// What to do with an Earth pin: only dry, open land is scored (about 101k tiles), so a pin on forest, farmland, a city or
// water has no vector. Within EARTH_SNAP_KM the search runs from the nearest scored tile instead; farther away there is
// no search, and the page offers to move the pin to the nearest scored tile. Pure, so the tests can run it.
import { EARTH_SNAP_KM, nearestTileRow } from "./characterizeReport.js";

/**
 * @param {number} ownRow  the pinned tile's row in earth.bin, or -1 when it is not scored
 * @param {Float32Array} lats  centre latitude of each scored tile (row order)
 * @param {Float32Array} lons  centre longitude of each scored tile
 * @returns {{ row: number, km: number } | { row: null, nearest: { row: number, km: number } | null }}
 *   a row to search from (km = 0 when the pinned tile itself, else the snap distance), or no row plus the nearest tile at any distance
 */
export function decideEarthSnap(ownRow, lat, lon, lats, lons) {
  if (ownRow >= 0) return { row: ownRow, km: 0 };
  const nearest = nearestTileRow(lat, lon, lats, lons, Infinity);
  return nearest && nearest.km <= EARTH_SNAP_KM ? { row: nearest.row, km: nearest.km } : { row: null, nearest };
}

/** Result note when the search ran from the nearest scored tile. */
export const snapNote = (km) => `Scored from the nearest dry, open land, ${Math.round(km)} km away. Forest, farmland, cities and water are not scored.`;

/** Message when the pin is too far from scored land. We cannot tell water from forest, so no cause is claimed. */
export const noScoreNote = (km) => `This spot is not dry, open land (it may be water, forest, farmland or a city), so it is not scored. The nearest scored land is ${Math.round(km)} km away.`;

export const nearestButtonLabel = (km) => `Use the nearest scored spot (${Math.round(km)} km)`;
