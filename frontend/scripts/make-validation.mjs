// Writes public/data/validation.json: the site's accuracy check, computed with the app's own search code on the
// real data (balanced preset), in both modes. The pairs, sites and hit rule come from ../known_analogs.json.
//   known     per Moon/Mars input: the Earth rank (%) of the best known analog listed for it (should be in the top 10%)
//   new       top-10 tiles more than 300 km from every known analog (the NEW badge): the search should find new places,
//             not only the famous sites; hit@10 (a known analog in the top 10) is reported with it as information
//   controls  total of each input against each negative-control place (wrong places must score red, below 60)
//   regions   top-10 tiles that fall inside a negative-control place (must be 0)
//   grid      per input and known Earth analog: the best Earth rank (%) of a tile near that analog (absolute mode)
// Run after build_vectors.py and make_weights.py (assemble_site.sh does). It writes sample: true if any input is sample data.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { baseCellOf, latLonToTile } from '../src/data/healpix.js';
import { MODES, combineAll, readLayout, scoreAllEarthTiles } from '../src/data/similarity.js';
import { BODY_RADIUS_KM, rankTopRows } from '../src/data/ranking.js';
import { clickedTileVector, readEarthTiles } from '../src/data/tileSearch.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(HERE, '..', 'public', 'data');
const read = (path) => readFileSync(join(DATA_DIR, path));
const json = (path) => JSON.parse(read(path));

const RED_BELOW = 60;      // a total under this is "red" (scoring.js scoreBand)
const MIN_HIT_RADIUS_KM = 100;
const TOP = 10;
const KNOWN_TOP_PCT = 90;     // a known analog should beat this share of Earth's tiles
const NEW_MIN_KM = 300;       // scoring.js isNewAnalog

const known = JSON.parse(readFileSync(join(HERE, '..', '..', 'known_analogs.json'), 'utf8'));
const site = (id) => {
  const found = known.sites.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`known_analogs.json has no site "${id}".`);
  return found;
};
const schema = json('vectors/schema.json');
const layout = readLayout(schema);
const weightsFile = json('weights.json');
const weights = weightsFile.presets.balanced.weights;
const earthLists = json('tiles/earth_meta.json');
const earthTiles = readEarthTiles({ meta: new Uint8Array(read('earth_meta.bin')), lists: earthLists }, schema.nside.earth);
const earthVectors = new Uint8Array(read('vectors/earth.bin'));
if (!earthLists.controls?.length) throw new Error('tiles/earth_meta.json has no "controls": run build_vectors.py with --known-analogs.');
const controlVectors = new Uint8Array(read('vectors/earth_controls.bin'));
if (controlVectors.length !== earthLists.controls.length * layout.bytesPerTile) throw new Error('earth_controls.bin does not match "controls" in earth_meta.json.');
const controlRow = (index) => controlVectors.subarray(index * layout.bytesPerTile, (index + 1) * layout.bytesPerTile);
const isSample = [weightsFile, earthLists, json('tiles/moon_meta.json'), json('tiles/mars_meta.json')].some((file) => file.sample !== false);

const lats = Float32Array.from(earthTiles, (tile) => tile.lat);
const lons = Float32Array.from(earthTiles, (tile) => tile.lon);

const earthSites = known.sites.filter((candidate) => candidate.body === 'earth' && candidate.role === 'site');
const inputs = known.pairs.flatMap((pair) => pair.inputs.map((id) => ({ pair, site: site(id), vector: inputVector(site(id)) })));

const results = inputs.map((input) => {
  const byMode = {};
  for (const mode of MODES) {
    const totals = combineAll(scoreAllEarthTiles(input.vector, earthVectors, layout, mode), weights);
    const picks = rankTopRows(totals, lats, lons, { count: TOP });
    const targets = input.pair.earth_ids.map(site);
    const hitIndex = picks.findIndex((pick) => targets.some((target) => kmFrom(target, pick.row) <= Math.max(target.radius_km, MIN_HIT_RADIUS_KM)));
    const controlTotals = earthLists.controls.map((_, index) => combineAll(scoreAllEarthTiles(input.vector, controlRow(index), layout, mode), weights)[0]);
    // A total below 0 means no factor could be compared: that is not a real "red" score.
    if (controlTotals.some((total) => total < 0)) throw new Error(`A control has no data to compare with ${input.site.name}.`);
    byMode[mode] = {
      totals,
      bestKnownRank: Math.max(...targets.map((target) => bestRankNear(totals, target) ?? -1)),
      newCount: picks.filter((pick) => earthSites.every((candidate) => kmFrom(candidate, pick.row) > NEW_MIN_KM)).length,
      hitRank: hitIndex < 0 ? null : hitIndex + 1,
      controlTotals,
      regionHits: picks.filter((pick) => earthLists.controls.some((control) => kmFrom(control, pick.row) <= control.radius_km)).length,
    };
  }
  return { input, ...byMode };
});

const summarise = (mode) => {
  const hits = results.filter((result) => result[mode].hitRank !== null).length;
  const scores = results.flatMap((result) => result[mode].controlTotals);
  const red = scores.filter((score) => score < RED_BELOW).length;
  return {
    known_high: results.filter((result) => result[mode].bestKnownRank >= KNOWN_TOP_PCT).length,
    new_matches: results.reduce((sum, result) => sum + result[mode].newCount, 0),
    hits,
    hit_ranks: results.map((result) => ({ input: result.input.site.name, rank: result[mode].hitRank })),
    controls_red: red,
    controls_total: scores.length,
    control_min: round1(Math.min(...scores)),
    control_max: round1(Math.max(...scores)),
    control_region_hits: results.reduce((sum, result) => sum + result[mode].regionHits, 0),
  };
};
const absolute = summarise('absolute');
const relative = summarise('relative');

