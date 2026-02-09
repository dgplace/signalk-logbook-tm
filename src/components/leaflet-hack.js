/**
 * Webpack compatibility hack for Leaflet default marker icons.
 * Imports marker PNGs through webpack's file-loader so the bundled
 * paths are used instead of Leaflet's broken relative URLs.
 * Pattern copied from @signalk/vesselpositions.
 */
import L from 'leaflet';

import 'leaflet/dist/leaflet.css';

import marker from 'leaflet/dist/images/marker-icon.png';
import marker2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';

delete L.Icon.Default.prototype._getIconUrl;

L.Icon.Default.mergeOptions({
  iconRetinaUrl: marker2x,
  iconUrl: marker,
  shadowUrl: markerShadow,
});
