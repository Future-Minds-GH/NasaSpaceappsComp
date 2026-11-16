// Shared by make-discoveries.mjs and make-characterize.mjs: loads the real vectors, scores every Moon/Mars target
// against every Earth tile with the app's own code (similarity.js, absolute mode) and combines each preset.
// Targets are the Moon and Mars sites of tiles/moon_meta.json and tiles/mars_meta.json, with the ids the pages use
// to show their names (the same list the live Characterize page scores against).
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { baseCellOf, latLonToTile } from '../src/data/healpix.js';
import { combineAll, readLayout, scoreAllEarthTiles } from '../src/data/similarity.js';
import { distanceKm } from '../src/data/ranking.js';
import { clickedTileVector, readEarthTiles, tileCentres } from '../src/data/tileSearch.js';

const HERE = dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = join(HERE, '..', 'public', 'data');
export const NEW_MIN_KM = 300;   // scoring.js isNewAnalog

const read = (path) => readFileSync(join(DATA_DIR, path));
const json = (path) => JSON.parse(read(path));

export const round = (value, decimals) => (value === null || value === undefined || Number.isNaN(value) ? null : Math.round(value * 10 ** decimals) / 10 ** decimals);

export function loadSiteData() {
  const known = JSON.parse(readFileSync(join(HERE, '..', '..', 'known_analogs.json'), 'utf8'));
  const schema = json('vectors/schema.json');
  const layout = readLayout(schema);
  const weightsFile = json('weights.json');
  const presets = weightsFile.presets;
  const earthLists = json('tiles/earth_meta.json');
  const bodyMeta = { moon: json('tiles/moon_meta.json'), mars: json('tiles/mars_meta.json') };
  const earthTiles = readEarthTiles({ meta: new Uint8Array(read('earth_meta.bin')), lists: earthLists }, schema.nside.earth);
  const earthVectors = new Uint8Array(read('vectors/earth.bin'));
  const rowByIndex = new Map(earthTiles.map((tile, row) => [tile.index, row]));
  const { lats, lons } = tileCentres(earthTiles);
  const isSample = [weightsFile, earthLists, bodyMeta.moon, bodyMeta.mars].some((file) => file.sample !== false);

  /** A Moon or Mars site's tile bytes. Throws when the tile has no data. */
  const targetVector = (site) => {
    const nside = schema.nside[site.body];
    const index = latLonToTile(nside, site.lat, site.lon);
    const bytes = read(site.body === 'mars' ? `vectors/mars_${baseCellOf(nside, index)}.bin` : 'vectors/moon.bin');
    const vector = clickedTileVector(site.body, nside, index, new Uint8Array(bytes), layout.bytesPerTile);
    if (!vector) throw new Error(`${site.name} has no data in its tile.`);
    return vector;
  };

  const earthSites = known.sites.filter((site) => site.body === 'earth' && site.role === 'site');
  const targets = Object.values(bodyMeta).flatMap((meta) => meta.sites.map((site) => {
    const scores = scoreAllEarthTiles(targetVector({ ...site, body: meta.body }), earthVectors, layout, 'absolute');
    const totals = Object.fromEntries(Object.entries(presets).map(([id, preset]) => [id, combineAll(scores, preset.weights)]));
    return { id: site.target_id, name: site.name, body: meta.body, scores, totals, cantReproduce: site.reality_gap ?? meta.reality_gap };
  }));

  // The app's NEW rule: more than 300 km from every known Earth analog (the meta km field), checked again by distance.
  const isNew = Uint8Array.from(earthTiles, (tile, row) => (
    tile.noveltyKm > NEW_MIN_KM && earthSites.every((site) => distanceKm(site.lat, site.lon, lats[row], lons[row]) > NEW_MIN_KM) ? 1 : 0
  ));

  return { known, schema, layout, weightsFile, presets, earthSites, earthTiles, earthVectors, rowByIndex, lats, lons, targets, isNew, isSample };
}
