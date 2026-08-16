#!/usr/bin/env bash
# Deploy waymark to the live host (jellytot-prod). Source + build stay on
# beelink; the live box pulls the repo and rebuilds its own containers
# natively. Run from beelink:  ./scripts/deploy-live.sh
set -euo pipefail

LIVE="${1:-jellytot@jellytot-prod}"
ssh "$LIVE" 'cd ~/Projects/waymark && git pull --ff-only && docker compose up -d --build'