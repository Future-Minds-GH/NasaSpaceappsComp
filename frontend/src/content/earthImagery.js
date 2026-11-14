// True-colour picture of an Earth tile from NASA GIBS (the Worldview imagery service): one cloud-light MODIS day,
// picked by hemisphere so the ground is in summer light. Role 1's tiles.md may swap the layer; change it only here.

const GIBS_WMS = "https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi";
const LAYER = "MODIS_Terra_CorrectedReflectance_TrueColor";
// A tile is about 25 km across; show a little more so its surroundings give context.
const VIEW_KM = 40;
const KM_PER_DEGREE = 111.32;

export function earthImageUrl(lat, lon) {
  const halfLat = VIEW_KM / 2 / KM_PER_DEGREE;
  const halfLon = halfLat / Math.max(0.1, Math.cos((lat * Math.PI) / 180));
  const bbox = [lat - halfLat, lon - halfLon, lat + halfLat, lon + halfLon].map((value) => value.toFixed(4)).join(",");
  const day = lat >= 0 ? "2023-07-15" : "2024-01-15";
  return `${GIBS_WMS}?SERVICE=WMS&REQUEST=GetMap&VERSION=1.3.0&CRS=EPSG:4326&FORMAT=image/jpeg&LAYERS=${LAYER}&TIME=${day}&BBOX=${bbox}&WIDTH=256&HEIGHT=256`;
}
