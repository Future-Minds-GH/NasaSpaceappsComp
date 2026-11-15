// decideEarthSnap: a scored pin uses its own tile; an unscored pin uses the nearest scored tile within EARTH_SNAP_KM;
// farther away there is no tile to search from, only the nearest one for the "use nearest" button.
import { test } from "node:test";
import assert from "node:assert/strict";
import { decideEarthSnap, noScoreNote, snapNote } from "../src/data/earthSnap.js";
import { EARTH_SNAP_KM, earthKmBetween } from "../src/data/characterizeReport.js";

// Three scored tiles on the equator: 0°, 1° (about 111 km east) and 20° east.
const lats = Float32Array.from([0, 0, 0]);
const lons = Float32Array.from([0, 1, 20]);

test("a scored pin uses its own tile at 0 km", () => {
  assert.deepEqual(decideEarthSnap(2, 5, 5, lats, lons), { row: 2, km: 0 });
});

test("an unscored pin within the limit snaps to the nearest tile with its distance", () => {
  const decision = decideEarthSnap(-1, 0, 2, lats, lons);   // 1° (about 111 km) east of tile 1
  assert.equal(decision.row, 1);
  assert.ok(Math.abs(decision.km - earthKmBetween(0, 2, 0, 1)) < 1e-6);
  assert.ok(decision.km <= EARTH_SNAP_KM);
});

test("an unscored pin beyond the limit gets no row and the nearest tile at any distance", () => {
  const decision = decideEarthSnap(-1, 0, 5, lats, lons);   // 4° (about 445 km) from tile 1
  assert.equal(decision.row, null);
  assert.equal(decision.nearest.row, 1);
  assert.ok(decision.nearest.km > EARTH_SNAP_KM);
});

test("a tile just inside the limit snaps, and an empty tile list gives no nearest", () => {
  const edge = decideEarthSnap(-1, 0, 0, Float32Array.from([0]), Float32Array.from([0.99 * EARTH_SNAP_KM / earthKmBetween(0, 0, 0, 1)]));
  assert.equal(edge.row, 0);
  assert.deepEqual(decideEarthSnap(-1, 0, 0, new Float32Array(0), new Float32Array(0)), { row: null, nearest: null });
});

test("the notes round the distance and make no claim about the cause", () => {
  assert.match(snapNote(87.6), /88 km away/);
  assert.match(noScoreNote(312.4), /312 km away/);
  assert.match(noScoreNote(1), /may be water, forest, farmland or a city/);
});
