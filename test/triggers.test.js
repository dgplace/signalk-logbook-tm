const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  processTriggers,
  processTwoMinute,
} = require('../plugin/triggers');

/**
 * Create a minimal Signal K application mock.
 *
 * @param {Object<string, *>} pathValues - Values returned by Signal K path.
 * @returns {object} Signal K application mock.
 */
function createApp(pathValues = {}) {
  return {
    getSelfPath(path) {
      return { value: pathValues[path] };
    },
    setPluginStatus() {},
  };
}

test('tracks the lowest positive depth candidate while under way', async () => {
  const position = { latitude: -27.5, longitude: 153.1 };
  const app = createApp({ 'navigation.position': position });
  const state = { 'navigation.state': 'sailing' };

  const firstUpdate = await processTriggers(
    'environment.depth.belowSurface',
    4.2,
    state,
    null,
    app,
  );
  assert.deepEqual(firstUpdate, {
    'custom.logbook.minDepthCandidate': 4.2,
    'custom.logbook.minDepthCandidatePosition': position,
  });

  state['custom.logbook.minDepthCandidate'] = firstUpdate['custom.logbook.minDepthCandidate'];
  assert.equal(
    await processTriggers('environment.depth.belowSurface', 5.1, state, null, app),
    undefined,
  );
});

test('ignores invalid depth samples and samples received when not under way', async () => {
  const app = createApp();
  const state = { 'navigation.state': 'moored' };

  assert.equal(
    await processTriggers('environment.depth.belowSurface', 2.5, state, null, app),
    undefined,
  );
  state['navigation.state'] = 'motoring';
  assert.equal(
    await processTriggers('environment.depth.belowSurface', 0, state, null, app),
    undefined,
  );
  assert.equal(
    await processTriggers('environment.depth.belowSurface', Number.NaN, state, null, app),
    undefined,
  );
});

test('promotes a new minimum depth record during the two-minute check', async () => {
  const candidatePosition = { latitude: -27.6, longitude: 153.2 };
  const entries = [];
  const log = {
    appendEntry(entry) {
      entries.push(entry);
      return Promise.resolve();
    },
  };
  const app = createApp({
    'navigation.position': { latitude: -27.7, longitude: 153.3 },
  });
  const state = {
    'navigation.state': 'sailing',
    'environment.depth.belowSurface': 8.6,
    'custom.logbook.minDepth': 5.2,
    'custom.logbook.minDepthCandidate': 3.4,
    'custom.logbook.minDepthCandidatePosition': candidatePosition,
  };

  const updates = await processTwoMinute(state, log, app);

  assert.equal(entries.length, 1);
  assert.equal(entries[0].text, 'New minimum depth record: 3.4 m');
  assert.equal(entries[0].depth, 3.4);
  assert.equal(entries[0]['custom.logbook.minDepth'], 3.4);
  assert.deepEqual(entries[0].position, candidatePosition);
  assert.equal(updates['custom.logbook.minDepth'], 3.4);
  assert.equal(updates['custom.logbook.minDepthCandidate'], undefined);
  assert.equal(updates['custom.logbook.minDepthCandidatePosition'], undefined);
});

test('does not promote a depth that is not a new minimum', async () => {
  let appendCount = 0;
  const log = {
    appendEntry() {
      appendCount += 1;
      return Promise.resolve();
    },
  };
  const state = {
    'navigation.state': 'motoring',
    'custom.logbook.minDepth': 3.4,
    'custom.logbook.minDepthCandidate': 4.1,
  };

  const updates = await processTwoMinute(state, log, createApp());

  assert.equal(appendCount, 0);
  assert.equal(updates['custom.logbook.minDepthCandidate'], undefined);
  assert.equal(updates['custom.logbook.minDepth'], undefined);
});

test('resets the minimum depth record when a trip ends', async () => {
  const entries = [];
  const log = {
    appendEntry(entry) {
      entries.push(entry);
      return Promise.resolve();
    },
  };
  const state = {
    'navigation.state': 'sailing',
    'custom.logbook.minDepth': 2.8,
    'custom.logbook.minDepthCandidate': 2.6,
    'custom.logbook.minDepthCandidatePosition': {
      latitude: -27.8,
      longitude: 153.4,
    },
  };

  const updates = await processTriggers(
    'navigation.state',
    'anchored',
    state,
    log,
    createApp(),
  );

  assert.equal(entries.length, 1);
  assert.equal(entries[0].text, 'Anchored');
  assert.equal(updates['custom.logbook.minDepth'], undefined);
  assert.equal(updates['custom.logbook.minDepthCandidate'], undefined);
  assert.equal(updates['custom.logbook.minDepthCandidatePosition'], undefined);
});
