// The site opens with three of the nine factor sliders (temperature, relative elevation, minerals);
// the other six come from "+ Add a factor".
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DEFAULT_SHOWN_FACTORS } from "../src/content/labels.js";
import { FACTORS } from "../src/data/scoring.js";

const weights = JSON.parse(readFileSync(new URL("../public/data/weights.json", import.meta.url), "utf8"));
const balanced = weights.presets[weights.default_preset].weights;

test("temperature, relative elevation and minerals show at first, in the slider order", () => {
  assert.deepEqual(DEFAULT_SHOWN_FACTORS, ["temp", "elev", "minerals"]);
  assert.ok(DEFAULT_SHOWN_FACTORS.every((factor) => FACTORS.includes(factor)));
  assert.deepEqual(DEFAULT_SHOWN_FACTORS, FACTORS.filter((factor) => DEFAULT_SHOWN_FACTORS.includes(factor)));
});

test("the other six factors are hidden at first, so each is offered by + Add a factor", () => {
  const hidden = FACTORS.filter((factor) => !DEFAULT_SHOWN_FACTORS.includes(factor));
  assert.deepEqual(hidden, ["swing", "sun", "slope", "rough", "surface", "ice"]);
  assert.equal(hidden.length + DEFAULT_SHOWN_FACTORS.length, FACTORS.length);
});

test("every factor shown at first has a weight above 0 in the default preset, so the first score counts it", () => {
  assert.ok(DEFAULT_SHOWN_FACTORS.every((factor) => balanced[factor] > 0), JSON.stringify(balanced));
});
