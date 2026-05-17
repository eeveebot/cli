'use strict';

import {
  MonitorState,
  ModuleState,
  ModuleStatus,
  ConnectorState,
  ConnectorStatus,
  MonitorEvent,
  MonitorEventType,
  StatsResponse,
  MonitorConfig,
} from './types.mjs';
import { parseHistograms, calculatePercentileFromBuckets } from './histogram.mjs';

/** Manages in-memory state of all observed modules and connectors. */
export class MonitorStateTracker {
  private readonly modules = new Map<string, ModuleState>();
  private readonly connectors = new Map<string, ConnectorState>();
  private readonly startTime: number;
  private readonly config: MonitorConfig;
  private eventsProcessed = 0;
  private summaryIntervalsCompleted = 0;

  constructor(config: MonitorConfig) {
    this.startTime = Date.now();
    this.config = config;
  }

  /** Return a snapshot of the current state */
  getState(): MonitorState {
    return {
      modules: new Map(this.modules),
      connectors: new Map(this.connectors),
      startTime: this.startTime,
    };
  }

  /** Increment the summary intervals counter */
  recordSummaryInterval(): void {
    this.summaryIntervalsCompleted++;
  }

  /** Get the total events processed count */
  getEventsProcessed(): number {
    return this.eventsProcessed;
  }

  /** Get the summary intervals completed count */
  getSummaryIntervalsCompleted(): number {
    return this.summaryIntervalsCompleted;
  }

  /** Get the monitor start time */
  getStartTime(): number {
    return this.startTime;
  }

  // ── Passive stats emission handler ──────────────────────────────────

  /**
   * Process a passive stats emission and detect anomalies.
   * Called when a `stats.emit.>` message is received between summary cycles.
   * Returns any detected anomaly events.
   */
  updateAndDetect(moduleName: string, stats: StatsResponse['stats']): MonitorEvent[] {
    const events: MonitorEvent[] = [];
    const now = Date.now();

    const previous = this.modules.get(moduleName);
    const current = this.parseModuleState(moduleName, stats, now);

    if (!previous) {
      // New module appeared
      this.modules.set(moduleName, current);
      events.push(this.createEvent('module_start', moduleName, `module appeared: ${moduleName}`));
      this.eventsProcessed += events.length;
      return events;
    }

    // Detect anomalies by comparing against previous state
    const anomalies = this.detectModuleAnomalies(previous, current);
    events.push(...anomalies);

    // Update state (shift current values into previous* fields)
    current.previousUptime = previous.uptime;
    current.previousErrorCount = previous.errorCount;
    this.modules.set(moduleName, current);

    this.eventsProcessed += events.length;
    return events;
  }

  // ── Batch update from interval stats collection ─────────────────────

  /**
   * Batch-update state from stats responses collected during an interval cycle.
   * Produces connector lifecycle events when connector data is found in responses.
   * Module anomaly detection happens in updateAndDetect for passive emissions.
   */
  updateFromStatsResponses(responses: StatsResponse[]): MonitorEvent[] {
    const now = Date.now();
    const events: MonitorEvent[] = [];

    for (const resp of responses) {
      if (!resp.module) continue;

      const previous = this.modules.get(resp.module);
      const current = this.parseModuleState(resp.module, resp.stats, now);

      if (previous) {
        current.previousUptime = previous.uptime;
        current.previousErrorCount = previous.errorCount;
      }

      this.modules.set(resp.module, current);

      // Extract connector state from connector module stats
      const connectorEvents = this.parseConnectorsFromStats(resp.module, resp.stats);
      events.push(...connectorEvents);
    }

    this.eventsProcessed += events.length;
    return events;
  }

  // ── Stale module detection ──────────────────────────────────────────

  /**
   * Check all known modules for staleness (no stats within maxModuleAge).
   * Called before each summary interval.
   * Returns events for any modules that have gone stale.
   */
  detectStaleModules(): MonitorEvent[] {
    const events: MonitorEvent[] = [];
    const now = Date.now();

    for (const [name, state] of this.modules) {
      if (state.status === 'down') continue; // already marked down

      const age = now - state.lastSeen;
      if (age > this.config.maxModuleAge) {
        state.status = 'down';
        events.push(this.createEvent('stats_anomaly', name, `module silent for ${Math.round(age / 1000)}s (threshold: ${Math.round(this.config.maxModuleAge / 1000)}s)`));
      }
    }

    this.eventsProcessed += events.length;
    return events;
  }

  // ── Connector state updates ─────────────────────────────────────────

