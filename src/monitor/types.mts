'use strict';

// ── Event types ──────────────────────────────────────────────────────────

/** All possible monitor event types */
export type MonitorEventType =
  | 'module_start'
  | 'module_stop'
  | 'module_error'
  | 'connector_connect'
  | 'connector_disconnect'
  | 'connector_reconnect'
  | 'registration'
  | 'unregistration'
  | 'backup_start'
  | 'backup_complete'
  | 'backup_failed'
  | 'stats_anomaly';

// ── Module state ─────────────────────────────────────────────────────────

/** Health status of an observed module */
export type ModuleStatus = 'healthy' | 'degraded' | 'down' | 'unknown';

/** Tracked state for a single observed module */
export interface ModuleState {
  name: string;
  version: string;
  status: ModuleStatus;
  uptime: number;                // ms
  messageCount: number;
  lastSeen: number;              // timestamp (Date.now())
  errorCount: number;
  previousUptime?: number;       // for restart detection
  previousErrorCount?: number;   // for error delta detection
}

// ── Connector state ──────────────────────────────────────────────────────

/** Connection status of a connector */
export type ConnectorStatus = 'connected' | 'disconnected' | 'connecting';

/** Tracked state for a single connector */
export interface ConnectorState {
  platform: string;              // 'irc' | 'discord'
  network: string;               // e.g. 'libera'
  status: ConnectorStatus;
  channels: string[];
  channelCount: number;          // tracked for anomaly detection
  lastChanged: number;           // timestamp (Date.now())
  disconnectedSince?: number;    // timestamp if currently disconnected
}

// ── Monitor state ────────────────────────────────────────────────────────

/** Top-level state of the entire observed system */
export interface MonitorState {
  modules: Map<string, ModuleState>;
  connectors: Map<string, ConnectorState>;
  startTime: number;
}

// ── Events ───────────────────────────────────────────────────────────────

/** A single event detected or observed by the monitor */
export interface MonitorEvent {
  timestamp: number;
  type: MonitorEventType;
  source: string;                // module/connector name
  detail: string;                // human-readable summary
  raw?: unknown;                 // original NATS payload
  suppressed?: boolean;          // if true, hide from stdout renderer (still processed for state)
}

// ── Stats response (from other modules) ──────────────────────────────────

/** Stats response received from a module via stats.emit.request fan-out */
export interface StatsResponse {
  module: string;
  stats: Record<string, string | number | boolean | object | null | undefined>;
}

// ── Monitor's own stats payload ──────────────────────────────────────────

/** Stats payload the monitor reports about itself */
export interface MonitorStats {
  version: string;
  uptime_formatted: string;
  memory_rss_mb: number;
  prometheus_metrics: string;
  // Monitor-specific:
  modules_observed: number;      // total modules in state table
  modules_healthy: number;       // modules with status 'healthy'
  modules_degraded: number;      // modules with status 'degraded'
  modules_down: number;          // modules with status 'down' or stale
  connectors_observed: number;
  connectors_connected: number;
  events_processed: number;      // total events emitted to renderer
  summary_intervals_completed: number;
}

// ── Configuration ────────────────────────────────────────────────────────

/** Monitor module configuration (CRD-driven, same as other botModules) */
export interface MonitorConfig {
  summaryInterval: number;       // ms between summary blocks (default 60000)
  maxModuleAge: number;          // ms before a module is considered stale (default 300000)
  displayEvents: MonitorEventType[];  // event types shown in --follow event log
  filters: string[];             // default subject prefix filters
}

// ── Renderer ─────────────────────────────────────────────────────────────

/** Interface implemented by all renderers (stdout, raw, tui) */
export interface MonitorRenderer {
  start(state: MonitorState): void;
  onEvent(event: MonitorEvent): void;
  onInterval(state: MonitorState): void;
  onRawMessage?(subject: string, payload: string): void;  // for --raw mode
  stop(): void;
}
