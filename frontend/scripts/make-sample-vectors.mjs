// Writes placeholder tile vectors in the matcher v0.3 format (data/schema.json), so the globe search runs before the real
// binaries exist:
//   vectors/schema.json      a copy of data/schema.json with sample: true (field order, units, tolerances)
//   vectors/moon.bin         every Moon tile (HEALPix nside 64, nested order)
//   vectors/mars_<0-11>.bin  Mars (nside 128) split by base cell
//   vectors/earth.bin        Earth land tiles (nside 256); sample: only tiles near the sample places
//   earth_meta.bin           per Earth tile: uint32 tile index, uint16 km to nearest known analog, uint16 tag bits,
//                            uint16 name index (65535 = none), uint8 environment (255 = none),
//                            uint8 flags (bit 0 = min_estimated: minerals are estimated, not measured)
//   tiles/earth_meta.json    the names, environment and tag lists earth_meta.bin points into
//   tiles/moon_meta.json, tiles/mars_meta.json   named features and the body's reality gap
// The tile width comes from the schema (factor fields, then relative fields). Values are made in real units and encoded
// with the schema's min and max; the relative fields and elev_pct are each body's percentile ranks, as in the real data.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { latLonToTile, tileCenter, tileCount } from '../src/data/healpix.js';
import { readLayout, NULL_CODE } from '../src/data/similarity.js';
import { EARTH_PLACES, KNOWN_ANALOGS, REALITY_GAP, TARGETS } from './sample-places.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(HERE, '..', 'public', 'data');
const SCHEMA_FILE = join(HERE, '..', '..', 'data', 'schema.json');
const SCHEMA = { ...JSON.parse(readFileSync(SCHEMA_FILE, 'utf8')), sample: true };
const LAYOUT = readLayout(SCHEMA);
const BYTES = LAYOUT.bytesPerTile;
const NSIDE = SCHEMA.nside;
const NULL = NULL_CODE;
const EARTH_RADIUS_KM = 160;

const TAGS = ['hyperarid soil', 'evaporite', 'hydrothermal', 'permafrost', 'ice-covered lake', 'aeolian', 'ice dynamics', 'volcanic', 'sedimentary', 'impact'];
const ENVIRONMENTS = ['desert', 'arid', 'polar', 'volcanic'];
const IMPACT_PLACES = /Meteor|Haughton|Lonar|Wolfe Creek/;
const EARTH_SITES = [
  { target_id: 'atacama', name: 'Atacama Desert', lat: -24.08, lon: -69.92, track: 'base', summary: 'The driest non-polar desert on Earth, used to test Mars life-detection instruments.' },
  { target_id: 'haughton_crater', name: 'Haughton Crater', lat: 75.38, lon: -89.68, track: 'base', summary: 'A 23 km impact crater in the high Arctic, home of the Haughton-Mars Project.' },
  { target_id: 'death_valley', name: 'Death Valley', lat: 36.25, lon: -116.83, track: 'base', summary: 'A hot, dry basin of salt flats and dunes, a stand-in for Mars evaporite basins.' },
  { target_id: 'mcmurdo_dry_valleys', name: 'McMurdo Dry Valleys', lat: -77.52, lon: 161.85, track: 'base', summary: 'Ice-free Antarctic valleys, cold and dry like the Mars poles.' },
  { target_id: 'craters_of_the_moon', name: 'Craters of the Moon', lat: 43.42, lon: -113.52, track: 'base', summary: 'Young lava fields and lava tubes, used for Moon and Mars field training.' },
  { target_id: 'lanzarote', name: 'Lanzarote', lat: 29.0, lon: -13.75, track: 'cave', summary: 'A volcanic island with long lava tubes, used for cave-exploration training.' },
];

const random = seededRandom(31);
mkdirSync(join(DATA_DIR, 'vectors'), { recursive: true });
mkdirSync(join(DATA_DIR, 'tiles'), { recursive: true });
writeFileSync(join(DATA_DIR, 'vectors', 'schema.json'), JSON.stringify(SCHEMA, null, 1));
writeFileSync(join(DATA_DIR, 'vectors', 'moon.bin'), bodyVectors('moon'));
const mars = bodyVectors('mars');
const marsPerShard = NSIDE.mars * NSIDE.mars * BYTES;
for (let shard = 0; shard < 12; shard++) writeFileSync(join(DATA_DIR, 'vectors', `mars_${shard}.bin`), mars.subarray(shard * marsPerShard, (shard + 1) * marsPerShard));
writeEarth();
for (const body of ['moon', 'mars']) writeBodyMeta(body);
console.log(`vectors: ${BYTES} bytes per tile; moon ${tileCount(NSIDE.moon)}, mars ${tileCount(NSIDE.mars)} tiles`);

