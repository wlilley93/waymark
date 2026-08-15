# Waymark

Shared live map of bookmarked places. React + MapLibre frontend, Fastify +
PostGIS backend, realtime by persisted per-map event sequences.

Governed by VJS ([2026] VJS-CC-WAYMARK 1, this repo's `.vjs/`) and subscribed
to VDS (`.vds/`). See `REQUIREMENTS.md` (v1.1, binding) before changing the
data model or API contract.

## Dev

```bash
# Postgres+PostGIS (loopback only)
docker run -d --name waymark-pg -e POSTGRES_PASSWORD=waymark -e POSTGRES_USER=waymark \
  -e POSTGRES_DB=waymark -p 127.0.0.1:5434:5432 postgis/postgis:16-3.4
docker exec waymark-pg psql -U waymark -d waymark -c "CREATE EXTENSION IF NOT EXISTS postgis"

npm install
npm run db:migrate                      # dev DB
npm -w @waymark/server run dev          # API on :3000 (vite dev proxies /api)
npm -w @waymark/web run dev             # web on :5173
```

## Test

```bash
npm test                                # shared + server + web unit (44 tests)
npx playwright test                     # e2e: signup → invite → live pin (chromium)
```

The e2e suite creates its own `waymark_e2e` database; the server tests use
`waymark_test` (migrated automatically).

## Deploy

```bash
docker compose up -d --build            # http://localhost:8080 (dev posture)
./scripts/backup.sh                     # pg_dump + photos
```

Production multiplayer: public HTTPS origin in `APP_ORIGINS`, TLS in front of
`web`, SMTP for email tokens. Same artifact.

## Governance

- `vjs --repo . route --kind code_change --issue spec_v1_1 --intent ... --path ...`
  issues the permit the pre-commit hook demands; `vjs log decision ... --basis
  <permit-id>` discharges it.
- `vds --root . proof --all` measures the design surface (see `.vds/`).

## API

`/api/openapi.json` (swagger UI at `/documentation` when the server runs).
