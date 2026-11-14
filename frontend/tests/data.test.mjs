// Checks the browser-side scoring and grid maths against the rules in the role doc. Run with `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { combineScore, isNewAnalog, normaliseWeights, rescoreMatches, weakestFactor, FACTORS } from "../src/data/scoring.js";
import { cellKey, snapToCell, tileNameForCell } from "../src/data/earthGrid.js";

const allOnes = Object.fromEntries(FACTORS.map((factor) => [factor, 1]));

test("score is 100 × product of breakdown^weight", () => {
  const breakdown = { ...allOnes, terrain: 0.5 };
  const weights = { ...Object.fromEntries(FACTORS.map((factor) => [factor, 0])), terrain: 1 };
  assert.equal(combineScore(breakdown, weights), 50);
  const evenWeights = Object.fromEntries(FACTORS.map((factor) => [factor, 1 / 7]));
  assert.ok(Math.abs(combineScore(breakdown, evenWeights) - 100 * 0.5 ** (1 / 7)) < 1e-9);
});

test("weights are normalised, so doubling every slider changes nothing", () => {
  const breakdown = { terrain: 0.9, elevation: 0.4, geology: 0.7, mineralogy: 0.6, climate: 0.8, weather: 0.5, water_ice: 0.3 };
  const weights = { terrain: 2, elevation: 1, geology: 1, mineralogy: 1, climate: 3, weather: 1, water_ice: 1 };
  const doubled = Object.fromEntries(Object.entries(weights).map(([factor, weight]) => [factor, weight * 2]));
  assert.ok(Math.abs(combineScore(breakdown, weights) - combineScore(breakdown, doubled)) < 1e-9);
  const allZero = Object.fromEntries(FACTORS.map((factor) => [factor, 0]));
  assert.ok(Math.abs(Object.values(normaliseWeights(allZero)).reduce((a, b) => a + b) - 1) < 1e-9);
});

test("rescoring re-ranks without mutating the input", () => {
  const matches = [
    { name: "A", rank: 1, score: 90, breakdown: { ...allOnes, water_ice: 0.2 } },
    { name: "B", rank: 2, score: 80, breakdown: { ...allOnes, terrain: 0.2 } },
  ];
  const iceOnly = { ...Object.fromEntries(FACTORS.map((factor) => [factor, 0])), water_ice: 1 };
  const rescored = rescoreMatches(matches, iceOnly);
  assert.deepEqual(rescored.map((match) => match.name), ["B", "A"]);
  assert.equal(rescored[0].rank, 1);
  assert.equal(matches[0].score, 90);
});

test("badges and weakest factor", () => {
  assert.equal(isNewAnalog({ km_to_nearest_known_analog: 301 }), true);
  assert.equal(isNewAnalog({ km_to_nearest_known_analog: 300 }), false);
  assert.equal(weakestFactor({ ...allOnes, climate: 0.1 }), "climate");
});

test("clicks snap to 0.5° cells and 10° tiles named by their south-west corner", () => {
  const cell = snapToCell(36.3, -116.8);
  assert.deepEqual([cell.lat, cell.lon], [36.25, -116.75]);
  assert.equal(tileNameForCell(cell), "30_-120");
  assert.equal(cellKey(cell), "36.25_-116.75");
  const southern = snapToCell(-24.08, -69.92);
  assert.equal(tileNameForCell(southern), "-30_-70");
  assert.equal(cellKey(southern), "-24.25_-69.75");
  assert.equal(snapToCell(10, 190).lon, -169.75);
});

