'use strict';

import chalk from 'chalk';
import AsciiTable from 'ascii-table';
import { MonitorRenderer, MonitorState, MonitorEvent, ModuleState, ConnectorState } from '../monitor/types.mjs';

/** Maximum visible chars for module name column (truncated with …) */
const MAX_MODULE_NAME_LEN = 15;

/** Format a number compactly: 1.2k for counts > 999, raw for smaller */
function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

/** Format uptime in milliseconds to a short human-readable string */
function formatUptime(ms: number): string {
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

/** Format a timestamp to HH:MM:SS */
function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toTimeString().slice(0, 8);
}

/** Format latency p50/p95 as compact string */
function formatLatency(p50: number | null, p95: number | null): string {
  if (p50 === null && p95 === null) return '—';
  const p50Str = p50 !== null ? `${p50}` : '—';
  const p95Str = p95 !== null ? `${p95}` : '—';
  return `${p50Str}/${p95Str}ms`;
}

/** Truncate a module name to MAX_MODULE_NAME_LEN with ellipsis */
function truncateName(name: string): string {
  if (name.length <= MAX_MODULE_NAME_LEN) return name;
  return name.slice(0, MAX_MODULE_NAME_LEN - 1) + '…';
}

/** Map event types to chalk color functions */
function colorizeEvent(type: MonitorEvent['type'], text: string, noColor: boolean): string {
  if (noColor) return text;
  switch (type) {
    case 'module_start':
    case 'connector_connect':
    case 'connector_reconnect':
    case 'backup_complete':
    case 'registration':
      return chalk.green(text);
    case 'module_error':
    case 'module_stop':
    case 'connector_disconnect':
    case 'backup_failed':
      return chalk.red(text);
    case 'unregistration':
    case 'stats_anomaly':
      return chalk.yellow(text);
    case 'backup_start':
      return chalk.cyan(text);
    default:
      return text;
  }
}

/** Stdout renderer for --follow mode. Append-only, colored, periodic summary. */
export class StdoutRenderer implements MonitorRenderer {
  private readonly noColor: boolean;
  private readonly noSummary: boolean;

  constructor(options: { noColor?: boolean; noSummary?: boolean } = {}) {
    this.noColor = options.noColor ?? false;
    this.noSummary = options.noSummary ?? false;

    // Force ANSI colors on even without a TTY (container stdout via kubectl logs)
    // Only disable when --no-color is explicitly set
    if (this.noColor) {
      chalk.level = 0;
    } else {
      chalk.level = 1;
    }
  }

  start(state: MonitorState): void {
    const moduleCount = state.modules.size;
    const connectorCount = state.connectors.size;
    const line = this.noColor
      ? `eevee monitor started · ${moduleCount} modules · ${connectorCount} connectors`
      : chalk.bold(`eevee monitor started · ${moduleCount} modules · ${connectorCount} connectors`);
    console.log(line);
  }

  onEvent(event: MonitorEvent): void {
    if (event.suppressed) return;

    const time = formatTime(event.timestamp);
    const prefix = this.noColor ? `${time} ▸` : chalk.dim(`${time} ▸`);
    const detail = colorizeEvent(event.type, event.detail, this.noColor);
    console.log(`${prefix} ${detail}`);
  }

  onInterval(state: MonitorState): void {
    if (this.noSummary) return;

    const modules = Array.from(state.modules.values()).sort((a, b) => a.name.localeCompare(b.name));
    const connectors = Array.from(state.connectors.values()).sort((a, b) =>
      `${a.platform}:${a.network}`.localeCompare(`${b.platform}:${b.network}`),
    );

    const now = new Date();
    const timeStr = now.toTimeString().slice(0, 5);

    const moduleCount = modules.length;
    const connectorCount = connectors.length;
    const header = `  eevee monitor · ${timeStr} UTC · ${moduleCount} module${moduleCount !== 1 ? 's' : ''} · ${connectorCount} connector${connectorCount !== 1 ? 's' : ''}`;

    const separator = '─'.repeat(60);

    console.log('');
    console.log(this.noColor ? separator : chalk.dim(separator));
    console.log(this.noColor ? header : chalk.bold(header));
    console.log(this.noColor ? separator : chalk.dim(separator));

    // Module table
    const table = new AsciiTable();
    table.removeBorder();
    table.setHeading('Module', 'Ver', 'Uptime', 'Msgs', 'Cmds', 'Errs', 'Mem', 'MsgLat', 'CmdLat');

    // Right-align numeric columns (1-indexed)
    table.setAlign(4, AsciiTable.RIGHT);  // Msgs
    table.setAlign(5, AsciiTable.RIGHT);  // Cmds
    table.setAlign(6, AsciiTable.RIGHT);  // Errs

    for (const mod of modules) {
      const statusDot = this.formatModuleStatus(mod);
      const name = `${statusDot} ${truncateName(mod.name)}`;
      const uptime = mod.status === 'down' ? 'down' : formatUptime(mod.uptime);
      const msgs = formatCount(mod.messageCount);
      const cmds = formatCount(mod.commandCount);
      const errs = String(mod.errorCount);
      const mem = `${mod.memoryRssMb}MB`;
      const msgLat = formatLatency(mod.messageP50, mod.messageP95);
      const cmdLat = formatLatency(mod.commandP50, mod.commandP95);

      table.addRow(name, mod.version, uptime, msgs, cmds, errs, mem, msgLat, cmdLat);
    }

    // Print the table, applying dim to heading row
    const tableStr = table.toString();
    const tableLines = tableStr.split('\n');
    for (let i = 0; i < tableLines.length; i++) {
      // Lines 0-1 are heading + separator — dim them
      if (i <= 1 && !this.noColor) {
        console.log(chalk.dim(tableLines[i]));
      } else {
        console.log(tableLines[i]);
      }
    }

    // Connector section (freeform)
    if (connectors.length > 0) {
      console.log('');
      for (const conn of connectors) {
        const status = this.formatConnectorStatus(conn);
        const channels = conn.channels.length > 0 ? `  ${conn.channels.join(',')}` : '';
        const line = `  ${conn.platform.toUpperCase()}: ${conn.network} ${status}${channels}`;
        console.log(this.noColor ? line : this.colorizeConnectorLine(conn, line));
      }
    }

    console.log(this.noColor ? separator : chalk.dim(separator));
  }

  stop(): void {
    const line = this.noColor
      ? 'eevee monitor stopped'
      : chalk.dim('eevee monitor stopped');
    console.log(line);
  }

  // ── Private formatting helpers ──────────────────────────────────────

  private formatModuleStatus(mod: ModuleState): string {
    if (this.noColor) {
      return mod.status === 'healthy' ? '●' : '○';
    }
    return mod.status === 'healthy' ? chalk.green('●') : mod.status === 'degraded' ? chalk.yellow('●') : chalk.red('○');
  }

  private formatConnectorStatus(conn: ConnectorState): string {
    const base = conn.status === 'connected' ? '● connected' : '○ disconnected';
    if (this.noColor) return base;

    if (conn.status === 'connected') {
      return chalk.green(base);
    }

    // Show how long disconnected if we have the timestamp
    let suffix = '';
    if (conn.disconnectedSince) {
      const ago = Math.round((Date.now() - conn.disconnectedSince) / 60000);
      suffix = ` (${ago}m ago)`;
    }
    return chalk.red(`${base}${suffix}`);
  }

  private colorizeConnectorLine(conn: ConnectorState, line: string): string {
    if (conn.status !== 'connected') return chalk.dim(line);
    return line;
  }
}
