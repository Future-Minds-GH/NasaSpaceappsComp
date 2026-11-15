// Checks the Discover data files and the famous-site cards written by scripts/make-discoveries.mjs and make-characterize.mjs
// (read only, Node only). Other Characterize spots are scored live in the browser, so there is no grid to check.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { FACTORS } from "../src/data/scoring.js";

const here = (path) => fileURLToPath(new URL(path, import.meta.url));
const json = (path) => JSON.parse(readFileSync(here(path), "utf8"));
const DATA = "../public/data/";
const MAX_CHARACTERIZE_BYTES = 3 * 1024 * 1024;

const discoveriesFile = json(`${DATA}discoveries.json`);
const sitesFile = json(`${DATA}characterize/sites.json`);
const known = json("../../known_analogs.json");
const earthSites = known.sites.filter((site) => site.body === "earth" && site.role === "site");
// The targets are the sites of the Moon and Mars meta files: the ids the pages use to show names.
const targetIds = new Set(["moon", "mars"].flatMap((body) => json(`${DATA}tiles/${body}_meta.json`).sites.map((site) => site.target_id)));

const kmBetween = (latA, lonA, latB, lonB) => {
  const radians = (degrees) => (degrees * Math.PI) / 180;
  const h = Math.sin(radians(latB - latA) / 2) ** 2 + Math.cos(radians(latA)) * Math.cos(radians(latB)) * Math.sin(radians(lonB - lonA) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
};
const isScore = (value) => typeof value === "number" && value >= 0 && value <= 100;
const hasNineFactors = (breakdown) => (
  JSON.stringify(Object.keys(breakdown)) === JSON.stringify(FACTORS)
  && FACTORS.every((factor) => breakdown[factor] === null || (breakdown[factor] >= 0 && breakdown[factor] <= 1))
);

test("every Discover and famous-site file says sample: false", () => {
  assert.equal(discoveriesFile.sample, false);
  assert.equal(sitesFile.sample, false);
  assert.equal(JSON.parse(readFileSync(here(`${DATA}discoveries.geojson`), "utf8")).type, "FeatureCollection");
});

test("discoveries: shape, scores 0-100, nine factors, ranked, known targets", () => {
  const { discoveries } = discoveriesFile;
  assert.equal(discoveriesFile.weights_used, "balanced");
  assert.ok(discoveries.length >= 20, `only ${discoveries.length} discoveries`);
  discoveries.forEach((item, index) => {
    assert.equal(item.rank, index + 1);
    assert.ok(typeof item.name === "string" && item.name.length > 0 && !item.name.includes("undefined"), item.name);
    assert.ok(Number.isFinite(item.lat) && Number.isFinite(item.lon));
    assert.ok(["moon", "mars"].includes(item.body));
    assert.ok(targetIds.has(item.best_target_id), item.best_target_id);
    assert.ok(isScore(item.score), `score ${item.score}`);
    assert.ok(index === 0 || discoveries[index - 1].score >= item.score, "ranked by score");
    assert.ok(hasNineFactors(item.breakdown), JSON.stringify(item.breakdown));
    assert.ok(Array.isArray(item.tags) && Array.isArray(item.why) && item.cant_reproduce.length > 0);
  });
});

test("discoveries are more than 300 km from every known Earth analog, by distance and by the km field", () => {
  for (const item of discoveriesFile.discoveries) {
    assert.ok(item.km_to_nearest_known_analog > 300, `${item.name}: ${item.km_to_nearest_known_analog} km`);
    for (const site of earthSites) assert.ok(kmBetween(site.lat, site.lon, item.lat, item.lon) > 300, `${item.name} is near ${site.name}`);
  }
});

test("discovery files agree: the CSV and the GeoJSON hold the same rows", () => {
  const { discoveries } = discoveriesFile;
  const csvLines = readFileSync(here(`${DATA}discoveries.csv`), "utf8").trim().split("\n");
  assert.equal(csvLines.length, discoveries.length + 1);
  assert.deepEqual(csvLines[0].split(","), ["rank", "name", "lat", "lon", "env_type", "tags", "body", "best_target_id", "score", "km_to_nearest_known_analog", ...FACTORS]);
  const features = json(`${DATA}discoveries.geojson`).features;
  assert.equal(features.length, discoveries.length);
  features.forEach((feature, index) => {
    assert.deepEqual(feature.geometry.coordinates, [discoveries[index].lon, discoveries[index].lat]);
    assert.equal(feature.properties.score, discoveries[index].score);
  });
});

test("characterize sites: the known Earth analogs, each scored against every target with nine factors", () => {
  assert.deepEqual(sitesFile.sites.map((entry) => entry.site_id), earthSites.map((site) => site.id));
  for (const entry of sitesFile.sites) {
    assert.ok(entry.site.name && Number.isFinite(entry.site.lat) && Number.isFinite(entry.site.lon));
    assert.ok(hasNineFactors(entry.site.factors), entry.site_id);
    assert.ok(Array.isArray(entry.site.tags));
    assert.ok(entry.targets.length >= 2 && new Set(entry.targets.map((target) => target.target_id)).size === entry.targets.length);
    for (const target of entry.targets) {
      assert.ok(targetIds.has(target.target_id) && ["moon", "mars"].includes(target.body));
      assert.ok(isScore(target.score), `${entry.site_id} ${target.target_id} ${target.score}`);
      assert.ok(hasNineFactors(target.breakdown));
      assert.equal(typeof target.best_preset, "string");
      assert.ok(Array.isArray(target.good_for) && target.cant_reproduce.length > 0);
    }
  }
});

test("characterize/ has no grid folder and stays small (live scoring replaced the grid)", () => {
  assert.equal(existsSync(here(`${DATA}characterize/grid`)), false);
  assert.ok(statSync(here(`${DATA}characterize/sites.json`)).size < MAX_CHARACTERIZE_BYTES);
});

test("every target of a card has a name in the meta files (no raw id shows)", () => {
  const named = new Set(["moon", "mars"].flatMap((body) => json(`${DATA}tiles/${body}_meta.json`).sites.filter((site) => site.name).map((site) => site.target_id)));
  for (const id of new Set([...discoveriesFile.discoveries.map((item) => item.best_target_id), ...sitesFile.sites.flatMap((entry) => entry.targets.map((target) => target.target_id))])) {
    assert.ok(named.has(id), id);
  }
});
