// Stand-in for h3-js, which three-globe imports only for its hex-bin and hex-polygon layers. PlanetGlobe uses neither,
// so this keeps ~217 kB out of the globe chunk.
// shortcut: hexBinPointsData / hexPolygonsData throw with this stub; alias back to h3-js in vite.config.js before using them.
const unavailable = () => {
  throw new Error("h3-js is stubbed out (vite.config.js): the globe's hex layers are not available.");
};
export const latLngToCell = unavailable;
export const cellToLatLng = unavailable;
export const cellToBoundary = unavailable;
export const polygonToCells = unavailable;
