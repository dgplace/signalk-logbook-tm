# signalk-cruisereport Development Log

## Architecture Overview

This is a **Signal K** server plugin and embedded webapp that provides a semi-automatic electronic logbook for sailing vessels. It listens to Signal K data paths, detects significant events, and writes timestamped YAML log entries to disk.

### Data Flow

1. **Signal K subscriptions** &rarr; `plugin/index.js` subscribes to ~20 paths (position, speed, wind, state, etc.) at 1-second intervals.
2. **Trigger processing** &rarr; each delta update is passed to `processTriggers()` which decides whether to create an automatic log entry (e.g. course change > 25&deg;, autopilot toggle, vessel state transition).
3. **Periodic checks** &rarr; a 60-second interval drives hourly log entries (`processHourly`) and a 2-minute max-record promotion cycle (`processTwoMinute`).
4. **Persistence** &rarr; the `Log` class writes/reads YAML files in `~/.signalk/plugin-config-data/signalk-cruisereport/YYYY-MM-DD.yml`.
5. **REST API** &rarr; `plugin/index.js` exposes CRUD endpoints (`GET/POST /logs`, `GET/PUT/DELETE /logs/:date/:entry`) and a discovery endpoint (`GET /cruise-report/info`) for the macOS Cruise Report app.
6. **Web UI** &rarr; Simplified React SPA served as an embedded Signal K webapp; provides a read-only overview of available data (day summary table and map view).

### Race-Condition Prevention Pattern

Several triggers (course change, autopilot state, navigation state) update `oldState[path]` **immediately** before the asynchronous log write. This prevents duplicate entries when the same state change arrives from multiple Signal K sources before the first write completes. The previous value is captured in a local variable (e.g. `prevState`) when the log text depends on the old value.

## File Overview

| File | Purpose |
|---|---|
| `plugin/index.js` | Main Signal K plugin entry point. Manages subscriptions, state buffer, periodic timers, REST API routes, and plugin configuration schema. |
| `plugin/triggers.js` | Event detection logic. `processTriggers()` handles per-update triggers; `processTwoMinute()` promotes max-value candidates; `processHourly()` writes hourly entries. |
| `plugin/format.js` | `stateToEntry()` converts the in-memory state object into a human-friendly log entry (degrees, knots, hPa, NM). |
| `plugin/Log.js` | `Log` class providing YAML-based persistence with JSON-Schema validation, file-per-day storage, and a write queue to serialise concurrent writes. |
| `schema/openapi.yaml` | OpenAPI 3 spec for the logbook REST API. |
| `schema/openapi.json` | Auto-generated JSON version of the OpenAPI spec (built via `js-yaml`). |
| `src/index.js` | React webapp entry point. |
| `src/components/AppPanel.jsx` | Top-level app shell. Read-only overview with day summary table and map tabs. |
| `src/components/Map.jsx` | Read-only map view of log entry positions with vessel track. |
| `public_src/` | Static assets source (icons, HTML template). |
| `public/` | Webpack build output served by Signal K. |
| `webpack.config.js` | Webpack configuration for building the React webapp. |
| `CLAUDE.md` | Agent coding instructions (symlink to AGENTS.md). |
| `README.md` | User-facing documentation. |

## Change Log

### Unreleased
- **feat: add Cruise Report passerelle** &mdash; Add `GET /cruise-report/info` endpoint returning plugin version, vessel name, and API version for macOS Cruise Report app discovery. Update OpenAPI schema with `CruiseReportInfo` schema and new `cruise-report` tag.
- **refactor: simplify web app to read-only overview** &mdash; Replace full-featured UI (timeline, logbook table, entry/crew/sail/filter editors) with a minimal overview showing a per-day entry count table and a read-only map. Removed components: `Timeline`, `Logbook`, `EntryEditor`, `EntryViewer`, `EntryDetails`, `FilterEditor`, `SailEditor`, `CrewEditor`, `Metadata`, `observations.js`.
- **fix: prevent duplicate log entries for autopilot and navigation state triggers** &mdash; Update `oldState[path]` immediately before the async log write in the `steering.autopilot.state` and `navigation.state` handlers, matching the pattern already used by the course-change handler. For the navigation state handler, the previous value is captured in `prevState` so log text still reflects the correct transition (e.g. "Motor stopped, sailing").
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
