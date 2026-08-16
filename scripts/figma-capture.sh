#!/usr/bin/env bash
# The decided-target round trip, one command ([2026] VJS-CC-WAYMARK 2, W2).
#
# Figma's REST API is read-only for file content, so the decided-target file
# is drawn by a PERSON (from docs/DESIGN-BRIEF.md — the machine-generated
# contract). This script is the front door that pulls what they drew:
#   1. saves the authenticated GET /v1/files/:key/nodes capture (rate-limit
#      friendly, one page per node) into .vds/cache/figma/ (gitignored by law,
#      VDS S-3(9) — no design value is committed),
#   2. derives the frame ledger,
#   3. refreshes the figma ledger the states proof measures.
#
# Usage:  FIGMA_TOKEN=figd_... ./scripts/figma-capture.sh <file-key> [node-id ...]
#         (no node ids = capture the whole file, one request)
set -euo pipefail

KEY="${1:?usage: figma-capture.sh <file-key> [node-id...]}"
shift || true
: "${FIGMA_TOKEN:?FIGMA_TOKEN must be set (personal access token, file_read scope)}"
VDS="${VDS_BIN:-vds}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/.vds/cache/figma"
mkdir -p "$OUT"

if [ $# -gt 0 ]; then
  IDS=$(printf '%s' "$*" | /usr/bin/sed 's/ /,/g; s/,,*/,/g')
  URL="https://api.figma.com/v1/files/$KEY/nodes?ids=$IDS"
else
  URL="https://api.figma.com/v1/files/$KEY?geometry=paths"
fi

CAPTURE="$OUT/nodes-$KEY-$(date +%Y%m%d-%H%M%S).json"
echo "capturing $URL"
/usr/bin/curl -sS -H "X-Figma-Token: $FIGMA_TOKEN" "$URL" -o "$CAPTURE"
/usr/bin/python3 - "$CAPTURE" <<'EOF'
import json, sys
d = json.load(open(sys.argv[1]))
if "err" in d or "error" in d:
    print(d); sys.exit(1)
nodes = d.get("nodes") or {"(whole file)": d}
print(f"capture ok: {len(nodes)} node(s), name={d.get('name', '?')}")
EOF

cd "$ROOT"
if [ $# -gt 0 ]; then
  "$VDS" --root . figma frames --file-key "$KEY" --from "$CAPTURE"
else
  echo "whole-file capture saved to $CAPTURE"
  echo "re-run with node ids to derive the frame ledger:"
  echo "  ./scripts/figma-capture.sh $KEY <frame-node-id>..."
fi
"$VDS" --root . figma pull --from "$CAPTURE"
echo
echo "next: register amend to record file-key#node per component, then 'vds proof states'"
