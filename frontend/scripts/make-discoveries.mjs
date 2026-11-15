// Writes public/data/discoveries.json, .csv and .geojson from the real tile data and the app's own scoring.
//   score, breakdown  similarity.js scoreAllEarthTiles + combineAll, absolute mode, balanced preset, typical-score fill included
//   candidates        per target, the top tiles that are NEW (more than 300 km from every known Earth analog), picked with
//                     ranking.js rankTopRows (250 km apart); a spot picked by two targets keeps its higher score; then
//                     spots closer than 250 km to a higher-ranked one are dropped
//   why, name, km     tileSearch.js buildMatches (plainReasons, tile name, meta km field)
//   cant_reproduce    reality_gap of the target's body in tiles/<body>_meta.json
//   name              the tile's name, else "Near 24.1°S, 69.9°W"; env_type and tags have no real source: null and []
// Run after build_vectors.py and make_weights.py. Usage: node scripts/make-discoveries.mjs
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { FACTORS } from '../src/data/scoring.js';
import { rankTopRows } from '../src/data/ranking.js';
import { typicalFactorsOf } from '../src/data/similarity.js';
import { buildMatches } from '../src/data/tileSearch.js';
import { coordinateLabel } from '../src/data/characterizeReport.js';
import { DATA_DIR, kmBetween, loadSiteData, round } from './site-data-common.mjs';

const PER_TARGET = 10;
const MIN_SEPARATION_KM = 250;   // ranking.js default
const started = Date.now();
const data = loadSiteData();
const weights = data.presets.balanced.weights;

// 1. Top NEW tiles per target; keep the higher score where two targets pick the same tile.
const bestByRow = new Map();
for (const target of data.targets) {
  const totals = Float32Array.from(data.isNew, (isNew, row) => (isNew ? target.totals.balanced[row] : -1));
  for (const pick of rankTopRows(totals, data.lats, data.lons, { count: PER_TARGET })) {
    if (!bestByRow.has(pick.row) || bestByRow.get(pick.row).total < pick.total) bestByRow.set(pick.row, { ...pick, target });
  }
}

// 2. Best first; drop a spot within 250 km of a better one (two targets can pick neighbouring tiles).
const chosen = [];
for (const pick of [...bestByRow.values()].sort((first, second) => second.total - first.total)) {
  if (chosen.every((other) => kmBetween(data.lats[other.row], data.lons[other.row], data.lats[pick.row], data.lons[pick.row]) >= MIN_SEPARATION_KM)) chosen.push(pick);
}

// 3. Cards from the app's own builder.
const cards = buildMatches(
  chosen.map((pick) => ({
    row: pick.row,
    total: pick.total,
    earthRankPct: null,
    factorScores: FACTORS.map((_, factor) => pick.target.scores[pick.row * FACTORS.length + factor]),
    typicalFactors: typicalFactorsOf(pick.target.scores, pick.row),
  })),
  { tiles: data.earthTiles, body: 'earth', nside: data.schema.nside.earth, weights, mode: 'absolute' },
);
const discoveries = cards.map((card, index) => ({
  name: card.name ?? coordinateLabel(card.lat, card.lon),
  lat: round(card.lat, 3),
  lon: round(card.lon, 3),
  env_type: card.env_type ?? null,
  tags: card.tags ?? [],
  body: chosen[index].target.body,
  best_target_id: chosen[index].target.id,
  score: round(card.score, 1),
  breakdown: card.breakdown,
  km_to_nearest_known_analog: card.km_to_nearest_known_analog,
  why: card.why,
  cant_reproduce: chosen[index].target.cantReproduce,
  rank: index + 1,
}));

writeFileSync(join(DATA_DIR, 'discoveries.json'), JSON.stringify({ sample: data.isSample, weights_used: 'balanced', discoveries }));
writeFileSync(join(DATA_DIR, 'discoveries.geojson'), JSON.stringify({
  type: 'FeatureCollection',
  features: discoveries.map(({ lat, lon, ...properties }) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [lon, lat] }, properties })),
}));
const csvCell = (value) => {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};
const header = ['rank', 'name', 'lat', 'lon', 'env_type', 'tags', 'body', 'best_target_id', 'score', 'km_to_nearest_known_analog', ...FACTORS];
writeFileSync(join(DATA_DIR, 'discoveries.csv'), `${[header, ...discoveries.map((row) => [
  row.rank, row.name, row.lat, row.lon, row.env_type, row.tags.join('; '), row.body, row.best_target_id, row.score, row.km_to_nearest_known_analog,
  ...FACTORS.map((factor) => row.breakdown[factor]),
])].map((cells) => cells.map(csvCell).join(',')).join('\n')}\n`);

console.log(`discoveries (sample: ${data.isSample}): ${discoveries.length} spots from ${data.targets.length} targets, ${Math.round((Date.now() - started) / 100) / 10} s`);
