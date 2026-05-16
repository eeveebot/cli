#!/usr/bin/env node
'use strict';

import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { handleMonitorCommand } from './monitor/command.mjs';

void yargs(hideBin(process.argv))
  .command(
    'monitor',
    'Observe eevee system activity',
    (yargs) => {
      return yargs
        .option('follow', {
          type: 'boolean',
          description: 'Append-only stdout mode (container entrypoint)',
        })
        .option('raw', {
          type: 'boolean',
          description: 'Unformatted NATS firehose',
        })
        .option('filter', {
          type: 'string',
          description: 'Subject prefix filter',
        })
        .option('modules', {
          type: 'string',
          description: 'Only track specified modules (comma-separated)',
        })
        .option('no-summary', {
          type: 'boolean',
          description: 'Disable periodic summary blocks',
        })
        .option('no-color', {
          type: 'boolean',
          description: 'Strip ANSI colors from output',
        });
    },
    (argv) => {
      void handleMonitorCommand(argv);
    },
  )
  .demandCommand()
  .strict()
  .parse();
