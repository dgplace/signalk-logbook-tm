const CircularBuffer = require('circular-buffer');
const Log = require('./Log');
const stateToEntry = require('./format');
const {
  processTriggers, processHourly, processTwoMinute,
  setCourseSettleDelay, cancelCourseChangeTimer,
} = require('./triggers');
const {
  DEFAULT_TIME_ZONE,
  isValidTimeZone,
  normalizeTimeZone,
} = require('./timezone');
const openAPI = require('../schema/openapi.json');
const pkg = require('../package.json');

/** Default heartbeat interval in minutes for automatic log entries. */
const DEFAULT_HEARTBEAT_MINUTES = 30;

/** Default settle delay in seconds before logging a course change. */
const DEFAULT_COURSE_SETTLE_SECONDS = 30;

/** Default timezone for log persistence (computer/server timezone). */
const DEFAULT_LOG_TIME_ZONE = DEFAULT_TIME_ZONE;

/**
 * List available IANA timezones supported by the current runtime.
 *
 * @returns {string[]} Supported timezone identifiers, or an empty list when unavailable.
 */
function getSupportedTimeZones() {
  if (typeof Intl.supportedValuesOf !== 'function') {
    return [];
  }
  try {
    return Intl.supportedValuesOf('timeZone');
  } catch (error) {
    return [];
  }
}

/** @type {string[]} */
const SUPPORTED_TIME_ZONES = getSupportedTimeZones();

/**
 * Build timezone enum values with the default timezone as the first entry.
 * This keeps plugin config UIs that auto-select the first enum value aligned
 * with the intended computer-timezone default.
 *
 * @param {string} defaultTimeZone - Default timezone for this runtime.
 * @param {string[]} supportedTimeZones - Runtime-supported IANA timezones.
 * @returns {string[]} Timezone options with default first and no duplicates.
 */
function buildLogTimeZoneEnum(defaultTimeZone, supportedTimeZones) {
  const all = [defaultTimeZone, ...supportedTimeZones];
  return all.filter((timeZone, index) => all.indexOf(timeZone) === index);
}

/** Default log timezone normalized to a valid IANA value. */
const LOG_TIME_ZONE_DEFAULT = normalizeTimeZone(DEFAULT_LOG_TIME_ZONE, 'UTC');

/** Timezone options for plugin schema, with default timezone as first entry. */
const LOG_TIME_ZONE_ENUM = buildLogTimeZoneEnum(LOG_TIME_ZONE_DEFAULT, SUPPORTED_TIME_ZONES);

/**
 * @typedef {Object} CruiseReportInfo
 * @property {string} plugin Plugin identifier.
 * @property {string} version Plugin version.
 * @property {string} vessel Vessel name, if available.
 * @property {number} apiVersion Trip Report API version.
 */

/**
 * Parse the JWT payload from a cookie token.
 * @param {string|undefined} token JWT token string from cookies.
 * @returns {Object} Decoded payload object, or an empty object for missing token.
 */
function parseJwt(token) {
  if (!token) {
    return {};
  }
  return JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
}

/**
 * Send a Signal K delta update.
 * @param {Object} app Signal K app instance.
 * @param {Object} plugin Plugin metadata object.
 * @param {Date} time Timestamp for the delta.
 * @param {string} path Signal K path.
 * @param {*} value Value for the path.
 * @returns {void}
 */
function sendDelta(app, plugin, time, path, value) {
  app.handleMessage(plugin.id, {
    context: `vessels.${app.selfId}`,
    updates: [
      {
        source: {
          label: plugin.id,
        },
        timestamp: time.toISOString(),
        values: [
          {
            path,
            value,
          },
        ],
      },
    ],
  });
}

/**
 * Build Trip Report discovery metadata.
 * @param {Object} app Signal K app instance.
 * @param {Object} plugin Plugin metadata object.
 * @returns {CruiseReportInfo} Discovery payload.
 */
function buildCruiseReportInfo(app, plugin) {
  const vesselName = app.getSelfPath('name') || '';
  return {
    plugin: plugin.id,
    version: pkg.version,
    vessel: vesselName,
    apiVersion: 1,
  };
}

/**
 * Create a shared error handler for API routes.
 * @param {Object} app Signal K app instance.
 * @returns {Function} Error handler callback.
 */