  /**
   * Update connector state from a control message.
   * Returns events for any detected anomalies (status change, channel count change).
   */
  updateConnector(
    platform: string,
    network: string,
    status: ConnectorStatus,
    channels: string[],
  ): MonitorEvent[] {
    const events: MonitorEvent[] = [];
    const now = Date.now();
    const key = `${platform}:${network}`;

    const current: ConnectorState = {
      platform,
      network,
      status,
      channels,
      channelCount: channels.length,
      lastChanged: now,
      disconnectedSince: status === 'disconnected' ? now : undefined,
    };

    const previous = this.connectors.get(key);

    if (!previous) {
      // New connector appeared
      this.connectors.set(key, current);
      const eventType = status === 'connected' ? 'connector_connect' : 'connector_disconnect';
      events.push(this.createEvent(eventType, key, `connector appeared: ${platform}:${network} (${status})`));
      this.eventsProcessed += events.length;
      return events;
    }

    // Status change
    if (previous.status !== status) {
      let eventType: MonitorEventType;
      let detail: string;

      if (status === 'connected' && previous.status !== 'connected') {
        eventType = 'connector_reconnect';
        detail = `${platform}:${network} reconnected`;
      } else if (status === 'disconnected') {
        eventType = 'connector_disconnect';
        detail = `${platform}:${network} disconnected`;
        current.disconnectedSince = now;
      } else {
        eventType = 'connector_connect';
        detail = `${platform}:${network} status changed: ${previous.status} → ${status}`;
      }

      events.push(this.createEvent(eventType, key, detail));
    }

    // Channel count change (any delta is anomalous)
    if (previous.channelCount !== current.channelCount) {
      const delta = current.channelCount - previous.channelCount;
      const direction = delta > 0 ? 'gained' : 'lost';
      const absDelta = Math.abs(delta);
      events.push(this.createEvent(
        'stats_anomaly',
        key,
        `${platform}:${network} ${direction} ${absDelta} channel${absDelta !== 1 ? 's' : ''} (${previous.channelCount} → ${current.channelCount})`,
      ));
    }

    // Preserve disconnectedSince if still disconnected (keep original timestamp)
    if (status === 'disconnected' && previous.disconnectedSince) {
      current.disconnectedSince = previous.disconnectedSince;
    }

    this.connectors.set(key, current);
    this.eventsProcessed += events.length;
    return events;
  }

  // ── Stats helpers ───────────────────────────────────────────────────

  /** Count modules by status */
  countModulesByStatus(): { healthy: number; degraded: number; down: number; total: number } {
    let healthy = 0;
    let degraded = 0;
    let down = 0;

    for (const state of this.modules.values()) {
      switch (state.status) {
        case 'healthy': healthy++; break;
        case 'degraded': degraded++; break;
        case 'down': down++; break;
        // 'unknown' counts as down for stats purposes
        case 'unknown': down++; break;
      }
    }

    return { healthy, degraded, down, total: this.modules.size };
  }

  /** Count connectors by status */
  countConnectorsByStatus(): { connected: number; total: number } {
    let connected = 0;
    for (const state of this.connectors.values()) {
      if (state.status === 'connected') connected++;
    }
    return { connected, total: this.connectors.size };
  }

  // ── Connector extraction from stats ────────────────────────────────

  /**
   * Parse connector state from a stats response that includes connector data.
   * connector-irc includes a `connector` array in its stats payload.
   * Each entry: { name, connected, channels (count), host, nick, reconnects, ... }
   */
  private parseConnectorsFromStats(
    moduleName: string,
    stats: StatsResponse['stats'],
  ): MonitorEvent[] {
    const events: MonitorEvent[] = [];

    // Only connector modules have connector data
    if (!moduleName.startsWith('connector-')) return events;

    const connectorData = stats.connector;
    if (!Array.isArray(connectorData)) return events;

    // Derive platform from module name: connector-irc → irc
    const platform = moduleName.replace('connector-', '');

    for (const conn of connectorData) {
      const network = typeof conn.name === 'string' ? conn.name : 'unknown';
      const connected = conn.connected === true;
      const channelCount = typeof conn.channels === 'number' ? conn.channels : 0;
      const status: ConnectorStatus = connected ? 'connected' : 'disconnected';

      // Build a channels array from the count (we don't have names, just the count)
      const channels: string[] = channelCount > 0 ? [`<${channelCount} channels>`] : [];

      const connEvents = this.updateConnector(platform, network, status, channels);
      events.push(...connEvents);
    }

    return events;
  }

  // ── Private helpers ─────────────────────────────────────────────────

