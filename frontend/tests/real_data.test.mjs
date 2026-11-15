// Extra v0.3 checks: Python and JS byte agreement, and rules on the REAL files (read only, never rewritten).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { FACTORS } from "../src/data/scoring.js";
import { NULL_CODE, combineAll, decodeByte, readLayout, scoreAllEarthTiles } from "../src/data/similarity.js";
import { rankTopRows } from "../src/data/ranking.js";

const here = (path) => fileURLToPath(new URL(path, import.meta.url));
const schema = JSON.parse(readFileSync(here("../../data/schema.json"), "utf8"));
const layout = readLayout(schema);
const earth = new Uint8Array(readFileSync(here("../public/data/vectors/earth.bin")));
const stride = layout.bytesPerTile;
const tiles = earth.length / stride;
const idx = (factor) => FACTORS.indexOf(factor);

// Needs Python with numpy (the export's own encoder). The GitHub Pages build has Node only, so it skips there.
test("JS decode of a byte equals the Python encoding's source value within half a step", (t) => {
  const values = [0, 0.001, 0.25, 0.3333, 0.5, 0.7071, 0.99, 1];
  const script = `
import json, sys
sys.path.insert(0, ${JSON.stringify(here("../../src"))})
import numpy as np, build_vectors as bv
x = np.array(${JSON.stringify(values)})
print(json.dumps([int(b) for b in bv.to_byte(x)]))`;
  let out;
  try { out = execFileSync("python", ["-c", script], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }); } catch { return t.skip("Python with numpy is not available"); }
  const bytes = JSON.parse(out.trim().split("\n").pop());
  for (const field of Object.values(layout.fields)) {
    values.forEach((fraction, position) => {
      const source = field.kind === "value" ? field.min + fraction * (field.max - field.min) : fraction;
      const step = field.kind === "value" ? (field.max - field.min) / 254 : 1 / 254;
      const decoded = decodeByte(field, bytes[position]);
      assert.ok(Math.abs(decoded - source) <= step / 2 + 1e-9, `${field.id}: ${decoded} vs ${source}`);
    });
  }
  assert.equal(decodeByte(layout.fields[Object.keys(layout.fields)[0]], NULL_CODE), null);
});

test("test_pairs.json covers relative mode too (the Python vs JS totals check itself lives in data.test.mjs)", () => {
  const pairs = JSON.parse(readFileSync(here("../public/data/test_pairs.json"), "utf8"));
  assert.ok(pairs.tolerance <= 0.1 && pairs.pairs.length > 0);
  assert.equal(pairs.sample, false, "real data expected");
  // Which modes the stored pairs cover: a relative-mode gap would leave the relative path unchecked against Python.
  const modes = new Set(pairs.pairs.map((pair) => pair.mode));
  assert.ok(modes.has("relative"), `test_pairs.json only covers modes: ${[...modes]}`);
});

test("real data: every weight at zero gives no candidate; the ranking returns nothing", () => {
  const clicked = earth.subarray(1000 * stride, 1001 * stride);
  const scores = scoreAllEarthTiles(clicked, earth, layout, "absolute");
  const zero = Object.fromEntries(FACTORS.map((factor) => [factor, 0]));
  const totals = combineAll(scores, zero);
  assert.ok(totals.every((total) => total === -1));
  assert.deepEqual(rankTopRows(totals, new Float32Array(tiles), new Float32Array(tiles)), []);
});

test("real data: an all-null tile is skipped by the ranking, even appended to the real tiles", () => {
  const withNull = new Uint8Array((tiles + 1) * stride);
  withNull.set(earth);
  withNull.fill(NULL_CODE, tiles * stride);
  const clicked = earth.subarray(1000 * stride, 1001 * stride);
  const scores = scoreAllEarthTiles(clicked, withNull, layout, "absolute");
  for (let factor = 0; factor < FACTORS.length; factor++) assert.ok(Number.isNaN(scores[tiles * FACTORS.length + factor]));
  const equal = Object.fromEntries(FACTORS.map((factor) => [factor, 1]));
  const totals = combineAll(scores, equal);
  assert.equal(totals[tiles], -1);
  const lat = new Float32Array(tiles + 1).map((_, row) => (row % 170) - 85);
  const lon = new Float32Array(tiles + 1).map((_, row) => (row * 7) % 360 - 180);
  const picks = rankTopRows(totals, lat, lon, { count: 50, minSeparationKm: 0 });
  assert.ok(picks.every((pick) => pick.row !== tiles && pick.total >= 0));
});

test("real data: relative mode reads the percentile bytes, and a mode switch changes the scores", () => {
  const rowA = 5000;
  const clicked = earth.subarray(rowA * stride, (rowA + 1) * stride);
  const absolute = scoreAllEarthTiles(clicked, earth, layout, "absolute");
  const relative = scoreAllEarthTiles(clicked, earth, layout, "relative");
  let differing = 0;
  let checked = 0;
  const dayPct = layout.fields.t_day_pct;
  const nightPct = layout.fields.t_night_pct;
  for (let row = 0; row < tiles; row += 37) {
    const parts = [];
    for (const field of [dayPct, nightPct]) {
      const a = clicked[field.offset];
      const b = earth[row * stride + field.offset];
      if (a !== NULL_CODE && b !== NULL_CODE) parts.push(Math.max(0, 1 - (Math.abs(a - b) / 254) / schema.relative_tol));
    }
    const got = relative[row * FACTORS.length + idx("temp")];
    if (parts.length) {
      assert.ok(Math.abs(got - parts.reduce((s, v) => s + v, 0) / parts.length) < 1e-5, `row ${row}`);
      checked++;
    } else assert.ok(Number.isNaN(got));
    if (Math.abs(got - absolute[row * FACTORS.length + idx("temp")]) > 1e-6) differing++;
  }
  assert.ok(checked > 100, `only ${checked} comparable tiles`);
  assert.ok(differing > 0, "relative temp scores equal absolute everywhere");
  // Vector factors and elev read the same bytes in both modes.
  for (const factor of ["surface", "minerals"]) for (let row = 0; row < tiles; row += 101) {
    const [a, b] = [absolute[row * FACTORS.length + idx(factor)], relative[row * FACTORS.length + idx(factor)]];
    assert.ok((Number.isNaN(a) && Number.isNaN(b)) || a === b, factor);
  }
});
