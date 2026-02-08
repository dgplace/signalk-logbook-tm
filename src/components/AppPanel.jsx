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

/**
 * Top-level app shell providing a read-only overview of available logbook data.
 * Displays a summary table of days with entry counts and a map view.
 * @param {object} props - Component props from Signal K admin UI.
 */
function AppPanel(props) {
  const [days, setDays] = useState([]);
  const [entries, setEntries] = useState([]);
  const [activeTab, setActiveTab] = useState('overview');
  const [needsUpdate, setNeedsUpdate] = useState(true);

  const loginStatus = props.loginStatus.status;

  useEffect(() => {
    if (!needsUpdate) {
      return undefined;
    }
    if (loginStatus === 'notLoggedIn') {
      return undefined;
    }

    const interval = setInterval(() => {
      setNeedsUpdate(true);
    }, 5 * 60000);

    fetch('/plugins/signalk-logbook/logs')
      .then((res) => res.json())
      .then((dates) => {
        setDays(dates);
        Promise.all(dates.map((day) => fetch(`/plugins/signalk-logbook/logs/${day}`)
          .then((r) => r.json())))
          .then((dayEntries) => {
            const all = [].concat.apply([], dayEntries); // eslint-disable-line prefer-spread
            setEntries(all);
            setNeedsUpdate(false);
          });
      });
    return () => {
      clearInterval(interval);
    };
  }, [needsUpdate, loginStatus]);

  if (props.loginStatus.status === 'notLoggedIn' && props.loginStatus.authenticationRequired) {
    return <props.adminUI.Login />;
  }

  // Build per-day summaries from entries
  const daySummaries = days.map((date) => {
    const dayEntries = entries.filter(
      (e) => new Date(e.datetime).toISOString().substr(0, 10) === date,
    );
    return {
      date,
      count: dayEntries.length,
    };
  });
  daySummaries.reverse();

  return (
    <div>
      <Row className="mb-3 mt-2">
        <Col>
          <h5>Logbook &mdash; Data Overview</h5>
          <small className="text-muted">
            {days.length} day{days.length !== 1 ? 's' : ''} recorded,
            {' '}
            {entries.length} total entries
          </small>
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
                      </tr>
                    ))}
                    {!daySummaries.length && (
                      <tr>
                        <td colSpan="2" className="text-muted text-center">
                          No logbook data available
                        </td>
                      </tr>
                    )}
                  </tbody>
                </Table>
              )}
            </TabPane>
            <TabPane tabId="map">
              {activeTab === 'map' && <Map entries={entries} />}
            </TabPane>
          </TabContent>
        </Col>
      </Row>
    </div>
  );
}

export default AppPanel;
