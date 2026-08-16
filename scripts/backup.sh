#!/usr/bin/env bash
# Nightly backup (REQUIREMENTS NFR-6): pg_dump + photo volume + one-command restore hint.
# Run from the host with the compose stack up:  ./scripts/backup.sh <output-dir>
set -euo pipefail

OUT="${1:-./backups/$(date +%Y%m%d-%H%M%S)}"
mkdir -p "$OUT"
# absolute for the docker bind (-v needs an absolute host path; a relative one
# silently creates an empty dir wherever the daemon resolves it)
case "$OUT" in
  /*) ABS_OUT="$OUT" ;;
  *) ABS_OUT="$PWD/$OUT" ;;
esac

PG_CID=$(docker compose ps -q postgres)
SRV_CID=$(docker compose ps -q server)
docker exec "$PG_CID" pg_dump -U waymark -d waymark > "$OUT/waymark.sql"
docker run --rm --volumes-from "$SRV_CID" -v "$ABS_OUT":/backup alpine \
  tar czf /backup/photos.tgz -C / data/photos

echo "backup written to $OUT"
echo "restore: docker compose exec -T postgres psql -U waymark -d waymark < $OUT/waymark.sql"
echo "         docker run --rm -i -v \$PWD:/bk --volumes-from \$(docker compose ps -q server) alpine sh -c 'tar xzf /bk$(cd "$(dirname "$0")" >/dev/null; echo)/photos.tgz -C /' # or untar into the photos volume by hand"
