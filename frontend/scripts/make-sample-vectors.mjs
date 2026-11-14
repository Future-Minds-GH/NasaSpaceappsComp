// Writes placeholder tile vectors in the plan v2.1 format, so the globe search runs before Role 1's real binaries exist:
//   vectors/schema.json      field order and meaning, byte encoding, lookup tables
//   vectors/moon.bin         every Moon tile (HEALPix nside 64, nested order), 34 bytes each
//   vectors/mars_<0-11>.bin  Mars (nside 128) split by base cell
//   vectors/earth.bin        Earth land tiles (nside 256); sample: only tiles near the sample places
//   earth_meta.bin           per Earth tile: uint32 tile index, uint16 km to nearest known analog, uint16 tag bits,
//                            uint16 name index (65535 = none), uint8 environment (255 = none),
//                            uint8 flags (bit 0 = min_estimated: mineralogy is estimated, not measured)
//   tiles/earth_meta.json    the names, environment and tag lists earth_meta.bin points into
//   tiles/moon_meta.json, tiles/mars_meta.json   named features and the body's reality gap
//   presets.json             mission presets (weights) and named sites per body
// Every byte is 0-254 (percentile or fraction × 254, embedding (e+1)/2 × 254, or a code); 255 = not applicable.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { latLonToTile, tileCenter, tileCount } from '../src/data/healpix.js';
import { EARTH_PLACES, KNOWN_ANALOGS, REALITY_GAP, TARGETS } from './sample-places.mjs';

const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'data');
const NSIDE = { moon: 64, mars: 128, earth: 256 };
const NULL = 255;
const EARTH_RADIUS_KM = 160;

export const SCHEMA = {
  version: '0.1-sample',
  sample: true,
  nside: NSIDE,
  scheme: 'nested',
  null_code: NULL,
  encoding: { percentile: 'round(p × 254)', fraction: 'round(f × 254)', embedding: 'round((e + 1) / 2 × 254)', code: 'integer code', flag: '0 or 1' },
  mars_shards: 'mars_<base cell 0-11>.bin',
  factors: [
    { id: 'terrain', fields: [...Array.from({ length: 8 }, (_, index) => ({ id: `emb${index}`, kind: 'embedding' })), { id: 'slope', kind: 'percentile' }, { id: 'roughness', kind: 'percentile' }] },
    { id: 'elevation', fields: [{ id: 'relief', kind: 'percentile' }, { id: 'topo_position', kind: 'code', lookup: 'topo_position' }] },
    { id: 'geology', fields: [{ id: 'rock_class', kind: 'code', lookup: 'rock_class' }, { id: 'volcanic', kind: 'flag' }, { id: 'impact', kind: 'flag' }] },
    { id: 'mineralogy', fields: ['mafic', 'clays', 'sulfates', 'carbonates', 'iron_oxides', 'salts'].map((id) => ({ id, kind: 'fraction' })) },
    { id: 'climate', fields: ['aridity', 'mean_temp', 'day_night_range', 'cold_extreme', 'sunlit_fraction'].map((id) => ({ id, kind: 'percentile' })) },
    { id: 'atmosphere', fields: ['pressure', 'wind', 'dust', 'dust_storms'].map((id) => ({ id, kind: 'percentile' })) },
    { id: 'water_ice', fields: [{ id: 'ice_fraction', kind: 'fraction' }, { id: 'ice_depth', kind: 'code', lookup: 'ice_depth' }, { id: 'ice_form', kind: 'code', lookup: 'ice_form' }, { id: 'liquid_water', kind: 'fraction' }] },
  ],
  lookups: {
    topo_position: { names: ['basin', 'lower slope', 'flat', 'upper slope', 'ridge'], rule: 'same 1, neighbouring code 0.5, else 0' },
    rock_class: { names: ['anorthosite', 'basalt', 'other igneous', 'sedimentary', 'evaporite', 'impact breccia', 'ice'], groups: ['igneous', 'igneous', 'igneous', 'sedimentary', 'sedimentary', 'impact', 'ice'], rule: 'same 1, same group 0.5, else 0' },
    ice_depth: { names: ['surface', 'under 1 m', 'deeper', 'none'], rule: 'same 1, else 0' },
    ice_form: { names: ['none', 'seasonal', 'ground ice', 'buried glacial ice', 'exposed ice sheet'], related: [[2, 3]], rule: 'same 1, ground vs buried 0.5, else 0' },
  },
};
const BYTES = SCHEMA.factors.reduce((count, factor) => count + factor.fields.length, 0);

