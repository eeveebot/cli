'use strict';

import { MonitorRenderer, MonitorState, MonitorEvent } from '../monitor/types.mjs';

/** Raw renderer for --raw mode. Unformatted NATS firehose, passthrough. */
export class RawRenderer implements MonitorRenderer {
  start(_state: MonitorState): void {
    // Intentionally empty — raw mode has no startup message
    void _state;
  }

  onEvent(event: MonitorEvent): void {
    console.log(`[${event.source}] ${event.detail}`);
  }

  onInterval(_state: MonitorState): void {
    // Intentionally empty — raw mode has no summary blocks
    void _state;
  }

  onRawMessage(subject: string, payload: string): void {
    console.log(`[${subject}] ${payload}`);
  }

  stop(): void {
    // Intentionally empty — raw mode has no shutdown message
  }
}
