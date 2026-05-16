'use strict';

import fs from 'node:fs';

import {
  NatsClient,
  log,
  createNatsConnection,
  registerGracefulShutdown,
  createModuleMetrics,
  initializeSystemMetrics,
  setupHttpServer,
} from '@eeveebot/libeevee';
import { loadMonitorConfig } from './config.mjs';
import { MonitorStateTracker } from './state.mjs';
import { MonitorCollector } from './collector.mjs';
import { MonitorRenderer, MonitorConfig } from './types.mjs';
import { setupMonitorStats } from './stats.mjs';
import { StdoutRenderer } from '../render/stdout.mjs';
import { RawRenderer } from '../render/raw.mjs';

/** Argument types for the monitor command */
interface MonitorArgv {
  follow?: boolean;
  raw?: boolean;
  filter?: string;
  modules?: string;
  noSummary?: boolean;
  noColor?: boolean;
}

/**
 * Handle the "eevee monitor" subcommand.
 * Wires NATS connection, config, state, collector, renderer, stats, and shutdown.
 */
export async function handleMonitorCommand(argv: MonitorArgv): Promise<void> {
  const moduleStartTime = Date.now();
  const moduleVersion = JSON.parse(
    fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
  ).version as string;

  log.info('Starting eevee monitor', {
    producer: 'monitor',
    version: moduleVersion,
    mode: argv.raw ? 'raw' : argv.follow ? 'follow' : 'follow',
  });

  // Initialize module metrics
  const metrics = createModuleMetrics('monitor');
  initializeSystemMetrics('monitor');

  // NATS connection
  const natsClients: InstanceType<typeof NatsClient>[] = [];
  const nats = await createNatsConnection();
  natsClients.push(nats);

  // HTTP server for health + metrics
  setupHttpServer({
    port: process.env.HTTP_API_PORT || '9000',
    serviceName: 'monitor',
    natsClients: natsClients,
  });

  // Load configuration
  let config: MonitorConfig;
  try {
    config = await loadMonitorConfig();
  } catch (error) {
    log.error('Failed to load monitor config, using defaults', {
      producer: 'monitor',
      error: error instanceof Error ? error.message : String(error),
    });
    // Use defaults so the monitor can still start
    config = {
      summaryInterval: 60000,
      maxModuleAge: 300000,
      displayEvents: [
        'module_start', 'module_stop', 'module_error',
        'connector_connect', 'connector_disconnect', 'connector_reconnect',
        'registration', 'unregistration',
        'backup_start', 'backup_complete', 'backup_failed',
        'stats_anomaly',
      ],
      filters: [],
    };
  }

  // State tracker
  const state = new MonitorStateTracker(config);

  // Renderer
  const renderer = createRenderer(argv);

  // Collector
  const collector = new MonitorCollector(nats, state, renderer, config);

  // Stats responder
  void setupMonitorStats(nats, state, moduleStartTime, moduleVersion, metrics);

  // Graceful shutdown
  registerGracefulShutdown(natsClients, async () => {
    collector.stop();
    log.info('Monitor shutdown complete', { producer: 'monitor' });
  });

  // Start collecting
  await collector.start();

  log.info('eevee monitor running', {
    producer: 'monitor',
    version: moduleVersion,
    summaryInterval: config.summaryInterval,
    maxModuleAge: config.maxModuleAge,
  });

  // Keep the process alive — the interval timer in the collector does this,
  // but we prevent the main function from returning as a safety measure.
  await new Promise<void>(() => {
    // Never resolves — process exits via graceful shutdown handler
  });
}

/** Create the appropriate renderer based on CLI flags */
function createRenderer(argv: MonitorArgv): MonitorRenderer {
  if (argv.raw) {
    return new RawRenderer();
  }

  // Default to stdout (--follow mode, or bare command until TUI is built)
  return new StdoutRenderer({
    noColor: argv.noColor ?? false,
    noSummary: argv.noSummary ?? false,
  });
}