function bodyVectors(body) {
  const nside = NSIDE[body];
  const buffer = new Uint8Array(tileCount(nside) * BYTES);
  for (let index = 0; index < tileCount(nside); index++) {
    const { lat, lon } = tileCenter(nside, index);
    buffer.set(encodeTile(body === 'moon' ? moonTile(lat, lon) : marsTile(lat, lon)), index * BYTES);
  }
  return addRanks(buffer);
}

// Smooth made-up geography in real units: lunar maria in the near side's middle latitudes, cold traps at the poles;
// Mars with northern plains, Tharsis volcanoes and icy mid-to-high latitudes.
function moonTile(lat, lon) {
  const polar = clamp01((Math.abs(lat) - 70) / 18);
  const mare = clamp01(Math.cos(((lon - 10) * Math.PI) / 120) * Math.cos((lat * Math.PI) / 70) - 0.35) * 1.6;
  const day = 380 - polar * 180 - Math.abs(lat) * 0.5;
  const night = 100 - polar * 10;
  return tileValues({
    day, night, sun: 340 * Math.cos((lat * Math.PI) / 180) + 20, slope: 8 + wave(lat, lon, 7) * 10 - Math.min(mare, 1) * 5, rough: 120 + wave(lat, lon, 5) * 200 - Math.min(mare, 1) * 80,
    elev: wave(lat, lon, 11), surface: [0.55, 0, 0.45], ice: polar * 0.4,
    minerals: mare > 0.5 ? [0.7, 0.2, 0.04, 0, 0, 0.06] : [0.15, 0.75, 0.04, 0, 0, 0.06],
  });
}

function marsTile(lat, lon) {
  const polar = clamp01((Math.abs(lat) - 55) / 25);
  const northernPlains = clamp01((lat - 10) / 25);
  const tharsis = clamp01(1 - Math.hypot(lat - 0, lon + 112) / 30);
  const midIce = Math.abs(lat) > 35 ? 0.35 : 0;
  return tileValues({
    day: 275 - polar * 60 - Math.abs(lat) * 0.6, night: 185 - polar * 30 - Math.abs(lat) * 0.3,
    sun: 200 * Math.cos((lat * Math.PI) / 180) + 20, slope: 3 + wave(lat, lon, 8) * 10 + tharsis * 8, rough: 40 + wave(lat, lon, 6) * 200 - northernPlains * 30,
    elev: wave(lat, lon, 13) + tharsis * 0.3, surface: [0.6, 0.15, 0.25], ice: Math.max(polar * 0.9, midIce),
    // No mineral map beyond 75 degrees latitude: those tiles have null minerals.
    minerals: Math.abs(lat) > 75 ? null : [0.4 + wave(lat, lon, 9) * 0.2, 0.05, 0.3 + wave(lat, lon, 10) * 0.2, 0.05, 0.1, 0.1],
  });
}

function earthTile(place) {
  const noise = (scale = 1) => (random() - 0.5) * 0.25 * scale;
  const isImpact = IMPACT_PLACES.test(place.name);
  const base = {
    desert: { day: 318, night: 292, sun: 260, slope: 3, rough: 30, surface: [0.2, 0.4, 0.4], ice: 0, minerals: [0.15, 0.05, 0.3, 0.2, 0.15, 0.15] },
    arid: { day: 308, night: 285, sun: 240, slope: 5, rough: 60, surface: [0.3, 0.2, 0.5], ice: 0.02, minerals: [0.2, 0.1, 0.25, 0.2, 0.15, 0.1] },
    polar: { day: 255, night: 238, sun: 120, slope: 4, rough: 25, surface: [0.1, 0, 0.4], ice: 0.5, minerals: [0.3, 0.2, 0.1, 0.1, 0.2, 0.1] },
    volcanic: { day: 305, night: 280, sun: 230, slope: 14, rough: 200, surface: [0.05, 0.05, 0.9], ice: 0.02, minerals: [0.7, 0.05, 0.1, 0.02, 0.1, 0.03] },
  }[place.env_type];
  return tileValues({
    day: base.day + noise() * 40, night: base.night + noise() * 40, sun: base.sun + noise() * 200,
    slope: Math.max(0, base.slope * (1 + noise() * 3) + (isImpact ? 4 : 0)), rough: Math.max(0, base.rough * (1 + noise() * 3) + (isImpact ? 60 : 0)),
    elev: 0.5 + noise() * 2, surface: base.surface.map((value) => Math.max(0, value + noise(0.4))),
    ice: Math.max(0, base.ice + noise() * 0.3), minerals: base.minerals.map((value) => Math.max(0.001, value + noise(0.3))),
  });
}

