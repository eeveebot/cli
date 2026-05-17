# cli

> CLI interfaces for managing and monitoring eevee-bot via NATS.

## Overview

The `@eeveebot/cli` package provides a command-line tool for observing and interacting with an eevee-bot deployment. It connects to the bot's NATS messaging backbone to watch system activity in real time, detect anomalies, and display periodic health summaries.

The CLI is designed for operators and developers who need visibility into a running eevee instance without deploying a full chat connector. It relies on [`@eeveebot/libeevee`](https://github.com/eeveebot/libeevee-js) for NATS client abstractions and structured logging.

A companion Docker image (the **toolbox**) packages the CLI into a lightweight Alpine container with the NATS CLI utility pre-installed, making it easy to run debugging sessions alongside your eevee workloads in Kubernetes.

## Features

- **Real-time system observability** — tracks module health, connector status, and registrations across the eevee deployment
- **Periodic summary tables** — 9-column ASCII table with version, uptime, message/command counts, errors, memory, and p50/p95 latency percentiles
- **Event detection** — 12 event types covering module lifecycle, connector changes, registration activity, backup operations, and anomalies
- **Anomaly detection** — automatic restart detection, error delta tracking, stale module detection, connector channel count changes
- **Two renderers** — `--follow` (colored events + summary tables) and `--raw` (unformatted NATS firehose)
- **CRD-driven configuration** — `summaryInterval`, `maxModuleAge`, `displayEvents`, and `filters` configurable via YAML
- **Container-friendly** — forces ANSI colors for `kubectl logs` / k9s (which don't present a TTY but handle escape codes fine)
- **Prometheus histogram parsing** — latency percentiles computed from `message_processing_seconds` and `command_processing_seconds` buckets
- **Stats reporting** — monitor reports its own module/connector counts and event throughput via `stats.emit.request`
- **Toolbox container** — pre-built Docker image (multi-arch: amd64/arm64) with `eevee monitor` and the `nats` CLI
- **Graceful shutdown** — drains NATS connections on `SIGINT`/`SIGTERM`

## Install

This module is part of the eevee ecosystem. Install via the workspace:

```bash
cd /path/to/eevee/cli
npm install
```

Or install globally from GitHub Packages:

```bash
npm install -g @eeveebot/cli
```

The package is published to [GitHub Packages](https://github.com/eeveebot/cli/pkgs/npm/%40eeveebot%2Fcli). You'll need a `.npmrc` configured for the `@eeveebot` scope:

```ini
@eeveebot:registry=https://npm.pkg.github.com/
```

And authenticate with a GitHub personal access token that has `read:packages` scope.

## Configuration

### Environment Variables

Both CLI tools require two environment variables to connect to NATS:

| Variable | Required | Description |
|----------|----------|-------------|
| `NATS_HOST` | Yes | NATS server URL (e.g. `nats://nats.example.com:4222`) |
| `NATS_TOKEN` | Yes | Authentication token for the NATS server |

### Module Configuration

The monitor reads CRD-driven YAML configuration from the path specified by `MODULE_CONFIG_PATH`:

| Variable | Required | Description |
|----------|----------|-------------|
| `MODULE_CONFIG_PATH` | Yes (for config) | Path to YAML config file. If unset, monitor starts with defaults. |

**YAML structure:**

```yaml
monitor:
  summaryInterval: 60000     # ms between summary blocks (default: 60000)
  maxModuleAge: 300000       # ms before a module is considered stale (default: 300000)
  displayEvents:             # event types shown in --follow mode (default: all)
    - module_start
    - module_error
    - connector_disconnect
  filters:                   # default subject prefix filters (default: none)
    - chat.irc
```

If `MODULE_CONFIG_PATH` is unset or the file is missing, the monitor falls back to defaults and continues running.

## Usage

### `eevee monitor`

The primary command. Connects to NATS and observes the eevee system — tracking module health, connector status, registrations, and anomalies in real time.

```bash
export NATS_HOST="nats://nats.example.com:4222"
export NATS_TOKEN="***"
eevee monitor
```

#### Options

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--follow` | boolean | on by default | Append-only stdout mode with colored events and periodic summary tables |
| `--raw` | boolean | off | Unformatted NATS firehose — prints every message as `[subject] payload` |
| `--filter` | string | (none) | Subject prefix filter — only observe messages matching this prefix |
| `--modules` | string | (all) | Only track specified modules (comma-separated, e.g. `router,admin,seen`) |
| `--no-summary` | boolean | off | Disable periodic summary blocks (events still shown) |
| `--no-color` | boolean | off | Strip ANSI colors from output |

#### Follow Mode (default)

Displays real-time events as timestamped lines, plus a periodic summary table:

```
04:12:03 ▸ module appeared: weather
04:12:03 ▸ module appeared: router
04:12:08 ▸ connector-irc:libera reconnected
04:13:03 ▸ admin errors increased by 2 (0 → 2)

──────────────────────────────────────────────────────────
  eevee monitor · 04:13 UTC · 12 modules · 1 connector
──────────────────────────────────────────────────────────
  Module          Ver      Uptime   Msgs    Cmds  Errs    Mem   MsgLat     CmdLat
  ● admin         2.7.3     2h15m   1.2k      43     2   58MB  3/12ms    15/89ms
  ● router        2.5.5     2h15m   4.1k     210     0   72MB  1/5ms     8/34ms
  ○ seen          1.5.5     2h15m     86       5     0   42MB  —         —
  ● connector-irc 1.6.6     2h15m   3.8k       0     0   65MB  2/8ms     —
  ...

  IRC: libera ● connected  #eevee,#testing
──────────────────────────────────────────────────────────
```

**Summary table columns:**

| Column | Description |
|--------|-------------|
| Module | Status dot (`●` healthy, `●` degraded, `○` down) + name (truncated at 15 chars) |
| Ver | Module version |
| Uptime | Time since module started |
| Msgs | Total messages processed |
| Cmds | Total commands executed |
| Errs | Total errors |
| Mem | RSS memory in MB |
| MsgLat | Message processing latency (p50/p95 in ms) |
| CmdLat | Command processing latency (p50/p95 in ms) |

**Status dots:**

| Symbol | Status | Meaning |
|--------|--------|---------|
| ● (green) | healthy | Running, no errors |
| ● (yellow) | degraded | Running, but has errors |
| ○ (red) | down | No recent stats (stale) or uptime is zero |

#### Raw Mode

Dumps every NATS message unformatted — useful for low-level debugging:

```bash
eevee monitor --raw
```

```
[stats.emit.response.weather] {"module":"weather","stats":{"version":"1.4.5",...}}
[command.register] {"module":"admin","command":"health"}
[control.connectors.irc.libera] {"action":"connect","network":"libera"}
```

### Toolbox Container

The toolbox image bundles `eevee monitor` as its default entrypoint. On startup, it:

1. Runs init hooks from `/eevee/hook.d/init/` (prints hostname and IP for debugging)
2. Launches `eevee monitor` in follow mode

```bash
docker run --rm \
  -e NATS_HOST="nats://nats.example.com:4222" \
  -e NATS_TOKEN="***" \
  ghcr.io/eeveebot/cli:latest
```

The image also includes the [`nats` CLI](https://github.com/nats-io/natscli) for manual NATS inspection:

```bash
docker exec -it <container> bash
nats sub ">"
```

## Events

The monitor observes the following event types across the NATS backbone:

| Event | Source Subject | Description |
|-------|---------------|-------------|
| `module_start` | `stats.emit.>`, first-cycle discovery | New module appeared, or module recovered from down/degraded |
| `module_stop` | `stats.emit.>`, stale detection | Module went down or stopped responding |
| `module_error` | `stats.emit.>`, error delta | Module's error count increased |
| `connector_connect` | `control.connectors.>` | Connector appeared or status changed to connected |
| `connector_disconnect` | `control.connectors.>` | Connector disconnected |
| `connector_reconnect` | `control.connectors.>` | Connector reconnected after being disconnected |
| `registration` | `command.register`, `broadcast.register`, `help.update`, `control.registerCommands.>`, `control.registerBroadcasts.>` | Command, broadcast, or help entry registered |
| `unregistration` | `command.unregister`, `broadcast.unregister`, `help.remove` | Command, broadcast, or help entry removed |
| `backup_start` | (reserved) | Backup operation started |
| `backup_complete` | (reserved) | Backup operation completed |
| `backup_failed` | (reserved) | Backup operation failed |
| `stats_anomaly` | `stats.emit.>`, stale detection | Module restarted, went stale, or connector lost/gained channels |

### Suppressed Events

Some events are **suppressed** from the stdout renderer — they're still processed for state tracking, but not printed as event lines. These include:

- First-cycle discovery events (all modules discovered on startup)
- Passive stats emission anomalies (detected between summary cycles)
- Stale module detection events
- Connector state extracted from stats responses

Raw mode (`--raw`) shows everything, suppressed or not.

## State Tracking

The monitor maintains in-memory state for all observed modules and connectors:

### Module State

Each module is tracked with:

- **Health status** — healthy / degraded / down / unknown
- **Uptime** — with restart detection (uptime reset means module restarted)
- **Counters** — messages, commands, errors (with delta detection on errors)
- **Latency** — p50/p95 from Prometheus histograms in `message_processing_seconds` and `command_processing_seconds`
- **Memory** — RSS in MB
- **Staleness** — if no stats received within `maxModuleAge`, module is marked down

### Connector State

Each connector is tracked with:

- **Status** — connected / disconnected / connecting
- **Channel count** — changes trigger anomaly events
- **Disconnection duration** — shows how long a connector has been down

Connector data is extracted from connector module stats responses (e.g. `connector-irc` includes a `connector` array in its stats payload).

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    NATS Server                          │
│              (eevee message backbone)                    │
└────────────────────────┬────────────────────────────────┘
                         │
          ┌──────────────┼──────────────┐
          │              │              │
     stats.emit.>  control.>  command/broadcast/help register/unregister
          │              │              │
          └──────────────┼──────────────┘
                         │
                  ┌──────▼──────┐
                  │  Collector  │
                  │  (NATS subs │
                  │   + interval│
                  │   timer)    │
                  └──────┬──────┘
                         │
              ┌──────────┼──────────┐
              │                     │
       ┌──────▼──────┐      ┌──────▼──────┐
       │ State       │      │ Renderer    │
       │ Tracker     │      │ (stdout or  │
       │ (modules +  │      │  raw)       │
       │  connectors)│      │             │
       └─────────────┘      └─────────────┘
```

### NATS Subjects

#### Inbound (subscribed)

| Subject | Purpose |
|---------|---------|
| `stats.emit.>` | Passive anomaly detection between summary cycles |
| `control.connectors.>` | Connector lifecycle events |
| `command.register` | Command registration notifications |
| `command.unregister` | Command unregistration notifications |
| `broadcast.register` | Broadcast registration notifications |
| `broadcast.unregister` | Broadcast unregistration notifications |
| `help.update` | Help entry updates |
| `help.remove` | Help entry removals |
| `control.registerCommands.>` | Router command re-registration sweeps |
| `control.registerBroadcasts.>` | Router broadcast re-registration sweeps |
| `stats.emit.request` | Stats collection requests (monitor responds with its own stats) |
| `stats.uptime` | Uptime queries |

#### Outbound (published)

| Subject | Purpose |
|---------|---------|
| `stats.emit.request` | Fan-out to collect stats from all modules (with reply channel) |
| `stats.emit.response.<uuid>` | Reply channel for stats collection responses |

### Collector

Owns all NATS subscriptions and the summary interval timer.

On each summary interval, the collector:

1. Detects stale modules (no stats within `maxModuleAge`)
2. Publishes `stats.emit.request` with a unique reply channel
3. Collects responses for 5 seconds
4. Updates state from responses (including connector data)
5. Emits first-cycle discovery events on the initial run
6. Passes state to the renderer

### State Tracker

Manages in-memory state for all observed modules and connectors. Detects anomalies by comparing current and previous state:

- **Uptime reset** → module restarted
- **Error count increase** → new errors
- **Status transition** → module went down or recovered
- **Channel count change** → connector gained/lost channels

### Renderers

| Renderer | Flag | Behavior |
|----------|------|----------|
| `StdoutRenderer` | (default, `--follow`) | Colored events + periodic summary table. Forces ANSI on even without a TTY (for `kubectl logs` / k9s). |
| `RawRenderer` | `--raw` | Unformatted `[subject] payload` for every NATS message. No summary, no events, no color. |

### Monitor Stats

The monitor reports its own stats when queried via `stats.emit.request`:

| Field | Description |
|-------|-------------|
| `modules_observed` | Total modules in state table |
| `modules_healthy` | Modules with status `healthy` |
| `modules_degraded` | Modules with status `degraded` |
| `modules_down` | Modules with status `down` or stale |
| `connectors_observed` | Total connectors in state table |
| `connectors_connected` | Connectors with status `connected` |
| `events_processed` | Total events emitted to renderer |
| `summary_intervals_completed` | Number of summary cycles completed |

## Development

### Prerequisites

- Node.js ≥ 24.0.0
- A running NATS server with token auth

### Build & Run

```bash
git clone https://github.com/eeveebot/cli.git
cd cli
npm install
npm test          # runs eslint + build
npm run build     # TypeScript compile only
```

### Updating libeevee

```bash
npm run update-libraries
```

This installs the latest `@eeveebot/libeevee` from GitHub Packages.

### Building the Toolbox Image

Requires [Docker Buildx](https://docs.docker.com/build/buildx/):

```bash
GITHUB_TOKEN=<your token> docker buildx bake --file toolbox/docker-bake.hcl
```

The build uses Docker secrets for the GitHub token needed to install the npm package from GitHub Packages.

## Contributing
Contributions are welcome! Open an issue, fork, branch, PR. Run `npm run build` before submitting — it lints and compiles.

## License

[CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/) — see [LICENSE](./LICENSE) for full text.
