const ordinal = require('ordinal');
const stateToEntry = require('./format');

// convert m/s to knots
function toKnots(mps) {
  return mps * 1.943844; // 1 m/s ≈ 1.9438 kt
}
// convert radians to degrees
function radToDeg(rad) {
  return (rad * 180) / Math.PI;
}

/**
 * Compute the circular (angular) mean of an array of angles in radians.
 * Handles wrap-around correctly (e.g. averaging 350° and 10° gives 0°).
 * @param {number[]} angles - Array of angles in radians.
 * @returns {number} Mean angle in radians (0 to 2π).
 */
function circularMeanRad(angles) {
  let sinSum = 0;
  let cosSum = 0;
  angles.forEach((a) => {
    sinSum += Math.sin(a);
    cosSum += Math.cos(a);
  });
  let mean = Math.atan2(sinSum / angles.length, cosSum / angles.length);
  if (mean < 0) mean += 2 * Math.PI;
  return mean;
}

// --- Course change debounce state (module-level) ---
/** @type {number} Settle delay in milliseconds. */
let courseSettleMs = 30000;
/** @type {ReturnType<typeof setTimeout>|null} Active debounce timer. */
let courseChangeTimer = null;
/** @type {number[]} Course samples (radians) collected during the settle window. */
let courseChangeSamples = [];
/** @type {number|null} The original (pre-change) course in radians. */
let courseChangeOriginal = null;

/**
 * Set the course change settle delay.
 * @param {number} seconds - Delay in seconds.
 */
exports.setCourseSettleDelay = function setCourseSettleDelay(seconds) {
  courseSettleMs = seconds * 1000;
};

/**
 * Cancel any pending course change debounce timer.
 * Call this when the plugin stops to avoid stale callbacks.
 */
exports.cancelCourseChangeTimer = function cancelCourseChangeTimer() {
  if (courseChangeTimer) {
    clearTimeout(courseChangeTimer);
    courseChangeTimer = null;
    courseChangeSamples = [];
    courseChangeOriginal = null;
  }
};

function isUnderWay(state) {
  if (state['navigation.state'] === 'sailing') {
    return true;
  }
  if (state['navigation.state'] === 'motoring') {
    return true;
  }
  return false;
}

function sailsString(state, app) {
  const string = [];
  Object.keys(state).forEach((path) => {
    const matched = path.match(/sails\.inventory\.([a-zA-Z0-9]+)/);
    if (!matched) {
      return;
    }
    // Since the sail updates arrive asynchronously, read from app directly
    // to ensure canonical state
    const sailState = app.getSelfPath(path).value;
    const sail = {
      ...sailState,
      id: matched[1],
    };
    if (!sail.active) {
      return;
    }
    if (sail.reducedState && sail.reducedState.reefs) {
      string.push(`${sail.name} (${ordinal(sail.reducedState.reefs)} reef)`);
      return;
    }
    if (sail.reducedState && sail.reducedState.furledRatio) {
      string.push(`${sail.name} (${sail.reducedState.furledRatio * 100}% furled)`);
      return;
    }
    string.push(sail.name);
  });
  return string.join(', ');
}

/**
 * Build a log entry from the current state and persist it to disk.
 *
 * @param {Object<string, *>} oldState - Shared plugin state used to populate
 *   the entry fields (position, speed, heading, etc.).
 * @param {import('./Log')} log - Log instance for persisting the entry.
 * @param {object} app - Signal K application object.
 * @param {string} text - Human-readable description of the event.
 * @param {Object<string, *>} [additionalData={}] - Extra fields merged into
 *   the entry (e.g. `end`, `position`).
 * @returns {Promise<void>}
 */
function appendLog(oldState, log, app, text, additionalData = {}) {
  const data = stateToEntry(oldState, text);

  // Ensure the entry has the vessel's position at the time of logging,
  // unless a specific position is explicitly provided by the caller
  // (e.g., for max record events captured earlier).
  if (additionalData.position) {
    data.position = additionalData.position;
  } else {
    const posInfo = app.getSelfPath && app.getSelfPath('navigation.position');
    if (posInfo && posInfo.value) {
      const gnssInfo = app.getSelfPath && app.getSelfPath('navigation.gnss.type');
      const source = (gnssInfo && gnssInfo.value) || (data.position && data.position.source);
      data.position = source ? { ...posInfo.value, source } : posInfo.value;
    }
  }

  Object.keys(additionalData).forEach((key) => {
    if (key === 'position') return; // already handled above
    data[key] = additionalData[key];
  });

  if (!data.category) {
    data.category = 'navigation';
  }
  return log.appendEntry(data)
    .then(() => {
      app.setPluginStatus(`Automatic log entry: ${text}`);
      return null;
    });
}

