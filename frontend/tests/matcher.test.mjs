// Matcher v0.3 rules on synthetic tiles built from data/schema.json (not from the sample files), so each rule is
// checked on its own: scalar tolerance, vector rule, temperature mean, arithmetic total, bands, relative mode, nulls.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { FACTORS, combineScore, isFalseFriend, scoreBand } from "../src/data/scoring.js";
import { NULL_CODE, assertWholeTiles, combineAll, readLayout, scoreAllEarthTiles } from "../src/data/similarity.js";
import { rankTopRows } from "../src/data/ranking.js";
import { FACTOR_LABELS } from "../src/content/labels.js";

const schema = JSON.parse(readFileSync(new URL("../../data/schema.json", import.meta.url), "utf8"));
const layout = readLayout(schema);
const index = (factor) => FACTORS.indexOf(factor);
// Bytes round values to 1/254 of the range, so decoded scores match the formula within a small step.
const close = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 0.05, `${message ?? ""} ${actual} vs ${expected}`);

/** A tile of null bytes with the given field bytes set (by schema field id). */
function tile(bytes = {}) {
  const row = new Uint8Array(layout.bytesPerTile).fill(NULL_CODE);
  for (const [id, byte] of Object.entries(bytes)) row[layout.fields[id].offset] = byte;
  return row;
}
const encode = (id, value) => {
  const field = layout.fields[id];
  return Math.round((field.kind === "value" ? (value - field.min) / (field.max - field.min) : value) * 254);
};
const score = (clicked, other, mode = "absolute") => scoreAllEarthTiles(clicked, other, layout, mode);

test("the tile width comes from the schema: 18 factor fields and 7 relative fields", () => {
  assert.equal(layout.bytesPerTile, 25);
  assert.throws(() => assertWholeTiles(new Uint8Array(26), layout), /multiple of 25/);
});

test("scalar rule: s = max(0, 1 - |a - b| / tol) on decoded values", () => {
  // Slope tolerance is 5 degrees: a 2 degree gap scores 0.6, a gap of 5 or more scores 0.
  const clicked = tile({ slope_deg: encode("slope_deg", 10) });
  const scores = score(clicked, Uint8Array.from([...tile({ slope_deg: encode("slope_deg", 12) }), ...tile({ slope_deg: encode("slope_deg", 20) })]));
  const step = 40 / 254; // one byte of slope, in degrees
  close(scores[index("slope")], 1 - (Math.abs(encode("slope_deg", 12) - encode("slope_deg", 10)) * step) / 5, "2 degree gap");
  assert.ok(Math.abs(scores[index("slope")] - 0.6) < 0.05);
  assert.equal(scores[layout.factors.length + index("slope")], 0);
});

test("temp is the mean of the day and night scores that are present", () => {
  const clicked = tile({ t_day_k: encode("t_day_k", 300), t_night_k: encode("t_night_k", 200) });
  const other = tile({ t_day_k: encode("t_day_k", 320), t_night_k: encode("t_night_k", 200) }); // day gap 20 of 40, night gap 0
  close(score(clicked, other)[index("temp")], (0.5 + 1) / 2, "both present");
  const dayOnly = tile({ t_day_k: encode("t_day_k", 320) });
  close(score(clicked, dayOnly)[index("temp")], 0.5, "only day present on one tile");
  const neither = tile({});
  assert.ok(Number.isNaN(score(clicked, neither)[index("temp")]));
});

test("vector rule: s = max(0, 1 - 0.5 x sum |p - q|), null if any component is null", () => {
  const set = (values) => Object.fromEntries(["surf_dust", "surf_sand", "surf_rock", "surf_ice"].map((id, position) => [id, encode(id, values[position])]));
  const clicked = tile(set([0.5, 0.5, 0, 0]));
  close(score(clicked, tile(set([0.5, 0.5, 0, 0])))[index("surface")], 1, "same");
  close(score(clicked, tile(set([0, 0.5, 0.5, 0])))[index("surface")], 0.5, "half moved");
  close(score(clicked, tile(set([0, 0, 0.5, 0.5])))[index("surface")], 0, "nothing shared");
  const incomplete = tile({ surf_dust: encode("surf_dust", 0.5), surf_sand: encode("surf_sand", 0.5), surf_rock: encode("surf_rock", 0) });
  assert.ok(Number.isNaN(score(clicked, incomplete)[index("surface")]), "null component on the other tile");
  assert.ok(Number.isNaN(score(incomplete, tile(set([0.5, 0.5, 0, 0])))[index("surface")]), "null component on the clicked tile");
});

