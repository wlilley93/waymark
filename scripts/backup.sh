#!/usr/bin/env bash
# Nightly backup (REQUIREMENTS NFR-6): pg_dump + photo volume + one-command restore hint.
# Run from the host with the compose stack up:  ./scripts/backup.sh <output-dir>
set -eu
OUT="${1:-./backups/$(date +%Y%m%d-%H%M%S)}"
mkdir -p "$OUT"

docker exec $(docker compose ps -q postgres) pg_dump -U waymark -d waymark > "$OUT/waymark.sql"
docker run --rm --volumes-from $(docker compose ps -q server) -v "$PWD/$OUT":/backup alpine \
  tar czf /backup/photos.tgz /data/photos

echo "backup written to $OUT"
echo "restore: docker compose exec -T postgres psql -U waymark -d waymark < $OUT/waymark.sql"
echo "         then untar photos.tgz into the photos volume"
