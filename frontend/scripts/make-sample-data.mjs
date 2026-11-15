// Writes placeholder data files into public/data/ in the shape Role 2's pipeline produces, so every screen can be
// built before the real files exist. Run with `npm run sample-data`. Every file carries "sample": true; the site shows
// a "sample data" note while it sees that flag, and the note disappears once Role 2's real files replace these.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { EARTH_PLACES, FACTORS, KNOWN_ANALOGS, REALITY_GAP, TARGETS, WHY_PHRASES } from "./sample-places.mjs";
import { latLonToTile } from "../src/data/healpix.js";
import { combineScore } from "../src/data/scoring.js";

const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "data");
const NEW_ANALOG_KM = 300;
const GRID_CELL_DEG = 0.5;
const GRID_TILE_DEG = 10;
// Grid cells are filled in this far around each sample place, so clicks near real deserts, poles and volcanoes work.
const GRID_RADIUS_DEG = 1.5;

// The mission presets of web/src/presets.json (the contract's nine weight keys), as shares that sum to 1 (4 decimals), in
// the weights.json shape of the matcher brief; the factor labels and groups come from data/schema.json and presets.json.
const HERE = dirname(fileURLToPath(import.meta.url));
const SCHEMA = JSON.parse(readFileSync(join(HERE, "..", "..", "data", "schema.json"), "utf8"));
const PRESET_FILE = JSON.parse(readFileSync(join(HERE, "..", "..", "web", "src", "presets.json"), "utf8"));
const FACTOR_LABELS = Object.fromEntries(SCHEMA.factors.map((factor) => [factor.id, factor.label]));
const GROUPS = PRESET_FILE.groups;
const GROUP_OF = Object.fromEntries(Object.entries(GROUPS).flatMap(([group, ids]) => ids.map((id) => [id, group])));
const DEFAULT_MODE = "absolute";
const PRESETS = Object.fromEntries(Object.entries(PRESET_FILE.presets).map(([id, preset]) => {
  const total = PRESET_FILE.weightKeys.reduce((sum, key) => sum + preset[key], 0);
  const weights = Object.fromEntries(PRESET_FILE.weightKeys.map((key) => [key, Math.round((preset[key] / total) * 10000) / 10000]));
  const top = PRESET_FILE.weightKeys.filter((key) => weights[key] > 0).sort((first, second) => weights[second] - weights[first]).slice(0, 3);
  return [id, { label: preset.label, description: `Counts ${top.map((key) => FACTOR_LABELS[key].toLowerCase()).join(", ")} most.`, weights }];
}));
const NSIDE = { moon: 64, mars: 128 };

// Habitability and process tags, by environment; real tags come from Role 2's rules.
const TAGS_BY_ENVIRONMENT = {
  desert: ["hyperarid soil", "aeolian"],
  arid: ["evaporite", "sedimentary"],
  polar: ["permafrost", "ice dynamics"],
  volcanic: ["volcanic", "hydrothermal"],
};

const GOOD_FOR = {
  desert: ["Rover driving trials", "Life-detection instrument tests", "Dust and abrasion tests on hardware"],
  arid: ["Sample collection rehearsals", "Mineral-mapping instrument tests", "Rover driving trials"],
  polar: ["Ice drilling tests", "Cold-weather spacesuit trials", "Habitat heating tests"],
  volcanic: ["Lava tube and cave robot trials", "Regolith digging and building tests", "Spacesuit walking trials on rough rock"],
};

const random = seededRandom(20261114);

// Role 2's weights.json: the only source of weights on the site.
writeJson("weights.json", {
  sample: true,
  default_preset: "balanced",
  default_mode: DEFAULT_MODE,
  factors: FACTORS.map((id) => ({ id, label: FACTOR_LABELS[id], group: GROUP_OF[id] })),
  groups: GROUPS,
  presets: PRESETS,
});
// Named sites for the globe's buttons live in Role 1's tiles/<body>_meta.json; make-sample-vectors.mjs adds the rest.
writeJson("tiles/named_sites.json", { sample: true, moon: namedSites("moon"), mars: namedSites("mars") });