// Landform "embeddings" (8 numbers, -1..1) standing in for DINOv2: similar ground gets similar vectors.
const LANDFORMS = {
  plains: [0.6, -0.2, 0.1, 0.5, -0.4, 0.2, 0.0, -0.3],
  cratered: [-0.5, 0.7, 0.3, -0.2, 0.4, -0.1, 0.5, 0.2],
  volcanic: [0.2, 0.4, -0.7, 0.1, 0.3, 0.6, -0.2, 0.1],
  layered: [0.4, 0.1, 0.5, -0.6, -0.3, 0.2, 0.3, 0.6],
  polar: [-0.2, -0.5, 0.2, 0.3, 0.6, -0.4, -0.5, 0.0],
  dunes: [0.7, 0.3, 0.2, 0.2, -0.6, -0.5, 0.1, -0.1],
};
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
    buffer.set(body === 'moon' ? moonTile(lat, lon) : marsTile(lat, lon), index * BYTES);
  }
  return buffer;
}

// Smooth made-up geography: lunar maria in the near side's middle latitudes, cold traps at the poles;
// Mars with northern plains, southern craters, Tharsis volcanoes and icy mid-to-high latitudes.
function moonTile(lat, lon) {
  const polar = clamp01((Math.abs(lat) - 70) / 18);
  const mare = clamp01(Math.cos(((lon - 10) * Math.PI) / 120) * Math.cos((lat * Math.PI) / 70) - 0.35) * 1.6;
  const landform = mix(LANDFORMS.cratered, mix(LANDFORMS.volcanic, LANDFORMS.polar, polar), Math.max(mare, polar));
  return vector({
    landform, slope: 0.4 + wave(lat, lon, 7) * 0.4 - mare * 0.25, roughness: 0.5 + wave(lat, lon, 5) * 0.3 - mare * 0.2,
    relief: 0.5 + wave(lat, lon, 11) * 0.4, position: Math.floor(wave(lat, lon, 4) * 4.99),
    rock: mare > 0.5 ? 1 : 0, volcanic: mare > 0.5, impact: true,
    minerals: [mare > 0.5 ? 0.8 : 0.3, 0.02, 0.02, 0.01, 0.15, 0.01],
    climate: [0.99, 0.15 - polar * 0.14, 0.99, 0.95 + polar * 0.04, 0.9 - polar * 0.2], atmosphere: null,
    ice: polar * 0.4, iceDepth: polar > 0.3 ? 1 : 3, iceForm: polar > 0.3 ? 2 : 0,
  });
}

function marsTile(lat, lon) {
  const polar = clamp01((Math.abs(lat) - 55) / 25);
  const northernPlains = clamp01((lat - 10) / 25);
  const tharsis = clamp01(1 - Math.hypot(lat - 0, lon + 112) / 30);
  const midIce = Math.abs(lat) > 35 ? 0.35 : 0;
  let landform = mix(LANDFORMS.cratered, LANDFORMS.plains, northernPlains);
  landform = mix(landform, LANDFORMS.volcanic, tharsis);
  landform = mix(landform, LANDFORMS.layered, clamp01(1 - Math.abs(lat + 5) / 12) * 0.6);
  landform = mix(landform, LANDFORMS.polar, polar);
  return vector({
    landform, slope: 0.35 + wave(lat, lon, 8) * 0.35 + tharsis * 0.2, roughness: 0.4 + wave(lat, lon, 6) * 0.35,
    relief: 0.4 + wave(lat, lon, 13) * 0.4 + tharsis * 0.2, position: Math.floor(wave(lat, lon, 3) * 4.99),
    rock: tharsis > 0.3 ? 1 : northernPlains > 0.5 ? 3 : 2, volcanic: tharsis > 0.3, impact: northernPlains < 0.3,
    minerals: [0.6, 0.2 + wave(lat, lon, 9) * 0.3, 0.2 + wave(lat, lon, 10) * 0.3, 0.05, 0.75, 0.15],
    climate: [0.98, 0.1 - polar * 0.09, 0.9, 0.9 + polar * 0.09, 0.6 - polar * 0.3],
    atmosphere: [0.01, 0.5 + wave(lat, lon, 4) * 0.3, 0.8, 0.6 + wave(lat, lon, 12) * 0.3],
    ice: Math.max(polar * 0.9, midIce), iceDepth: polar > 0.5 ? 0 : midIce ? 1 : 3, iceForm: polar > 0.7 ? 4 : polar > 0.2 || midIce ? 2 : 0,
  });
}

