/**
 * @typedef {Object} PropulsionEngineState
 * @property {string} state Live Signal K propulsion engine state (e.g. started, stopped).
 */

/**
 * @typedef {Object<string, PropulsionEngineState>} PropulsionStateMap
 * Map of engine identifiers to their live Signal K state.
 */

/**
 * Convert radians to integer degrees.
 *
 * @param {number} rad - Angle in radians.
 * @returns {number} Angle in whole degrees.
 */
function rad2deg(rad) {
  return Math.round((rad * 180) / Math.PI);
}

/**
 * Convert radians to degrees with one decimal place.
 *
 * @param {number} rad - Angle in radians.
 * @returns {number} Angle in degrees.
 */
function rad2deg1(rad) {
  return parseFloat(((rad * 180) / Math.PI).toFixed(1));
}

/**
 * Convert Kelvin to Celsius with one decimal place.
 *
 * @param {number} kelvin - Temperature in Kelvin.
 * @returns {number} Temperature in Celsius.
 */
function kelvin2celsius(kelvin) {
  return parseFloat((kelvin - 273.15).toFixed(1));
}

/**
 * Convert metres per second to knots with one decimal place.
 *
 * @param {number} ms - Speed in metres per second.
 * @returns {number} Speed in knots.
 */
function ms2kt(ms) {
  return parseFloat((ms * 1.94384).toFixed(1));
}

/**
 * Return a present Signal K state string, or null when the value is absent.
 * Empty or non-string values are treated as missing; no motoring/sailing
 * state is invented.
 *
 * @param {*} value - Candidate state value from the vessel buffer.
 * @returns {string|null} State string, or null when unpublished.
 */
