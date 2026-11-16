// Tests for the ponytail-optimizations branch: the ?preset= lookup, the shared Earth-tile parse and the one haversine helper.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pickPresetId } from "../src/data/exploreSelection.js";
import { readEarthTiles } from "../src/data/tileSearch.js";
import { BODY_RADIUS_KM, distanceKm, kthLargest, rankTopRows } from "../src/data/ranking.js";
import { nearestTileRow } from "../src/data/characterizeReport.js";
import { latLonToTile, tileCenter } from "../src/data/healpix.js";

const DATA = new URL("../public/data/", import.meta.url);
const presets = { balanced: { weights: {} }, landing: { weights: {} } };

test("pickPresetId keeps a real preset from the URL", () => {
  assert.equal(pickPresetId(presets, "landing", "balanced"), "landing");
});

test("pickPresetId falls back to the default for names that only live on Object.prototype", () => {
  for (const name of ["toString", "constructor", "__proto__", "hasOwnProperty", "valueOf"]) {
    assert.equal(pickPresetId(presets, name, "balanced"), "balanced", name);
  }
});

test("pickPresetId falls back for a missing or unknown preset, and to the first preset with no default", () => {
  assert.equal(pickPresetId(presets, null, "balanced"), "balanced");
  assert.equal(pickPresetId(presets, "", "balanced"), "balanced");
  assert.equal(pickPresetId(presets, "nope", undefined), "balanced");
  assert.equal(pickPresetId({}, "toString", undefined), undefined);   // presets still loading: no preset yet
});

test("readEarthTiles parses each meta file once and returns the same tiles to every caller", () => {
  const schema = JSON.parse(readFileSync(new URL("vectors/schema.json", DATA)));
  const lists = JSON.parse(readFileSync(new URL("tiles/earth_meta.json", DATA)));
  const meta = new Uint8Array(readFileSync(new URL("earth_meta.bin", DATA)));
  const first = readEarthTiles({ meta, lists }, schema.nside.earth);
  assert.equal(first.length, meta.byteLength / 12);
  assert.equal(readEarthTiles({ meta, lists, vectors: null }, schema.nside.earth), first, "same bytes: cached tiles");
  // A copy of the bytes is a different file object: parsed afresh, with equal content.
  const fresh = readEarthTiles({ meta: meta.slice(), lists }, schema.nside.earth);
  assert.notEqual(fresh, first);
  assert.deepEqual(fresh, first);
  // A different nside or lists object must never get the cached tiles.
  assert.notEqual(readEarthTiles({ meta, lists }, schema.nside.earth / 2), first);
  assert.notEqual(readEarthTiles({ meta, lists: { ...lists } }, schema.nside.earth), first);
});

test("distanceKm: known great-circle distances on Earth and other bodies", () => {
  const oneDegreeKm = (Math.PI / 180) * BODY_RADIUS_KM.earth;
  assert.equal(distanceKm(10, 20, 10, 20), 0);
  assert.ok(Math.abs(distanceKm(0, 0, 0, 1) - oneDegreeKm) < 1e-9, "Earth is the default radius");
  assert.ok(Math.abs(distanceKm(0, 0, 1, 0) - oneDegreeKm) < 1e-9);
  assert.ok(Math.abs(distanceKm(0, 0, 0, 180) - Math.PI * BODY_RADIUS_KM.earth) < 1e-6, "antipodes: half the circumference");
  assert.ok(Math.abs(distanceKm(90, 0, -90, 0, BODY_RADIUS_KM.moon) - Math.PI * BODY_RADIUS_KM.moon) < 1e-6);
  assert.ok(Math.abs(distanceKm(0, 179.5, 0, -179.5) - oneDegreeKm) < 1e-6, "across the date line");
  assert.ok(Math.abs(distanceKm(12, 34, -56, 78, 3389.5) - distanceKm(-56, 78, 12, 34, 3389.5)) < 1e-9, "symmetric");
});

test("nearestTileRow (now on distanceKm) keeps its limit and picks the closest row", () => {
  const lats = Float32Array.from([0, 0, 0]);
  const lons = Float32Array.from([0, 1, 3]);
  assert.deepEqual(nearestTileRow(0, 0.9, lats, lons, 200).row, 1);
  assert.equal(nearestTileRow(0, 10, lats, lons, 200), null);
});

test("rankTopRows still keeps picks apart by the body radius it is given", () => {
  // Earth: 1° is ~111 km (under the 250 km gap, dropped), 10° is ~1,112 km (kept).
  const totals = Float32Array.from([99, 98, 97]);
  const lats = Float32Array.from([0, 0, 0]);
  const lons = Float32Array.from([0, 1, 10]);
  assert.deepEqual(rankTopRows(totals, lats, lons, { count: 3 }).map((pick) => pick.row), [0, 2]);
  // Moon: 1° is ~30 km and 5° ~152 km, both under 250 km, so only the best tile stays.
  const moonLons = Float32Array.from([0, 1, 5]);
  assert.deepEqual(rankTopRows(totals, lats, moonLons, { count: 3, radiusKm: BODY_RADIUS_KM.moon }).map((pick) => pick.row), [0]);
});

test("the h3-js stub exports every name three-globe imports, and each one throws if a hex layer ever calls it", async () => {
  const source = readFileSync(new URL("../node_modules/three-globe/dist/three-globe.mjs", import.meta.url), "utf8");
  const names = source.match(/import \{([^}]*)\} from ['"]h3-js['"]/)[1].split(",").map((name) => name.trim()).filter(Boolean);
  const stub = await import("../src/h3-stub.js");
  assert.ok(names.length > 0);
  for (const name of names) {
    assert.equal(typeof stub[name], "function", name);
    assert.throws(() => stub[name](0, 0, 0), /stubbed out/);
  }
});

test("HEALPix bit interleaving round-trips up to nside 2^15, including the last tile of every face", () => {
  const nside = 2 ** 15;
  for (let face = 0; face < 12; face++) {
    for (const offset of [0, 1, 2 ** 29, nside * nside - 1]) {
      const index = face * nside * nside + offset;
      const { lat, lon } = tileCenter(nside, index);
      assert.equal(latLonToTile(nside, lat, lon), index);
    }
  }
});

test("kthLargest (the median fill's quickselect) picks the same value as a full sort, duplicates included", () => {
  let seed = 7;
  const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let trial = 0; trial < 500; trial++) {
    const values = Float32Array.from({ length: 1 + Math.floor(random() * 300) }, () => Math.floor(random() * 8) / 8);
    const sorted = values.slice().sort();
    const k = 1 + Math.floor(random() * values.length);
    assert.equal(kthLargest(values, k), sorted[values.length - k]);
  }
});