const scoresByTarget = Object.fromEntries(TARGETS.map((target) => [target.target_id, scorePlacesFor(target)]));
writeCharacterizeFiles();
writeDiscoveries();
writeJson("validation.json", {
  sample: true,
  value: 10,
  out_of: KNOWN_ANALOGS.length,
  summary: `10 of ${KNOWN_ANALOGS.length} well-known analog sites land in the top 10% of Earth for the target they are used for.`,
  // Four placeholder tests: Role 2's validation run replaces them.
  tests: [
    { id: "recall", name: "Known analogs rank high", result: "10 of 12 known analog sites fall in our top 10% for their target (target 70%).", passed: true },
    { id: "specificity", name: "The right analog wins", result: "Icy sites beat ice-free ones for Mars ice targets, and ice-free ones win for Jezero and Gale, in 9 of 10 target pairs.", passed: true },
    { id: "baseline", name: "Beats a simple baseline", result: "Ranking by temperature alone gets 6 of the 10 pairs right; the nine factors get 9.", passed: true },
    { id: "hard_negatives", name: "Wrong places rank low", result: "Humid farmland, temperate grassland and a city edge all land in Earth's bottom 15%.", passed: true },
  ],
  // Specificity test, placeholder numbers: Role 2's validation run replaces them.
  specificity: {
    analogs: ["Devon Island", "Svalbard", "Dry Valleys", "Atacama", "Death Valley", "Hawaii lava"],
    rows: [
      { target: "Arcadia Planitia", expected: ["Devon Island", "Svalbard", "Dry Valleys"], ranks: [98.4, 97.1, 96.2, 81.0, 74.5, 52.3] },
      { target: "Utopia Planitia", expected: ["Devon Island", "Svalbard", "Dry Valleys"], ranks: [97.2, 96.8, 95.5, 79.4, 72.0, 50.1] },
      { target: "Jezero Crater", expected: ["Atacama", "Death Valley"], ranks: [70.2, 66.4, 74.8, 97.9, 96.6, 58.0] },
      { target: "Gale Crater", expected: ["Atacama", "Death Valley"], ranks: [68.5, 63.1, 71.9, 98.3, 97.4, 61.2] },
      { target: "Shackleton Connecting Ridge", expected: ["Dry Valleys"], ranks: [88.0, 86.5, 97.6, 72.4, 60.8, 77.3] },
    ],
  },
});

/** Featured sites for the globe buttons, with the HEALPix tile each one sits in. */
function namedSites(body) {
  return TARGETS.filter((target) => target.body === body).map((target) => ({
    ...target,
    tile_id: `${body}_${NSIDE[body]}_${latLonToTile(NSIDE[body], target.lat, target.lon)}`,
    image_url: trekImageUrl(target),
    reality_gap: REALITY_GAP[target.body],
  }));
}

