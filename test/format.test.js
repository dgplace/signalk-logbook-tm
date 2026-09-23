const assert = require('node:assert/strict');
const os = require('node:os');
const { test } = require('node:test');
const stateToEntry = require('../plugin/format');
const Log = require('../plugin/Log');

/**
 * Build a minimal vessel state with engine hours for format tests.
 *
 * @param {Object<string, *>} extras - Additional Signal K path values.
 * @returns {Object<string, *>} Vessel state keyed by Signal K path.
 */
function baseState(extras = {}) {
  return {
    'navigation.datetime': '2026-09-23T10:00:00.000Z',
    'propulsion.port.runTime': 1458000,
    ...extras,
  };
}

test('stamps propulsion state when present and keeps engine hours', () => {
  const entry = stateToEntry(baseState({
    'propulsion.port.state': 'started',
    'propulsion.starboard.state': 'stopped',
  }), 'Heartbeat');

  assert.deepEqual(entry.propulsion, {
    port: { state: 'started' },
    starboard: { state: 'stopped' },
  });
  assert.equal(entry.navigationState, undefined);
  assert.equal(entry.engine.hours, 405);
  assert.equal(Object.prototype.hasOwnProperty.call(entry, 'navigationState'), false);
});

test('stamps navigationState when only navigation.state is present', () => {
  const entry = stateToEntry(baseState({
    'navigation.state': 'sailing',
  }), 'Heartbeat');

  assert.equal(entry.navigationState, 'sailing');
  assert.equal(entry.propulsion, undefined);
  assert.equal(Object.prototype.hasOwnProperty.call(entry, 'propulsion'), false);
  assert.equal(entry.engine.hours, 405);
});

test('omits navigationState and propulsion when neither state is present', () => {
  const entry = stateToEntry(baseState({
    'propulsion.port.state': null,
    'navigation.state': '',
  }), 'Heartbeat');

  assert.equal(entry.navigationState, undefined);
  assert.equal(entry.propulsion, undefined);
  assert.equal(Object.prototype.hasOwnProperty.call(entry, 'navigationState'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(entry, 'propulsion'), false);
  assert.equal(entry.engine.hours, 405);
});

test('OpenAPI Entry schema accepts stamped state fields', async () => {
  const log = new Log(os.tmpdir());
  const entry = stateToEntry(baseState({
    'navigation.state': 'motoring',
    'propulsion.port.state': 'started',
  }), 'Heartbeat');
  entry.category = 'navigation';

  const result = await log.validateEntry(entry);
  assert.equal(result.errors.length, 0, JSON.stringify(result.errors));
});

test('stamps both propulsion and navigationState when both are published', () => {
  const entry = stateToEntry(baseState({
    'navigation.state': 'motoring',
    'propulsion.port.state': 'started',
  }), 'Heartbeat');

  assert.equal(entry.navigationState, 'motoring');
  assert.deepEqual(entry.propulsion, {
    port: { state: 'started' },
  });
  assert.equal(entry.engine.hours, 405);
});
