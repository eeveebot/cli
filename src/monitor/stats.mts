'use strict';

import { NatsClient, log, NatsSubscriptionResult, ModuleMetrics } from '@eeveebot/libeevee';
import { MonitorStateTracker } from './state.mjs';
import { MonitorStats } from './types.mjs';

/**
 * Set up the monitor's own stats responder.
 * Subscribes to stats.emit.request and responds with monitor-specific stats
 * (module/connector counts, event throughput) alongside standard fields.
 *
 * Note: We do NOT use registerStatsHandlers() because we need to include
 * monitor-specific fields in the response. Using both would cause duplicate
 * responses to the same request.
 */
export async function setupMonitorStats(
  nats: InstanceType<typeof NatsClient>,
  state: MonitorStateTracker,
  startTime: number,
  version: string,
  metrics: ModuleMetrics,
): Promise<Promise<NatsSubscriptionResult>[]> {
  const subscriptions: Promise<NatsSubscriptionResult>[] = [];

  // stats.emit.request — respond with full monitor stats
  const statsSub = nats.subscribe('stats.emit.request', (_subject, message) => {
    try {
      const data = JSON.parse(message.string()) as { replyChannel?: string };
      if (!data.replyChannel) return;

      const moduleCounts = state.countModulesByStatus();
      const connectorCounts = state.countConnectorsByStatus();

      const statsResponse: { module: string; stats: MonitorStats } = {
        module: 'monitor',
        stats: {
          version,
          uptime_formatted: formatUptime(Date.now() - startTime),
          memory_rss_mb: Math.round(process.memoryUsage().rss / (1024 * 1024)),
          prometheus_metrics: '',  // TODO: populate from prometheus register
          modules_observed: moduleCounts.total,
          modules_healthy: moduleCounts.healthy,
          modules_degraded: moduleCounts.degraded,
          modules_down: moduleCounts.down,
          connectors_observed: connectorCounts.total,
          connectors_connected: connectorCounts.connected,
          events_processed: state.getEventsProcessed(),
          summary_intervals_completed: state.getSummaryIntervalsCompleted(),
        },
      };

      void nats.publish(data.replyChannel, JSON.stringify(statsResponse));
      metrics.recordNatsPublish('monitor_stats_response');
    } catch (error) {
      log.error('Failed to send monitor stats response', {
        producer: 'monitor',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });
  subscriptions.push(statsSub);

  // stats.uptime — respond with basic uptime info
  const uptimeSub = nats.subscribe('stats.uptime', (_subject, message) => {
    try {
      const data = JSON.parse(message.string()) as { replyChannel?: string };
      if (!data.replyChannel) return;

      const uptime = Date.now() - startTime;
      const uptimeResponse = {
        module: 'monitor',
        version,
        uptime,
        uptimeFormatted: formatUptime(uptime),
      };

      void nats.publish(data.replyChannel, JSON.stringify(uptimeResponse));
      metrics.recordNatsPublish('monitor_uptime_response');
    } catch (error) {
      log.error('Failed to send uptime response', {
        producer: 'monitor',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });
  subscriptions.push(uptimeSub);

  return subscriptions;
}

/** Format milliseconds into a human-readable uptime string */
function formatUptime(ms: number): string {
  const days = Math.floor(ms / 86400000);
  const hours = Math.floor((ms % 86400000) / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  return `${days}d ${hours}h ${minutes}m ${seconds}s`;
}