function writeCharacterizeFiles() {
  const famous = [
    ["atacama", "Atacama Desert, Chile"],
    ["haughton_crater", "Haughton Crater, Devon Island"],
    ["death_valley", "Death Valley, USA"],
    ["mcmurdo_dry_valleys", "McMurdo Dry Valleys, Antarctica"],
    ["craters_of_the_moon", "Craters of the Moon, Idaho"],
    ["lanzarote", "Lanzarote, Canary Islands"],
  ];
  const sites = famous.map(([siteId, name]) => ({ site_id: siteId, ...reportCard(EARTH_PLACES.find((place) => place.name === name)) }));
  writeJson("characterize/sites.json", { sample: true, sites });

  const tiles = new Map();
  for (const place of EARTH_PLACES) {
    for (let lat = place.lat - GRID_RADIUS_DEG; lat <= place.lat + GRID_RADIUS_DEG; lat += GRID_CELL_DEG) {
      for (let lon = place.lon - GRID_RADIUS_DEG; lon <= place.lon + GRID_RADIUS_DEG; lon += GRID_CELL_DEG) {
        const cellLat = Math.floor(lat / GRID_CELL_DEG) * GRID_CELL_DEG + GRID_CELL_DEG / 2;
        const cellLon = Math.floor(lon / GRID_CELL_DEG) * GRID_CELL_DEG + GRID_CELL_DEG / 2;
        if (Math.abs(cellLat) > 90) continue;
        const tileName = `${Math.floor(cellLat / GRID_TILE_DEG) * GRID_TILE_DEG}_${Math.floor(cellLon / GRID_TILE_DEG) * GRID_TILE_DEG}`;
        if (!tiles.has(tileName)) tiles.set(tileName, {});
        const cell = { ...place, name: `Near ${place.name}`, lat: cellLat, lon: cellLon };
        tiles.get(tileName)[`${cellLat.toFixed(2)}_${cellLon.toFixed(2)}`] = reportCard(cell, 3);
      }
    }
  }
  for (const [tileName, cells] of tiles) {
    writeJson(`characterize/grid/${tileName}.json`, { sample: true, cell_deg: GRID_CELL_DEG, cells });
  }
}

// Discover: per body, Earth places more than 300 km from any catalogued analog, each under the target of
// that body it matches best, with all nine factor scores so the page can re-rank them live with the sliders.
function writeDiscoveries() {
  const balanced = PRESETS.balanced.weights;
  const discoveries = [];
  for (const body of ["moon", "mars"]) {
    for (const place of EARTH_PLACES) {
      const km = kmToNearestKnownAnalog(place);
      if (km <= NEW_ANALOG_KM) continue;
      const best = TARGETS.filter((target) => target.body === body)
        .map((target) => {
          const breakdown = scoresByTarget[target.target_id].find((entry) => entry.place === place).breakdown;
          return { target, breakdown, score: combineScore(breakdown, balanced) };
        })
        .sort((a, b) => b.score - a.score)[0];
      discoveries.push({
        name: place.name,
        lat: place.lat,
        lon: place.lon,
        env_type: place.env_type,
        tags: TAGS_BY_ENVIRONMENT[place.env_type],
        body,
        best_target_id: best.target.target_id,
        score: round(best.score, 1),
        breakdown: best.breakdown,
        km_to_nearest_known_analog: Math.round(km),
        why: whyPhrases(best.breakdown),
        cant_reproduce: REALITY_GAP[body].slice(0, 3),
      });
    }
  }
  discoveries.sort((a, b) => b.score - a.score).forEach((item, index) => { item.rank = index + 1; });
  writeJson("discoveries.json", { sample: true, weights_used: "balanced", discoveries });

  const header = ["rank", "name", "lat", "lon", "env_type", "tags", "body", "best_target_id", "score", "km_to_nearest_known_analog", ...FACTORS];
  const rows = discoveries.map((item) => [
    item.rank, `"${item.name}"`, item.lat, item.lon, item.env_type, `"${item.tags.join("; ")}"`, item.body, item.best_target_id, item.score,
    item.km_to_nearest_known_analog, ...FACTORS.map((factor) => item.breakdown[factor] ?? ""),
  ].join(","));
  writeText("discoveries.csv", [header.join(","), ...rows].join("\n") + "\n");
  writeJson("discoveries.geojson", {
    type: "FeatureCollection",
    features: discoveries.map(({ lat, lon, ...properties }) => ({ type: "Feature", geometry: { type: "Point", coordinates: [lon, lat] }, properties })),
  });
}

