# Atrapos: Implementation Plan

Web app for signing in with a Suunto account, building routes on OpenStreetMap (draw, or import GPX/FIT), placing POIs on them, and pushing the route (Route API) and the POIs (POI API) to the user's Suunto app account so they sync to the watch.

UI design: https://claude.ai/artifact/6T93oL1GkfUhNvwoaXyCZo (private until shared)

## Status

| Milestone | State |
|---|---|
| M0 Scaffolding | ✅ Done: solution, Docker Compose, PostGIS + EF migrations, mock Suunto (OAuth + Route + POI), web shell with dark/light themes |
| M1 Suunto sign-in (mock) | ✅ Done: BFF code flow with `state`, encrypted token storage, auto-refresh, sign out / disconnect, CSRF header |
| M2 Map & freehand editor | ✅ Done: Leaflet + OSM/OpenTopoMap/CyclOSM, click to extend, drag/insert/delete points, undo/redo, stats, elevation profile with map hover sync, autosave, route library |
| M3 Snap-to-trail | ✅ Done: BRouter proxy (`/api/routing/segment`) with caching and a concurrency cap, 8 profiles, snap/freehand per segment, automatic straight-line fallback with a notice, markers drawn on the trail |
| M4 Import GPX/FIT | ✅ Done: GPX 1.0/1.1 (tracks, routes, waypoints, Suunto route points), FIT courses (course points) and activities (laps), preview with live simplification, waypoint → POI mapping, original file kept |
| M5 POIs | ✅ Done: add/move/edit/delete on the map and in the list, snapping onto the route, live distance along, 61 Suunto types with category glyphs, POIs on the elevation profile, all undoable |
| M6 Suunto sync | ✅ Done (against the mock): route push (import / PUT with revision), conflicts with keep-mine / take-theirs / save-copy, POI create/upsert with per-POI results and retry, refresh from Suunto, styled confirmation dialogs, All POIs page |
| M7 Editing extras & polish | ✅ Done: reverse, trim before/after, split, GPX download, error page and toasts, skip link, reduced motion, Playwright e2e (7 tests) with axe: 0 violations in both themes |
| M8 Go live with Suunto | 🔄 In progress: live sign-in verified; fixed the import-id shape and POI timestamp units found on first use; awaiting re-push confirmation |
| Dashboard | ✅ Done: library summary tiles (also act as filters), search, status filter, activity filter (only activities in use, with counts), sort, Boxes/List views (remembered per browser), multi-select with Shift ranges and bulk delete; All POIs gets search, filter, per-route select-all, bulk push and bulk delete. API: `POST /api/routes/delete`, `POST /api/pois/delete` |
| User preferences | ✅ Done: profile page with default map, units (metric/imperial) and appearance (dark/light), stored on the user (`users.default_map`, `units`, `theme`); `GET/PUT /api/settings` validates values; the web app applies them on load |
| Editor & library extras | ✅ Done: place search on the map (Nominatim), all-routes map view on the dashboard, POIs on a map in All POIs, GPX/FIT shrink tool, ascent/descent from a resampled (5 m), smoothed (±50 m) profile with 5 m turning-point hysteresis (server `Geo.cs` and client `geo.ts` match), per-route push route / push POIs buttons on the dashboard, "Start loop here" for loops, configurable upload limit (`Uploads:MaxFileSizeMb`) |
| Hosting hardening | ✅ Done: `Hosting:*` options (`Hardening.cs`): forwarded headers from a trusted proxy, HSTS, security headers and a CSP on every response (not `/auth`, Swagger, OpenAPI; the theme bootstrap moved to `public/theme-init.js` so inline scripts stay forbidden), in-memory fixed-window rate limits per user / per address (all, external-service, auth). TLS itself stays with the reverse proxy |
| Section analysis | ✅ Done: a transient `useSectionStore` (distances along the line, cleared on any line change) set by dragging on the elevation profile (with edge handles and range inputs) or by the ruler tool's two-point pick (route line or vertex markers); `sectionStats` in `geo.ts` reuses `stats()` on the interpolated sub-line, plus net change, grades over 100 m windows and min/max; client-side only, nothing saved |
| Selectable designs | ✅ Done: `users.design` (`classic`/`alpine`/`soft`, default `classic`) in `/api/settings`, applied as `data-design` on the root next to `data-theme`; `styles/designs.css` overrides tokens (fonts, radii, colours, route-line colours) per design and theme, with nav overrides in `AppShell.module.css` (Alpine underlined tabs, Soft left icon rail). Classic stays the default CSS untouched; layouts are shared, so the designs differ in styling and navigation, not in page structure |
| Suunto loaders | ✅ Done: every call that reaches Suunto (refresh, route push, POI push and retry, conflict resolve, disconnect) runs through `withSuunto()`, which drives an app-wide indicator (progress bar under the top bar, the connection chip names the operation); busy buttons show a spinner and stay readable (`aria-busy`); sign-in shows "Opening Suunto…" |

