// Map tile services. Role 1's tiles.md is the source of truth: when it changes, edit only this file.
// Every map uses Leaflet's EPSG:4326 projection, which matches the Trek equirectangular tiles (2 × 1 tiles at zoom 0).

const TREK_TILES = "https://trek.nasa.gov/tiles";

export const BODY_TILE_LAYERS = {
  moon: {
    url: `${TREK_TILES}/Moon/EQ/LRO_WAC_Mosaic_Global_303ppd_v02/1.0.0/default/default028mm/{z}/{y}/{x}.jpg`,
    maxNativeZoom: 7,
    attribution: "LRO WAC mosaic, NASA Moon Trek",
  },
  mars: {
    url: `${TREK_TILES}/Mars/EQ/Mars_Viking_MDIM21_ClrMosaic_global_232m/1.0.0/default/default028mm/{z}/{y}/{x}.jpg`,
    maxNativeZoom: 7,
    attribution: "Viking MDIM 2.1 colour mosaic, NASA Mars Trek",
  },
};

export const EARTH_WMS_LAYER = {
  url: "https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi",
  layers: "BlueMarble_ShadedRelief_Bathymetry",
  attribution: "Blue Marble shaded relief, NASA GIBS",
};
