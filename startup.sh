#!/bin/sh
set -e
if curl -sf http://127.0.0.1:8080/ >/dev/null 2>&1; then
  exit 0
fi
cd /workspace
npm run dev >/tmp/grok64-dev.log 2>&1 &
