// The only place the site reads data. Every file comes from public/data/, so swapping Role 2's sample files for the
// real ones needs no code change. Paths are built from Vite's BASE_URL so they also work under /<repo>/ on GitHub Pages.

const DATA_ROOT = `${import.meta.env.BASE_URL}data/`;

const responseCache = new Map();
const sampleFlagListeners = new Set();
let isShowingSampleData = false;

/** Named Earth, Moon and Mars sites (the globes' shortcut buttons), each with its body, from tiles/<body>_meta.json. */
export function loadTargets() {
  const earthSites = fetchJson("tiles/earth_meta.json").then((meta) => (meta.sites ?? []).map((site) => ({ ...site, body: "earth" })));
  const otherSites = ["moon", "mars"].map((body) => loadBodyMeta(body).then((meta) => (meta.sites ?? []).map((site) => ({ ...site, body }))));
  return Promise.all([earthSites, ...otherSites])
    .then((siteLists) => siteLists.flat());
}

/** Mission presets from Role 2's weights.json, the only source of weights: { factors, default_preset, presets }. */
export function loadWeights() {
  return fetchJson("weights.json");
}

/** Field layout of every tile vector (vectors/schema.json). */
export function loadVectorSchema() {
  return fetchJson("vectors/schema.json");
}

/** All Moon tile vectors, or one Mars base-cell shard (Mars is split into 12 files). */
export function loadBodyVectors(body, shard = null) {
  return fetchBinary(body === "mars" ? `vectors/mars_${shard}.bin` : "vectors/moon.bin");
}

/** Earth tile vectors plus their metadata (tile index, novelty, tags, name) and the lists the metadata points into. */
export function loadEarthTiles() {
  return Promise.all([fetchBinary("vectors/earth.bin"), fetchBinary("earth_meta.bin"), fetchJson("tiles/earth_meta.json")])
    .then(([vectors, meta, lists]) => ({ vectors, meta, lists }));
}

/** Role 2's wording and thresholds for the plain reasons on result cards; null until Role 2 ships the file. */
export function loadWhyRules() {
  return fetchJson("why_rules.json", { isOptional: true }).then((file) => file?.rules ?? file);
}

/** Role 2's precomputed results for the demo's showcase clicks, used only if the live search fails. */
export function loadShowcase() {
  return fetchJson("showcase.json", { isOptional: true });
}

/** A body's named tiles and reality gap (tiles/<body>_meta.json). */
export function loadBodyMeta(body) {
  return fetchJson(`tiles/${body}_meta.json`);
}

/**
 * A shortlist of 30 Earth candidates per Moon/Mars tile with their seven factor scores (Role 2's pools/), used when the
 * live search fails or is slow. Files are split by HEALPix parent cell at nside 8: pools/<body>_<parent index>.json,
 * holding { tiles: { "<tile index>": [[<Earth tile index>, s1 … s7 (null = missing)], …] } }.
 */
export function loadPool(body, parentIndex) {
  return fetchJson(`pools/${body}_${parentIndex}.json`, { isOptional: true });
}

/** Exact report cards for the famous analog sites (Atacama, Haughton Crater, Death Valley…). */
export function loadFamousSites() {
  return fetchJson("characterize/sites.json").then((file) => file.sites);
}

/**
 * One 10° tile of the 0.5° Earth grid, named by its south-west corner (e.g. "30_-120").
 * Returns an empty object for tiles that do not exist: those are all ocean or ice sheet, which are not scored.
 */
export function loadGridTile(tileName) {
  return fetchJson(`characterize/grid/${tileName}.json`, { isOptional: true }).then((file) => file?.cells ?? {});
}

export function loadDiscoveries() {
  return fetchJson("discoveries.json").then((file) => file.discoveries);
}

/** Role 3's model check (plain Markdown text), or null until Role 3 ships it. */
export function loadModelCheck() {
  return fetch(`${DATA_ROOT}model_check.md`).then((response) => (response.ok ? response.text() : null)).catch(() => null);
}

export function loadValidation() {
  return fetchJson("validation.json");
}

/** Public URL of a data file, for download links (discoveries.csv, discoveries.geojson). */
export function dataFileUrl(fileName) {
  return `${DATA_ROOT}${fileName}`;
}

/** Lets the footer show a "sample data" note while any loaded file still carries Role 2's `sample: true` flag. */
export function subscribeToSampleFlag(listener) {
  sampleFlagListeners.add(listener);
  return () => sampleFlagListeners.delete(listener);
}

export function getIsShowingSampleData() {
  return isShowingSampleData;
}

function fetchJson(path, { isOptional = false } = {}) {
  if (!responseCache.has(path)) {
    const request = fetch(`${DATA_ROOT}${path}`).then(async (response) => {
      if (response.status === 404 && isOptional) return null;
      if (!response.ok) throw new Error(`Could not load ${path} (HTTP ${response.status}).`);
      const file = await response.json();
      if (file?.sample) markSampleData();
      return file;
    });
    // Forget failed requests so a retry after a network blip fetches again.
    request.catch(() => responseCache.delete(path));
    responseCache.set(path, request);
  }
  return responseCache.get(path);
}

// Binary vector files are cached like JSON ones; a missing file is an error (every body must have its vectors).
function fetchBinary(path) {
  if (!responseCache.has(path)) {
    const request = fetch(`${DATA_ROOT}${path}`).then(async (response) => {
      if (!response.ok) throw new Error(`Could not load ${path} (HTTP ${response.status}).`);
      return new Uint8Array(await response.arrayBuffer());
    });
    request.catch(() => responseCache.delete(path));
    responseCache.set(path, request);
  }
  return responseCache.get(path);
}

function markSampleData() {
  if (isShowingSampleData) return;
  isShowingSampleData = true;
  sampleFlagListeners.forEach((listener) => listener());
}
