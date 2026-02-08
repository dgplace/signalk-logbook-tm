Semi-automatic logbook for Signal K
===================================

Status: ready for the first test runs

This application provides both a server-side plugin and the user interface for maintaining semi-automatic logbooks with [Signal K](https://signalk.org). Just like traditional logbooks, you can write an entry at any time. However, there are several things that are done automatically for you:

* Entries written when starting/ending a trip (requires [signalk-autostate](https://github.com/meri-imperiumi/signalk-autostate) plugin)
* When underway, an entry is created every hour recording the current conditions
* Automatic entry when course over ground changes by more than 25°

## Cruise Report Integration

This plugin acts as a passerelle (bridge) for the macOS **Cruise Report** application. The macOS app can:

1. Discover the Signal K server via mDNS (`_signalk-http._tcp`) or by entering the server IP address manually.
2. Call `GET /plugins/signalk-logbook/cruise-report/info` to confirm a compatible logbook plugin is running and retrieve vessel metadata.
3. Call `GET /plugins/signalk-logbook/logs` to list available days.
4. Call `GET /plugins/signalk-logbook/logs/{date}` to download all entries for a given day.

The macOS app handles trip aggregation and reporting locally.

## User interface

The plugin provides a simplified read-only web interface as part of the [Signal K](https://signalk.org) administration interface. It shows:

* An overview table listing each day that has logbook data, with entry counts.
* A map view displaying vessel track and log entry positions.

## Data storage and format

This logbook app writes the logs to disk using [YAML format](https://en.wikipedia.org/wiki/YAML) which combines machine readability with at least some degree of human readability.

Logs are stored on a file per day basis at `~/.signalk/plugin-config-data/signalk-logbook/YYYY-MM-DD.yml` 
If there are no entries for a given day, no file gets written.

Note: unlike Signal K itself, the log entries are written using "human-friendly" units, so degrees, knots, etc. They look something like:

```yaml
- datetime: 2014-08-15T19:00:19.546Z
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

## Source data

The following SignalK paths are used by this logbook.

|SingleK path|Timeline name|YAML path|Notes|
|-|-|-|-|
|`navigation.datetime`|Time|`/datetime`|Falls back to system time if not present. Display timezone can be configured.|
|`navigation.courseOverGroundTrue`|Course|`/course`||
|`navigation.headingTrue`|Heading|`/heading`||
|`navigation.speedThroughWater`||`/speed/stw`||
|`navigation.speedOverGround`|Speed|`/speed/sog`||
|`environment.wind.directionTrue`|Wind|`/wind/direction`||
|`environment.wind.speedOverGround`|Wind|`/wind/speed`||
|`environment.outside.pressure`|Baro|`/barometer`||
|`environment.water.swell.state`|Sea|`/observations/seaState`||
|`navigation.position`|Coordinates|`/position/longitude` `/position/latitude`||
|`navigation.gnss.type`|Fix|`/position/source`|Defaults to "GPS".|
|`navigation.log`|Log|`/log`||
|`propulsion.*.runTime`|Engine|`/engine/hours`||
|`sails.inventory.*`|||Sail changes are logged.|
|`communication.crewNames`||`/crewNames`|Crew changes are logged.|
|`steering.autopilot.state`|||Autopilot changes are logged.|
|`navigation.state`|||If present, used to start and stop automated hourly entries. Changes are logged.|
|`propulsion.*.state`|||Propulsion changes are logged.|
|`communication.vhf.channel`||`/vhf`||
|`navigation.courseRhumbline.nextPoint.position`||`/waypoint`||

The [signalk-derived-data](https://github.com/sbender9/signalk-derived-data) and [signalk-path-mapper](https://github.com/sbender9/signalk-path-mapper) plugins are both useful to remap available data to the required canonical paths.

## API

The plugin exposes the following REST API endpoints:

| Method | Path | Description |
|---|---|---|
| `GET` | `/cruise-report/info` | Plugin version, vessel name, and API version for Cruise Report app discovery |
| `GET` | `/logs` | List of dates with logbook entries |
| `POST` | `/logs` | Create a new log entry |
| `GET` | `/logs/{date}` | All entries for a given day |
| `GET` | `/logs/{date}/{datetime}` | Single entry |
| `PUT` | `/logs/{date}/{datetime}` | Update an entry |
| `DELETE` | `/logs/{date}/{datetime}` | Delete an entry |

See the [OpenAPI spec](schema/openapi.yaml) for full details. The API can also be used for automations with [Node-Red](https://nodered.org) or [NoFlo](https://noflojs.org) etc.

## Ideas

Some additional ideas for the future:

* Enable creating additional rules for automated entries when certain things happen (for example, when turning on a watermaker).
* We could ship easy systemd unit files for setting up backups to popular locations, like pushing to a git repo
* One-time script for populating logbook from InfluxDB entries when starting to use the system

## Changes

* This repo
  - Add Cruise Report passerelle: `GET /cruise-report/info` discovery endpoint for macOS Cruise Report app
  - Simplify web UI to read-only overview (day summary table + map)
  - Remove entry/crew/sail editors (editing now handled by Cruise Report macOS app)
  - Fix duplicate log entries for autopilot and navigation state triggers
  - Add trigger to record when change of heading > 25 degrees
  - Add trigger when new top high SOG for the the trip
  - Add trigger when new top high wind speed
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