test("tile search: a Gale Crater click ranks Earth tiles with the plan's formula", async () => {
  const { readLayout, scoreAllEarthTiles, combineAll } = await import("../src/data/similarity.js");
  const { readEarthTiles, clickedTileVector, buildMatches } = await import("../src/data/tileSearch.js");
  const { rankTopRows } = await import("../src/data/ranking.js");
  const { FACTORS: factorList } = await import("../src/data/scoring.js");
  // The same steps the search worker runs: score every Earth tile, combine with the weights, pick the top 10.
  const search = (scores, weights) => {
    const totals = combineAll(scores, weights);
    const picks = rankTopRows(totals, Float32Array.from(earthTiles, (tile) => tile.lat), Float32Array.from(earthTiles, (tile) => tile.lon))
      .map((pick) => ({ ...pick, factorScores: Array.from(scores.subarray(pick.row * factorList.length, (pick.row + 1) * factorList.length)) }));
    return buildMatches(picks, { tiles: earthTiles, weights, nside: 256 });
  };
  const { latLonToTile, baseCellOf } = await import("../src/data/healpix.js");
  const bytes = (path) => new Uint8Array(readFileSync(new URL(`../public/data/${path}`, import.meta.url)));
  const json = (path) => JSON.parse(readFileSync(new URL(`../public/data/${path}`, import.meta.url)));
  const schema = json("vectors/schema.json");
  const layout = readLayout(schema);
  assert.equal(layout.bytesPerTile, 34);
  const earthTiles = readEarthTiles({ meta: bytes("earth_meta.bin"), lists: json("tiles/earth_meta.json") }, schema.nside.earth);
  const earthVectors = bytes("vectors/earth.bin");
  assert.equal(earthTiles.length * 34, earthVectors.length);

  const gale = latLonToTile(128, -5.4, 137.8);
  const shard = bytes(`vectors/mars_${baseCellOf(128, gale)}.bin`);
  const clicked = clickedTileVector("mars", 128, gale, shard, 34);
  const started = performance.now();
  const scores = scoreAllEarthTiles(clicked, earthVectors, layout);
  const weights = json("weights.json").presets.balanced.weights;
  const matches = search(scores, weights);
  const elapsedMs = performance.now() - started;
  assert.equal(matches.length, 10);
  assert.ok(matches.every((match, index) => index === 0 || match.score <= matches[index - 1].score));
  assert.ok(matches[0].earth_rank_pct > 99, String(matches[0].earth_rank_pct));
  assert.ok(Object.values(matches[0].breakdown).every((value) => value === null || (value >= 0 && value <= 1)));
  assert.ok(elapsedMs < 1000, `search took ${elapsedMs} ms`);

  // The Moon has no atmosphere: that factor is missing (null), never zero.
  const moon = bytes("vectors/moon.bin");
  const moonClick = clickedTileVector("moon", 64, latLonToTile(64, -89.45, -136), moon, 34);
  const moonScores = scoreAllEarthTiles(moonClick, earthVectors, layout);
  const moonMatches = search(moonScores, weights);
  assert.equal(moonMatches[0].breakdown.atmosphere, null);
  assert.ok(moonMatches[0].score > 0);
});

test("plan v2.1 scoring: factors floor at 0.05, missing factors drop out and weights renormalise", () => {
  const weights = { terrain: 0.5, elevation: 0, geology: 0, mineralogy: 0, climate: 0, atmosphere: 0.5, water_ice: 0 };
  assert.ok(Math.abs(combineScore({ ...allOnes, atmosphere: null, terrain: 0.64 }, weights) - 64) < 1e-9);
  assert.ok(Math.abs(combineScore({ ...allOnes, terrain: 0 }, { ...weights, atmosphere: 0 }) - 5) < 1e-9);
});

test("HEALPix nested: round trip and healpy's layout at nside 2", async () => {
  const { latLonToTile, tileCenter, tileCount } = await import("../src/data/healpix.js");
  for (const nside of [64, 128, 256]) {
    for (let index = 0; index < tileCount(nside); index += 997) {
      const { lat, lon } = tileCenter(nside, index);
      assert.equal(latLonToTile(nside, lat, lon), index);
    }
  }
  // healpy.pix2ang(2, [0, 1, 2, 3], nest=True, lonlat=True)
  const expected = [[45, 19.47], [67.5, 41.81], [22.5, 41.81], [45, 66.44]];
  expected.forEach(([lon, lat], index) => {
    const center = tileCenter(2, index);
    assert.ok(Math.abs(center.lat - lat) < 0.01 && Math.abs(center.lon - lon) < 0.01, JSON.stringify(center));
  });
});

