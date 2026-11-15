// Picks the top tiles from the search totals: best first, at least a set distance apart on that body, each with its
// rank (the share of the body's tiles it beats). Pure, so both the Web Worker and the tests can run it.
// It sorts only the best few hundred tiles, not all of them, so a slider move stays within the plan's 20 ms.

export const BODY_RADIUS_KM = { earth: 6371, moon: 1737.4, mars: 3389.5 };
const FIRST_CANDIDATE_POOL = 512;
/** A same-planet search skips tiles this close to the picked spot, so it finds a place, not the spot's neighbours. */
export const SAME_BODY_MIN_KM = 500;

/**
 * @param {Float32Array} totals  one 0-100 total per candidate tile
 * @param {Float32Array} lats    tile centre latitudes, same order
 * @param {Float32Array} lons    tile centre longitudes, same order
 * @param {{ lat: number, lon: number, km: number } | null} [options.exclude]  skip tiles closer than km to this point
 * @returns {{ row: number, total: number, earthRankPct: number }[]}
 */
export function rankTopRows(totals, lats, lons, { count = 10, minSeparationKm = 250, radiusKm = BODY_RADIUS_KM.earth, exclude = null } = {}) {
  // A negative total marks a tile with no factor to compare: it is not a candidate.
  let candidateCount = 0;
  for (let row = 0; row < totals.length; row++) if (totals[row] >= 0) candidateCount++;
  // Widen the pool until it holds enough well-separated tiles (or every tile).
  for (let poolSize = FIRST_CANDIDATE_POOL; ; poolSize *= 4) {
    const pool = bestRows(totals, Math.min(poolSize, totals.length));
    const chosen = [];
    for (const row of pool) {
      if (chosen.length === count) break;
      if (exclude && distanceKm(exclude.lat, exclude.lon, lats[row], lons[row], radiusKm) < exclude.km) continue;
      if (chosen.some((pick) => distanceKm(lats[pick.row], lons[pick.row], lats[row], lons[row], radiusKm) < minSeparationKm)) continue;
      // Every tile above this one is in the pool, so the first pool position with its total is how many tiles beat it.
      const beatenBy = pool.findIndex((other) => totals[other] === totals[row]);
      chosen.push({ row, total: totals[row], earthRankPct: Math.round(((candidateCount - 1 - beatenBy) / Math.max(1, candidateCount - 1)) * 1000) / 10 });
    }
    if (chosen.length === count || poolSize >= totals.length) return chosen;
  }
}

/** Indices of the `size` highest totals, best first, without sorting the whole array. */
function bestRows(totals, size) {
  if (size >= totals.length) return Array.from(totals.keys()).filter((row) => totals[row] >= 0).sort((first, second) => totals[second] - totals[first]);
  const threshold = kthLargest(totals, size);
  const rows = [];
  for (let row = 0; row < totals.length; row++) if (totals[row] >= 0 && totals[row] >= threshold) rows.push(row);
  return rows.sort((first, second) => totals[second] - totals[first]);
}

// Quickselect on a copy: the value of the k-th largest total.
function kthLargest(totals, k) {
  const values = Float32Array.from(totals);
  let low = 0;
  let high = values.length - 1;
  const target = values.length - k;
  while (low < high) {
    const pivot = values[(low + high) >> 1];
    let left = low;
    let right = high;
    while (left <= right) {
      while (values[left] < pivot) left++;
      while (values[right] > pivot) right--;
      if (left <= right) { const swap = values[left]; values[left] = values[right]; values[right] = swap; left++; right--; }
    }
    if (target <= right) high = right; else if (target >= left) low = left; else break;
  }
  return values[target];
}

function distanceKm(latA, lonA, latB, lonB, radiusKm) {
  const toRadians = (degrees) => (degrees * Math.PI) / 180;
  const h = Math.sin(toRadians(latB - latA) / 2) ** 2 + Math.cos(toRadians(latA)) * Math.cos(toRadians(latB)) * Math.sin(toRadians(lonB - lonA) / 2) ** 2;
  return 2 * radiusKm * Math.asin(Math.sqrt(h));
}