function createErrorHandler(app) {
  /**
   * Handle an API error response.
   * @param {Error} error Error from storage or validation.
   * @param {Object} res Express response object.
   * @returns {void}
   */
  return (error, res) => {
    if (error.code === 'ENOENT') {
      res.sendStatus(404);
      return;
    }
    if (error.stack && error.message) {
      app.debug(error.stack);
      res.status(400);
      res.send({
        message: error.stack,
      });
      return;
    }
    app.debug(error.message);
    res.sendStatus(500);
  };
}

/**
 * Resolve the configured log timezone from plugin options.
 *
 * @param {Object|undefined} options - Plugin configuration options.
 * @param {Object} app - Signal K app instance.
 * @returns {string} Valid IANA timezone used for storage.
 */
function resolveLogTimeZone(options, app) {
  const configuredTimeZone = options && options.logTimeZone;
  if (configuredTimeZone && !isValidTimeZone(configuredTimeZone)) {
    app.error(`Invalid log timezone "${configuredTimeZone}". Falling back to ${DEFAULT_LOG_TIME_ZONE}.`);
  }
  return normalizeTimeZone(configuredTimeZone, DEFAULT_LOG_TIME_ZONE);
}

/**
 * Register read-only routes used by both plugin and Signal K API routers.
 * @param {Object} router Express router object.
 * @param {Object} app Signal K app instance.
 * @param {Object} plugin Plugin metadata object.
 * @param {Function} getLog Function returning the current Log instance.
 * @param {Function} handleError Shared error handler.
 * @param {Object} paths Route path mapping.
 * @param {string} paths.info Path for discovery info endpoint.
 * @param {string} paths.logs Path for listing available log dates.
 * @param {string} paths.logsByDate Path for listing entries by date.
 * @param {string} paths.logEntry Path for reading a single entry.
 * @returns {void}
 */
function registerReadOnlyRoutes(router, app, plugin, getLog, handleError, paths) {
  /**
   * Returns plugin and vessel metadata for macOS Trip Report app discovery.
   * @route GET /cruise-report/info
   * @returns {CruiseReportInfo}
   */
  router.get(paths.info, (req, res) => {
    res.contentType('application/json');
    res.send(JSON.stringify(buildCruiseReportInfo(app, plugin)));
  });

  /**
   * List dates that have log entries.
   * @route GET /logs
   * @returns {void}
   */
  router.get(paths.logs, (req, res) => {
    const log = getLog();
    if (!log) {
      res.sendStatus(503);
      return;
    }
    res.contentType('application/json');
    log.listDates()
      .then((dates) => {
        res.send(JSON.stringify(dates));
      }, (e) => handleError(e, res));
  });

  /**
   * Read all entries for a given day.
   * @route GET /logs/:date
   * @returns {void}
   */
  router.get(paths.logsByDate, (req, res) => {
    const log = getLog();
    if (!log) {
      res.sendStatus(503);
      return;
    }
    res.contentType('application/json');
    log.getDate(req.params.date)
      .then((date) => {
        res.send(JSON.stringify(date));
      }, (e) => handleError(e, res));
  });

  /**
   * Read a single entry.
   * @route GET /logs/:date/:entry
   * @returns {void}
   */
  router.get(paths.logEntry, (req, res) => {
    const log = getLog();
    if (!log) {
      res.sendStatus(503);
      return;
    }
    res.contentType('application/json');
    if (req.params.entry.substr(0, 10) !== req.params.date) {
      res.sendStatus(404);
      return;
    }
    log.getEntry(req.params.entry)
      .then((entry) => {
        res.send(JSON.stringify(entry));
      }, (e) => handleError(e, res));
  });
}

