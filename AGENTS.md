# Waymark agent contract

Waymark is a shared live map of bookmarked places (see `REQUIREMENTS.md`).
This repo is governed by VJS V2 and subscribed to VDS.

## VJS loop (governed work)

```bash
VJS=/Users/williamlilley/Projects/vibe-justice-system/target/release/vjs

# Before governed load-bearing work
$VJS --repo . route --kind implementation-decision --issue <issue> --intent "<description>"

# After material decisions
$VJS --repo . log decision --issue <issue> --decision "<decision>" \
      --basis <authority> --risk low --why "<reason>"

# Before commit
$VJS --repo . validate --staged

# Full check
$VJS --repo . local-ci
```

Governed writes need a permit (pre-commit gate is armed via `core.hooksPath`).
Permits expire after 2 hours and close with proof. Material decisions need a
50-150 word log.

## VDS (design governance)

```bash
VDS=/Users/williamlilley/Projects/vibe-design-system/target/release/vds
$VDS --root . doctor      # measured position
$VDS --root . proof --all
```

Designpack: none vendored yet (`.vds/designpack.lock` pins the absence).
No design values in `.vds/` — requirements only (VDS S-2(4)).

## Verification

No build yet. When M1 lands, the commands will live here.