const hitText = (result, mode) => `${result.input.site.name} ${result[mode].hitRank === null ? 'misses' : `rank ${result[mode].hitRank}`}`;
const bar = Math.ceil(inputs.length / 2);
const controlTileCounts = earthLists.controls.map((control) => `${control.name.replace(' (negative control)', '')} ${earthTiles.reduce((count, _, row) => count + (kmFrom(control, row) <= control.radius_km ? 1 : 0), 0)}`).join(', ');
const knownText = (result) => `${result.input.site.name} ${result.absolute.bestKnownRank < 0 ? 'no data' : `${result.absolute.bestKnownRank}%`}`;
const tests = [
  {
    id: 'known_rank',
    name: 'Known analogs rank high',
    result: `For ${absolute.known_high} of ${inputs.length} targets, the best Earth tile within ${MIN_HIT_RADIUS_KM} km (or the site radius) of a known analog listed for it beats ${KNOWN_TOP_PCT}% of Earth's tiles (${results.map(knownText).join('; ')}). `
      + `Relative mode: ${relative.known_high} of ${inputs.length}. The bar is ${bar} of ${inputs.length}.`,
    passed: absolute.known_high >= bar,
  },
  {
    id: 'new_places',
    name: 'Top matches find new places',
    result: `${absolute.new_matches} of the ${inputs.length * TOP} top-10 matches are more than ${NEW_MIN_KM} km from every known analog. `
      + `${absolute.hits} of ${inputs.length} targets have a known analog in their top 10 (relative mode: ${relative.hits}). The bar is half of the matches being new.`,
    passed: absolute.new_matches * 2 >= inputs.length * TOP,
  },
  {
    id: 'controls',
    name: 'Wrong places score red',
    result: `${absolute.controls_red} of ${absolute.controls_total} control scores are below ${RED_BELOW} (highest ${absolute.control_max}). `
      + `Each target is scored against ${earthLists.controls.map((control) => control.name.replace(' (negative control)', '')).join(', ')}. Absolute mode, balanced weights.`,
    passed: absolute.controls_red === absolute.controls_total,
  },
  {
    id: 'control_regions',
    name: 'No match lands in a wrong place',
    result: `${absolute.control_region_hits} of the ${inputs.length * TOP} top-10 matches lie inside a control place. Absolute mode. `
      + `The land filter already leaves out most of these places; scored tiles inside each: ${controlTileCounts}.`,
    passed: absolute.control_region_hits === 0,
  },
];

const specificity = {
  analogs: earthSites.map((candidate) => candidate.name),
  rows: results.map((result) => ({
    target: result.input.site.name,
    expected: result.input.pair.earth_ids.map((id) => site(id).name),
    ranks: earthSites.map((candidate) => bestRankNear(result.absolute.totals, candidate)),
  })),
};

const validation = {
  sample: isSample,
  mode: 'absolute',
  value: absolute.known_high,
  out_of: inputs.length,
  summary: `For ${absolute.known_high} of ${inputs.length} Moon and Mars targets, a known Earth analog ranks in Earth's top ${100 - KNOWN_TOP_PCT}%, `
    + `while ${absolute.new_matches} of the ${inputs.length * TOP} top-10 matches are new places (absolute mode).`,
  tests,
  specificity,
  relative,
  absolute,
};
writeFileSync(join(DATA_DIR, 'validation.json'), JSON.stringify(validation, null, 1));
console.log(`validation.json (sample: ${isSample}): known high ${absolute.known_high}/${inputs.length}, new ${absolute.new_matches}/${inputs.length * TOP}, hit@10 absolute ${absolute.hits}/${inputs.length}, relative ${relative.hits}/${inputs.length}; controls red ${absolute.controls_red}/${absolute.controls_total}; control-region hits ${absolute.control_region_hits}`);

/** The clicked tile's bytes for a Moon or Mars site. Throws when the tile has no data. */
function inputVector(target) {
  const nside = schema.nside[target.body];
  const index = latLonToTile(nside, target.lat, target.lon);
  const bytes = new Uint8Array(read(target.body === 'mars' ? `vectors/mars_${baseCellOf(nside, index)}.bin` : 'vectors/moon.bin'));
  const vector = clickedTileVector(target.body, nside, index, bytes, layout.bytesPerTile);
  if (!vector) throw new Error(`${target.name} has no data in its tile.`);
  return vector;
}

/** Best earthRankPct (same formula as rankTopRows) among Earth tiles near the site; null if no scored tile is there. */
function bestRankNear(totals, target) {
  const radius = Math.max(target.radius_km, MIN_HIT_RADIUS_KM);
  let best = -Infinity;
  for (let row = 0; row < totals.length; row++) if (totals[row] >= 0 && kmFrom(target, row) <= radius && totals[row] > best) best = totals[row];
  if (best === -Infinity) return null;
  let candidates = 0;
  let beatenBy = 0;
  for (let row = 0; row < totals.length; row++) {
    if (totals[row] < 0) continue;
    candidates++;
    if (totals[row] > best) beatenBy++;
  }
  return Math.round(((candidates - 1 - beatenBy) / Math.max(1, candidates - 1)) * 1000) / 10;
}

function kmFrom(place, row) {
  const toRadians = (degrees) => (degrees * Math.PI) / 180;
  const h = Math.sin(toRadians(lats[row] - place.lat) / 2) ** 2
    + Math.cos(toRadians(place.lat)) * Math.cos(toRadians(lats[row])) * Math.sin(toRadians(lons[row] - place.lon) / 2) ** 2;
  return 2 * BODY_RADIUS_KM.earth * Math.asin(Math.sqrt(h));
}

function round1(value) {
  return Math.round(value * 10) / 10;
}
