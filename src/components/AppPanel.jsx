import React, { useState, useEffect } from 'react';
import {
  Row,
  Col,
  Nav,
  NavItem,
  NavLink,
  TabContent,
  TabPane,
  Table,
  Badge,
} from 'reactstrap';
import Map from './Map.jsx';

/** Candidate public API base paths for read-only log access. */
const PUBLIC_LOG_ENDPOINT_CANDIDATES = [
  '/signalk/v1/api/cruise-report/logs',
  '/signalk/v1/api/plugins/signalk-cruisereport/cruise-report/logs',
  '/signalk/v1/api/plugins/signalk-cruisereport/logs',
  '/plugins/signalk-cruisereport/logs',
];

/**
 * Fetch JSON from an endpoint and throw when the response is not successful.
 * @param {string} url - HTTP endpoint URL.
 * @returns {Promise<*>} Parsed JSON response body.
 */
async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`.trim());
  }
  return response.json();
}

/**
 * Resolve the first reachable public API base path for log listing.
 * @returns {Promise<{basePath: string, dates: string[]}>} Matching base path and date list.
 */
async function resolvePublicLogsEndpoint() {
  const errors = [];

  return PUBLIC_LOG_ENDPOINT_CANDIDATES.reduce(
    (previousAttempt, basePath) => previousAttempt.catch(() => fetchJson(basePath)
      .then((dates) => {
        if (!Array.isArray(dates)) {
          throw new Error('Response is not a date array');
        }
        return { basePath, dates };
      })
      .catch((error) => {
        errors.push(`${basePath} (${error.message})`);
        throw error;
      })),
    Promise.reject(new Error('No public endpoint resolved yet')),
  ).catch(() => Promise.reject(new Error(errors.join('; '))));
}

/**
 * Load all entries for the provided day list from a public API base path.
 * @param {string} basePath - Public API logs base path.
 * @param {string[]} dates - Day identifiers in YYYY-MM-DD format.
 * @returns {Promise<Object[]>} Flat list of log entries.
 */
async function loadEntriesForDays(basePath, dates) {
  const dayEntries = await Promise.all(
    dates.map((day) => fetchJson(`${basePath}/${encodeURIComponent(day)}`)),
  );
  return dayEntries.reduce((allEntries, dailyEntries) => allEntries.concat(dailyEntries), []);
}

/**
 * Top-level app shell providing a read-only overview of available logbook data.
 * Displays a summary table of days with entry counts and a map view.
 */
function AppPanel() {
  const [days, setDays] = useState([]);
  const [entries, setEntries] = useState([]);
  const [activeTab, setActiveTab] = useState('overview');
  const [needsUpdate, setNeedsUpdate] = useState(true);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    const interval = setInterval(() => {
      setNeedsUpdate(true);
    }, 5 * 60000);
    return () => {
      clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    if (!needsUpdate) {
      return undefined;
    }

    let isCancelled = false;

    const loadOverview = async () => {
      try {
        const { basePath, dates } = await resolvePublicLogsEndpoint();
        if (isCancelled) {
          return;
        }
        setDays([...dates].sort());

        const allEntries = await loadEntriesForDays(basePath, dates);
        if (isCancelled) {
          return;
        }
        setEntries(allEntries);
        setLoadError('');
      } catch (error) {
        if (isCancelled) {
          return;
        }
        setDays([]);
        setEntries([]);
        setLoadError(
          'Unable to load log overview from public API. '
          + `Tried: ${PUBLIC_LOG_ENDPOINT_CANDIDATES.join(', ')}. `
          + 'Ensure Signal K allows read-only API access.',
        );
      } finally {
        if (!isCancelled) {
          setNeedsUpdate(false);
        }
      }
    };

    loadOverview();
    return () => {
      isCancelled = true;
    };
  }, [needsUpdate]);

  // Build per-day summaries from entries
  const daySummaries = days.map((date) => {
    const dayEntries = entries.filter(
      (e) => e.datetime.substr(0, 10) === date,
    );
    const logsWithValue = dayEntries
      .filter((e) => e.log != null && !Number.isNaN(Number(e.log)));
    let distance = null;
    if (logsWithValue.length >= 2) {
      const first = logsWithValue[0].log;
      const last = logsWithValue[logsWithValue.length - 1].log;
      distance = parseFloat(Math.abs(last - first).toFixed(1));
    }
    return {
      date,
      count: dayEntries.length,
      distance,
    };
  });
  daySummaries.reverse();

  return (
    <div>
      <Row className="mb-3 mt-2">
        <Col>
          <h5>Cruise Report &mdash; Data Overview</h5>
          <small className="text-muted">
            {days.length} day{days.length !== 1 ? 's' : ''} recorded,
            {' '}
            {entries.length} total entries
          </small>
          {loadError && (
            <>
              <br />
              <small className="text-danger">{loadError}</small>
            </>
          )}
        </Col>
      </Row>
      <Row>
        <Col className="bg-light border">
          <Nav tabs>
            <NavItem>
              <NavLink
                className={activeTab === 'overview' ? 'active' : ''}
                onClick={() => setActiveTab('overview')}
              >
                Overview
              </NavLink>
            </NavItem>
            <NavItem>
              <NavLink
                className={activeTab === 'map' ? 'active' : ''}
                onClick={() => setActiveTab('map')}
              >
                Map
              </NavLink>
            </NavItem>
          </Nav>
          <TabContent activeTab={activeTab}>
            <TabPane tabId="overview">
              {activeTab === 'overview' && (
                <Table striped hover responsive className="mt-2">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Entries</th>
                      <th>Distance (NM)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {daySummaries.map((day) => (
                      <tr key={day.date}>
                        <td>{day.date}</td>
                        <td>
                          <Badge color="primary" pill>
                            {day.count}
                          </Badge>
                        </td>
                        <td>
                          {day.distance != null ? day.distance : '\u2014'}
                        </td>
                      </tr>
                    ))}
                    {!daySummaries.length && (
                      <tr>
                        <td colSpan="3" className="text-muted text-center">
                          No logbook data available
                        </td>
                      </tr>
                    )}
                  </tbody>
                </Table>
              )}
            </TabPane>
            <TabPane tabId="map">
              {activeTab === 'map' && (
                <Map
                  entries={entries.filter(
                    (e) => days.length > 0 && e.datetime.substr(0, 10) === days[days.length - 1],
                  )}
                />
              )}
            </TabPane>
          </TabContent>
        </Col>
      </Row>
    </div>
  );
}

export default AppPanel;
