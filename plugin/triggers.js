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

function appendLog(oldState, log, app, text, additionalData = {}) {
  const data = stateToEntry(oldState, text);
  Object.keys(additionalData).forEach((key) => {
    data[key] = additionalData[key];
  });
  if (!data.category) {
    data.category = 'navigation';
  }
  const dateString = new Date(data.datetime).toISOString().substr(0, 10);
  return log.appendEntry(dateString, data)
    .then(() => {
      app.setPluginStatus(`Automatic log entry: ${text}`);
      return null;
    });
}

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
    case 'navigation.attitude.roll': {
      // roll is heel; value in radians
      const heelDeg = Math.abs(radToDeg(value));
      const currentCandidate = oldState['custom.logbook.maxHeelCandidate'] || 0;
      if (heelDeg > currentCandidate) {
        const posInfo = app.getSelfPath && app.getSelfPath('navigation.position');
        const pos = posInfo && posInfo.value ? posInfo.value : oldState['navigation.position'];
        return Promise.resolve({
          'custom.logbook.maxHeelCandidate': heelDeg,
          'custom.logbook.maxHeelCandidatePosition': pos,
        });
      }
      break;
    }
    case 'navigation.courseOverGroundTrue': {
      // Log when course changes by >25° while the vessel is sailing. Compare
      // against the last stored course rather than the previous update so that
      // gradual changes are still picked up once the cumulative change exceeds
      // the threshold.
      if (oldState['navigation.state'] === 'sailing' && typeof value === 'number') {
        const last = typeof oldState['custom.logbook.lastCourse'] === 'number'
          ? oldState['custom.logbook.lastCourse']
          : value;
        let delta = Math.abs(radToDeg(value) - radToDeg(last));
        if (delta > 180) delta = 360 - delta;
        if (delta >= 25) {
          const posInfo = app.getSelfPath && app.getSelfPath('navigation.position');
          const pos = posInfo && posInfo.value ? posInfo.value : oldState['navigation.position'];

          // Update the stored course immediately so that subsequent
          // updates see the new value even if log writing is still
          // in progress.
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
      if (value === 'anchored') {
        return appendLog(oldState, log, app, 'Anchored', {
          end: true,
          'custom.logbook.maxSpeed': 0,
          'custom.logbook.maxWind': 0,
          'custom.logbook.maxHeel': 0,
        }).then(() => ({
          'custom.logbook.maxSpeed': 0,
          'custom.logbook.maxWind': 0,
          'custom.logbook.maxHeel': 0,
          'custom.logbook.lastCourse': undefined,
          'custom.logbook.maxSpeedCandidatePosition': undefined,
          'custom.logbook.maxWindCandidatePosition': undefined,
          'custom.logbook.maxHeelCandidatePosition': undefined,
        }));
      }
      if (value === 'sailing') {
        let text = '';
        if (oldState[path] === 'motoring') {
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
        if (oldState[path] === 'anchored') {
          text = 'Anchor up, motoring';
        } else if (oldState[path] === 'sailing') {
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
        }).then(() => ({
          'custom.logbook.maxSpeed': 0,
          'custom.logbook.maxWind': 0,
          'custom.logbook.maxHeel': 0,
          'custom.logbook.lastCourse': undefined,
          'custom.logbook.maxSpeedCandidatePosition': undefined,
          'custom.logbook.maxWindCandidatePosition': undefined,
          'custom.logbook.maxHeelCandidatePosition': undefined,
        }));
      }
      break;
    }
    case 'communication.crewNames': {
      if (!oldState[path] || !oldState[path].length) {
        return Promise.resolve();
      }
      if (!value || !value.length) {
        return Promise.resolve();
      }
      if (JSON.stringify(oldState[path]) === JSON.stringify(path)) {
        return Promise.resolve();
      }
      const added = value.filter((v) => oldState[path].indexOf(v) === -1);
      const removed = oldState[path].filter((v) => value.indexOf(v) === -1);
      if (added.length && removed.length) {
        return appendLog(oldState, log, app, `Crew changed to ${value.join(', ')}`);
      }
      if (added.length) {
        return appendLog(oldState, log, app, `${added.join(', ')} joined the crew`);
      }
      if (removed.length) {
        return appendLog(oldState, log, app, `${removed.join(', ')} left the crew`);
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

exports.processTwoMinute = function processTwoMinute(oldState, log, app) {
  const updates = {
    'custom.logbook.maxSpeedCandidate': 0,
    'custom.logbook.maxWindCandidate': 0,
    'custom.logbook.maxHeelCandidate': 0,
    'custom.logbook.maxSpeedCandidatePosition': undefined,
    'custom.logbook.maxWindCandidatePosition': undefined,
    'custom.logbook.maxHeelCandidatePosition': undefined,
  };

  if (!isUnderWay(oldState)) {
    return Promise.resolve(updates);
  }

  let promise = Promise.resolve();

  if (typeof oldState['custom.logbook.maxSpeedCandidate'] === 'number'
      && oldState['custom.logbook.maxSpeedCandidate'] > (oldState['custom.logbook.maxSpeed'] || 0)) {
    const speed = oldState['custom.logbook.maxSpeedCandidate'];
    const speedKn = toKnots(speed).toFixed(1);
    const position = oldState['custom.logbook.maxSpeedCandidatePosition'];
    promise = promise.then(() => appendLog(oldState, log, app, `New speed record: ${speedKn} kt`, {
      'custom.logbook.maxSpeed': speed,
      position,
    })).then(() => {
      updates['custom.logbook.maxSpeed'] = speed;
      if (position) {
        updates['navigation.position'] = position;
      }
    });
  }

  if (typeof oldState['custom.logbook.maxWindCandidate'] === 'number'
      && oldState['custom.logbook.maxWindCandidate'] > (oldState['custom.logbook.maxWind'] || 0)) {
    const wind = oldState['custom.logbook.maxWindCandidate'];
    const windKn = toKnots(wind).toFixed(1);
    const position = oldState['custom.logbook.maxWindCandidatePosition'];
    promise = promise.then(() => appendLog(oldState, log, app, `New wind speed record: ${windKn} kt`, {
      'custom.logbook.maxWind': wind,
      position,
    })).then(() => {
      updates['custom.logbook.maxWind'] = wind;
      if (position) {
        updates['navigation.position'] = position;
      }
    });
  }

  if (typeof oldState['custom.logbook.maxHeelCandidate'] === 'number'
      && oldState['custom.logbook.maxHeelCandidate'] > (oldState['custom.logbook.maxHeel'] || 0)) {
    const heel = oldState['custom.logbook.maxHeelCandidate'];
    const position = oldState['custom.logbook.maxHeelCandidatePosition'];
    promise = promise.then(() => appendLog(oldState, log, app, `New heel record: ${heel.toFixed(1)}°`, {
      'custom.logbook.maxHeel': heel,
      position,
    })).then(() => {
      updates['custom.logbook.maxHeel'] = heel;
    });
  }

  return promise.then(() => updates);
};

exports.processHourly = function processHourly(oldState, log, app) {
  if (oldState['navigation.state'] !== 'sailing' && oldState['navigation.state'] !== 'motoring') {
    return Promise.resolve();
  }
  const data = stateToEntry(oldState, '');
  const dateString = new Date(data.datetime).toISOString().substr(0, 10);
  return log.appendEntry(dateString, data)
    .then(() => {
      app.setPluginStatus('Automatic hourly log entry');
    });
};