/**
 * Process Signal K path updates and create automatic log entries when
 * significant state changes are detected (e.g. course, autopilot,
 * navigation state, crew, sails, propulsion).
 *
 * @param {string} path - Signal K path that changed.
 * @param {*} value - New value for the path.
 * @param {Object<string, *>} oldState - Mutable shared state object; updated
 *   in-place for certain paths to prevent duplicate entries.
 * @param {import('./Log')} log - Log instance for persisting entries.
 * @param {object} app - Signal K application object.
 * @returns {Promise<Object<string, *>|void>} Optional state updates to merge.
 */
exports.processTriggers = function processTriggers(path, value, oldState, log, app) {
  switch (path) {
    case 'navigation.speedOverGround':
    case 'navigation.speedThroughWater': {
      const currentCandidate = oldState['custom.logbook.maxSpeedCandidate'] || 0;
      if (typeof value === 'number' && value > currentCandidate) {
        const posInfo = app.getSelfPath && app.getSelfPath('navigation.position');
        const pos = posInfo && posInfo.value ? posInfo.value : oldState['navigation.position'];
        return Promise.resolve({
          'custom.logbook.maxSpeedCandidate': value,
          'custom.logbook.maxSpeedCandidatePosition': pos,
        });
      }
      break;
    }
    case 'environment.wind.speedOverGround': {
      const currentCandidate = oldState['custom.logbook.maxWindCandidate'] || 0;
      if (typeof value === 'number' && value > currentCandidate) {
        const posInfo = app.getSelfPath && app.getSelfPath('navigation.position');
        const pos = posInfo && posInfo.value ? posInfo.value : oldState['navigation.position'];
        return Promise.resolve({
          'custom.logbook.maxWindCandidate': value,
          'custom.logbook.maxWindCandidatePosition': pos,
        });
      }
      break;
    }
    case 'environment.depth.belowSurface': {
      if (!isUnderWay(oldState) || !Number.isFinite(value) || value <= 0) {
        break;
      }
      const currentCandidate = oldState['custom.logbook.minDepthCandidate'];
      if (typeof currentCandidate !== 'number' || value < currentCandidate) {
        const posInfo = app.getSelfPath && app.getSelfPath('navigation.position');
        const pos = posInfo && posInfo.value ? posInfo.value : oldState['navigation.position'];
        return Promise.resolve({
          'custom.logbook.minDepthCandidate': value,
          'custom.logbook.minDepthCandidatePosition': pos,
        });
      }
      break;
    }
    case 'navigation.attitude': {
      // value is attitude object; roll is heel in radians
      if (value && typeof value === 'object' && !Number.isNaN(Number(value.roll))) {
        const heelDeg = Math.abs(radToDeg(value.roll));
        const currentCandidate = oldState['custom.logbook.maxHeelCandidate'] || 0;
        if (heelDeg > currentCandidate) {
          const posInfo = app.getSelfPath && app.getSelfPath('navigation.position');
          const pos = posInfo && posInfo.value ? posInfo.value : oldState['navigation.position'];
          return Promise.resolve({
            'custom.logbook.maxHeelCandidate': heelDeg,
            'custom.logbook.maxHeelCandidatePosition': pos,
          });
        }
      }
      break;
    }
    case 'navigation.courseOverGroundTrue': {
      // Log when course changes by >25° while sailing. Uses a configurable
      // settle delay to filter wave-induced oscillations: on the first
      // threshold crossing a timer starts and course samples are collected.
      // When the timer fires the circular mean of all samples is logged.
      if (oldState['navigation.state'] === 'sailing' && typeof value === 'number') {
        const last = typeof oldState['custom.logbook.lastCourse'] === 'number'
          ? oldState['custom.logbook.lastCourse']
          : value;

        // If a debounce window is already open, collect the sample
        if (courseChangeTimer) {
          courseChangeSamples.push(value);
          return Promise.resolve();
        }

        let delta = Math.abs(radToDeg(value) - radToDeg(last));
        if (delta > 180) delta = 360 - delta;
        if (delta >= 25) {
          // Bypass settle delay when configured to 0
          if (courseSettleMs <= 0) {
            const posInfo = app.getSelfPath && app.getSelfPath('navigation.position');
            const pos = posInfo && posInfo.value ? posInfo.value : oldState['navigation.position'];
            // eslint-disable-next-line no-param-reassign
            oldState['custom.logbook.lastCourse'] = value;
            // eslint-disable-next-line no-param-reassign
            oldState['navigation.position'] = pos;
            const stateWithPos = { ...oldState, 'navigation.position': pos };
            return appendLog(
              stateWithPos,
              log,
              app,
              `Course change: ${radToDeg(last).toFixed(0)}° → ${radToDeg(value).toFixed(0)}°`,
            ).then(() => ({
              'custom.logbook.lastCourse': value,
              'navigation.position': pos,
            }));
          }

          // Start the settle window
          courseChangeOriginal = last;
          courseChangeSamples = [value];

          // Freeze references for the timer callback
          const stateRef = oldState;
          const logRef = log;
          const appRef = app;

          courseChangeTimer = setTimeout(() => {
            const avgCourse = circularMeanRad(courseChangeSamples);
            const posInfo = appRef.getSelfPath && appRef.getSelfPath('navigation.position');
            const pos = posInfo && posInfo.value
              ? posInfo.value : stateRef['navigation.position'];
            // eslint-disable-next-line no-param-reassign
            stateRef['custom.logbook.lastCourse'] = avgCourse;
            // eslint-disable-next-line no-param-reassign
            stateRef['navigation.position'] = pos;
            const stateWithPos = { ...stateRef, 'navigation.position': pos };
            appendLog(
              stateWithPos,
              logRef,
              appRef,
              `Course change: ${radToDeg(courseChangeOriginal).toFixed(0)}° → ${radToDeg(avgCourse).toFixed(0)}°`,
            ).catch((err) => {
              appRef.setPluginError(`Failed to store entry: ${err.message}`);
            });

            // Reset debounce state
            courseChangeTimer = null;
            courseChangeSamples = [];
            courseChangeOriginal = null;
          }, courseSettleMs);

          // Update lastCourse immediately so further updates during the
          // settle window don't re-trigger the threshold check.
          // eslint-disable-next-line no-param-reassign
          oldState['custom.logbook.lastCourse'] = value;
          return Promise.resolve();
        }
        if (last !== oldState['custom.logbook.lastCourse']) {
          // Initialize stored course when starting under way
          return Promise.resolve({ 'custom.logbook.lastCourse': last });
        }
      }
      break;
    }
    case 'steering.autopilot.state': {
      if (oldState[path] === value || !oldState[path]) {
        // We can ignore state when it doesn't change
        return Promise.resolve();
      }
      if (!isUnderWay(oldState)) {
        // Autopilot state changes are likely not interesting when not under way
        return Promise.resolve();
      }
      // Update state immediately to prevent duplicate entries when the same
      // state change arrives from multiple sources before the async log write
      // completes (same pattern used by the course change handler).
      // eslint-disable-next-line no-param-reassign
      oldState[path] = value;
      if (value === 'auto') {
        return appendLog(oldState, log, app, 'Autopilot activated');
      }
      if (value === 'wind') {
        return appendLog(oldState, log, app, 'Autopilot set to wind mode');
      }
      if (value === 'route') {
        return appendLog(oldState, log, app, 'Autopilot set to route mode');
      }
      if (value === 'standby') {
        return appendLog(oldState, log, app, 'Autopilot deactivated');
      }
      break;
    }
    case 'navigation.state': {
      if (oldState[path] === value || !oldState[path]) {
        // We can ignore state when it doesn't change
        return Promise.resolve();
      }
      // Capture previous state for log text before updating immediately
      const prevState = oldState[path];
      // eslint-disable-next-line no-param-reassign
      oldState[path] = value;
      if (value === 'anchored') {
        return appendLog(oldState, log, app, 'Anchored', {
          end: true,
          'custom.logbook.maxSpeed': 0,
          'custom.logbook.maxWind': 0,
          'custom.logbook.maxHeel': 0,
          'custom.logbook.minDepth': undefined,
        }).then(() => ({
          'custom.logbook.maxSpeed': 0,
          'custom.logbook.maxWind': 0,
          'custom.logbook.maxHeel': 0,
          'custom.logbook.minDepth': undefined,
          'custom.logbook.lastCourse': undefined,
          'custom.logbook.minDepthCandidate': undefined,
          'custom.logbook.maxSpeedCandidatePosition': undefined,
          'custom.logbook.maxWindCandidatePosition': undefined,
          'custom.logbook.maxHeelCandidatePosition': undefined,
          'custom.logbook.minDepthCandidatePosition': undefined,
        }));
      }
      if (value === 'sailing') {
        let text = '';
        if (prevState === 'motoring') {
          text = 'Motor stopped, sailing';
          if (oldState['custom.logbook.sails']) {
            text = `${text} with ${oldState['custom.logbook.sails']}`;
          }
          return appendLog(oldState, log, app, text);
        }
        text = 'Sailing';
        if (oldState['custom.logbook.sails']) {
          text = `${text} with ${oldState['custom.logbook.sails']}`;
        }
        return appendLog(oldState, log, app, text);
      }
      if (value === 'motoring') {
        let text = 'Motoring';
        if (prevState === 'anchored') {
          text = 'Anchor up, motoring';
        } else if (prevState === 'sailing') {
          text = 'Sails down, motoring';
        }
        return appendLog(oldState, log, app, text)
          .then(() => ({ 'custom.logbook.lastCourse': undefined }));
      }
      if (value === 'moored') {
        return appendLog(oldState, log, app, 'Stopped', {
          end: true,
          'custom.logbook.maxSpeed': 0,
          'custom.logbook.maxWind': 0,
          'custom.logbook.maxHeel': 0,
          'custom.logbook.minDepth': undefined,
        }).then(() => ({
          'custom.logbook.maxSpeed': 0,
          'custom.logbook.maxWind': 0,
          'custom.logbook.maxHeel': 0,
          'custom.logbook.minDepth': undefined,
          'custom.logbook.lastCourse': undefined,
          'custom.logbook.minDepthCandidate': undefined,
          'custom.logbook.maxSpeedCandidatePosition': undefined,
          'custom.logbook.maxWindCandidatePosition': undefined,
          'custom.logbook.maxHeelCandidatePosition': undefined,
          'custom.logbook.minDepthCandidatePosition': undefined,
        }));
      }
      break;
    }
    default: {
      break;
    }
  }

  const propulsionState = path.match(/propulsion\.([A-Za-z0-9]+)\.state/);
  if (propulsionState) {
    if (oldState[path] === value || !oldState[path]) {
      // We can ignore state when it doesn't change
      return Promise.resolve();
    }
    if (isUnderWay(oldState)) {
      // Logging motor state changes is redundant when it anyway changes vessel state
      return Promise.resolve();
    }
    const engineName = propulsionState[1];
    if (value === 'started') {
      return appendLog(oldState, log, app, `Started ${engineName} engine`);
    }
    if (value === 'stopped') {
      return appendLog(oldState, log, app, `Stopped ${engineName} engine`);
    }
  }

  const sailState = path.match(/sails\.inventory\.([a-zA-Z0-9]+)/);
  if (sailState) {
    const sails = {
      ...oldState,
    };
    sails[path] = value;
    const sailsCombined = sailsString(sails, app);
    const stateUpdates = {
      'custom.logbook.sails': sailsCombined,
    };
    if (!oldState['custom.logbook.sails']) {
      return Promise.resolve(stateUpdates);
    }
    if (oldState['custom.logbook.sails'] === sailsCombined) {
      return Promise.resolve(null);
    }
    if (oldState['navigation.state'] === 'sailing') {
      return appendLog(oldState, log, app, `Sails set: ${sailsCombined}`)
        .then(() => stateUpdates);
    }
    return Promise.resolve(stateUpdates);
  }

  return Promise.resolve();
};

