# signalk-cruisereport Development Log

## Architecture Overview

This is a **Signal K** server plugin and embedded webapp that provides a semi-automatic electronic logbook for sailing vessels. It listens to Signal K data paths, detects significant events, and writes timestamped YAML log entries to disk.
For Docker deployments in this repository, the Signal K container timezone is hardcoded with `TZ=Australia/Brisbane`.

### Data Flow

1. **Signal K subscriptions** &rarr; `plugin/index.js` subscribes to 21 paths (position, speed, wind, depth, state, etc.) at 1-second intervals.
2. **Trigger processing** &rarr; each delta update is passed to `processTriggers()` which decides whether to create an automatic log entry or retain a record candidate (e.g. course change > 25&deg;, autopilot toggle, vessel state transition, minimum positive depth).
3. **Periodic checks** &rarr; a 60-second interval drives configurable heartbeat log entries (`processHourly`, default every 30 min) and a 2-minute record promotion cycle (`processTwoMinute`) for maximum speed, wind, heel, and minimum depth while under way.
4. **Persistence** &rarr; the `Log` class writes/reads YAML files in `~/.signalk/plugin-config-data/signalk-cruisereport/YYYY-MM-DD.yml`, with day bucketing and stored `datetime` offsets based on the configured log timezone (default: host computer timezone).
5. **REST API** &rarr; `plugin/index.js` exposes read-only endpoints on both plugin routes and Signal K API routes (`GET /signalk/v1/api/cruise-report/info`, `GET /signalk/v1/api/cruise-report/logs`, `GET /signalk/v1/api/cruise-report/logs/:date`, `GET /signalk/v1/api/cruise-report/logs/:date/:entry`), while write endpoints (`POST /logs`, `PUT/DELETE /logs/:date/:entry`) remain available only on authenticated plugin routes.
6. **Web UI** &rarr; Simplified React SPA served as an embedded Signal K webapp; provides a read-only overview of available data (day summary table and map view) by reading compatible read-only routes, including `/signalk/v1/api/cruise-report/*`, `/signalk/v1/api/plugins/signalk-cruisereport/cruise-report/*`, and legacy `/signalk/v1/api/plugins/signalk-cruisereport/logs`.

### Race-Condition Prevention Pattern

Several triggers (course change, autopilot state, navigation state) update `oldState[path]` **immediately** before the asynchronous log write. This prevents duplicate entries when the same state change arrives from multiple Signal K sources before the first write completes. The previous value is captured in a local variable (e.g. `prevState`) when the log text depends on the old value.

## File Overview

| File | Purpose |
|---|---|
| `plugin/index.js` | Main Signal K plugin entry point. Manages subscriptions, state buffer, periodic timers, dual read-only API routing (`registerWithRouter` + `signalKApiRoutes`), authenticated write routes, and plugin configuration schema. |
| `plugin/triggers.js` | Event detection logic. `processTriggers()` handles per-update triggers; `processTwoMinute()` promotes maximum-value and minimum-depth candidates; `processHourly()` writes heartbeat entries. |
| `plugin/format.js` | `stateToEntry()` converts the in-memory state object into a human-friendly log entry (degrees, knots, hPa, NM). |
| `plugin/Log.js` | `Log` class providing YAML-based persistence with JSON-Schema validation, file-per-day storage, and a write queue to serialise concurrent writes. |
| `plugin/timezone.js` | Shared timezone helpers for validating IANA timezone IDs, formatting persisted datetimes with offsets, and deriving timezone-local day strings for file naming. |
| `schema/openapi.yaml` | OpenAPI 3 spec for the logbook REST API. |
| `schema/openapi.json` | Auto-generated JSON version of the OpenAPI spec (built via `js-yaml`). |
| `src/index.js` | React webapp entry point. |
| `src/components/AppPanel.jsx` | Top-level app shell. Read-only overview with day summary table and map tabs. |
| `src/components/Map.jsx` | Read-only Leaflet map view of log entry positions with vessel track (OpenStreetMap + OpenSeaMap tiles). |
| `src/components/leaflet-hack.js` | Webpack compatibility fix for Leaflet default marker icons and CSS import. |
| `public_src/` | Static assets source (icons, HTML template). |
| `public/` | Webpack build output served by Signal K. |
| `scripts/deploy-local.sh` | Copies built plugin, webapp, and schema into the local Signal K instance (`signalk/node_modules/signalk-cruisereport/`) for testing. Runs `npm run build` to ensure the webapp bundle is current. |
| `scripts/swagger-local.js` | Local Swagger UI server for viewing `schema/openapi.yaml` in a browser during development. |
| `docker-compose.yml` | Local/container runtime definition for Signal K, including hardcoded container timezone `TZ=Australia/Brisbane`. |
| `webpack.config.js` | Webpack configuration for building the React webapp. |
| `CLAUDE.md` | Agent coding instructions (symlink to AGENTS.md). |
| `README.md` | User-facing documentation. |

