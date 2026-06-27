Semi-automatic logbook for Signal K — Trip Report Edition
============================================================

> **Based on** [signalk-logbook](https://github.com/meri-imperiumi/signalk-logbook) by Henri Bergius. Original code licensed under MIT.

This is a fork of the Signal K logbook plugin, adapted to serve as a data source for the macOS **Trip Report** application. It provides both a server-side plugin and a simplified web interface for monitoring semi-automatic logbooks with [Signal K](https://signalk.org). Several things are done automatically:

* Entries written when starting/ending a trip (requires [signalk-autostate](https://github.com/meri-imperiumi/signalk-autostate) plugin)
* When underway, a heartbeat entry is created at a configurable interval (default 30 minutes) recording the current conditions
* Automatic entry when course over ground changes by more than 25° (with configurable settle delay to filter wave-induced oscillations)
* Log timezone is configurable (defaults to the Signal K host computer timezone and is preselected as the first option in plugin settings)

## Trip Report Integration

This plugin acts as a passerelle (bridge) for the macOS **Trip Report** application. The macOS app can:

1. Discover the Signal K server via mDNS (`_signalk-http._tcp`) or by entering the server IP address manually.
2. Call `GET /signalk/v1/api/cruise-report/info` to confirm a compatible logbook plugin is running and retrieve vessel metadata.
3. Call `GET /signalk/v1/api/cruise-report/logs` to list available days.
4. Call `GET /signalk/v1/api/cruise-report/logs/{date}` to download all entries for a given day.

The macOS app handles trip aggregation and reporting locally.

## User interface

The plugin provides a simplified read-only web interface as part of the [Signal K](https://signalk.org) administration interface. It shows:

* An overview table listing each day that has logbook data, with entry counts.
* A Leaflet map view (OpenStreetMap + OpenSeaMap) displaying vessel track and log entry positions.
* Data is loaded from read-only routes with compatibility fallbacks. The webapp tries `/signalk/v1/api/cruise-report/*`, `/signalk/v1/api/plugins/signalk-cruisereport/cruise-report/*`, and legacy plugin API paths such as `/signalk/v1/api/plugins/signalk-cruisereport/logs`.

## Data storage and format

This logbook app writes the logs to disk using [YAML format](https://en.wikipedia.org/wiki/YAML) which combines machine readability with at least some degree of human readability.

Logs are stored on a file per day basis at `~/.signalk/plugin-config-data/signalk-cruisereport/YYYY-MM-DD.yml`.
The `YYYY-MM-DD` day boundary is computed in the configured plugin log timezone (default: server/computer timezone).
If there are no entries for a given day, no file gets written.

Note: unlike Signal K itself, the log entries are written using "human-friendly" units, so degrees, knots, etc.
The `datetime` field is stored with an explicit timezone offset for the configured log timezone. They look something like:

```yaml
- datetime: 2014-08-15T21:00:19.546+02:00
  position:
    longitude: 24.7363006
    latitude: 59.7243978
    source: GPS
  heading: 202
  course: 198
  speed:
    stw: 12.5
    sog: 11.8
  log: 9.6
  waypoint: null
  barometer: 1008.71
  depth: 12.5
  waterTemperature: 22.3
  attitude:
    yaw: 15.2
    pitch: -2.3
    roll: 8.7
  wind:
    speed: 13.7
    direction: 283
  engine:
    hours: 405
  category: navigation
  text: Set 1st reef on mainsail
  author: bergie
```

It is a good idea to set up automatic backups of these files off the vessel, for example to [GitHub](https://github.com) or some other cloud storage service. How to handle this backup is out of the scope of this plugin.

For making a hard copy of the logbook, the [logbook-printer](https://github.com/meri-imperiumi/logbook-printer) repository implements a service to do so with a cheap receipt printer.

## Docker Compose timezone

The `docker-compose.yml` in this repository hardcodes the Signal K container timezone:

```yaml
environment:
  - TZ=Australia/Brisbane
```

This avoids host timezone mount differences on Docker Desktop and keeps container time in AEST (`Australia/Brisbane`).

## Source data

The following SignalK paths are used by this logbook.

|SingleK path|Timeline name|YAML path|Notes|
|-|-|-|-|
|`navigation.datetime`|Time|`/datetime`|Falls back to system time if not present.|
|`navigation.courseOverGroundTrue`|Course|`/course`||
|`navigation.headingTrue`|Heading|`/heading`||
|`navigation.speedThroughWater`||`/speed/stw`||
|`navigation.speedOverGround`|Speed|`/speed/sog`||
|`navigation.attitude`|Attitude|`/attitude`|Yaw, pitch, and roll in degrees.|
|`environment.wind.directionTrue`|Wind|`/wind/direction`||
|`environment.wind.speedOverGround`|Wind|`/wind/speed`||
|`environment.outside.pressure`|Baro|`/barometer`||
|`environment.depth.belowSurface`|Depth|`/depth`|Meters.|
|`environment.water.temperature`|Temp|`/waterTemperature`|Degrees Celsius.|
|`environment.water.swell.state`|Sea|`/observations/seaState`||
|`navigation.position`|Coordinates|`/position/longitude` `/position/latitude`||
|`navigation.gnss.type`|Fix|`/position/source`|Defaults to "GPS".|
|`navigation.log`|Log|`/log`||
|`propulsion.*.runTime`|Engine|`/engine/hours`||
|`steering.autopilot.state`|||Autopilot changes are logged.|
|`navigation.state`|||If present, used to start and stop automated heartbeat entries. Changes are logged.|
|`propulsion.*.state`|||Propulsion changes are logged.|
|`communication.vhf.channel`||`/vhf`||
|`navigation.courseRhumbline.nextPoint.position`||`/waypoint`||

The [signalk-derived-data](https://github.com/sbender9/signalk-derived-data) and [signalk-path-mapper](https://github.com/sbender9/signalk-path-mapper) plugins are both useful to remap available data to the required canonical paths.

## API

The plugin exposes the following REST API endpoints.

Public read-only endpoints (available without login when Signal K `allow_readonly` is enabled):

| Method | Path | Description |
|---|---|---|
| `GET` | `/signalk/v1/api/cruise-report/info` | Plugin version, vessel name, and API version for Trip Report app discovery |
| `GET` | `/signalk/v1/api/cruise-report/logs` | List of dates with logbook entries |
| `GET` | `/signalk/v1/api/cruise-report/logs/{date}` | All entries for a given day |
| `GET` | `/signalk/v1/api/cruise-report/logs/{date}/{datetime}` | Single entry |

Compatibility note: on some Signal K versions/configurations, read-only endpoints may be exposed under plugin API paths such as `/signalk/v1/api/plugins/signalk-cruisereport/cruise-report/*` or `/signalk/v1/api/plugins/signalk-cruisereport/logs`.

Authenticated write endpoints (plugin router):

| Method | Path | Description |
|---|---|---|
| `POST` | `/plugins/signalk-cruisereport/logs` | Create a new log entry |
| `PUT` | `/plugins/signalk-cruisereport/logs/{date}/{datetime}` | Update an entry |
| `DELETE` | `/plugins/signalk-cruisereport/logs/{date}/{datetime}` | Delete an entry |

See the [OpenAPI spec](schema/openapi.yaml) for full details. The API can also be used for automations with [Node-Red](https://nodered.org) or [NoFlo](https://noflojs.org) etc.

## Local Swagger UI

You can run a local Swagger UI for this plugin API from the project root:

```bash
npm run swagger
```

Then open:

```text
http://127.0.0.1:3333
```

Optional environment variables:

* `SWAGGER_HOST` (default: `127.0.0.1`)
* `SWAGGER_PORT` (default: `3333`)

Note: the UI assets are loaded from the `unpkg.com` CDN, so internet access is required for the page rendering.

## Ideas

Some additional ideas for the future:

* Enable creating additional rules for automated entries when certain things happen (for example, when turning on a watermaker).
* We could ship easy systemd unit files for setting up backups to popular locations, like pushing to a git repo
* One-time script for populating logbook from InfluxDB entries when starting to use the system

## Changes

* This repo
  - Rename macOS integration references from Cruise Report to Trip Report while retaining compatible package, type, and API route identifiers
  - Bump npm package version from `1.0.1` to `1.0.2` for release
  - Fix npm lint/test failure by moving `leaflet` to runtime dependencies and applying a targeted ESLint exception for Leaflet marker icon shim internals
  - Bump npm package version from `1.0.0` to `1.0.1` for packaging and distribution
  - Hardcode Signal K container timezone in `docker-compose.yml` with `TZ=Australia/Brisbane` to avoid Docker Desktop host-timezone mount mismatches
  - Refresh OpenAPI/Swagger spec to document public read-only `/signalk/v1/api/cruise-report/*` routes and authenticated plugin write routes under `/plugins/signalk-cruisereport/*`
  - Fix web overview to use public read-only `/signalk/v1/api/cruise-report/logs*` routes instead of authenticated plugin routes, removing forced login prompt for read-only access
  - Add web overview fallback to support both public route shapes: `/signalk/v1/api/cruise-report/logs*` and `/signalk/v1/api/plugins/signalk-cruisereport/cruise-report/logs*`
  - Extend web overview fallback to include legacy plugin API path `/signalk/v1/api/plugins/signalk-cruisereport/logs` (and direct `/plugins/signalk-cruisereport/logs` as last fallback)
  - Fix legacy log read compatibility by allowing `crewNames` in entry schema and resolving OpenAPI schema `$ref` links during runtime validation
  - Ensure plugin `logTimeZone` config defaults to the computer timezone by placing it first in the timezone enum list
  - Add Trip Report passerelle: `GET /cruise-report/info` discovery endpoint for macOS Trip Report app
  - Simplify web UI to read-only overview (day summary table + map)
  - Remove entry/crew/sail editors (editing now handled by Trip Report macOS app)
  - Remove `sails.inventory.*` and `communication.crewNames` path subscriptions (crew and sail management now handled by Trip Report macOS app)
  - Fix duplicate log entries for autopilot and navigation state triggers
  - Add trigger to record when change of heading > 25 degrees
  - Add trigger when new top high SOG for the the trip
  - Add trigger when new top high wind speed
  - Replace pigeon-maps with Leaflet + react-leaflet (OpenStreetMap + OpenSeaMap tiles, matching @signalk/vesselpositions)
  - Add daily distance (NM) column to overview table
  - Replace fixed hourly log interval with configurable heartbeat (default 30 minutes)
  - Remove unused display timezone setting
  - Add configurable log storage timezone (defaults to host computer timezone) for day-bucketing and persisted datetime offsets
  - Add course change settle delay (default 30s) to debounce wave-induced heading oscillations
  - Expose read-only API on `/signalk/v1/api/cruise-report/*` while keeping write endpoints auth-only on `/plugins/signalk-cruisereport/*`
  - Add local Swagger UI runner with `npm run swagger`
* 0.7.2 (2024-05-13)
  - Fix issue storing entries when `navigation.position` includes altitude
* 0.7.1 (2024-04-23)
  - Allow storing log entries when VHF channel is a single digit one
* 0.7.0 (2023-04-27)
  - Time range filter for logs to show is now editable (and persisted)
* 0.6.1 (2023-04-05)
  - Motor start/stop is not logged separately when under way as it will change vessel state and produce a log that way
* 0.6.0 (2023-04-05)
  - Course over ground is now also stored in the log data. It is shown instead of heading when available
  - Logbook view was made more compact by combining wind and weather observation columns
  - Compatibility with older Node.js versions, like the one on Venus OS
  - The "log" data now uses `navigation.log` instead of `navigation.trip.log`
* 0.5.0 (2023-03-13)
  - Timezone used when displaying entries is now configurable in plugin settings. Still defaults to UTC.
  - Observations form is shown only for navigation entries to reduce clutter
* 0.4.2 (2023-03-08)
  - Fixed issue when there is no recorded speed in a log entry
* 0.4.1 (2023-03-06)
  - Fixed issue when plugin has no configuration
  - Enabled _Edit_ button for sails editor when no sails are set as active
* 0.4.0 (2023-03-05)
  - User interface and logging for sail changes, powered by the [sailsconfiguration](https://github.com/SignalK/sailsconfiguration) plugin
  - User interface and logging for crew changes
  - User interface for recording weather observations (sea state, cloud coverage, visibility)
  - User interface for recording manual fixes when using celestial navigation etc
  - Fix for logbook view when there is no wind data available
* 0.3.0 (2023-02-22)
  - Map view now fetches vessel track using the Signal K History API, if available
  - Fixed engine name capture for automatic logs
  - Added OpenAPI for easier Logbook API discoverability and usage
* 0.2.1 (2023-02-15)
  - Added triggers for automatically logging when engine is started or stopped
  - Added VHF channel to radio logs. Automatically populated when available (see for example [the Icom M510e plugin](https://www.npmjs.com/package/signalk-icom-m510e-plugin))
* 0.2.0 (2023-02-15)
  - Added support for multiple entry categories (navigation, engine, etc)
  - Automatic entry creation when changing autopilot state
  - Added an `end` flag to entries marking end of a trip
  - Added engine hours to logs
* 0.1.2 (2023-02-08)
  - Implemented entry deletion
  - Fixed issue with initial load if logging in within this webapp (#5)
* 0.1.0 (2023-02-03)
  - Initial release
