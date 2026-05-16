'use strict';

import fs from 'node:fs';
import yaml from 'js-yaml';
import { log } from '@eeveebot/libeevee';
import { MonitorConfig, MonitorEventType } from './types.mjs';

const CONFIG_ENV_VAR = 'MODULE_CONFIG_PATH';

/** All valid monitor event types — used to validate displayEvents config */
const VALID_EVENT_TYPES: ReadonlySet<string> = new Set<string>([
  'module_start',
  'module_stop',
  'module_error',
  'connector_connect',
  'connector_disconnect',
  'connector_reconnect',
  'registration',
  'unregistration',
  'backup_start',
  'backup_complete',
  'backup_failed',
  'stats_anomaly',
]);

/** Default displayEvents — all anomaly types shown by default */
const DEFAULT_DISPLAY_EVENTS: MonitorEventType[] = [
  'module_start',
  'module_stop',
  'module_error',
  'connector_connect',
  'connector_disconnect',
  'connector_reconnect',
  'registration',
  'unregistration',
  'backup_start',
  'backup_complete',
  'backup_failed',
  'stats_anomaly',
];

/** Default monitor configuration values */
const DEFAULTS: Readonly<MonitorConfig> = {
  summaryInterval: 60000,
  maxModuleAge: 300000,
  displayEvents: DEFAULT_DISPLAY_EVENTS,
  filters: [],
} as const;

/** Raw config shape from YAML — all fields optional */
interface RawMonitorConfig {
  monitor?: {
    summaryInterval?: number;
    maxModuleAge?: number;
    displayEvents?: string[];
    filters?: string[];
  };
}

/**
 * Load monitor configuration from CRD-driven YAML file.
 * Follows the same pattern as admin, router, and connector-irc:
 * - Read path from MODULE_CONFIG_PATH env var
 * - Parse YAML
 * - Validate and apply defaults
 * @returns MonitorConfig with all fields populated
 */
export async function loadMonitorConfig(): Promise<MonitorConfig> {
  const configPath = process.env[CONFIG_ENV_VAR];
  if (!configPath) {
    const msg = `Environment variable ${CONFIG_ENV_VAR} is not set.`;
    log.error(msg, { producer: 'monitor' });
    throw new Error(msg);
  }

  try {
    const configFile = fs.readFileSync(configPath, 'utf8');
    const raw = yaml.load(configFile) as RawMonitorConfig;

    // The config may be empty or missing the monitor key — that's fine, use defaults
    const monitorSection = raw?.monitor ?? {};

    // summaryInterval
    const summaryInterval = typeof monitorSection.summaryInterval === 'number'
      ? monitorSection.summaryInterval
      : DEFAULTS.summaryInterval;
    if (summaryInterval < 1000) {
      log.warn('summaryInterval is very low, minimum 1000ms recommended', {
        producer: 'monitor',
        summaryInterval,
      });
    }

    // maxModuleAge
    const maxModuleAge = typeof monitorSection.maxModuleAge === 'number'
      ? monitorSection.maxModuleAge
      : DEFAULTS.maxModuleAge;
    if (maxModuleAge < 10000) {
      log.warn('maxModuleAge is very low, minimum 10000ms recommended', {
        producer: 'monitor',
        maxModuleAge,
      });
    }

    // displayEvents — validate each entry against known types
    const displayEvents: MonitorEventType[] = Array.isArray(monitorSection.displayEvents)
      ? monitorSection.displayEvents.filter((event): event is MonitorEventType => {
          if (!VALID_EVENT_TYPES.has(event)) {
            log.warn(`Unknown displayEvent type "${event}", ignoring`, {
              producer: 'monitor',
            });
            return false;
          }
          return true;
        })
      : DEFAULTS.displayEvents;

    // filters
    const filters = Array.isArray(monitorSection.filters)
      ? monitorSection.filters.filter((f): f is string => typeof f === 'string')
      : DEFAULTS.filters;

    const config: MonitorConfig = {
      summaryInterval,
      maxModuleAge,
      displayEvents,
      filters,
    };

    log.info('Loaded monitor configuration', {
      producer: 'monitor',
      configPath,
      summaryInterval,
      maxModuleAge,
      displayEventCount: displayEvents.length,
      filterCount: filters.length,
    });

    return config;
  } catch (error) {
    log.error('Failed to load monitor configuration', {
      producer: 'monitor',
      configPath,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
