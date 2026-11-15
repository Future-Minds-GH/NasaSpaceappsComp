// Maps a click on the Earth map to the pipeline's 0.5° grid cell and the 10° tile file that holds it.

const CELL_DEG = 0.5;
const TILE_DEG = 10;

/** Centre and bounds of the 0.5° cell containing a point. */
export function snapToCell(lat, lon) {
  const clampedLat = Math.min(Math.max(lat, -90), 89.999);
  const wrappedLon = ((((lon + 180) % 360) + 360) % 360) - 180;
  const south = Math.floor(clampedLat / CELL_DEG) * CELL_DEG;
  const west = Math.floor(wrappedLon / CELL_DEG) * CELL_DEG;
  return {
    lat: south + CELL_DEG / 2,
    lon: west + CELL_DEG / 2,
    bounds: [[south, west], [south + CELL_DEG, west + CELL_DEG]],
  };
}

/** File name (without .json) of the 10° tile holding a cell: its south-west corner, e.g. "30_-120". */
export function tileNameForCell(cell) {
  const south = Math.floor(cell.lat / TILE_DEG) * TILE_DEG;
  const west = Math.floor(cell.lon / TILE_DEG) * TILE_DEG;
  return `${south}_${west}`;
}

/** Key of a cell inside its tile file: the centre with two decimals, e.g. "36.25_-116.75". */
export function cellKey(cell) {
  return `${cell.lat.toFixed(2)}_${cell.lon.toFixed(2)}`;
}
