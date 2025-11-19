#!/bin/bash

echo "eevee-toolbox init script"

echo "Running hooks"

for HOOK in $(ls /eevee/hook.d/init/); do
  echo "Executing hook: /eevee/hook.d/init/${HOOK}"
  . "/eevee/hook.d/init/${HOOK}"
done

echo "Starting eevee-monitor"

exec eevee-monitor
