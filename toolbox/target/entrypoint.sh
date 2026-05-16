#!/bin/bash

# Run init hooks
if [ -d /eevee/hook.d/init ]; then
  for HOOK in /eevee/hook.d/init/*; do
    if [ -x "$HOOK" ]; then
      echo "Executing hook: ${HOOK}"
      . "$HOOK"
    fi
  done
fi

# Execute the CMD (e.g. eevee monitor --follow)
exec "$@"