/**
 * Periodic check (every ~2 minutes) that promotes max-value candidates
 * (speed, wind, heel, depth) into permanent records by writing log entries.
 *
 * @param {Object<string, *>} oldState - Shared plugin state.
 * @param {import('./Log')} log - Log instance for persisting entries.
 * @param {object} app - Signal K application object.
 * @returns {Promise<Object<string, *>>} State updates to merge (resets candidates).
 */
exports.processTwoMinute = function processTwoMinute(oldState, log, app) {
  const updates = {
    'custom.logbook.maxSpeedCandidate': 0,
    'custom.logbook.maxWindCandidate': 0,
    'custom.logbook.maxHeelCandidate': 0,
    'custom.logbook.minDepthCandidate': undefined,
    'custom.logbook.maxSpeedCandidatePosition': undefined,
    'custom.logbook.maxWindCandidatePosition': undefined,
    'custom.logbook.maxHeelCandidatePosition': undefined,
    'custom.logbook.minDepthCandidatePosition': undefined,
  };

  if (!isUnderWay(oldState)) {
    return Promise.resolve(updates);
  }

  let promise = Promise.resolve();

  if (typeof oldState['custom.logbook.maxSpeedCandidate'] === 'number'
      && oldState['custom.logbook.maxSpeedCandidate'] > (oldState['custom.logbook.maxSpeed'] || 0)) {
    const speed = oldState['custom.logbook.maxSpeedCandidate'];
    const speedKn = toKnots(speed).toFixed(1);
    promise = promise.then(() => appendLog(oldState, log, app, `New speed record: ${speedKn} kt`, {
      'custom.logbook.maxSpeed': speed,
    })).then(() => {
      updates['custom.logbook.maxSpeed'] = speed;
    });
  }

  if (typeof oldState['custom.logbook.maxWindCandidate'] === 'number'
      && oldState['custom.logbook.maxWindCandidate'] > (oldState['custom.logbook.maxWind'] || 0)) {
    const wind = oldState['custom.logbook.maxWindCandidate'];
    const windKn = toKnots(wind).toFixed(1);
    promise = promise.then(() => appendLog(oldState, log, app, `New wind speed record: ${windKn} kt`, {
      'custom.logbook.maxWind': wind,
    })).then(() => {
      updates['custom.logbook.maxWind'] = wind;
    });
  }

  if (typeof oldState['custom.logbook.maxHeelCandidate'] === 'number'
      && oldState['custom.logbook.maxHeelCandidate'] > (oldState['custom.logbook.maxHeel'] || 0)) {
    const heel = oldState['custom.logbook.maxHeelCandidate'];
    promise = promise.then(() => appendLog(oldState, log, app, `New heel record: ${heel.toFixed(1)}°`, {
      'custom.logbook.maxHeel': heel,
    })).then(() => {
      updates['custom.logbook.maxHeel'] = heel;
    });
  }

  const minimumDepth = oldState['custom.logbook.minDepth'];
  const depthCandidate = oldState['custom.logbook.minDepthCandidate'];
  if (typeof depthCandidate === 'number'
      && (typeof minimumDepth !== 'number' || depthCandidate < minimumDepth)) {
    promise = promise.then(() => appendLog(
      oldState,
      log,
      app,
      `New minimum depth record: ${depthCandidate.toFixed(1)} m`,
      {
        depth: depthCandidate,
        position: oldState['custom.logbook.minDepthCandidatePosition'],
        'custom.logbook.minDepth': depthCandidate,
      },
    )).then(() => {
      updates['custom.logbook.minDepth'] = depthCandidate;
    });
  }

  return promise.then(() => updates);
};

/**
 * Create an automatic hourly log entry when the vessel is under way.
 *
 * @param {Object<string, *>} oldState - Shared plugin state.
 * @param {import('./Log')} log - Log instance for persisting entries.
 * @param {object} app - Signal K application object.
 * @returns {Promise<void>}
 */
exports.processHourly = function processHourly(oldState, log, app) {
  if (oldState['navigation.state'] !== 'sailing' && oldState['navigation.state'] !== 'motoring') {
    return Promise.resolve();
  }
  const data = stateToEntry(oldState, '');
  // Ensure position reflects the vessel's position at the hourly tick
  const posInfo = app.getSelfPath && app.getSelfPath('navigation.position');
  if (posInfo && posInfo.value) {
    const gnssInfo = app.getSelfPath && app.getSelfPath('navigation.gnss.type');
    const source = (gnssInfo && gnssInfo.value) || (data.position && data.position.source);
    data.position = source ? { ...posInfo.value, source } : posInfo.value;
  }
  return log.appendEntry(data)
    .then(() => {
      app.setPluginStatus('Automatic hourly log entry');
    });
};