Deviations and details settled during implementation:
- `poi_types` and `activity_types` live in code (`Domain/Lookups.cs`, from the POI API schema and Suunto's Activities.pdf) and are served at `/api/lookups/*`, not stored in tables.
- Each control point stores its **segment** (the computed line to the next point, with elevation) in `routes.control_points` (jsonb). Opening a route never re-routes or re-fetches elevation; editing recomputes only the segments next to the change. `routes.geometry` is derived from the segments on save.
- Elevation: Open Topo Data, dataset `mapzen` (global; SRTM has no data above 60°N). Requests are capped at 100 points and one per second, cached on a ~11 m grid. `Elevation:Provider=None` turns lookups off.
- Freehand segments are sampled every 50 m so the profile has detail.
- BRouter never says "no route" for off-network points: it snaps both ends to the nearest way, even 30 km away, and returns 200. The backend treats an end snapped more than 300 m (`Routing:MaxSnapDistanceM`) as no route (422). The client then switches that segment to freehand without adding an undo step and shows a notice. A 503 ("router unavailable") offers Retry.
- Control points keep the raw click. Markers are drawn where the snapped segment starts or ends, so they sit on the trail. Where a snapped segment meets a freehand one, a straight connector bridges the gap (joint tolerance 1 m, the same on client and server).
- Import is stateless: `POST /api/imports/preview` parses and returns the track, and `POST /api/imports` re-uploads the file with the user's choices. Both run the same pipeline: 1 m base simplification, then Douglas–Peucker at the chosen tolerance. The browser runs an identical algorithm, so the preview's point count matches what's saved.
- An imported track becomes about 60 m-spaced control points, at least one every 2 km and at most 300. Each one's freehand segment keeps the original detail. Dragging a point redraws only its two segments, and undo brings the detail back (the segment cache lives for the whole session).
- Waypoints more than 200 m off the track are imported as POIs without a distance along the route. FIT turn instructions and lap markers are unchecked by default; Suunto generates its own turn-by-turn.
- Tracks without elevation are imported without it; elevation isn't looked up on import (it would mean dozens of rate-limited requests).
- POIs are part of the route document. `PUT /api/routes/{id}` carries the full POI list, and the server applies the diff. That gives POIs the same undo and autosave as route points. The client generates POI UUIDs.
- Deleting a POI is a soft delete (`pois.deleted_at`). Undoing restores the same row with its `suunto_poi_key`, so the next push upserts the existing Suunto POI instead of creating a duplicate.
- `pois.location` is 2D, with `elevation_m` nullable; the migration copied the imported Z values. On-route POIs take the route's elevation at their spot; off-route ones get a one-point lookup.
- Placement snaps onto the route within 20 screen pixels (at most 200 m). Distance along the route is computed live in the editor and stored by the server on every save. A POI more than 200 m from the line is "off route": it can be a Suunto POI but not a route waypoint.
- Push GPX: on-route POIs become `<rtept>` vertices at their spot on the line, carrying a `suunto:routePoint` (name/type/description), as in Suunto's own export. No separate `<wpt>`, to avoid double waypoints. The line is simplified at 2 m between POI anchors; ends and anchors are always kept.
- Before an update, the route is exported and its revision compared with the one stored at the last sync. A mismatch, or a 409 from PUT, becomes a conflict (`routes.sync_state = conflict`) and nothing is overwritten. A 404 means the route was deleted in the app ("upload again" or "keep local only").
- Only GETs are retried (`DisableForUnsafeHttpMethods`): a retried import or create could make duplicates on Suunto.
- Refresh (manual only) pulls POIs first, then routes. Unchanged local copies take Suunto's version; locally edited ones become conflicts. Waypoints of routes new from Suunto reuse a pulled POI with the same name within 15 m. Tombstoned POIs are matched by key and stay deleted.
- **Verified against the live API (2026-10-15):**
  - Sign-in: `http://localhost:5080` works as the redirect URI, and `state` is echoed back. Tokens have `expires_in` 86399 s and `scope` "workout", with a refresh token.
  - The route import answers `{"items":[{"id", "username", "description", "activities", "segments", …}]}`. If the id can't be read, the client looks the route up by name in recently modified routes. The id is saved before anything else can fail, so a later push can't duplicate the route.
  - The POI API wants `creation`/`modified` in **epoch milliseconds**. With seconds, as in Suunto's own docs example, it answers **HTTP 200 with `errorCode: 4` and an empty key**: the POI isn't created. `country`/`locality` are optional. Any non-zero `errorCode` or empty key now counts as a failure, and the mock reproduces both behaviours.
- Leaflet markers: an icon must never change while its marker is dragged. `setIcon()` replaces the element the drag is bound to, so the drop is lost (found by the e2e tests). Selection is a CSS class on the existing element, handlers are bound once, and titles are updated in place because react-leaflet only sets `title` on creation.
- Reverse hands each leg's mode to its new owning point. Freehand legs are seeded reversed into the segment cache; snapped legs are re-routed, because one-way paths matter. Trim is undoable. Split is a server action (`POST /api/routes/{id}/split`): the tail and its POIs, which keep their Suunto keys, move to "<name> (part 2)". It can't be undone and asks first.
- GPX download (`GET /api/routes/{id}/gpx`) is the push GPX plus every POI as a plain `<wpt>`, off-route ones included, for other apps.
- The routing profile is set per route (`routes.routing_profile`). It's part of the cache key for snapped segments only, so changing it re-routes just those.

---

## 1. Decisions from the interview

| Topic | Decision |
|---|---|
| POI model | **Both, always.** Every POI is pushed as a standalone Suunto POI (POI API) **and** embedded as a waypoint in the route GPX (Route API). Each has its own sync status. |
| Route design | **Snap-to-trail + freehand**, chosen per segment. |
| Routing engine | **BRouter**, called only by our backend (public `brouter.de` at first, switch to a self-hosted container through config). |
| Delete | **Local delete with a warning.** The Suunto APIs have no DELETE, so the item stays in the Suunto app. |
| Suunto access | **No credentials yet.** We build against a **mock Suunto server** that follows the real contracts, and switch to the real API through config. |
| Audience / hosting | **Personal, local only.** Docker Compose on the developer machine. |
| Sync direction | **Two-way.** Import existing Suunto routes and POIs, edit them, push updates (with route revision handling). |
| Editor extras (v1) | Elevation profile + stats, undo/redo, drag/insert/delete points, reverse, split, trim, base-map switcher (OSM / OpenTopoMap / CyclOSM), GPX download. |
| FIT input | **Course and Activity** files. |
| Simplification | **Automatic + adjustable.** Douglas-Peucker, 5 m default, slider with a live point count. |
| Visual style | Suunto-inspired, **dark and light themes** with a toggle. |

---

## 2. Suunto API facts (checked against API Zone, 2026-10-14)

**Common:** base `https://cloudapi.suunto.com`. Every Cloud API call sends `Authorization: Bearer <jwt>` + `Ocp-Apim-Subscription-Key: <key>`. Some Route operations in the spec list only `Authorization`; we send both anyway.

### OAuth2 (`https://cloudapi-oauth.suunto.com`, *not* cloudapi.suunto.com)
- `GET /oauth/authorize?response_type=code&client_id=…&redirect_uri=…`
- `POST /oauth/token?grant_type=authorization_code&code=…&redirect_uri=…`, Basic auth `client_id:client_secret`
- `POST /oauth/token?grant_type=refresh_token&refresh_token=…` (same Basic auth)
- Response: `access_token` (JWT with a `user` claim holding the Suunto username), `refresh_token`, `expires_in` = 86400 (24h).
- `GET /oauth/deauthorize?client_id=…` with Bearer token, to disconnect.
- The redirect URI must match the one set in the API Zone profile.

### Route API (`/v2/route`)
| Op | Call | Notes |
|---|---|---|
| Import | `POST /v2/route/import?activities=1,2` body `application/gpx+xml` | Returns 200 JSON (body not documented, so verify the id field). `activities` = Suunto activity IDs, default 1 (running). |
| List | `GET /v2/route?page=0&size=5&since=<epoch ms>&sort=asc` | Returns `PartnerRoute[]`. **Polling is prohibited**, so we only call it on user action. |
| Get | `GET /v2/route/{oid}` | JSON metadata |
| Export | `GET /v2/route/{oid}/export` with `Accept: application/gpx+xml` | GPX including `suunto:id` + `suunto:revision` |
| Update | `PUT /v2/route/{oid}` body GPX | GPX **must** contain `suunto:id` (= oid) and the **current** `suunto:revision`, or the call returns **409 Conflict**. Returns the full GPX with the new revision. |

GPX rules: each `trk`/`rte` becomes a separate route. Route name precedence is `rte/trk name > desc > metadata name > metadata desc`. Waypoints come from `wpt` elements whose coordinates match a route point, **or** from a route point with `<extensions><suunto:routePoint><suunto:name/><suunto:type/><suunto:description/>`. Waypoint `type` is matched case-insensitively against the watch icon list (unknown types fall back to `Waypoint`). Route extensions: `suunto:activityIds`, `suunto:turnWaypointsEnabled`. Namespace: `http://www.suunto.com/xmlschemas/RouteExtension/v1`.

### POI API (`/v2/poi`)
| Op | Call |
|---|---|
| Create | `POST /v2/poi/create` |
| Upsert | `PUT /v2/poi/{poiKey}` (body `key` must equal path) |
| Get | `GET /v2/poi/detail?poiKey=…` |
| List | `GET /v2/poi?limit=&offset=` |

Body: `{ key?, creation, modified, point: { x: LON, y: LAT, z: ALT, name, type }, activityId, country, locality, watchEnabled: true }`. `watchEnabled` **must be true**. `type` is an integer enum with 61 values (-1 Unknown, 0 Building, 3 Parking, 4 Camp, 12 Water, 34 Peak, 73 Danger, 74 AidStation, 77 Campfire…). The full list goes into a seeded lookup table. **No DELETE.**

---

## 3. Architecture

```
┌──────────── docker compose (localhost) ─────────────────────────────┐
│                                                                     │
│  web (Vite/React, served by api in prod build)                      │
│        │ cookie session (HttpOnly, SameSite=Lax)                    │
│        ▼                                                            │
│  api  (.NET 10, ASP.NET Core) ── BFF + domain + sync engine         │
│   ├── OAuth client  ─────────► Suunto OAuth  │ or mock-suunto       │
│   ├── SuuntoRouteClient ─────► /v2/route     │ (same contracts)     │
│   ├── SuuntoPoiClient   ─────► /v2/poi       │                      │
│   ├── RoutingProxy      ─────► BRouter (brouter.de → self-host)     │
│   ├── ElevationService  ─────► Open Topo Data (freehand segments)   │
│   └── EF Core ───────────────► postgres (PostGIS 17)                │
│                                                                     │
│  mock-suunto (.NET minimal API): OAuth + Route + POI with          │
│  revisions, 409s, in-memory store; used until credentials arrive    │
└─────────────────────────────────────────────────────────────────────┘
```

**BFF auth pattern:** the browser never sees Suunto tokens. The backend runs the code flow, stores the access and refresh tokens **encrypted** (ASP.NET Data Protection, keys persisted to a volume) and gives the SPA a session cookie. Tokens refresh automatically when less than 5 minutes remain. We send and check a `state` parameter for CSRF (Suunto docs don't mention it, so verify it is echoed back). "Disconnect" calls `/oauth/deauthorize` and wipes the tokens.

### Tech stack
- **Backend:** .NET 10 LTS, ASP.NET Core Minimal APIs, EF Core 10 + Npgsql + NetTopologySuite (PostGIS geometry), a small built-in FIT reader/writer (`Infrastructure/Import/Fit`; it replaced `Garmin.FIT.Sdk`, whose licence forbids distribution under copyleft terms such as the AGPL), `System.Xml.Linq` (GPX read/write), `Microsoft.Extensions.Http.Resilience` (retry/backoff on 429/5xx), Serilog, xUnit + Testcontainers.
- **Frontend:** React 19 + TypeScript + Vite, `react-leaflet` 5 (Leaflet raster OSM tiles), TanStack Query (server state), Zustand + `zundo` (editor state with undo/redo), Radix UI primitives (accessible dialogs, select, tabs), `simplify-js` (live simplify preview), a small custom SVG elevation chart (synced hover with the map), CSS variables for dark/light theme tokens, Vitest + Playwright.
- **DB:** `postgis/postgis:17`.

---

## 4. Data model (PostgreSQL + PostGIS)

```
users            id, suunto_username (unique), access_token_enc, refresh_token_enc,
                 token_expires_at, created_at, last_suunto_refresh_at

routes           id, user_id, name, description, activity_ids int[],
                 turn_waypoints_enabled bool, routing_profile text,
                 geometry geometry(LineStringZ,4326),   -- full computed line
                 control_points jsonb,                   -- clicked points + per-segment mode (snap|free)
                 simplify_tolerance_m real, distance_m, ascent_m, descent_m,
                 source (drawn|gpx|fit_course|fit_activity|suunto),
                 suunto_route_id, suunto_revision bigint, suunto_modified_at,
                 local_modified_at, last_pushed_hash, sync_state, created_at

pois             id, user_id, route_id (nullable → standalone POI),
                 name, description, poi_type int (FK poi_types), location geometry(PointZ,4326),
                 distance_along_m (if on a route), activity_id,
                 suunto_poi_key, suunto_modified_at, local_modified_at,
                 last_pushed_hash, sync_state, created_at

poi_types        id int (Suunto enum), name, gpx_type_name, icon      -- seeded, 61 rows
activity_types   id int (Suunto activity id), name                    -- seeded from Activities.pdf
source_files     id, route_id, file_name, kind, bytes, uploaded_at    -- keep originals
sync_log         id, user_id, entity (route|poi), entity_id, op, http_status, message, at
```

`sync_state` ∈ `local_only | synced | local_changes | remote_newer | conflict | error`. It is computed from the hashes and timestamps, so the UI can show route status and POI status separately.

---

## 5. Key flows

### 5.1 Drawing (snap + freehand)
- The editor keeps **control points** plus a **mode per segment**. Snap segments call `POST /api/routing/segment {from,to,profile}`, which the backend proxies to BRouter (`/brouter?lonlats=…&profile=hiking-mountain&format=geojson`) and caches by (from,to,profile). BRouter output includes elevation.
- Freehand segments are straight lines. Elevation comes from `ElevationService` (Open Topo Data SRTM, batched up to 100 points, cached).
- Dragging a control point re-routes only the two segments next to it. Undo/redo covers control-point operations, POI edits, reverse, split and trim.

### 5.2 Import (GPX / FIT)
- `POST /api/imports` (multipart) → the server parses the file and returns a **preview DTO** (tracks, points, waypoints/course points, stats). Nothing is saved yet.
  - **GPX:** `trk`/`rte` (pick one if there are several), `wpt` → candidate POIs.
  - **FIT Course:** `Record` messages (semicircles → degrees), `CoursePoint` messages → candidate POIs (FIT type → Suunto POI type mapping table).
  - **FIT Activity:** `Record` track, optional `Lap` markers → candidate POIs.
- The client shows the simplify slider (preview with `simplify-js`). On confirm, `POST /api/routes` with the chosen tolerance; the server simplifies again authoritatively (NTS Douglas-Peucker in a local metric projection).

### 5.3 Push route (Route API)
1. Build GPX 1.1: `metadata/name`, `suunto:route` (activityIds, turnWaypointsEnabled), `<rte>` with `rtept`s. **Each POI on the route** is snapped to its projected position on the line, a vertex is inserted there, and that `rtept` gets a `suunto:routePoint` extension (name/type/description). We also emit a matching `wpt`.
2. **New route:** `POST /v2/route/import?activities=…`, store the id, then `GET /export` to capture `suunto:revision`.
3. **Existing route:** `GET /export` → compare the remote revision with ours.
   - Same → inject `suunto:id` + `suunto:revision` → `PUT`. Store the new revision from the response.
   - Different, or `PUT` returns 409 → **conflict dialog**: *Keep mine* (push on the latest revision after explicit consent), *Load Suunto version*, or *Save mine as a new route*.

### 5.4 Push POIs (POI API, separate from the route)
- New → `POST /v2/poi/create` (`watchEnabled: true`, x=lon, y=lat, z=ele) → store `key`.
- Changed → `PUT /v2/poi/{key}`.
- Each POI is pushed and reported individually, so one failure doesn't block the rest (the push result dialog has a Retry button per POI).
- Moving a POI marks **both** the POI (needs upsert) and its route (waypoint changed, needs route push) as changed.

### 5.5 Refresh from Suunto (manual only, never polled)
- `GET /v2/route?since=<last refresh>` (paged) → new routes are imported via `/export`. For known routes with a newer `modified`, mark `remote_newer`.
- `GET /v2/poi` (paged) → upsert into local POIs by `key`. POIs matching a route waypoint get linked to that route.
- Webhooks are skipped because a local app has no public URL. Can be added later with a tunnel.

### 5.6 Delete
- Local delete only, with a dialog explaining that the item stays in the Suunto app.
- Deleting a POI that is on a route **does** remove its waypoint on the next route push, but the standalone Suunto POI remains. The dialog says this.

---

## 6. Backend API (SPA ↔ api)

```
GET  /auth/login            → 302 Suunto authorize (state cookie)
GET  /auth/callback         → code exchange, session cookie, → /library
POST /auth/logout           POST /auth/disconnect (deauthorize)
GET  /api/me

GET  /api/routes            GET/PUT/DELETE /api/routes/{id}
POST /api/routes            POST /api/routes/{id}/reverse | split | trim
GET  /api/routes/{id}/gpx   (download)
POST /api/routes/{id}/push  → Route API
POST /api/routes/{id}/resolve-conflict {strategy}

GET  /api/pois?routeId=     POST /api/pois   PUT/DELETE /api/pois/{id}
POST /api/pois/push {ids[]} → POI API

POST /api/imports           (multipart GPX/FIT → preview)
POST /api/routing/segment   (BRouter proxy)
POST /api/elevation         (batch)
POST /api/suunto/refresh    (pull routes + POIs)
GET  /api/lookups/poi-types | activity-types
GET/PUT /api/settings       (default map, units, theme)
```

---

## 7. Repository layout

```
/src
  /RoutePoiManager.Api            ASP.NET Core host, endpoints, auth (BFF)
  /RoutePoiManager.Domain         entities, sync-state rules, geometry helpers
  /RoutePoiManager.Infrastructure EF Core, Suunto clients, BRouter, elevation, GPX/FIT
  /RoutePoiManager.MockSuunto     mock OAuth + Route + POI server
  /web                            React app (Vite)
/tests
  /RoutePoiManager.UnitTests      GPX builder/parser, FIT parser, mappers, simplify, sync-state
  /RoutePoiManager.IntegrationTests  API + Postgres (Testcontainers) + MockSuunto
  /web/e2e                        Playwright smoke tests
docker-compose.yml   .env.example   PLAN.md   README.md
```

Secrets (`Suunto__ClientId`, `Suunto__ClientSecret`, `Suunto__SubscriptionKey`) live in `.env` / user-secrets and are never committed. `Suunto__Mode=Mock|Live`.

---

## 8. Milestones

| # | Milestone | Done when |
|---|---|---|
| M0 | Scaffolding | `docker compose up` runs postgres + api + web + mock-suunto; EF migrations; lookup seeds; theme tokens. |
| M1 | Suunto sign-in (mock) | Login → mock authorize → callback → session; token refresh; disconnect. |
| M2 | Map & freehand editor | Leaflet + 3 base layers + attribution; draw/drag/insert/delete; undo/redo; stats; elevation profile with hover sync. |
| M3 | Snap-to-trail | BRouter proxy + cache; per-segment mode; drag re-routing; profile select. |
| M4 | Import GPX/FIT | GPX + FIT course + FIT activity parsing; preview; simplify slider; course points → POIs mapping. |
| M5 | POIs | Add/edit/move on map and list; snap-to-route + distance along; type picker with icons. |
| M6 | Suunto sync | Route import/update with revision + 409 conflict dialog; POI create/upsert; per-item results; refresh from Suunto; delete warnings; sync log. |
| M7 | Editing extras & polish | Reverse/split/trim, GPX download, light/dark toggle, error states, a11y pass, e2e tests. |
| M8 | Go live with Suunto | Switch `Mode=Live` with real credentials; run the verification checklist (§9) against a test account. |

---

## 9. Risks and open questions (verify once credentials arrive)

1. **Partner-program eligibility.** Suunto says it grants API access to companies/organisations and **not for personal use**. A personal app may not be approved. This is the biggest risk, so apply early and describe the use case.
2. **Localhost redirect URI.** Confirm Suunto accepts `http://localhost:<port>/auth/callback`.
3. **`state` parameter** isn't documented. Confirm it is passed through.
4. **Route import response body** isn't documented. Confirm which field carries the route id.
5. **POI timestamps:** the example (`1602074065`) looks like epoch **seconds**, while routes use **milliseconds**. Confirm.
6. **Activity IDs:** the full list is in Suunto's `Activities.pdf`. Seed it from there.
7. **Watch limits:** maximum route points and name length aren't documented (names may be truncated). Simplification + a name-length hint in the UI cover this.
8. **One partner app per Suunto account:** linking this app may unlink another partner service on that account.
9. **BRouter public server** is fair-use. Switch to a self-hosted container if it becomes slow or rate-limited.
10. **OSM tile usage policy:** fine for personal use. Keep attribution, never bulk-prefetch tiles.
