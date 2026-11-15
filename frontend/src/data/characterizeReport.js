// Report-card numbers for one Earth tile against the Moon and Mars targets, from scores that scoreAllEarthTiles already
// computed (absolute mode, typical-score fill included). Pure: the page (characterizeSpot.js) and the build script
// (scripts/make-characterize.mjs) both use it, so the famous-site cards and the live cards follow one rule.
import { FACTORS, combineScore } from "./scoring.js";
import { NULL_CODE, decodeByte } from "./similarity.js";
import { BODY_RADIUS_KM } from "./ranking.js";

/** Smallest radius for the nearest-tile fallback, in km (the rule of scripts/make-characterize.mjs: max(site radius, 100 km)). */
export const MIN_FALLBACK_KM = 100;

const SCORE_PRESET = "balanced";
// Fields holding the tile's percentile among Earth's scored tiles, per factor. surface and minerals have none.
const PERCENTILE_FIELDS = {
  temp: ["t_day_pct", "t_night_pct"], swing: ["t_swing_pct"], sun: ["sun_pct"], slope: ["slope_pct"],
  rough: ["rough_pct"], elev: ["elev_pct"], ice: ["ice_pct"],
};

const roundTo = (value, decimals) => Math.round(value * 10 ** decimals) / 10 ** decimals;

/** Great-circle distance between two Earth points, in km. */
export function earthKmBetween(latA, lonA, latB, lonB) {
  const radians = (degrees) => (degrees * Math.PI) / 180;
  const h = Math.sin(radians(latB - latA) / 2) ** 2 + Math.cos(radians(latA)) * Math.cos(radians(latB)) * Math.sin(radians(lonB - lonA) / 2) ** 2;
  return 2 * BODY_RADIUS_KM.earth * Math.asin(Math.sqrt(h));
}

/** The row of the scored tile nearest to a point within `maxKm`, as { row, km }, or null when none is that close. */
export function nearestTileRow(lat, lon, lats, lons, maxKm) {
  let best = null;
  for (let row = 0; row < lats.length; row++) {
    const km = earthKmBetween(lat, lon, lats[row], lons[row]);
    if (km <= maxKm && (best === null || km < best.km)) best = { row, km };
  }
  return best;
}

/** "Near 24.1°S, 69.9°W": the name of a place that has no real name. */
export function coordinateLabel(lat, lon) {
  return `Near ${Math.abs(lat).toFixed(1)}°${lat >= 0 ? "N" : "S"}, ${Math.abs(lon).toFixed(1)}°${lon >= 0 ? "E" : "W"}`;
}

/**
 * How extreme the tile is on Earth's land, per factor, 0-1 (the card's wording: 0 ordinary, 1 as extreme as it gets):
 * 2 x |p - 0.5|, p = the tile's percentile (mean of day and night for temp). null where the tile has no percentile.
 */
export function siteFactors(layout, earthVectors, row) {
  return Object.fromEntries(FACTORS.map((factor) => {
    const percentiles = (PERCENTILE_FIELDS[factor] ?? [])
      .map((id) => decodeByte(layout.fields[id], earthVectors[row * layout.bytesPerTile + layout.fields[id].offset]))
      .filter((value) => value !== null);
    if (percentiles.length === 0) return [factor, null];
    const percentile = percentiles.reduce((sum, value) => sum + value, 0) / percentiles.length;
    return [factor, roundTo(2 * Math.abs(percentile - 0.5), 2)];
  }));
}

/**
 * One card line per target the tile can be compared with, best score first.
 * @param {number} row  the tile's row in earth.bin
 * @param {{ id: string, body: string, scores: Float32Array, cantReproduce: string[] }[]} targets  scores: all Earth tiles x 9 factors
 * @param {Record<string, { weights: Record<string, number> }>} presets  weights.json presets; the score uses "balanced"
 */
export function targetMatches(row, targets, presets) {
  return targets
    .map((target) => {
      const raw = Object.fromEntries(FACTORS.map((factor, index) => {
        const value = target.scores[row * FACTORS.length + index];
        return [factor, Number.isNaN(value) ? null : value];
      }));
      // No factor on both tiles: nothing to compare (the search skips such a tile too).
      if (FACTORS.every((factor) => raw[factor] === null)) return null;
      const totals = Object.entries(presets).map(([id, preset]) => [id, combineScore(raw, preset.weights)]);
      const bestPreset = totals.reduce((best, entry) => (entry[1] > best[1] ? entry : best))[0];
      return {
        target_id: target.id,
        body: target.body,
        score: roundTo(combineScore(raw, presets[SCORE_PRESET].weights), 1),
        breakdown: Object.fromEntries(FACTORS.map((factor) => [factor, raw[factor] === null ? null : roundTo(raw[factor], 2)])),
        best_preset: bestPreset,
        good_for: [],
        cant_reproduce: target.cantReproduce,
      };
    })
    .filter(Boolean)
    .sort((first, second) => second.score - first.score);
}