test("total is the arithmetic weighted mean, and a null factor is left out", () => {
  const breakdown = { temp: 1, swing: 0.5, sun: null, slope: 0, rough: 0.8, elev: 0.2, surface: 1, minerals: 0.4, ice: 0.6 };
  const weights = { temp: 2, swing: 1, sun: 5, slope: 1, rough: 0, elev: 0, surface: 0, minerals: 0, ice: 0 };
  // sun is null (left out), rough has weight 0: (2 x 1 + 1 x 0.5 + 1 x 0) / (2 + 1 + 1) x 100
  close(combineScore(breakdown, weights), (100 * 2.5) / 4);
  assert.equal(combineScore({ ...breakdown, temp: null, swing: null, slope: null }, weights), 0);
  // The same rule in the fast path: tile 0 has a null factor, tile 1 has no factor at all.
  const scores = Float32Array.from([...FACTORS.map(() => 1), ...FACTORS.map(() => NaN)]);
  scores[index("sun")] = NaN;
  const totals = combineAll(scores, weights);
  close(totals[0], 100);
  assert.equal(totals[1], -1);
  const ranked = rankTopRows(totals, Float32Array.from([0, 40]), Float32Array.from([0, 0]));
  assert.deepEqual(ranked.map((pick) => pick.row), [0], "a tile with no factor is not a candidate");
});

test("bands: 90.0 is green, 60.0 is yellow, below is not", () => {
  assert.equal(scoreBand(90), "green");
  assert.equal(scoreBand(89.99), "yellow");
  assert.equal(scoreBand(60), "yellow");
  assert.equal(scoreBand(59.99), "red");
  assert.equal(scoreBand(0), "red");
});

test("relative mode scores the percentile bytes (tol 0.25); absolute mode scores the real units", () => {
  // Same real day temperature on both tiles, but their ranks within their own planets are 0.1 apart.
  const clicked = tile({ t_day_k: encode("t_day_k", 300), t_day_pct: encode("t_day_pct", 0.2) });
  const other = tile({ t_day_k: encode("t_day_k", 300), t_day_pct: encode("t_day_pct", 0.3) });
  close(score(clicked, other, "absolute")[index("temp")], 1, "absolute");
  close(score(clicked, other, "relative")[index("temp")], 1 - 0.1 / 0.25, "relative");
  // And the other way round: different real units, same rank.
  const warm = tile({ t_day_k: encode("t_day_k", 380), t_day_pct: encode("t_day_pct", 0.2) });
  assert.ok(score(clicked, warm, "absolute")[index("temp")] < 0.01);
  close(score(clicked, warm, "relative")[index("temp")], 1, "same rank");
  // elev_pct is the same in both modes (tol 0.25).
  const high = tile({ elev_pct: encode("elev_pct", 0.5) });
  const low = tile({ elev_pct: encode("elev_pct", 0.4) });
  for (const mode of ["absolute", "relative"]) close(score(high, low, mode)[index("elev")], 0.6, `elev in ${mode}`);
});

test("false friend: slope and rough both >= 0.7 while the heaviest other weighted factor is < 0.4", () => {
  const breakdown = { temp: 0.3, swing: 0.9, sun: null, slope: 0.7, rough: 0.8, elev: 0.5, surface: 0.9, minerals: 0.9, ice: 0.9 };
  assert.equal(isFalseFriend(breakdown, { temp: 5, swing: 1, slope: 1, rough: 1 }), true);
  assert.equal(isFalseFriend(breakdown, { temp: 1, swing: 5, slope: 1, rough: 1 }), false);
  assert.equal(isFalseFriend({ ...breakdown, rough: 0.69 }, { temp: 5 }), false);
  assert.equal(isFalseFriend(breakdown, { slope: 1, rough: 1 }), false, "no other weighted factor");
});

test("100k tiles score in well under a second, and a slider move is quick", () => {
  const tiles = 100_000;
  const bytes = new Uint8Array(tiles * layout.bytesPerTile);
  for (let position = 0; position < bytes.length; position++) bytes[position] = (position * 2654435761) % 255;
  const clicked = bytes.subarray(0, layout.bytesPerTile);
  for (const mode of ["absolute", "relative"]) {
    const started = performance.now();
    const scores = scoreAllEarthTiles(clicked, bytes, layout, mode);
    const scoringMs = performance.now() - started;
    assert.ok(scoringMs < 1000, `${mode} scoring took ${scoringMs} ms`);
    const recombined = performance.now();
    combineAll(scores, Object.fromEntries(FACTORS.map((factor) => [factor, 1])));
    assert.ok(performance.now() - recombined < 200);
  }
});

test("the factor labels in labels.js are the labels in data/schema.json", () => {
  assert.deepEqual(Object.keys(FACTOR_LABELS), schema.factors.map((factor) => factor.id));
  for (const factor of schema.factors) assert.equal(FACTOR_LABELS[factor.id], factor.label);
});
