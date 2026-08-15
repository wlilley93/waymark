# Waymark agent contract

Waymark is a shared live map of bookmarked places (see `REQUIREMENTS.md` — v1.1,
binding per [2026] VJS-CC-WAYMARK 1).
This repo is governed by VJS V2 (vendored `lawpack/`, pinned) and subscribed to VDS.

## VJS loop (governed work)

```bash
VJS=vjs   # on ~/.local/bin

# Before governed load-bearing work — issues the scoped permit
$VJS --repo . route --kind code_change --issue spec_v1_1 \
     --intent "<what>" --path <files-or-dirs>

# After the work — MUST carry the permit id in --basis (discharge contract)
$VJS --repo . log decision --kind code_change --issue spec_v1_1 \
     --decision "<decision>" --basis PERMIT-<id> --risk <risk> --why "<why>"

# Before commit (the pre-commit hook runs this)
$VJS --repo . validate --staged
```

Permits expire after 2 hours. New issues of substance route to the County
Court first (see `.vjs/orders/2026-VJS-CC-WAYMARK-SPEC-MODEL-001.yaml`; the
v1.1 ruling is binding on `spec_v1_1`).

## VDS (design governance)

```bash
VDS=vds
$VDS --root . doctor               # measured position
$VDS --root . proof --all          # 15 kinds; vacuous states are recorded, not hidden
```

Register is `.vds/register/` (CMP-0001..0006); enforcement lock pins
`apps/server/test/mapplaces.test.ts` (composition) and `e2e/live.spec.ts`
(criteria grader) with in-repo negative controls. No designpack vendored;
no design values in `.vds/` (VDS S-2(4)).

## Verification

```bash
npm test                  # shared + server + web unit tests
npx playwright test       # e2e: signup → invite → live pin
npm run typecheck         # tsc across workspaces
docker compose up -d --build   # full stack on :8080
```

Local dev: `waymark-pg` PostGIS container on 127.0.0.1:5434 (see README).
The e2e suite expects it running and creates `waymark_e2e` itself.
