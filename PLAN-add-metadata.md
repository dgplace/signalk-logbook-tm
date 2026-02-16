# Plan: Add Depth, Water Temperature, and Attitude Metadata

## Context

The logbook currently captures navigation, wind, barometer, sea state, and engine data. The user wants to enrich log entries with three additional sensor readings:

- **Depth** — water depth below transducer
- **Water temperature** — sea surface temperature
- **Attitude** — yaw, pitch, and roll (vessel orientation)

The plugin already subscribes to `navigation.attitude.roll` for max-heel tracking. This plan replaces that with the full `navigation.attitude` object to capture all three axes, and adds two new environment subscriptions.

---

## Files to Modify

| File | Change |
|---|---|
| `schema/openapi.yaml` | Add `Attitude` schema; add `depth`, `waterTemperature`, `attitude` properties to `Entry` |
| `plugin/format.js` | Add `rad2deg1()`, `kelvin2celsius()` helpers; add depth/waterTemp/attitude conversion blocks |
| `plugin/index.js` | Replace `navigation.attitude.roll` with `navigation.attitude`; add 2 new environment paths |
| `plugin/triggers.js` | Change case `navigation.attitude.roll` → `navigation.attitude`; extract `.roll` from object |
| `README.md` | Add new fields to source data table and YAML example |
| `LOG.md` | Add change log entry |

---

## Implementation Steps

### 1. `schema/openapi.yaml` — Add new schema & properties

Add a new `Attitude` component schema (after `Waypoint`):

```yaml
Attitude:
  type: object
  additionalProperties: false
  properties:
    yaw:
      type: number
      example: 15.2
    pitch:
      type: number
      example: -2.3
    roll:
      type: number
      example: 8.7
```

Add three new properties to `Entry.properties` (after `barometer`, before `wind`):

```yaml
depth:
  type: number
  minimum: 0
  example: 12.5
waterTemperature:
  type: number
  example: 22.3
attitude:
  $ref: '#/components/schemas/Attitude'
```

Then regenerate JSON: `npm run prebuild`

### 2. `plugin/format.js` — Add conversion logic

Add two new helper functions at the top:

- `rad2deg1(rad)` — radians → degrees, 1 decimal (existing `rad2deg` rounds to integers, too coarse for attitude)
- `kelvin2celsius(kelvin)` — Kelvin → °C, 1 decimal

Add three new blocks inside `stateToEntry()` (after the engine block, before vhf):

- **depth**: `state['environment.depth.belowSurface']` → meters, 1 decimal (pass-through, no unit change)
- **waterTemperature**: `state['environment.water.temperature']` → °C via `kelvin2celsius()`
- **attitude**: `state['navigation.attitude']` → object check, convert each of `yaw`/`pitch`/`roll` via `rad2deg1()`

### 3. `plugin/index.js` — Update subscription paths (line 279)

- Replace `'navigation.attitude.roll'` with `'navigation.attitude'`
- Add `'environment.depth.belowSurface'` and `'environment.water.temperature'` after the existing environment paths

### 4. `plugin/triggers.js` — Adapt heel tracking (line 186)

Change `case 'navigation.attitude.roll':` to `case 'navigation.attitude':` and extract `.roll` from the object value with a type guard (`value && typeof value === 'object'`). All other heel-tracking logic stays the same.

### 5. `README.md` — Document new fields

Add rows to the source data table and add the new fields to the YAML example block.

### 6. `LOG.md` — Update change log

Add entry describing the new subscriptions, schema changes, and format additions.

---

## Unit Conversions

| Field | Signal K unit | Stored unit | Conversion | Precision |
|---|---|---|---|---|
| `depth` | meters | meters | none | 1 decimal |
| `waterTemperature` | Kelvin | °C | `K - 273.15` | 1 decimal |
| `attitude.yaw` | radians | degrees | `rad × 180 / π` | 1 decimal |
| `attitude.pitch` | radians | degrees | `rad × 180 / π` | 1 decimal |
| `attitude.roll` | radians | degrees | `rad × 180 / π` | 1 decimal |

---

## Backward Compatibility

- Old YAML files remain valid — all new fields are optional (not in `required`)
- Schema changes must be applied **before** any new-format entry is written (`additionalProperties: false` rejects unknown fields)
- Sensors not installed → fields simply omitted from entries (standard `isNaN` guards)

---

## Verification

1. `npm run prebuild` — regenerate `schema/openapi.json` from YAML
2. `npm run lint` — confirm no lint errors
3. `npm run build` — confirm webpack build succeeds
4. Manual: review generated `schema/openapi.json` to confirm `depth`, `waterTemperature`, and `Attitude` schema are present
5. Manual: inspect a test entry to verify new fields appear when sensors provide data