module.exports = (app) => {
  const plugin = {};
  let unsubscribes = [];
  let interval;

  plugin.id = 'signalk-cruisereport';
  plugin.name = 'Cruise Report';
  plugin.description = 'Semi-automatic electronic logbook for sailing vessels with Trip Report integration';

  const setStatus = app.setPluginStatus || app.setProviderStatus;

  // The paths we want to listen and collect data for
  const paths = [
    'navigation.state', // Under way/stopped
    'navigation.datetime', // Current time, for automated hourly entries
    'navigation.position',
    'navigation.gnss.type',
    'navigation.headingTrue',
    'navigation.courseOverGroundTrue',
    'navigation.speedThroughWater',
    'navigation.speedOverGround',
    'navigation.attitude', // attitude object in radians
    'navigation.log',
    'navigation.courseRhumbline.nextPoint.position',
    'environment.outside.pressure',
    'environment.depth.belowSurface',
    'environment.water.temperature',
    'environment.wind.directionTrue',
    'environment.wind.speedOverGround',
    'environment.water.swell.state',
    'propulsion.*.state',
    'propulsion.*.runTime',
    'steering.autopilot.state',
    'communication.vhf.channel',
  ];

  // We keep 15min of past state to allow slight backdating of entries
  const buffer = new CircularBuffer(16);

  let log;
  let state = {};
  let lastMaxCheck = 0;

  plugin.start = (options) => {
    const heartbeatMinutes = (options && options.heartbeatInterval)
      || DEFAULT_HEARTBEAT_MINUTES;
    const courseSettleSeconds = (options && options.courseSettleDelay)
      || DEFAULT_COURSE_SETTLE_SECONDS;
    const logTimeZone = resolveLogTimeZone(options, app);
    setCourseSettleDelay(courseSettleSeconds);
    let lastHeartbeat = 0;

    log = new Log(app.getDataDirPath(), logTimeZone);
    const subscription = {
      context: 'vessels.self',
      subscribe: paths.map((p) => ({
        path: p,
        period: 1000,
      })),
    };

    app.subscriptionmanager.subscribe(
      subscription,
      unsubscribes,
      (subscriptionError) => {
        app.error(`Error:${subscriptionError}`);
      },
      (delta) => {
        if (!delta.updates) {
          return;
        }
        delta.updates.reduce((prev, u) => prev.then(() => {
          if (!u.values) {
            return Promise.resolve();
          }
          return u.values.reduce((
            previousPromise,
            v,
          ) => previousPromise.then(() => processTriggers(v.path, v.value, state, log, app)
            .then((stateUpdates) => {
              if (!stateUpdates) {
                return;
              }
              // Trigger wants to write state
              Object.keys(stateUpdates).forEach((key) => {
                state[key] = stateUpdates[key];
              });
            }, (err) => {
              app.setPluginError(`Failed to store entry: ${err.message}`);
            })
            .then(() => {
              if (u.$source === 'signalk-cruisereport.XX') {
                // Don't store our reports into state
                return;
              }
              // Copy new value into state
              if (v.path === 'navigation.attitude' && typeof v.value === 'object' && v.value !== null) {
                const current = state[v.path] || {};
                const updates = v.value;
                const merged = { ...current };
                Object.keys(updates).forEach((key) => {
                  if (updates[key] !== null && typeof updates[key] !== 'undefined') {
                    merged[key] = updates[key];
                  }
                });
                state[v.path] = merged;
              } else {
                state[v.path] = v.value;
              }
            })), Promise.resolve());
        }), Promise.resolve());
      },
    );

    interval = setInterval(() => {
      // Save old state to buffer
      if (!state.datetime) {
        state.datetime = new Date().toISOString();
      }
      const now = Date.now();
      if (now - lastHeartbeat >= heartbeatMinutes * 60000) {
        // Store periodic heartbeat log entry
        processHourly(state, log, app)
          .catch((err) => {
            app.setPluginError(`Failed to store entry: ${err.message}`);
          });
        lastHeartbeat = now;
      }

      if (now - lastMaxCheck >= 120000) {
        processTwoMinute(state, log, app)
          .then((stateUpdates) => {
            Object.keys(stateUpdates).forEach((key) => {
              state[key] = stateUpdates[key];
            });
          }, (err) => {
            app.setPluginError(`Failed to store entry: ${err.message}`);
          });
        lastMaxCheck = now;
      }

      buffer.enq(state);
      // We can keep a clone of the previous values
      state = {
        ...state,
        datetime: null,
      };
    }, 60000);

    setStatus('Waiting for updates');
  };

  plugin.registerWithRouter = (router) => {
    const handleError = createErrorHandler(app);
    registerReadOnlyRoutes(router, app, plugin, () => log, handleError, {
      info: '/cruise-report/info',
      logs: '/logs',
      logsByDate: '/logs/:date',
      logEntry: '/logs/:date/:entry',
    });

    /**
     * Create a new manual log entry (authenticated plugin route).
     * @route POST /logs
     * @returns {void}
     */
    router.post('/logs', (req, res) => {
      if (!log) {
        res.sendStatus(503);
        return;
      }
      res.contentType('application/json');
      let stats;
      if (req.body.ago > buffer.size()) {
        // We don't have history that far, sadly
        res.sendStatus(404);
        return;
      }
      if (buffer.size() > 0) {
        stats = buffer.get(req.body.ago);
      } else {
        stats = {
          ...state,
        };
      }
      const token = req.cookies ? req.cookies.JAUTHENTICATION : undefined;
      const author = parseJwt(token).id;
      const data = stateToEntry(stats, req.body.text, author);
      if (req.body.category) {
        data.category = req.body.category;
      } else {
        data.category = 'navigation';
      }
      if (req.body.observations) {
        data.observations = {
          ...req.body.observations,
        };
        if (!Number.isNaN(Number(data.observations.seaState))) {
          sendDelta(
            app,
            plugin,
            new Date(data.datetime),
            'environment.water.swell.state',
            data.observations.seaState,
          );
        }
      }
      if (req.body.position) {
        data.position = {
          ...req.body.position,
        };
        // TODO: Send delta on manually entered position?
      }
      log.appendEntry(data)
        .then(() => {
          setStatus(`Manual log entry: ${req.body.text}`);
          res.sendStatus(201);
        }, (e) => handleError(e, res));
    });

    /**
     * Update an existing entry (authenticated plugin route).
     * @route PUT /logs/:date/:entry
     * @returns {void}
     */
    router.put('/logs/:date/:entry', (req, res) => {
      if (!log) {
        res.sendStatus(503);
        return;
      }
      res.contentType('application/json');
      if (req.params.entry.substr(0, 10) !== req.params.date) {
        res.sendStatus(404);
        return;
      }
      const entry = {
        ...req.body,
      };
      const token = req.cookies ? req.cookies.JAUTHENTICATION : undefined;
      const author = parseJwt(token).id;
      if (author && !entry.author) {
        entry.author = author;
      }
      log.writeEntry(entry)
        .then(() => {
          res.sendStatus(200);
        }, (e) => handleError(e, res));
    });

    /**
     * Delete an entry (authenticated plugin route).
     * @route DELETE /logs/:date/:entry
     * @returns {void}
     */
    router.delete('/logs/:date/:entry', (req, res) => {
      if (!log) {
        res.sendStatus(503);
        return;
      }
      if (req.params.entry.substr(0, 10) !== req.params.date) {
        res.sendStatus(404);
        return;
      }
      log.deleteEntry(req.params.entry)
        .then(() => {
          res.sendStatus(204);
        }, (e) => handleError(e, res));
    });
  };

  /**
   * Register read-only routes on the Signal K API router.
   * These endpoints can be accessed anonymously when the server allows read-only access.
   * @param {Object} router Express router object for Signal K API.
   * @returns {Object} Router instance.
   */
  plugin.signalKApiRoutes = (router) => {
    const handleError = createErrorHandler(app);
    registerReadOnlyRoutes(router, app, plugin, () => log, handleError, {
      info: '/cruise-report/info',
      logs: '/cruise-report/logs',
      logsByDate: '/cruise-report/logs/:date',
      logEntry: '/cruise-report/logs/:date/:entry',
    });
    return router;
  };

  plugin.stop = () => {
    unsubscribes.forEach((f) => f());
    unsubscribes = [];
    clearInterval(interval);
    cancelCourseChangeTimer();
  };

  plugin.schema = {
    type: 'object',
    properties: {
      heartbeatInterval: {
        type: 'number',
        default: DEFAULT_HEARTBEAT_MINUTES,
        title: 'Heartbeat interval (minutes)',
        description: 'How often an automatic log entry is written while under way.',
        minimum: 5,
        maximum: 120,
      },
      courseSettleDelay: {
        type: 'number',
        default: DEFAULT_COURSE_SETTLE_SECONDS,
        title: 'Course change settle delay (seconds)',
        description: 'Wait this long after detecting a course change before logging, to filter out wave-induced oscillations. Course samples during the window are averaged.',
        minimum: 0,
        maximum: 120,
      },
      logTimeZone: {
        type: 'string',
        default: LOG_TIME_ZONE_DEFAULT,
        title: 'Log timezone',
        description: 'IANA timezone used for file-per-day grouping and stored entry datetimes (for example: Pacific/Auckland or UTC). Defaults to this computer timezone.',
        ...(LOG_TIME_ZONE_ENUM.length > 0 ? { enum: LOG_TIME_ZONE_ENUM } : {}),
      },
    },
  };

  plugin.getOpenApi = () => openAPI;

  return plugin;
};
