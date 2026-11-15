// Writes placeholder versions of two Role 2 files, in the shape the site and tests expect:
//   test_pairs.json  { pairs: [{ a: "<moon|mars tile id>", b: "<earth tile id>", preset, mode, total }] }: similarity.js must
//                    match similarity.py within 0.1 points on every pair. (The sample totals come from similarity.js
//                    itself, so they only prove the harness runs; Role 2's file is the real check.)
//   showcase.json    { results: { "<tile id>": { name, preset, matches: [result cards] } } }: the demo's showcase
//                    clicks, used only when the live search fails.
// Both files, and the pools below, are made for the default mode (absolute). In relative mode the site uses the live search.
// Run after make-sample-vectors.mjs.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FACTORS } from '../src/data/scoring.js';
import { baseCellOf, latLonToTile, tileCount } from '../src/data/healpix.js';
import { MODES, combineAll, readLayout, scoreAllEarthTiles } from '../src/data/similarity.js';
import { rankTopRows } from '../src/data/ranking.js';
import { buildMatches, clickedTileVector, readEarthTiles } from '../src/data/tileSearch.js';

const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'data');
const read = (path) => readFileSync(join(DATA_DIR, path));
const json = (path) => JSON.parse(read(path));
const schema = json('vectors/schema.json');
const layout = readLayout(schema);
const weightsFile = json('weights.json');
const earthTiles = readEarthTiles({ meta: new Uint8Array(read('earth_meta.bin')), lists: json('tiles/earth_meta.json') }, schema.nside.earth);
const earthVectors = new Uint8Array(read('vectors/earth.bin'));

const MODE = 'absolute';
const pairs = [];
const showcase = {};
for (const body of ['moon', 'mars']) {
  const nside = schema.nside[body];
  const meta = json(`tiles/${body}_meta.json`);
  for (const site of meta.sites.filter((candidate) => candidate.track !== 'cave')) {
    const index = latLonToTile(nside, site.lat, site.lon);
    const scores = scoreTile(body, nside, index);
    const tileId = `${body}_${nside}_${index}`;
    for (const mode of MODES) {
      const modeScores = mode === MODE ? scores : scoreTile(body, nside, index, mode);
      for (const [presetId, preset] of Object.entries(weightsFile.presets)) {
        const totals = combineAll(modeScores, preset.weights);
        // Two pairs per site, preset and mode: its best Earth tile and one fixed mid-list tile.
        for (const row of [rankTopRows(totals, ...centres())[0].row, Math.floor(earthTiles.length / 2)]) {
          pairs.push({ a: tileId, b: `earth_${schema.nside.earth}_${earthTiles[row].index}`, preset: presetId, mode, total: Math.round(totals[row] * 1000) / 1000 });
        }
      }
    }
    const balanced = weightsFile.presets[weightsFile.default_preset].weights;
    const picks = rankTopRows(combineAll(scores, balanced), ...centres()).map((pick) => ({
      ...pick, factorScores: Array.from(scores.subarray(pick.row * FACTORS.length, (pick.row + 1) * FACTORS.length)),
    }));
    showcase[tileId] = { name: site.name, preset: weightsFile.default_preset, matches: buildMatches(picks, { tiles: earthTiles, weights: balanced, nside: schema.nside.earth, mode: MODE }) };
  }
}
writeFileSync(join(DATA_DIR, 'test_pairs.json'), JSON.stringify({ sample: true, tolerance: 0.1, pairs }, null, 1));
writeFileSync(join(DATA_DIR, 'showcase.json'), JSON.stringify({ sample: true, mode: MODE, results: showcase }));
console.log(`test_pairs: ${pairs.length} pairs; showcase: ${Object.keys(showcase).length} tiles`);

// pools/<body>_<parent>.json: for every tile in the nside-8 parent cell of each named Moon/Mars site, the union of
// the top Earth tiles over every preset and nine single-factor-heavy weightings, capped at 30, best first under
// the default preset. (Role 2 builds these for every tile with FAISS; the sample covers the named sites' regions.)
const POOL_SIZE = 30;
const PARENT_NSIDE = 8;
const weightings = [
  ...Object.values(weightsFile.presets).map((preset) => preset.weights),
  ...FACTORS.map((heavy) => Object.fromEntries(FACTORS.map((factor) => [factor, factor === heavy ? 0.7 : 0.05]))),
];
mkdirSync(join(DATA_DIR, 'pools'), { recursive: true });
let poolFiles = 0;
for (const body of ['moon', 'mars']) {
  const nside = schema.nside[body];
  const childrenPerParent = (nside / PARENT_NSIDE) ** 2;
  const parents = new Set(json(`tiles/${body}_meta.json`).sites.map((site) => Math.floor(latLonToTile(nside, site.lat, site.lon) / childrenPerParent)));
  for (const parent of parents) {
    const tiles = {};
    for (let index = parent * childrenPerParent; index < (parent + 1) * childrenPerParent; index++) {
      const scores = scoreTile(body, nside, index);
      const rows = new Set(weightings.flatMap((weights) => rankTopRows(combineAll(scores, weights), ...centres()).map((pick) => pick.row)));
      const balancedTotals = combineAll(scores, weightsFile.presets[weightsFile.default_preset].weights);
      tiles[index] = [...rows].sort((first, second) => balancedTotals[second] - balancedTotals[first]).slice(0, POOL_SIZE).map((row) => [
        earthTiles[row].index,
        ...Array.from(scores.subarray(row * FACTORS.length, (row + 1) * FACTORS.length), (value) => (Number.isNaN(value) ? null : Math.round(value * 1000) / 1000)),
      ]);
    }
    writeFileSync(join(DATA_DIR, 'pools', `${body}_${parent}.json`), JSON.stringify({ sample: true, mode: MODE, body, nside, parent_nside: PARENT_NSIDE, tiles }));
    poolFiles += 1;
  }
}
console.log(`pools: ${poolFiles} files`);

function scoreTile(body, nside, index, mode = MODE) {
  const bytes = new Uint8Array(read(body === 'mars' ? `vectors/mars_${baseCellOf(nside, index)}.bin` : 'vectors/moon.bin'));
  if (index >= tileCount(nside)) throw new Error(`Tile ${index} is outside nside ${nside}.`);
  return scoreAllEarthTiles(clickedTileVector(body, nside, index, bytes, layout.bytesPerTile), earthVectors, layout, mode);
}

function centres() {
  return [Float32Array.from(earthTiles, (tile) => tile.lat), Float32Array.from(earthTiles, (tile) => tile.lon)];
}
