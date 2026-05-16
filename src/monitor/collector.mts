'use strict';

import * as crypto from 'crypto';
import { NatsClient, log, NatsSubscriptionResult } from '@eeveebot/libeevee';
import { MonitorStateTracker } from './state.mjs';
import { MonitorRenderer, MonitorConfig, MonitorEvent, StatsResponse, ConnectorStatus } from './types.mjs';

/** Interval for collecting stats from all modules (5s) */
const STATS_COLLECTION_TIMEOUT_MS = 5000;

/**
 * The collector owns all NATS subscriptions and the summary interval timer.
 * It observes the system and drives the renderer with events and interval summaries.
 */
export class MonitorCollector {
  private readonly nats: InstanceType<typeof NatsClient>;
  private readonly state: MonitorStateTracker;
  private readonly renderer: MonitorRenderer;
  private readonly config: MonitorConfig;
  private readonly subscriptions: Promise<NatsSubscriptionResult>[] = [];
  private intervalTimer: ReturnType<typeof setInterval> | null = null;
  private isRunning = false;
  private readonly isRawMode: boolean;

  constructor(
    nats: InstanceType<typeof NatsClient>,
    state: MonitorStateTracker,
    renderer: MonitorRenderer,
    config: MonitorConfig,
  ) {
    this.nats = nats;
    this.state = state;
    this.renderer = renderer;
    this.config = config;
    this.isRawMode = typeof renderer.onRawMessage === 'function';
  }

  /** Start all subscriptions and the summary interval */
  async start(): Promise<void> {
    if (this.isRunning) {
      log.warn('Collector already running', { producer: 'monitor' });
      return;
    }

    this.isRunning = true;
    log.info('Starting monitor collector', { producer: 'monitor' });

    // Subscribe to observation subjects
    await this.subscribeToStatsEmit();
    await this.subscribeToConnectorControl();
    await this.subscribeToCommandRegistrations();
    await this.subscribeToBroadcastRegistrations();
    await this.subscribeToHelpUpdates();

    // Start the renderer with current (empty) state
    this.renderer.start(this.state.getState());

    // Start the summary interval
    this.startInterval();

    log.info('Monitor collector started', {
      producer: 'monitor',
      summaryInterval: this.config.summaryInterval,
    });
  }

  /** Stop all subscriptions and the interval timer */
  stop(): void {
    if (!this.isRunning) return;

    this.isRunning = false;

    if (this.intervalTimer !== null) {
      clearInterval(this.intervalTimer);
      this.intervalTimer = null;
    }

    // Unsubscribe all
    for (const subPromise of this.subscriptions) {
      void subPromise.then((sub) => {
        if (sub && typeof sub !== 'boolean' && !sub.isClosed()) {
          sub.unsubscribe();
        }
      });
    }
    this.subscriptions.length = 0;

    this.renderer.stop();

    log.info('Monitor collector stopped', { producer: 'monitor' });
  }

  // ── Subscription setup ──────────────────────────────────────────────