function presentStateString(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * Return present `navigation.state` from buffered vessel state.
 *
 * @param {Object<string, *>} state - Buffered vessel state keyed by Signal K path.
 * @returns {string|null} Live navigation state, or null when unpublished.
 */
function readNavigationState(state) {
  return presentStateString(state['navigation.state']);
}

/**
 * Collect present `propulsion.<id>.state` values as a map of engine states.
 * Engines without a published state are omitted. Does not read `engine.hours`.
 *
 * @param {Object<string, *>} state - Buffered vessel state keyed by Signal K path.
 * @returns {PropulsionStateMap|null} Engine-id map, or null when none published.
 */
function readPropulsionState(state) {
  const propulsion = {};
  Object.keys(state).forEach((key) => {
    const match = key.match(/^propulsion\.([A-Za-z0-9]+)\.state$/);
    if (!match) {
      return;
    }
    const engineState = presentStateString(state[key]);
    if (!engineState) {
      return;
    }
    propulsion[match[1]] = {
      state: engineState,
    };
  });
  if (Object.keys(propulsion).length === 0) {
    return null;
  }
  return propulsion;
}

/**
 * Convert buffered Signal K vessel state into a human-friendly log entry.
 *
 * @param {Object<string, *>} state - Buffered vessel state keyed by Signal K path.
 * @param {string} text - Human-readable description of the event.
 * @param {string} [author=''] - Entry author, empty for automatic entries.
 * @returns {Object<string, *>} Log entry including optional `navigationState`
 *   and `propulsion` fields when those Signal K paths are present.
 */
module.exports = function stateToEntry(state, text, author = '') {
  const data = {
    datetime: state['navigation.datetime'] || new Date().toISOString(),
    text,
    author,
  };
  if (state['navigation.position']) {
    data.position = {
      latitude: state['navigation.position'].latitude,
      longitude: state['navigation.position'].longitude,
    };
  }
  if (state['navigation.gnss.type'] && data.position) {
    data.position.source = state['navigation.gnss.type'];
  }
  if (!Number.isNaN(Number(state['navigation.headingTrue']))) {
    data.heading = rad2deg(state['navigation.headingTrue']);
  }
  if (!Number.isNaN(Number(state['navigation.courseOverGroundTrue']))) {
    data.course = rad2deg(state['navigation.courseOverGroundTrue']);
  }
  if (!Number.isNaN(Number(state['navigation.speedThroughWater']))) {
    if (!data.speed) {
      data.speed = {};
    }
    data.speed.stw = ms2kt(state['navigation.speedThroughWater']);
  }
  if (!Number.isNaN(Number(state['navigation.speedOverGround']))) {
    if (!data.speed) {
      data.speed = {};
    }
    data.speed.sog = ms2kt(state['navigation.speedOverGround']);
  }
  if (!Number.isNaN(Number(state['navigation.log']))) {
    data.log = parseFloat((state['navigation.log'] / 1852).toFixed(1));
  }
  if (state['navigation.courseRhumbline.nextPoint.position']
    && !Number.isNaN(Number(state['navigation.courseRhumbline.nextPoint.position'].latitude))) {
    data.waypoint = state['navigation.courseRhumbline.nextPoint.position'];
  }
  if (!Number.isNaN(Number(state['environment.outside.pressure']))) {
    data.barometer = parseFloat((state['environment.outside.pressure'] / 100).toFixed(2));
  }
  if (!Number.isNaN(Number(state['environment.depth.belowSurface']))) {
    data.depth = parseFloat(state['environment.depth.belowSurface'].toFixed(1));
  }
  if (!Number.isNaN(Number(state['environment.water.temperature']))) {
    data.waterTemperature = kelvin2celsius(state['environment.water.temperature']);
  }

  // Handle attitude (yaw, pitch, roll) which arrives as an object.
  const attitude = state['navigation.attitude'] || {};
  const { yaw, pitch, roll } = attitude;

  if (!Number.isNaN(Number(yaw)) || !Number.isNaN(Number(pitch)) || !Number.isNaN(Number(roll))) {
    data.attitude = {};
    if (!Number.isNaN(Number(yaw))) {
      data.attitude.yaw = rad2deg1(yaw);
    }
    if (!Number.isNaN(Number(pitch))) {
      data.attitude.pitch = rad2deg1(pitch);
    }
    if (!Number.isNaN(Number(roll))) {
      data.attitude.roll = rad2deg1(roll);
    }
  }

  if (!Number.isNaN(Number(state['environment.wind.speedOverGround']))) {
    if (!data.wind) {
      data.wind = {};
    }
    data.wind.speed = ms2kt(state['environment.wind.speedOverGround']);
  }
  if (!Number.isNaN(Number(state['environment.wind.directionTrue']))) {
    if (!data.wind) {
      data.wind = {};
    }
    data.wind.direction = rad2deg(state['environment.wind.directionTrue']);
  }
  if (!Number.isNaN(Number(state['environment.water.swell.state']))) {
    if (!data.observations) {
      data.observations = {};
    }
    data.observations.seaState = state['environment.water.swell.state'];
  }
  if (!Number.isNaN(Number(state['environment.outside.cloudCoverage']))) {
    if (!data.observations) {
      data.observations = {};
    }
    data.observations.cloudCoverage = state['environment.outside.cloudCoverage'];
  }
  if (!Number.isNaN(Number(state['environment.outside.visibility']))) {
    if (!data.observations) {
      data.observations = {};
    }
    data.observations.visibility = state['environment.outside.visibility'];
  }
  Object.keys(state).forEach((key) => {
    if (!key.match(/propulsion\.[A-Za-z0-9]+\.runTime/)) {
      return;
    }
    if (!Number.isNaN(Number(state[key]))) {
      if (!data.engine) {
        data.engine = {};
      }
      data.engine.hours = parseFloat((state[key] / 60 / 60).toFixed(1));
    }
  });
  const propulsion = readPropulsionState(state);
  if (propulsion) {
    data.propulsion = propulsion;
  }
  const navigationState = readNavigationState(state);
  if (navigationState) {
    data.navigationState = navigationState;
  }
  if (state['communication.vhf.channel']) {
    data.vhf = state['communication.vhf.channel'];
  }
  return data;
};
