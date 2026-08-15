# Waymark — Requirements v1.1

> Binding build specification per [2026] VJS-CC-WAYMARK 1. v1.0 text is superseded
> where amended; unchanged sections carry forward. Working name: Waymark.

## 1. Vision

A shared, live map of bookmarked places. Friends create accounts, join map rooms via invite, drop places with rich structured data, and see each other's additions appear in real time on a high-quality map with optional 3D terrain.

**Core principle (amended):** user-defined taxonomy, fields and presentation metadata are configuration; core behaviour and security remain versioned application code. No third-party runtime plugin system in v1 — TypeScript interfaces and internal registries only.

## 2. Place model (amended — the three-layer model)

A **Place** is the venue itself. A **MapPlace** is a group's bookmark of it.

- `places` — canonical real-world location: name, geometry, address, website, operational status, OSM natural key where known
- `place_sources` — provider identity per place: `(provider, external_id)` unique; providers: `manual`, `nominatim`, `osm`, future imports
- `map_places` — the bookmark: map, place, shared note, added_by, **version** (optimistic concurrency), timestamps

Rules:
- Dedupe on `(provider, external_id)` at insert; manual pins reuse an exact geom+name match before creating
- Map-specific data NEVER lives on places; venue data NEVER lives on map_places
- Corrections to venue facts propagate to every map that bookmarks the place

## 3. Taxonomy (amended — facets and terms)

- `facets` — a dimension: category, vibe, occasion, audience, facilities, price…
- `terms` — a value in a facet: Restaurant, Cosy, Date, Family friendly…
- `map_place_terms` — term per bookmark with role `primary` | `secondary` for category-facet terms; other facets unroled
- One **primary category** plus optional **secondary categories** per bookmark
- Filters compose across facets: family-friendly AND restaurant NOT bar; cosy of any kind; rainy-day landmarks nearby
- Per-map facets/terms seeded with defaults on map creation, fully editable in-app

## 4. Custom fields (amended — typed definitions)

- `field_definitions` — map-scoped: key, label, data_type (`text|number|boolean|date|url|select`), validation rules, applicable terms, display config, filterable, required
- `map_place_field_values` — JSONB values validated against their definition
- User-defined fields never require migrations; core concepts may

## 5. Concurrency (amended — optimistic, versioned)

- Every `map_places` mutation bumps `version` inside the transaction and appends a `place_revisions` audit row
- `PATCH`/`DELETE` require `If-Match: <version>`; mismatch → `409` with the current record
- Non-overlapping field auto-merge is a client behaviour on top of the 409 contract, never a server-side guess
- No silent last-write-wins anywhere

## 6. Realtime (amended — persisted sequences)

- WS events are notifications; **the database is the source of truth**
- Every event carries `(mapId, seq)` from a per-map monotonic sequence persisted in `activity_events` transactionally BEFORE broadcast
- Clients reconnect by sending `resync` with their last `seq`; the server replays missed events from `activity_events`
- Event handlers are idempotent (upsert by id); clients refetch detail on `place.updated`
- Event kinds: `place.created/updated/deleted`, `comment.added`, `rating.set`, `note.updated`, `member.joined`

## 7. Spatial queries (amended)

- Radius / nearby: `ST_DWithin(geog, point, metres)`
- Viewport loading: `geom && ST_MakeEnvelope(bbox)` (bbox intersection, index-friendly)

## 8. Geocoding (amended — provider interface)

- All search goes through a `Geocoder` provider interface; providers are swappable
- Nominatim adapter: server-side, **explicit submitted queries only** — never keystroke autocomplete against the public instance; proper UA header; ≥1s spacing; result caching
- Manual map placement always available; hosted/self-hosted search is a later provider swap

## 9. Map engine (amended posture)

- MapLibre GL JS + OpenFreeMap (no API key, no view limits; no SLA — kept behind a replaceable tile-source config)
- 3D terrain via AWS Terrain Tiles (public dataset, no uptime guarantee): **optional toggle, off by default**, replaceable source
- Clustering → markers → summary → detail → related (progressive disclosure)
- Deep links: URL hash encodes camera + selected place

## 10. Auth floor (amended)

argon2id password hashing; httpOnly + Secure + SameSite cookies; session rotation on login and revocation endpoint; login rate limiting (per-email+IP window); single-use expiring tokens stored **hashed** (password reset, invites); CSRF via same-origin custom-header policy; audit events for auth mutations (signup, login, failure, reset, invite create/accept, member changes, account deletion); account deletion anonymises.

## 11. Deployment (amended — two postures, one artifact)

- **Development:** Docker Compose; private access over LAN/Tailscale; email stubbed to server logs
- **Production multiplayer:** public HTTPS hostname, transactional email, app-level invitations — the artifact is identical; posture is configuration
- Postgres never publishes its port to the host in either posture

## 12. Architecture (unchanged)

```
[React 19 + Vite + TS SPA]  ← PWA, MapLibre GL JS
   │ REST (OpenAPI) + WebSocket
[Fastify API, Node 22+]  ← zod, argon2, Drizzle ORM, geocoder providers
   │
[Postgres 16 + PostGIS]  ← internal-only
[volume: photos + thumbnails]
```

Monorepo: `apps/web`, `apps/server`, `packages/shared` (zod schemas shared client/server).

## 13. Data model

`users · sessions · auth_audit · maps · memberships · invites · places · place_sources · map_places · facets · terms · map_place_terms · field_definitions · map_place_field_values · photos · ratings · notes · comments · place_revisions · map_event_seqs · activity_events`

## 14. Milestones

- **M1 Scaffold** — monorepo, compose, auth, blank map with OpenFreeMap + terrain toggle
- **M2 Places** — three-layer model, taxonomy, typed fields, viewport/nearby, detail panel, filters, clustering
- **M3 Multiplayer** — invites/roles, WS live sync with resync, comments, ratings, notes
- **M4 Richness** — photos, related-places discovery, deep links, PWA shell
- **M5 Hardening** — OpenAPI published, backups script, e2e (signup → invite → both users see live pin), polish

## 15. Out of scope for v1

Autocomplete against public Nominatim · email delivery (stubbed, posture-gated) · native apps · federation · offline editing · route planning · public/share-to-web maps · runtime plugins · Google-bookmarks import (API-ready).