/**
 * Real-unit values of one tile keyed by schema field id; the percentile fields are filled in later by addRanks.
 * surface is [dust, sand, rock]: scaled to leave room for the ice share (= ice probability, contract section 5).
 * elev is a raw 0-1 height that addRanks turns into elev_pct.
 */
function tileValues({ day, night, sun, slope, rough, elev, surface, ice, minerals }) {
  const total = surface.reduce((sum, value) => sum + value, 0);
  const [dust, sand, rock] = surface.map((value) => (value / total) * (1 - clamp01(ice)));
  const mineralTotal = minerals ? minerals.reduce((sum, value) => sum + value, 0) : 1;
  const [mafic, feldspathic, ironox, sulfate, clay, carbonate] = minerals ? minerals.map((value) => value / mineralTotal) : Array(6).fill(null);
  return {
    t_day_k: day, t_night_k: night, t_swing_k: Math.max(0, day - night), sun_wm2: sun, slope_deg: slope, rough_m: rough, elev_pct: clamp01(elev),
    surf_dust: dust, surf_sand: sand, surf_rock: rock, surf_ice: clamp01(ice),
    min_mafic: mafic, min_feldspathic: feldspathic, min_ironox: ironox, min_sulfate: sulfate, min_clay: clay, min_carbonate: carbonate,
    ice_prob: clamp01(ice),
  };
}

/** Packs one tile's values into BYTES bytes in schema order (percentile bytes are 255 until addRanks runs). */
function encodeTile(values) {
  const bytes = new Uint8Array(BYTES).fill(NULL);
  for (const [id, field] of Object.entries(LAYOUT.fields)) {
    const value = values[id];
    if (value === undefined || value === null) continue;
    const fraction = field.kind === 'value' ? (Math.min(field.max, Math.max(field.min, value)) - field.min) / (field.max - field.min) : clamp01(value);
    bytes[field.offset] = Math.round(fraction * SCHEMA.byte_scale);
  }
  return bytes;
}

/**
 * Fills the relative fields (and turns elev_pct from a raw height into a rank) with each field's percentile within this
 * set of tiles: (average rank - 0.5) / n over the non-null tiles, as the real data does per body.
 */
function addRanks(buffer) {
  const tiles = buffer.length / BYTES;
  const pairs = [['elev_pct', 'elev_pct'], ...SCHEMA.relative_fields.map((field) => [field.rel_of, field.id])];
  for (const [sourceId, targetId] of pairs) {
    const source = LAYOUT.fields[sourceId].offset;
    const target = LAYOUT.fields[targetId].offset;
    const counts = new Float64Array(SCHEMA.byte_scale + 1);
    for (let tile = 0; tile < tiles; tile++) if (buffer[tile * BYTES + source] !== NULL) counts[buffer[tile * BYTES + source]]++;
    const n = counts.reduce((sum, count) => sum + count, 0);
    const rankByte = new Uint8Array(SCHEMA.byte_scale + 1);
    let below = 0;
    counts.forEach((count, byte) => {
      rankByte[byte] = n ? Math.round(((below + count / 2) / n) * SCHEMA.byte_scale) : NULL;
      below += count;
    });
    for (let tile = 0; tile < tiles; tile++) {
      const value = buffer[tile * BYTES + source];
      buffer[tile * BYTES + target] = value === NULL ? NULL : rankByte[value];
    }
  }
  return buffer;
}

