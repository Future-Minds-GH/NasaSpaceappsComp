// Download buttons for the matches on screen. Every file records the weights used, so any ranking can be reproduced.
// Files carry only the five scored factors: the other four count for nothing, so they are left out.
import { SCORED_FACTORS, normaliseWeights } from "../data/scoring.js";
import { downloadText, toCsv } from "../data/format.js";

const BASE_COLUMNS = ["rank", "tile_id", "name", "lat", "lon", "score", "band", "mode", "earth_rank_pct", "km_to_nearest_known_analog", "false_friend"];

export default function MatchExports({ matches, fileStem, weights, clickedTileId }) {
  const usedWeights = normaliseWeights(weights ?? {}, SCORED_FACTORS);
  const exportedMatches = matches.map(withScoredFactorsOnly);

  function handleCsvClick() {
    const rows = exportedMatches.map((match) => ({
      ...match,
      score: match.score.toFixed(1),
      ...Object.fromEntries(SCORED_FACTORS.map((factor) => [factor, match.breakdown?.[factor] ?? ""])),
      ...Object.fromEntries(SCORED_FACTORS.map((factor) => [`weight_${factor}`, usedWeights[factor].toFixed(3)])),
      clicked_tile: clickedTileId,
    }));
    const columns = [...BASE_COLUMNS, ...SCORED_FACTORS, ...SCORED_FACTORS.map((factor) => `weight_${factor}`), "clicked_tile"];
    downloadText(`${fileStem}.csv`, toCsv(columns, rows), "text/csv");
  }

  function handleGeoJsonClick() {
    const features = exportedMatches.map(({ lat, lon, ...properties }) => ({ type: "Feature", geometry: { type: "Point", coordinates: [lon, lat] }, properties }));
    downloadText(`${fileStem}.geojson`, JSON.stringify({ type: "FeatureCollection", clicked_tile: clickedTileId, weights: usedWeights, features }, null, 1), "application/geo+json");
  }

  function handleJsonClick() {
    downloadText(`${fileStem}.json`, JSON.stringify({ clicked_tile: clickedTileId, weights: usedWeights, matches: exportedMatches }, null, 2), "application/json");
  }

  return (
    <div className="match-exports" role="group" aria-labelledby="match-exports-label">
      <p id="match-exports-label" className="control-label">Download these matches (with the weights used)</p>
      <div className="match-exports-buttons">
        <button className="button button-quiet" type="button" onClick={handleCsvClick}>CSV</button>
        <button className="button button-quiet" type="button" onClick={handleGeoJsonClick}>GeoJSON</button>
        <button className="button button-quiet" type="button" onClick={handleJsonClick}>JSON</button>
      </div>
    </div>
  );
}

/** A match whose per-factor fields (scores, real values, typical-score flags) keep only the scored factors. */
function withScoredFactorsOnly(match) {
  const keepScored = (perFactor) => perFactor && Object.fromEntries(SCORED_FACTORS.map((factor) => [factor, perFactor[factor] ?? null]));
  return {
    ...match,
    breakdown: keepScored(match.breakdown),
    values: keepScored(match.values),
    typical_factors: match.typical_factors?.filter((factor) => SCORED_FACTORS.includes(factor)),
  };
}