  /** Subscribe to stats.emit.> for passive anomaly detection */
  private async subscribeToStatsEmit(): Promise<void> {
    const sub = this.nats.subscribe('stats.emit.>', (subject, message) => {
      try {
        const payload = message.string();
        if (this.forwardRaw(subject, payload)) return;

        const data = JSON.parse(payload) as StatsResponse;
        if (!data.module) return;

        const events = this.state.updateAndDetect(data.module, data.stats);
        this.emitEvents(events);
      } catch (error) {
        log.error('Failed to process stats emission', {
          producer: 'monitor',
          subject,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });
    this.subscriptions.push(sub);
  }

  /** Subscribe to control.connectors.> for connector lifecycle events */
  private async subscribeToConnectorControl(): Promise<void> {
    const sub = this.nats.subscribe('control.connectors.>', (subject, message) => {
      try {
        const payload = message.string();
        if (this.forwardRaw(subject, payload)) return;

        const data = JSON.parse(payload) as {
          platform?: string;
          network?: string;
          action?: string;
          channels?: string[];
          status?: string;
        };

        // Extract connector identity from the subject: control.connectors.<platform>.<network>
        const parts = subject.split('.');
        // parts: ['control', 'connectors', platform, network, ...]
        const platform = data.platform ?? parts[2] ?? 'unknown';
        const network = data.network ?? parts[3] ?? 'unknown';

        // Determine connector status from the action/event
        let status: ConnectorStatus = 'disconnected';
        if (data.action === 'connect' || data.action === 'connected' || data.status === 'connected') {
          status = 'connected';
        } else if (data.action === 'reconnect' || data.action === 'reconnecting') {
          status = 'connecting';
        }

        const channels = Array.isArray(data.channels) ? data.channels : [];
        const events = this.state.updateConnector(platform, network, status, channels);
        this.emitEvents(events);
      } catch (error) {
        log.error('Failed to process connector control message', {
          producer: 'monitor',
          subject,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });
    this.subscriptions.push(sub);
  }

  /** Subscribe to command register/unregister for registration events */
  private async subscribeToCommandRegistrations(): Promise<void> {
    const registerSub = this.nats.subscribe('command.register', (subject, message) => {
      try {
        const payload = message.string();
        if (this.forwardRaw(subject, payload)) return;

        const data = JSON.parse(payload) as { module?: string; command?: string };
        this.emitEvents([{
          timestamp: Date.now(),
          type: 'registration',
          source: data.module ?? 'unknown',
          detail: `command registered: ${data.command ?? 'unknown'}`,
        }]);
      } catch (error) {
        log.error('Failed to process command.register', {
          producer: 'monitor',
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });
    this.subscriptions.push(registerSub);

    const unregisterSub = this.nats.subscribe('command.unregister', (subject, message) => {
      try {
        const payload = message.string();
        if (this.forwardRaw(subject, payload)) return;

        const data = JSON.parse(payload) as { module?: string; command?: string };
        this.emitEvents([{
          timestamp: Date.now(),
          type: 'unregistration',
          source: data.module ?? 'unknown',
          detail: `command unregistered: ${data.command ?? 'unknown'}`,
        }]);
      } catch (error) {
        log.error('Failed to process command.unregister', {
          producer: 'monitor',
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });
    this.subscriptions.push(unregisterSub);
  }

  /** Subscribe to broadcast register/unregister for registration events */
  private async subscribeToBroadcastRegistrations(): Promise<void> {
    const registerSub = this.nats.subscribe('broadcast.register', (subject, message) => {
      try {
        const payload = message.string();
        if (this.forwardRaw(subject, payload)) return;

        const data = JSON.parse(payload) as { module?: string; broadcast?: string };
        this.emitEvents([{
          timestamp: Date.now(),
          type: 'registration',
          source: data.module ?? 'unknown',
          detail: `broadcast registered: ${data.broadcast ?? 'unknown'}`,
        }]);
      } catch (error) {
        log.error('Failed to process broadcast.register', {
          producer: 'monitor',
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });
    this.subscriptions.push(registerSub);

    const unregisterSub = this.nats.subscribe('broadcast.unregister', (subject, message) => {
      try {
        const payload = message.string();
        if (this.forwardRaw(subject, payload)) return;

        const data = JSON.parse(payload) as { module?: string; broadcast?: string };
        this.emitEvents([{
          timestamp: Date.now(),
          type: 'unregistration',
          source: data.module ?? 'unknown',
          detail: `broadcast unregistered: ${data.broadcast ?? 'unknown'}`,
        }]);
      } catch (error) {
        log.error('Failed to process broadcast.unregister', {
          producer: 'monitor',
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });
    this.subscriptions.push(unregisterSub);
  }

  /** Subscribe to help update/remove for registration events */
  private async subscribeToHelpUpdates(): Promise<void> {
    const updateSub = this.nats.subscribe('help.update', (subject, message) => {
      try {
        const payload = message.string();
        if (this.forwardRaw(subject, payload)) return;

        const data = JSON.parse(payload) as { module?: string };
        this.emitEvents([{
          timestamp: Date.now(),
          type: 'registration',
          source: data.module ?? 'unknown',
          detail: 'help entry updated',
        }]);
      } catch (error) {
        log.error('Failed to process help.update', {
          producer: 'monitor',
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });
    this.subscriptions.push(updateSub);

    const removeSub = this.nats.subscribe('help.remove', (subject, message) => {
      try {
        const payload = message.string();
        if (this.forwardRaw(subject, payload)) return;

        const data = JSON.parse(payload) as { module?: string };
        this.emitEvents([{
          timestamp: Date.now(),
          type: 'unregistration',
          source: data.module ?? 'unknown',
          detail: 'help entry removed',
        }]);
      } catch (error) {
        log.error('Failed to process help.remove', {
          producer: 'monitor',
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });
    this.subscriptions.push(removeSub);
  }

  // ── Interval & stats collection ─────────────────────────────────────

  /** Start the periodic summary interval */
  private startInterval(): void {
    this.intervalTimer = setInterval(() => {
      void this.runSummaryCycle();
    }, this.config.summaryInterval);
  }

  /**
   * Run one summary cycle:
   * 1. Detect stale modules
   * 2. Subscribe to reply channel
   * 3. Publish stats.emit.request
   * 4. Collect responses for 5s
   * 5. Update state from responses
   * 6. Call renderer.onInterval with fresh state
   */
  private async runSummaryCycle(): Promise<void> {
    try {
      // 1. Detect stale modules before requesting fresh stats
      const staleEvents = this.state.detectStaleModules();
      this.emitEvents(staleEvents);

      // 2. Subscribe to a unique reply channel
      const replyChannel = `stats.emit.response.${crypto.randomUUID()}`;
      const responses: StatsResponse[] = [];

      const replySub = await this.nats.subscribe(replyChannel, (_subject, message) => {
        try {
          const replyData = JSON.parse(message.string()) as StatsResponse;
          if (replyData.module) {
            responses.push(replyData);
          }
        } catch (error) {
          log.error('Failed to parse stats response', {
            producer: 'monitor',
            error: error instanceof Error ? error.message : String(error),
          });
        }
      });

      // 3. Publish stats.emit.request with the reply channel
      const statsRequest = { replyChannel };
      await this.nats.publish('stats.emit.request', JSON.stringify(statsRequest));

      // 4. Wait 5s for responses (always wait full window)
      await new Promise<void>((resolve) => {
        setTimeout(resolve, STATS_COLLECTION_TIMEOUT_MS);
      });

      // Unsubscribe from the reply channel
      if (replySub && !replySub.isClosed()) {
        replySub.unsubscribe();
      }

      // 5. Update state from responses
      this.state.updateFromStatsResponses(responses);
      this.state.recordSummaryInterval();

      // 6. Render the summary
      this.renderer.onInterval(this.state.getState());

      log.info('Summary cycle completed', {
        producer: 'monitor',
        responsesReceived: responses.length,
      });
    } catch (error) {
      log.error('Failed to run summary cycle', {
        producer: 'monitor',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // ── Event dispatch ──────────────────────────────────────────────────

  /** Forward raw NATS message to renderer if in raw mode. Returns true if consumed. */
  private forwardRaw(subject: string, payload: string): boolean {
    if (this.isRawMode && this.renderer.onRawMessage) {
      this.renderer.onRawMessage(subject, payload);
      return true;
    }
    return false;
  }

  /** Forward events to the renderer, filtered by displayEvents config */
  private emitEvents(events: MonitorEvent[]): void {
    const displaySet = new Set(this.config.displayEvents);
    for (const event of events) {
      if (displaySet.has(event.type)) {
        this.renderer.onEvent(event);
      }
    }
  }
}
