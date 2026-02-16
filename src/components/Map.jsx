import React, { useState, useEffect, useRef } from 'react';
import {
  Map as LeafletMap,
  TileLayer,
  Polyline,
  CircleMarker,
  LayersControl,
} from 'react-leaflet';
import L from 'leaflet';
import './leaflet-hack';

/**
 * Calculate Leaflet LatLngBounds from an array of {lat, lon} points.
 * @param {Array<{lat: number, lon: number}>} points - Position array.
 * @returns {L.LatLngBounds|null} Bounds enclosing all points, or null if empty.
 */
function calculateBounds(points) {
  if (!points.length) {
    return null;
  }
  return L.latLngBounds(points.map((p) => [p.lat, p.lon]));
}

/** Distance threshold in metres (~0.04 NM) for filtering nearby history points. */
const DISTANCE_THRESHOLD_M = 74;

/**
 * Read-only map view showing vessel track and log entry positions.
 * Uses Leaflet with OpenStreetMap tiles and an optional OpenSeaMap overlay.
 * @param {object} props - Component props.
 * @param {Array} props.entries - Array of log entry objects.
 */
function Map(props) {
  // Filter entries that have a position
  const entries = props.entries.filter((e) => e.position).map((entry) => ({
    ...entry,
    date: new Date(entry.datetime),
  }));

  const [points, setPoints] = useState(
    entries.map((e) => ({
      lat: e.position.latitude,
      lon: e.position.longitude,
    })),
  );

  // Update points when entries change
  useEffect(() => {
    setPoints(entries.map((e) => ({
      lat: e.position.latitude,
      lon: e.position.longitude,
    })));
  }, [props.entries]);

  const mapRef = useRef(null);

  // Fit map bounds whenever points change
  useEffect(() => {
    const bounds = calculateBounds(points);
    if (mapRef.current && bounds && bounds.isValid()) {
      mapRef.current.leafletElement.fitBounds(bounds, { padding: [20, 20] });
    }
  }, [points]);

  // Fetch historical positions from Signal K History API
  useEffect(() => {
    if (entries.length < 2) {
      return;
    }
    const days = entries.reduce((arr, e) => {
      const date = e.datetime.substr(0, 10);
      if (arr.indexOf(date) === -1) {
        arr.push(date);
      }
      return arr;
    }, []);
    const from = entries[0].datetime;
    const to = entries[entries.length - 1].datetime;
    const resolution = 300; // Position every 5min
    fetch(`/signalk/v1/history/values?from=${from}&to=${to}&paths=navigation.position&resolution=${resolution}`)
      .then((res) => res.json())
      .then((positions) => {
        if (!positions.data || !positions.data.length) {
          return;
        }
        let prev;
        const pts = [];
        positions.data.forEach((d) => {
          if (!d.length) {
            return;
          }
          if (days.indexOf(d[0].substr(0, 10)) === -1) {
            return;
          }
          if (!d[1]) {
            return;
          }
          const point = L.latLng(d[1][1], d[1][0]);
          if (prev) {
            if (prev.distanceTo(point) < DISTANCE_THRESHOLD_M) {
              return;
            }
          }
          prev = point;
          pts.push({
            lat: point.lat,
            lon: point.lng,
          });
        });
        setPoints(pts);
      })
      .catch(() => {});
  }, [props.entries]);

  // Compute initial bounds
  const bounds = calculateBounds(points);
  const defaultCenter = [0, 0];
  const defaultZoom = 2;

  return (
    <div style={{ width: '80vw', height: '80vh' }}>
      <LeafletMap
        ref={mapRef}
        center={bounds && bounds.isValid() ? bounds.getCenter() : defaultCenter}
        zoom={bounds && bounds.isValid() ? undefined : defaultZoom}
        bounds={bounds && bounds.isValid() ? bounds : undefined}
        boundsOptions={{ padding: [20, 20] }}
        style={{ width: '100%', height: '100%' }}
      >
        <LayersControl position="topright">
          <LayersControl.BaseLayer checked name="OpenStreetMap">
            <TileLayer
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              attribution="&copy; <a href=&quot;http://osm.org/copyright&quot;>OpenStreetMap</a> contributors"
            />
          </LayersControl.BaseLayer>
          <LayersControl.Overlay name="Sea Marks">
            <TileLayer
              url="https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png"
              attribution="&copy; <a href=&quot;http://www.openseamap.org&quot;>OpenSeaMap</a> contributors"
            />
          </LayersControl.Overlay>
        </LayersControl>

        {/* Vessel track as a single polyline */}
        {points.length > 1 && (
          <Polyline
            positions={points.map((p) => [p.lat, p.lon])}
            color="red"
            weight={1}
          />
        )}

        {/* Colour-coded markers at log entry positions */}
        {entries.map((entry) => {
          let color = '#009bdb';
          if (entry.category === 'engine') {
            color = '#ed1b2f';
          }
          if (entry.category === 'radio') {
            color = '#00ae9d';
          }
          return (
            <CircleMarker
              key={entry.datetime}
              center={[entry.position.latitude, entry.position.longitude]}
              radius={6}
              color={color}
              fillColor={color}
              fillOpacity={0.8}
            />
          );
        })}
      </LeafletMap>
    </div>
  );
}

export default Map;