/** Report card for one Earth place: every target it resembles, best first. */
function reportCard(place, targetCount = TARGETS.length) {
  const targets = TARGETS.map((target) => {
    const breakdown = sampleBreakdown(target, place);
    const scores = Object.entries(PRESETS).map(([presetId, preset]) => [presetId, combineScore(breakdown, preset.weights)]);
    const [bestPreset, bestScore] = scores.sort((a, b) => b[1] - a[1])[0];
    return {
      target_id: target.target_id,
      body: target.body,
      score: round(bestScore, 1),
      breakdown,
      best_preset: bestPreset,
      good_for: GOOD_FOR[place.env_type].slice(0, 2 + Math.floor(random() * 2)),
      cant_reproduce: REALITY_GAP[target.body].slice(0, 3),
    };
  }).sort((a, b) => b.score - a.score).slice(0, targetCount);
  const factors = Object.fromEntries(FACTORS.map((factor) => [factor, round(0.3 + random() * 0.7, 2)]));
  return { site: { name: place.name, lat: place.lat, lon: place.lon, env_type: place.env_type, tags: TAGS_BY_ENVIRONMENT[place.env_type], factors }, targets };
}

function scorePlacesFor(target) {
  return EARTH_PLACES.map((place) => ({ place, breakdown: sampleBreakdown(target, place) }));
}

/** Plausible-looking factor scores: higher when the place's environment suits the target's body and track. */
function sampleBreakdown(target, place) {
  const affinity = {
    moon: { polar: 0.78, volcanic: 0.74, arid: 0.6, desert: 0.55 },
    mars: { desert: 0.78, arid: 0.76, polar: 0.66, volcanic: 0.62 },
  }[target.body][place.env_type];
  const caveBoost = target.track === "cave" && place.env_type === "volcanic" ? 0.12 : 0;
  return Object.fromEntries(FACTORS.map((factor) => {
    const value = affinity + caveBoost + (random() - 0.5) * 0.36;
    return [factor, round(Math.min(0.99, Math.max(0.12, value)), 2)];
  }));
}

function whyPhrases(breakdown) {
  return FACTORS.filter((factor) => breakdown[factor] !== null).sort((a, b) => breakdown[b] - breakdown[a]).slice(0, 3).map((factor) => WHY_PHRASES[factor]);
}

function kmToNearestKnownAnalog(place) {
  return Math.min(...KNOWN_ANALOGS.map((known) => haversineKm(place, known)));
}

function haversineKm(a, b) {
  const toRadians = (degrees) => (degrees * Math.PI) / 180;
  const dLat = toRadians(b.lat - a.lat);
  const dLon = toRadians(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRadians(a.lat)) * Math.cos(toRadians(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

/** One Moon or Mars Trek tile (about 20 km across) containing the target. */
function trekImageUrl({ body, lat, lon }) {
  const layer = body === "mars"
    ? { path: "Mars/EQ/THEMIS_DayIR_ControlledMosaics_100m_v2_oct2018", zoom: 9, extension: "png" }
    : { path: "Moon/EQ/LRO_WAC_Mosaic_Global_303ppd_v02", zoom: 8, extension: "jpg" };
  const tileDegrees = 180 / 2 ** layer.zoom;
  const row = Math.floor((90 - lat) / tileDegrees);
  const column = Math.floor((lon + 180) / tileDegrees);
  return `https://trek.nasa.gov/tiles/${layer.path}/1.0.0/default/default028mm/${layer.zoom}/${row}/${column}.${layer.extension}`;
}

function round(value, places) {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
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

function writeJson(relativePath, value) {
  writeText(relativePath, JSON.stringify(value) + "\n");
}

function writeText(relativePath, text) {
  const path = join(DATA_DIR, relativePath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

// Role 3's model_check.md (placeholder).
writeText("model_check.md", `# Model check (sample)

The score has no learned model: every factor is a measured value compared with a tolerance.

- Known analog pairs rank in the top 5% of Earth's land in the sample run.

Role 3 replaces this file with the real run.
`);
