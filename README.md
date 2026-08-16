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

## Where the design lifecycle stops, and why ([2026] VJS-CC-WAYMARK 2)

Everything machine-settleable is settled: **W1 REGISTER-COMPLETE granted**
(WARRANT-W1-001) on passing captured proofs — register_completeness,
reconciliation, composition, contrast, no_stored_values, ledger_staleness —
over 8 screens and 15 registered components, with a WCAG-compliant token
layer and a registered primitive layer.

| stage | state | blocked on |
|---|---|---|
| W2 DESIGN-COMPLETE | reserved | a decided-target **Figma file** — `states` measures drawn states from it and no agent write-path exists (REST + MCP are read-only); a design act |
| W3 PRINCIPAL-ACCEPTED | reserved | the **Principal alone** (VDS S-6(7)); never inferred from silence |
| W4 PARITY | reserved | follows W3 |
| `states` proof | 15 findings standing, CI-asserted known-red | same Figma file |
| SMTP email | transport shipped (`SMTP_URL`/`FROM_EMAIL`) | an SMTP **credential** — Principal supply |

Resolved since the W1 order: the binary gates now run in CI (a `design` job
builds the pinned instrument from the public vendor tree and asserts the
battery, with `states` asserted known-red), and the project **subscribes to
designpack v1** (`designpack/v1` vendored, digest-pinned in
`.vds/designpack.lock`) so the specification's RESERVED clauses resolve
upstream. Doctor: **9 MET / 1 UNMET-by-reservation (D6)**.

## API

`/api/openapi.json` (swagger UI at `/documentation` when the server runs).

## Live deployment

The dev stack runs on this LAN via `docker compose up -d --build` (port 8090;
OrbStack holds 8080 for boltrig) and is published at
`https://mac-mini-m4-pro.tailb4b671.ts.net/` through Tailscale Funnel
(public HTTPS, verified end-to-end: signup → map → place → viewport).
CI: `.github/workflows/vds-enforce.yml` (green on push).