## Change Log

### Unreleased
- **release: prepare version 1.0.3** &mdash; Bump the npm package version from `1.0.2` to `1.0.3` for the minimum-depth record release.
- **feat: log new minimum depth records while under way** &mdash; Track the lowest positive `environment.depth.belowSurface` sample and promote it to an automatic log entry during the two-minute record check while sailing or motoring. Preserve the sampled depth and position, reset the record at trip end, document the trigger, and add focused regression coverage.
- **release: prepare version 1.0.2 for Trip Report integration** &mdash; Rename current-facing macOS integration descriptions from Cruise Report to Trip Report across package metadata, plugin documentation, README, and OpenAPI documentation while retaining compatible package, type, and route identifiers. Bump the npm package version from `1.0.1` to `1.0.2`.
- **fix: restore npm test lint pass for Leaflet marker shim** &mdash; Move `leaflet` from `devDependencies` to `dependencies` in `package.json` so runtime imports in `src/components/leaflet-hack.js` satisfy `import/no-extraneous-dependencies`, and add a targeted `no-underscore-dangle` lint override for the required Leaflet internal `_getIconUrl` delete.
- **chore: bump npm package version to 1.0.1** &mdash; Update `package.json` and `package-lock.json` from `1.0.0` to `1.0.1` in preparation for packaging and distribution.
- **feat: restrict map view to the latest log file** &mdash; Update `src/components/AppPanel.jsx` to pass only the entries from the most recent day to the `Map` component, ensuring the `days` list is sorted correctly. Added reactivity to `src/components/Map.jsx` so the track and markers refresh immediately when the log data changes.
- **fix: deploy-local.sh skips webapp build** &mdash; Add `npm run build` step to `scripts/deploy-local.sh` before copying `public/` so that `src/` changes are compiled into the bundle. Previously the script only ran `npm run prebuild` (schema generation), leaving a stale webpack bundle when source files had changed.
- **fix: use local date from datetime string for day filtering** &mdash; Replace `new Date(e.datetime).toISOString().substr(0, 10)` with `e.datetime.substr(0, 10)` in both the Map entries filter and the daySummaries builder. The previous approach converted to UTC which could shift entries to a neighbouring day when the log timezone has a positive offset, causing the map to show the wrong day or appear empty.
- **fix: prevent partial attitude updates from clobbering valid yaw/pitch/roll data** &mdash; Implement property-level merging for `navigation.attitude` in `plugin/index.js`. If an update from a source contains `null` or `undefined` for a specific axis (common with sources like address 35), the plugin now retains the last known valid value from other sources (like address 204), ensuring `yaw` is preserved in the logs.
- **feat: add depth, water temperature, and attitude metadata** &mdash; Enrich log entries with water depth, sea surface temperature, and full vessel attitude (yaw/pitch/roll). Replaced the specific `navigation.attitude.roll` subscription with the full `navigation.attitude` object, added `environment.depth.belowSurface` and `environment.water.temperature` paths, and implemented unit conversions (Kelvin to Celsius, radians to degrees). Updated OpenAPI schema and README documentation to include these new fields.
- **fix: restore day-log API compatibility for legacy entries** &mdash; Add `crewNames` back as an optional legacy field in `schema/openapi.yaml` and regenerate `schema/openapi.json` so older persisted logs validate during read operations.
- **fix: resolve OpenAPI schema `$ref` entries during runtime validation** &mdash; Refactor `plugin/Log.js` validator setup to rewrite all local `#/components/schemas/*` references to absolute validator IDs. This fixes `GET /.../logs/{date}` failures caused by unresolved schema refs (for example `Position`/`Waypoint`) during `validateDate()`.
- **fix: add legacy plugin API fallback for web overview loading** &mdash; Extend `src/components/AppPanel.jsx` endpoint probing to include `/signalk/v1/api/plugins/signalk-cruisereport/logs` and `/plugins/signalk-cruisereport/logs` after the preferred public read-only routes, improving compatibility with older or differently mounted Signal K plugin API routing.
- **fix: hardcode Docker container timezone to Australia/Brisbane** &mdash; Update `docker-compose.yml` to set `TZ=Australia/Brisbane` and remove host `/etc/localtime` bind mount, avoiding Docker Desktop host-timezone mount mismatches that kept container time in UTC.
- **fix: make plugin timezone default deterministic in settings UI** &mdash; Update `plugin/index.js` to build the `logTimeZone` enum with the computer timezone first, and ensure the schema `default` uses a normalized valid timezone. This prevents settings UIs from falling back to the first alphabetical timezone (for example `Africa/Abidjan`) when initializing the selector.
- **fix: add public route-shape fallback for web overview loading** &mdash; Update `src/components/AppPanel.jsx` to probe both public read-only endpoint variants (`/signalk/v1/api/cruise-report/logs*` and `/signalk/v1/api/plugins/signalk-cruisereport/cruise-report/logs*`) before showing an error, improving compatibility across Signal K router mount behaviors.
- **fix: remove login requirement for read-only web overview** &mdash; Update `src/components/AppPanel.jsx` to read overview data from public Signal K API routes (`/signalk/v1/api/cruise-report/logs*`) instead of authenticated plugin routes (`/plugins/signalk-cruisereport/logs*`) and remove forced rendering of the login view for read-only access.
- **docs: refresh OpenAPI/Swagger spec to match current API behavior** &mdash; Update `schema/openapi.yaml` to document public read-only endpoints under `/signalk/v1/api/cruise-report/*` and authenticated write endpoints under `/plugins/signalk-cruisereport/*`; align request/response schemas with runtime behavior by adding manual-entry `category` and `position` fields, removing obsolete `crewNames`, and bumping API doc version example to `1.0.0`. Regenerate `schema/openapi.json`.
- **chore: align Docker Signal K container timezone with host machine** &mdash; Update `docker-compose.yml` to mount `/etc/localtime` read-only into the `signalk` container so container timezone follows the machine timezone.
- **feat: configurable log storage timezone** &mdash; Add plugin setting `logTimeZone` (default: host computer timezone). YAML file day boundaries now follow this timezone, and stored entry `datetime` values are persisted with explicit ISO-8601 timezone offsets (for example `+10:00`) instead of forced UTC `Z`.
- **feat: add Trip Report passerelle** &mdash; Add `GET /cruise-report/info` endpoint returning plugin version, vessel name, and API version for macOS Trip Report app discovery. Update OpenAPI schema with `CruiseReportInfo` schema and new `cruise-report` tag.
- **refactor: simplify web app to read-only overview** &mdash; Replace full-featured UI (timeline, logbook table, entry/crew/sail/filter editors) with a minimal overview showing a per-day entry count table and a read-only map. Removed components: `Timeline`, `Logbook`, `EntryEditor`, `EntryViewer`, `EntryDetails`, `FilterEditor`, `SailEditor`, `CrewEditor`, `Metadata`, `observations.js`.
- **fix: prevent duplicate log entries for autopilot and navigation state triggers** &mdash; Update `oldState[path]` immediately before the async log write in the `steering.autopilot.state` and `navigation.state` handlers, matching the pattern already used by the course-change handler. For the navigation state handler, the previous value is captured in `prevState` so log text still reflects the correct transition (e.g. "Motor stopped, sailing").
- **refactor: remove `sails.inventory.*` and `communication.crewNames` paths** &mdash; Stop subscribing to sail inventory and crew name paths. Remove `sendCrewNames()` helper, the `communication.crewNames` PUT handler, the crew-change trigger in `triggers.js`, the `crewNames` field from `stateToEntry()` in `format.js`, and the `crewNames` property from the plugin configuration schema. Crew and sail management is now handled by the Trip Report macOS app.
- **refactor: replace pigeon-maps with Leaflet** &mdash; Replace pigeon-maps map library with Leaflet + react-leaflet v2 (matching @signalk/vesselpositions approach). Use OpenStreetMap base tiles with optional OpenSeaMap sea marks overlay. Vessel track rendered as a single Polyline; log entries shown as colour-coded CircleMarkers. Remove `pigeon-maps`, `@mapbox/geo-viewport`, and `where` dependencies. Add `leaflet-hack.js` for webpack marker icon compatibility.
- **feat: add daily distance column** &mdash; Overview table now shows total distance sailed per day (NM), computed from the first and last `log` values of each day's entries.
- **feat: configurable heartbeat interval** &mdash; Replace fixed hourly log entry with a configurable heartbeat interval (default 30 minutes, range 5–120). Remove unused `displayTimeZone` setting and `timezones-list` dependency.
- **feat: course change settle delay** &mdash; Add configurable debounce window (default 30 seconds, range 0–120) for the course change trigger. When a course change &ge;25&deg; is detected, samples are collected for the settle period then a single entry is logged with the circular mean of all samples. This filters out wave-induced oscillations. Other triggers (autopilot, speed records, etc.) continue to fire normally during the window.
- **feat: public read-only API routes via Signal K API router** &mdash; Register read-only endpoints through `signalKApiRoutes` so `GET /signalk/v1/api/cruise-report/...` can be accessed without login when Signal K allows anonymous read-only access. Keep `POST/PUT/DELETE` endpoints on authenticated `/plugins/signalk-cruisereport/...` routes only.
- **feat: add local Swagger UI runner** &mdash; Add `scripts/swagger-local.js` and `npm run swagger` to serve a local Swagger UI for `schema/openapi.yaml` at `http://127.0.0.1:3333` (configurable via `SWAGGER_HOST` and `SWAGGER_PORT`).
- Add JSDoc documentation headers to exported trigger functions.
- Create this LOG.md file.

### fd560fb &mdash; Implement code changes to enhance functionality and improve performance
- Broad improvements to trigger logic and logging.

### 41353c6 &mdash; fix: update course immediately after logging
- Update stored course right after logging a course change to avoid stale comparisons.

### 7c74f56 &mdash; Update position for course change and max events
- Capture vessel position at the moment of course change and max-record events.

### 9ac1ab7 &mdash; Log course changes only while sailing
- Restrict course-change trigger to fire only when `navigation.state` is `sailing`.

### 755fc08 &mdash; Log course changes cumulatively
- Compare against last *logged* course rather than previous update for cumulative detection.

### e5209dc &mdash; fix triggers appendLog parameters
- Correct parameter order/values passed to `appendLog`.

### 6b9c2c0 &mdash; Check maxima every two minutes
- Move max-speed/wind/heel promotion from per-update to a 2-minute interval to reduce CPU usage.

### 29aa6d7 &mdash; Fix max speed logging
- Fix threshold comparison for new speed records.

### 9f57668 &mdash; Allow custom logbook metrics
- Support `custom.logbook.*` keys in the state object for tracking maxima.

### 9464ad1 &mdash; chore: remove custom logbook sails field
- Clean up unused custom sails field from validation schema.
