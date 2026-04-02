#!/bin/bash
cd "$(dirname "$0")"
set -a
source .env
set +a
export NODE_TLS_REJECT_UNAUTHORIZED=0
exec npx tsx server.ts