  /** Parse a stats emission into a ModuleState */
  private parseModuleState(
    moduleName: string,
    stats: StatsResponse['stats'],
    now: number,
  ): ModuleState {
    // uptime_seconds is in seconds, convert to ms for internal use
    const uptimeSeconds = typeof stats.uptime_seconds === 'number' ? stats.uptime_seconds : 0;
    const uptime = uptimeSeconds * 1000;
    const version = typeof stats.version === 'string' ? stats.version : '—';
    const memoryRssMb = typeof stats.memory_rss_mb === 'number' ? stats.memory_rss_mb : 0;

    // Parse counters from prometheus_metrics text blob
    const promText = typeof stats.prometheus_metrics === 'string' ? stats.prometheus_metrics : '';
    const messageCount = parsePrometheusCounter(promText, 'messages_total', { result: 'processed' });
    const commandCount = parsePrometheusCounter(promText, 'commands_total', { result: 'success' });
    const errorCount = parsePrometheusCounter(promText, 'errors_total');

    // Parse histograms for latency percentiles
    const histograms = parseHistograms(promText);
    let messageP50: number | null = null;
    let messageP95: number | null = null;
    let commandP50: number | null = null;
    let commandP95: number | null = null;

    const msgHist = histograms.get('message_processing_seconds');
    if (msgHist && msgHist.count > 0) {
      const p50 = calculatePercentileFromBuckets(msgHist.buckets, msgHist.count, 0.5);
      const p95 = calculatePercentileFromBuckets(msgHist.buckets, msgHist.count, 0.95);
      if (p50 !== null) messageP50 = Math.round(p50 * 1000);
      if (p95 !== null) messageP95 = Math.round(p95 * 1000);
    }

    const cmdHist = histograms.get('command_processing_seconds');
    if (cmdHist && cmdHist.count > 0) {
      const p50 = calculatePercentileFromBuckets(cmdHist.buckets, cmdHist.count, 0.5);
      const p95 = calculatePercentileFromBuckets(cmdHist.buckets, cmdHist.count, 0.95);
      if (p50 !== null) commandP50 = Math.round(p50 * 1000);
      if (p95 !== null) commandP95 = Math.round(p95 * 1000);
    }

    // Determine status
    let status: ModuleStatus = 'unknown';
    if (uptime > 0 && errorCount === 0) {
      status = 'healthy';
    } else if (uptime > 0 && errorCount > 0) {
      status = 'degraded';
    } else if (uptime === 0) {
      status = 'down';
    }

    return {
      name: moduleName,
      version,
      status,
      uptime,
      messageCount,
      commandCount,
      errorCount,
      memoryRssMb,
      messageP50,
      messageP95,
      commandP50,
      commandP95,
      lastSeen: now,
    };
  }

  /** Detect anomalies by comparing previous and current module state */
  private detectModuleAnomalies(previous: ModuleState, current: ModuleState): MonitorEvent[] {
    const events: MonitorEvent[] = [];

    // Uptime reset — module restarted
    if (current.uptime < previous.uptime && previous.uptime > 0) {
      events.push(this.createEvent(
        'stats_anomaly',
        current.name,
        `restarted (uptime: ${this.formatUptime(previous.uptime)} → ${this.formatUptime(current.uptime)})`,
      ));
    }

    // Error count increase — any delta
    if (current.errorCount > previous.errorCount) {
      const delta = current.errorCount - previous.errorCount;
      events.push(this.createEvent(
        'module_error',
        current.name,
        `errors increased by ${delta} (${previous.errorCount} → ${current.errorCount})`,
      ));
    }

    // Status transition to down
    if (current.status === 'down' && previous.status !== 'down') {
      events.push(this.createEvent(
        'module_stop',
        current.name,
        `module went down (was ${previous.status})`,
      ));
    }

    // Status recovery from down/degraded to healthy
    if (current.status === 'healthy' && (previous.status === 'down' || previous.status === 'degraded')) {
      events.push(this.createEvent(
        'module_start',
        current.name,
        `module recovered (${previous.status} → healthy)`,
      ));
    }

    return events;
  }

  /** Create a MonitorEvent with the current timestamp */
  private createEvent(type: MonitorEventType, source: string, detail: string): MonitorEvent {
    return {
      timestamp: Date.now(),
      type,
      source,
      detail,
    };
  }

  /** Format uptime in milliseconds to human-readable string */
  private formatUptime(ms: number): string {
    if (ms < 60000) return `${Math.round(ms / 1000)}s`;
    const minutes = Math.floor(ms / 60000);
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    if (hours < 24) return `${hours}h${remainingMinutes}m`;
    const days = Math.floor(hours / 24);
    const remainingHours = hours % 24;
    return `${days}d${remainingHours}h`;
  }
}

// ── Prometheus text parser ───────────────────────────────────────────────

/**
 * Parse a counter value from Prometheus metrics text.
 * Sums values across all label combinations, optionally filtering by labels.
 * Lightweight version of admin's parseCounter — only what the monitor needs.
 */
function parsePrometheusCounter(
  metricsText: string,
  metricName: string,
  labelFilter?: Record<string, string>,
): number {
  let total = 0;
  const lines = metricsText.split('\n');

  for (const line of lines) {
    if (line.startsWith('#') || line.trim() === '') continue;

    const match = line.match(
      new RegExp(`^${metricName}\\{([^}]*)\\}\\s+([\\d.]+)`),
    );
    if (!match) continue;

    const labelsStr = match[1];
    const value = parseFloat(match[2]);
    if (isNaN(value)) continue;

    // Apply label filter
    if (labelFilter) {
      let matches = true;
      for (const [key, val] of Object.entries(labelFilter)) {
        if (!labelsStr.includes(`${key}="${val}"`)) {
          matches = false;
          break;
        }
      }
      if (!matches) continue;
    }

    total += value;
  }

  return total;
}
