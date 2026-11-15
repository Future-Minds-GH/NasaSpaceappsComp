// Checks on the REAL files (read only): earth_controls.bin, "controls" in earth_meta.json, and validation.json.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { NULL_CODE, combineAll, readLayout, scoreAllEarthTiles } from "../src/data/similarity.js";
import { rankTopRows } from "../src/data/ranking.js";

const here = (path) => fileURLToPath(new URL(path, import.meta.url));
const raw = (path) => readFileSync(here(path));
const json = (path) => JSON.parse(raw(path));
const schema = json("../../data/schema.json");
const layout = readLayout(schema);
const stride = layout.bytesPerTile;
const meta = json("../public/data/tiles/earth_meta.json");
const known = json("../../known_analogs.json");
const controlsBin = new Uint8Array(raw("../public/data/vectors/earth_controls.bin"));
const earth = new Uint8Array(raw("../public/data/vectors/earth.bin"));
const validation = json("../public/data/validation.json");
const row = (index) => controlsBin.subarray(index * stride, (index + 1) * stride);

test("earth_controls.bin has one 25-byte row per control, same ids and order as the known-analogs file", () => {
  const wanted = known.sites.filter((s) => s.body === "earth" && s.role === "negative_control");
  assert.equal(stride, 25);
  assert.equal(controlsBin.length, meta.controls.length * stride);
  assert.deepEqual(meta.controls.map((c) => c.id), wanted.map((s) => s.id));
  for (const control of meta.controls) assert.ok(control.radius_km > 0 && Number.isFinite(control.lat) && Number.isFinite(control.lon));
});

test("control rows: bytes are 0..254 or null, value bytes in range, percentile bytes sit between the Earth tiles below and at-or-below", () => {
  const tiles = earth.length / stride;
  let checkedPct = 0;
  meta.controls.forEach((control, index) => {
    const bytes = row(index);
    assert.ok(bytes.some((byte) => byte !== NULL_CODE), `${control.id} is all null`);
    for (const field of Object.values(layout.fields)) {
      const byte = bytes[field.offset];
      assert.ok(byte === NULL_CODE || byte <= 254, `${control.id} ${field.id}: ${byte}`);
      if (field.kind !== "percentile" || byte === NULL_CODE) continue;
      const source = field.rel_of ? layout.fields[field.rel_of] : field;   // a factor-level percentile field has no rel_of: check it against its own column
      const sourceByte = bytes[source.offset];
      if (sourceByte === NULL_CODE) continue;
      // Byte coding keeps order, so (L + E/2)/n lies between count(byte < v)/n and count(byte <= v)/n (+ 1 step of rounding).
      let below = 0, atOrBelow = 0, valid = 0;
      for (let tile = 0; tile < tiles; tile++) {
        const value = earth[tile * stride + source.offset];
        if (value === NULL_CODE) continue;
        valid++;
        if (value < sourceByte) below++;
        if (value <= sourceByte) atOrBelow++;
      }
      const pct = byte / 254;
      assert.ok(pct >= below / valid - 1 / 254 && pct <= atOrBelow / valid + 1 / 254, `${control.id} ${field.id}: ${pct} not in [${below / valid}, ${atOrBelow / valid}]`);
      checkedPct++;
    }
  });
  assert.ok(checkedPct > 20, `only ${checkedPct} percentile checks ran`);
});

test("validation.json: shape matches what ValidationGrid.jsx and ValidationSummary read", () => {
  assert.equal(typeof validation.sample, "boolean");
  assert.ok(Number.isFinite(validation.value) && Number.isFinite(validation.out_of) && validation.value <= validation.out_of);
  assert.equal(typeof validation.summary, "string");
  assert.deepEqual(validation.tests.map((t) => t.id), ["known_rank", "new_places", "controls", "control_regions"]);
  for (const t of validation.tests) assert.ok(t.name && t.result && typeof t.passed === "boolean", t.id);
  const { analogs, rows } = validation.specificity;
  assert.ok(analogs.length > 0 && rows.length === validation.out_of);
  const names = new Set(known.sites.map((s) => s.name));
  for (const a of analogs) assert.ok(names.has(a), `analog "${a}" not in known_analogs.json`);
  for (const r of rows) {
    assert.equal(r.ranks.length, analogs.length, r.target);        // the grid maps ranks[index] to analogs[index]
    assert.ok(Array.isArray(r.expected) && r.expected.length > 0 && r.expected.every((e) => names.has(e)));
    for (const rank of r.ranks) assert.ok(rank === null || (typeof rank === "number" && rank >= 0 && rank <= 100), `${r.target}: ${rank}`);
  }
  // The grid cells use rank / 100 and "n/a": a null rank would make "--rank" NaN-free only if guarded; record how many are null.
  for (const mode of ["absolute", "relative"]) {
    const s = validation[mode];
    assert.ok(s.controls_total === meta.controls.length * validation.out_of, mode);
    assert.equal(s.hit_ranks.length, validation.out_of);
  }
});

// Same formula as bestRankNear in scripts/make-validation.mjs (that file runs on import, so it cannot be imported).
function bestRankNear(totals, bestRow) {
  const best = totals[bestRow];
  let candidates = 0, beatenBy = 0;
  for (const total of totals) { if (total < 0) continue; candidates++; if (total > best) beatenBy++; }
  return Math.round(((candidates - 1 - beatenBy) / Math.max(1, candidates - 1)) * 1000) / 10;
}

test("bestRankNear's formula equals rankTopRows' earthRankPct for the top tile (real data, both modes)", () => {
  const tiles = earth.length / stride;
  const weights = json("../public/data/weights.json").presets.balanced.weights;
  const lats = new Float32Array(tiles).map((_, i) => (i % 180) - 90), lons = new Float32Array(tiles).map((_, i) => (i % 360) - 180);
  const clicked = controlsBin.slice(0, stride);   // any real vector will do as the input
  for (const mode of ["absolute", "relative"]) {
    const totals = combineAll(scoreAllEarthTiles(clicked, earth, layout, mode), weights);
    const picks = rankTopRows(totals, lats, lons, { count: 10 });
    assert.equal(bestRankNear(totals, picks[0].row), picks[0].earthRankPct, mode);
    assert.ok(picks[0].earthRankPct >= 99.9);
  }
});