test("similarity.js matches similarity.py on every pair in test_pairs.json (within the file's tolerance)", async () => {
  const { readLayout: layoutOf, scoreAllEarthTiles: scoreAll, combineAll: combine } = await import("../src/data/similarity.js");
  const { readEarthTiles: earthTilesOf, clickedTileVector: vectorOf } = await import("../src/data/tileSearch.js");
  const { baseCellOf } = await import("../src/data/healpix.js");
  const file = (path) => readFileSync(new URL(`../public/data/${path}`, import.meta.url));
  const testPairs = JSON.parse(file("test_pairs.json"));
  const schema = JSON.parse(file("vectors/schema.json"));
  const layout = layoutOf(schema);
  const presets = JSON.parse(file("weights.json")).presets;
  const earthTiles = earthTilesOf({ meta: new Uint8Array(file("earth_meta.bin")), lists: JSON.parse(file("tiles/earth_meta.json")) }, schema.nside.earth);
  const earthRowByIndex = new Map(earthTiles.map((tile, row) => [tile.index, row]));
  const earthVectors = new Uint8Array(file("vectors/earth.bin"));
  const scoresByTile = new Map();
  for (const pair of testPairs.pairs) {
    const [body, nside, index] = pair.a.split("_").map((part, position) => (position ? Number(part) : part));
    if (!scoresByTile.has(pair.a)) {
      const bytes = new Uint8Array(file(body === "mars" ? `vectors/mars_${baseCellOf(nside, index)}.bin` : "vectors/moon.bin"));
      scoresByTile.set(pair.a, scoreAll(vectorOf(body, nside, index, bytes, layout.bytesPerTile), earthVectors, layout));
    }
    const row = earthRowByIndex.get(Number(pair.b.split("_")[2]));
    const total = combine(scoresByTile.get(pair.a), pair.weights ?? presets[pair.preset].weights)[row];
    assert.ok(Math.abs(total - pair.total) <= (testPairs.tolerance ?? 0.1), `${pair.a} vs ${pair.b} (${pair.preset}): ${total} vs ${pair.total}`);
  }
  assert.ok(testPairs.pairs.length >= 20);
});

test("sliders always sum to 1: moving one rescales the rest in proportion", async () => {
  const { rebalanceWeights } = await import("../src/data/scoring.js");
  const start = { terrain: 0.4, elevation: 0.1, geology: 0.1, mineralogy: 0.1, climate: 0.1, atmosphere: 0.1, water_ice: 0.1 };
  const next = rebalanceWeights(start, "terrain", 0.7);
  assert.ok(Math.abs(Object.values(next).reduce((a, b) => a + b) - 1) < 1e-9);
  assert.ok(Math.abs(next.elevation - 0.05) < 1e-9);
  const allElse = rebalanceWeights({ ...Object.fromEntries(FACTORS.map((factor) => [factor, 0])), terrain: 1 }, "terrain", 0.4);
  assert.ok(Math.abs(allElse.climate - 0.1) < 1e-9);
});

test("pool fallback: a Moon/Mars tile's shortlist is re-scored with the current weights and flagged approximate", async () => {
  const { readEarthTiles, buildPoolMatches } = await import("../src/data/tileSearch.js");
  const { latLonToTile } = await import("../src/data/healpix.js");
  const file = (path) => readFileSync(new URL(`../public/data/${path}`, import.meta.url));
  const schema = JSON.parse(file("vectors/schema.json"));
  const earthTiles = readEarthTiles({ meta: new Uint8Array(file("earth_meta.bin")), lists: JSON.parse(file("tiles/earth_meta.json")) }, schema.nside.earth);
  const rowByIndex = new Map(earthTiles.map((tile, row) => [tile.index, row]));
  const gale = latLonToTile(128, -5.4, 137.8);
  const parent = Math.floor(gale / (128 / 8) ** 2);
  const pool = JSON.parse(file(`pools/mars_${parent}.json`));
  const presets = JSON.parse(file("weights.json")).presets;
  const options = { earthTiles, rowByIndex, earthNside: 256 };
  const balanced = buildPoolMatches(pool, gale, { ...options, weights: presets.balanced.weights });
  const landing = buildPoolMatches(pool, gale, { ...options, weights: presets.landing.weights });
  assert.equal(balanced.length, 10);
  assert.ok(balanced.every((match, index) => index === 0 || match.score <= balanced[index - 1].score));
  assert.ok(balanced.every((match) => match.earth_rank_pct === null && match.body === "earth"));
  assert.notDeepEqual(balanced.map((match) => match.score), landing.map((match) => match.score));
  assert.ok(earthTiles.some((tile) => tile.minEstimated) && earthTiles.some((tile) => !tile.minEstimated));
});