function writeEarth() {
  const tiles = new Map();
  EARTH_PLACES.forEach((place, placeIndex) => {
    const span = EARTH_RADIUS_KM / 111;
    for (let lat = place.lat - span; lat <= place.lat + span; lat += 0.08) {
      for (let lon = place.lon - span * 2; lon <= place.lon + span * 2; lon += 0.08) {
        if (distanceKm(lat, lon, place.lat, place.lon) > EARTH_RADIUS_KM) continue;
        const index = latLonToTile(NSIDE.earth, lat, lon);
        if (!tiles.has(index)) tiles.set(index, { index, place, placeIndex });
      }
    }
  });
  const records = [...tiles.values()].sort((first, second) => first.index - second.index);
  const vectors = new Uint8Array(records.length * BYTES);
  const meta = new DataView(new ArrayBuffer(records.length * 12));
  records.forEach((record, row) => {
    const { lat, lon } = tileCenter(NSIDE.earth, record.index);
    vectors.set(encodeTile(earthTile(record.place)), row * BYTES);
    meta.setUint32(row * 12, record.index, true);
    meta.setUint16(row * 12 + 4, Math.min(65535, Math.round(Math.min(...KNOWN_ANALOGS.map((known) => distanceKm(lat, lon, known.lat, known.lon))))), true);
    meta.setUint16(row * 12 + 6, tagBits(record.place), true);
    meta.setUint16(row * 12 + 8, record.placeIndex, true);
    meta.setUint8(row * 12 + 10, ENVIRONMENTS.indexOf(record.place.env_type));
    // Sample rule: about 3 tiles in 10 have no measured minerals (real data: EMIT coverage).
    meta.setUint8(row * 12 + 11, record.index % 10 < 3 ? 1 : 0);
  });
  writeFileSync(join(DATA_DIR, 'vectors', 'earth.bin'), addRanks(vectors));
  writeFileSync(join(DATA_DIR, 'earth_meta.bin'), new Uint8Array(meta.buffer));
  writeFileSync(join(DATA_DIR, 'tiles', 'earth_meta.json'), JSON.stringify({
    sample: true, record_bytes: 12, tile_count: records.length, names: EARTH_PLACES.map((place) => `Near ${place.name}`), environments: ENVIRONMENTS, tags: TAGS,
    // Named Earth sites for the Earth globe's buttons: the famous analogs the challenge page names, plus a few more.
    sites: EARTH_SITES,
  }));
  console.log(`earth: ${records.length} sample tiles`);
}

function tagBits(place) {
  const names = {
    desert: ['hyperarid soil', 'aeolian'], arid: ['evaporite', 'sedimentary'], polar: ['permafrost', 'ice dynamics'], volcanic: ['volcanic', 'hydrothermal'],
  }[place.env_type];
  if (IMPACT_PLACES.test(place.name)) names.push('impact');
  if (/McMurdo/.test(place.name)) names.push('ice-covered lake');
  return names.reduce((bits, name) => bits | (1 << TAGS.indexOf(name)), 0);
}

// tiles/<body>_meta.json: the body's reality gap, named tiles, and the named sites shown as buttons on the globe.
function writeBodyMeta(body) {
  const named = Object.fromEntries(TARGETS.filter((target) => target.body === body).map((target) => [latLonToTile(NSIDE[body], target.lat, target.lon), target.name]));
  const sites = JSON.parse(readFileSync(join(DATA_DIR, 'tiles', 'named_sites.json'), 'utf8'))[body];
  // min_estimated: tiles whose mineralogy is estimated (sample: Moon none; Mars the tiles outside CRISM-like coverage).
  const minEstimated = body === 'mars' ? Array.from({ length: tileCount(NSIDE.mars) }, (_, index) => index).filter((index) => index % 7 === 0) : [];
  writeFileSync(join(DATA_DIR, 'tiles', `${body}_meta.json`), JSON.stringify({ sample: true, body, nside: NSIDE[body], reality_gap: REALITY_GAP[body], named, sites, min_estimated: minEstimated }));
}

// Function declarations (not arrow constants) so the top-level code above can call them before this line runs.
function wave(lat, lon, scale) {
  return (Math.sin(lat / scale + lon / (scale * 2.3)) * Math.cos(lon / (scale * 1.7) - lat / (scale * 3.1)) + 1) / 2;
}
function mix(first, second, amount) {
  return first.map((value, index) => value * (1 - amount) + second[index] * amount);
}
function clamp01(value) {
  return Math.min(1, Math.max(0, value));
}

function distanceKm(latA, lonA, latB, lonB) {
  const toRadians = (degrees) => (degrees * Math.PI) / 180;
  const h = Math.sin(toRadians(latB - latA) / 2) ** 2 + Math.cos(toRadians(latA)) * Math.cos(toRadians(latB)) * Math.sin(toRadians(lonB - lonA) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

function seededRandom(seed) {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}