function earthTile(place) {
  const noise = () => (random() - 0.5) * 0.25;
  const isImpact = IMPACT_PLACES.test(place.name);
  const byEnvironment = {
    desert: { landform: LANDFORMS.dunes, rock: 3, minerals: [0.2, 0.2, 0.3, 0.2, 0.5, 0.4], climate: [0.97, 0.8, 0.85, 0.3, 0.9], atmosphere: [0.95, 0.6, 0.7, 0.6], ice: 0, iceDepth: 3, iceForm: 0, liquid: 0.01 },
    arid: { landform: LANDFORMS.layered, rock: 4, minerals: [0.3, 0.4, 0.5, 0.3, 0.6, 0.5], climate: [0.9, 0.6, 0.75, 0.5, 0.85], atmosphere: [0.9, 0.5, 0.5, 0.4], ice: 0.02, iceDepth: 3, iceForm: 1, liquid: 0.03 },
    polar: { landform: LANDFORMS.polar, rock: 2, minerals: [0.4, 0.2, 0.2, 0.1, 0.3, 0.2], climate: [0.92, 0.03, 0.6, 0.97, 0.5], atmosphere: [0.9, 0.8, 0.2, 0.2], ice: 0.6, iceDepth: 1, iceForm: 2, liquid: 0.04 },
    volcanic: { landform: LANDFORMS.volcanic, rock: 1, minerals: [0.85, 0.1, 0.15, 0.05, 0.35, 0.1], climate: [0.6, 0.6, 0.6, 0.4, 0.7], atmosphere: [0.85, 0.5, 0.3, 0.2], ice: 0.02, iceDepth: 3, iceForm: 0, liquid: 0.05 },
  }[place.env_type];
  return vector({
    landform: isImpact ? mix(byEnvironment.landform, LANDFORMS.cratered, 0.6).map((value) => value + noise()) : byEnvironment.landform.map((value) => value + noise()),
    slope: 0.4 + noise() * 2, roughness: 0.45 + noise() * 2, relief: 0.5 + noise() * 2, position: Math.floor(random() * 4.99),
    rock: byEnvironment.rock, volcanic: place.env_type === 'volcanic', impact: isImpact,
    minerals: byEnvironment.minerals.map((value) => value + noise()), climate: byEnvironment.climate.map((value) => value + noise() * 0.5),
    atmosphere: byEnvironment.atmosphere.map((value) => value + noise()), ice: byEnvironment.ice + noise() * 0.3,
    iceDepth: byEnvironment.iceDepth, iceForm: byEnvironment.iceForm, liquid: byEnvironment.liquid,
  });
}

/** Packs one tile's values into 34 bytes in schema order. */
function vector({ landform, slope, roughness, relief, position, rock, volcanic, impact, minerals, climate, atmosphere, ice, iceDepth, iceForm, liquid = 0 }) {
  const byte = (value) => Math.round(clamp01(value) * 254);
  return [
    ...landform.map((value) => byte((Math.max(-1, Math.min(1, value)) + 1) / 2)), byte(slope), byte(roughness),
    byte(relief), Math.min(4, Math.max(0, position)),
    rock, volcanic ? 1 : 0, impact ? 1 : 0,
    ...minerals.map(byte),
    ...climate.map(byte),
    ...(atmosphere ? atmosphere.map(byte) : [NULL, NULL, NULL, NULL]),
    byte(ice), iceDepth, iceForm, byte(liquid),
  ];
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
    vectors.set(earthTile(record.place), row * BYTES);
    meta.setUint32(row * 12, record.index, true);
    meta.setUint16(row * 12 + 4, Math.min(65535, Math.round(Math.min(...KNOWN_ANALOGS.map((known) => distanceKm(lat, lon, known.lat, known.lon))))), true);
    meta.setUint16(row * 12 + 6, tagBits(record.place), true);
    meta.setUint16(row * 12 + 8, record.placeIndex, true);
    meta.setUint8(row * 12 + 10, ENVIRONMENTS.indexOf(record.place.env_type));
    // Sample rule: about 3 tiles in 10 have no measured minerals (real data: EMIT coverage).
    meta.setUint8(row * 12 + 11, record.index % 10 < 3 ? 1 : 0);
  });
  writeFileSync(join(DATA_DIR, 'vectors', 'earth.bin'), vectors);
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
