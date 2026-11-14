// Download buttons for the matches on screen. Every file records the weights used, so any ranking can be reproduced.
import { FACTORS, normaliseWeights } from "../data/scoring.js";
import { downloadText, toCsv } from "../data/format.js";

const BASE_COLUMNS = ["rank", "tile_id", "name", "lat", "lon", "score", "earth_rank_pct", "km_to_nearest_known_analog", "false_friend"];

export default function MatchExports({ matches, fileStem, weights, clickedTileId }) {
  const usedWeights = normaliseWeights(weights ?? {});

  function handleCsvClick() {
    const rows = matches.map((match) => ({
      ...match,
      score: match.score.toFixed(1),
      ...Object.fromEntries(FACTORS.map((factor) => [factor, match.breakdown?.[factor] ?? ""])),
      ...Object.fromEntries(FACTORS.map((factor) => [`weight_${factor}`, usedWeights[factor].toFixed(3)])),
      clicked_tile: clickedTileId,
    }));
    const columns = [...BASE_COLUMNS, ...FACTORS, ...FACTORS.map((factor) => `weight_${factor}`), "clicked_tile"];
    downloadText(`${fileStem}.csv`, toCsv(columns, rows), "text/csv");
  }

  function handleGeoJsonClick() {
    const features = matches.map(({ lat, lon, ...properties }) => ({ type: "Feature", geometry: { type: "Point", coordinates: [lon, lat] }, properties }));
    downloadText(`${fileStem}.geojson`, JSON.stringify({ type: "FeatureCollection", clicked_tile: clickedTileId, weights: usedWeights, features }, null, 1), "application/geo+json");
  }

  function handleJsonClick() {
    downloadText(`${fileStem}.json`, JSON.stringify({ clicked_tile: clickedTileId, weights: usedWeights, matches }, null, 2), "application/json");
  }

  return (
    <div className="exports">
      <p className="control-label">Download these matches (with the weights used)</p>
      <div className="exports-buttons">
        <button className="button button-quiet" type="button" onClick={handleCsvClick}>CSV</button>
        <button className="button button-quiet" type="button" onClick={handleGeoJsonClick}>GeoJSON</button>
        <button className="button button-quiet" type="button" onClick={handleJsonClick}>JSON</button>
      </div>
    </div>
  );
}
