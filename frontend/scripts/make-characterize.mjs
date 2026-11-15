// Writes public/data/characterize/sites.json: the famous test sites' report cards, computed from the real tile data.
// Only these nine cards are precomputed. Any other spot is scored live in the browser (src/data/characterizeSpot.js), with
// the same code (src/data/characterizeReport.js) on the same scores, so the two kinds of card follow one rule:
//   score, breakdown  similarity.js scoreAllEarthTiles (one run per target over all Earth tiles), absolute mode, balanced preset,
//                     typical-score fill included
//   best_preset       the preset with the highest total for that tile and target
//   cant_reproduce    reality_gap of the target's body in tiles/<body>_meta.json
//   site.factors      how extreme the spot is on Earth's land, 0-1: see siteFactors in characterizeReport.js
//   env_type, tags    the tile's value in earth_meta.json (none today: null and []); good_for has no source: []
// Sites are the known Earth analogs (role "site" in known_analogs.json). Each uses the Earth tile holding its coordinates,
// else the nearest scored tile within max(radius, 100 km); else the script stops.
// It also removes the old characterize/grid/ folder, which live scoring replaced.
// Usage: node scripts/make-characterize.mjs
import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { latLonToTile } from '../src/data/healpix.js';
import { MIN_FALLBACK_KM, nearestTileRow, siteFactors, targetMatches } from '../src/data/characterizeReport.js';
import { typicalFactorsOf } from '../src/data/similarity.js';
import { DATA_DIR, loadSiteData } from './site-data-common.mjs';

const started = Date.now();
const data = loadSiteData();

const sites = data.earthSites.map((site) => {
  // Same row rule as the live scorer (src/data/characterizeSpot.js scoreSpot).
  let row = data.rowByIndex.get(latLonToTile(data.schema.nside.earth, site.lat, site.lon));
  let nearestKm = null;
  if (row === undefined) {
    const radius = Math.max(site.radius_km, MIN_FALLBACK_KM);
    const nearest = nearestTileRow(site.lat, site.lon, data.lats, data.lons, radius);
    if (!nearest) throw new Error(`${site.name} has no scored Earth tile within ${radius} km.`);
    row = nearest.row;
    nearestKm = Math.round(nearest.km);
  }
  const tile = data.earthTiles[row];
  const typicalByTarget = new Map(data.targets.map((target) => [target.id, typicalFactorsOf(target.scores, row)]));
  return {
    site_id: site.id,
    site: {
      name: site.name, lat: site.lat, lon: site.lon, env_type: tile.envType, tags: tile.tags,
      factors: siteFactors(data.layout, data.earthVectors, row),
      ...(nearestKm === null ? {} : { nearest_km: nearestKm }),
    },
    targets: targetMatches(row, data.targets, data.presets)
      .map((match) => ({ ...match, typical_factors: typicalByTarget.get(match.target_id) })),
  };
});

const outDir = join(DATA_DIR, 'characterize');
rmSync(join(outDir, 'grid'), { recursive: true, force: true });
writeFileSync(join(outDir, 'sites.json'), JSON.stringify({ sample: data.isSample, sites }));
console.log(`characterize (sample: ${data.isSample}): ${sites.length} sites x ${data.targets.length} targets, ${Math.round((Date.now() - started) / 100) / 10} s`);
