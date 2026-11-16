// Characterize's live scoring: a clicked spot on land becomes a report card by scoring its Earth tile against every Moon and
// Mars target with the app's own scoring (absolute mode, typical-score fill). The vectors come through the same loaders
// Explore uses. Each target is scored against all Earth tiles once, then kept, so only the first click waits.
import { loadBodyVectors, loadEarthTiles, loadTargets, loadVectorSchema, loadWeights } from "./api.js";
import { MIN_FALLBACK_KM, coordinateLabel, nearestTileRow, siteFactors, targetMatches } from "./characterizeReport.js";
import { baseCellOf, latLonToTile } from "./healpix.js";
import { readLayout, scoreAllEarthTiles, typicalFactorsOf } from "./similarity.js";
import { clickedTileVector, readEarthTiles, tileCentres } from "./tileSearch.js";

let basePromise = null;

/**
 * The report card entry for a spot ({ site, targets }), or null when no scored land tile is near it. Like
 * scripts/make-characterize.mjs: the tile holding the spot, else the nearest scored tile within max(radiusKm, 100 km);
 * then `site.nearest_km` says how far that tile is. Each target carries `typical_factors` (factors filled with a typical score).
 * Throws when a file fails to load, so the page can offer "Try again".
 */
export async function scoreSpot(lat, lon, radiusKm = 0) {
  const base = await loadBase();
  let row = base.rowByIndex.get(latLonToTile(base.nside, lat, lon));
  let nearestKm = null;
  if (row === undefined) {
    const nearest = nearestTileRow(lat, lon, base.lats, base.lons, Math.max(radiusKm, MIN_FALLBACK_KM));
    if (!nearest) return null;
    row = nearest.row;
    nearestKm = Math.round(nearest.km);
  }
  const targets = targetMatches(row, base.targets, base.presets);
  if (targets.length === 0) return null;
  const typicalByTarget = new Map(base.targets.map((target) => [target.id, typicalFactorsOf(target.scores, row)]));
  const tile = base.earthTiles[row];
  return {
    site: {
      name: tile.name ?? coordinateLabel(lat, lon), lat, lon,
      env_type: tile.envType, tags: tile.tags, factors: siteFactors(base.layout, base.earthVectors, row),
      ...(nearestKm === null ? {} : { nearest_km: nearestKm }),
    },
    targets: targets.map((match) => ({ ...match, typical_factors: typicalByTarget.get(match.target_id) })),
  };
}

function loadBase() {
  if (!basePromise) {
    basePromise = buildBase();
    basePromise.catch(() => { basePromise = null; });
  }
  return basePromise;
}

async function buildBase() {
  const [schema, earthFiles, targetSites, weightsFile] = await Promise.all([loadVectorSchema(), loadEarthTiles(), loadTargets(), loadWeights()]);
  const layout = readLayout(schema);
  const earthTiles = readEarthTiles(earthFiles, schema.nside.earth);
  const targets = [];
  for (const site of targetSites.filter((target) => target.body !== "earth")) {
    const nside = schema.nside[site.body];
    const index = latLonToTile(nside, site.lat, site.lon);
    const bytes = await loadBodyVectors(site.body, site.body === "mars" ? baseCellOf(nside, index) : null);
    const vector = clickedTileVector(site.body, nside, index, bytes, layout.bytesPerTile);
    if (!vector) throw new Error(`${site.name} has no data in its tile.`);
    targets.push({
      id: site.target_id, body: site.body, scores: scoreAllEarthTiles(vector, earthFiles.vectors, layout, "absolute"),
      cantReproduce: site.reality_gap ?? [],
    });
    // Let the page repaint between targets: each one scores about 100,000 tiles.
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  return {
    ...tileCentres(earthTiles, Float64Array), layout, earthTiles, earthVectors: earthFiles.vectors, targets, presets: weightsFile.presets,
    nside: schema.nside.earth, rowByIndex: new Map(earthTiles.map((tile, row) => [tile.index, row])),
  };
}
