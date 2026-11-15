// The live search (plan v2.1, "Similarity search and scoring"): compares one clicked tile vector with every candidate
// tile vector. A click computes the seven factor scores for every candidate once (scoreAllEarthTiles) and keeps their
// logs (toLogScores); moving a slider only recombines the logs (combineLogs), so the ranking updates while dragging.
// Scoring's similarity.py is the reference; both must agree within 0.1 points on the shared test pairs.
// The loops read byte offsets directly and allocate nothing per tile: 120k Earth tiles must score in well under a second.
import { FACTORS, FACTOR_FLOOR } from "./scoring.js";

export const NULL_CODE = 255;
const BYTE_SCALE = 254;
const FACTOR_COUNT = 7;

/** Byte offsets of every field, grouped by factor, plus the lookups the comparisons need (from vectors/schema.json). */
export function readLayout(schema) {
  let offset = 0;
  const fieldsByFactor = {};
  for (const factor of schema.factors) {
    fieldsByFactor[factor.id] = Object.fromEntries(factor.fields.map((field) => [field.id, { ...field, offset: offset++ }]));
  }
  const offsetsOf = (factor, kind) => Object.values(fieldsByFactor[factor]).filter((field) => !kind || field.kind === kind).map((field) => field.offset);
  const terrain = fieldsByFactor.terrain;
  return {
    fieldsByFactor,
    bytesPerTile: offset,
    lookups: schema.lookups,
    offsets: {
      embedding: offsetsOf("terrain", "embedding"),
      terrainStatistics: [terrain.slope.offset, terrain.roughness.offset],
      mineralogy: offsetsOf("mineralogy"),
      climate: offsetsOf("climate"),
      atmosphere: offsetsOf("atmosphere"),
    },
  };
}

/**
 * Seven factor scores of every candidate tile against the clicked tile.
 * @param {Record<string, number> | null} fieldWeights  optional multipliers for single measurements inside a factor,
 *   keyed "factor.field" (e.g. "climate.mean_temp", "terrain.shape" for the picture embedding). Missing keys count 1,
 *   so with no fieldWeights every factor is the plain mean the plan describes. A 0 leaves that measurement out.
 * @returns {Float32Array} N × 7 scores in FACTORS order; NaN where a factor is missing on either tile.
 */
export function scoreAllEarthTiles(clicked, vectors, layout, fieldWeights = null) {
  const stride = layout.bytesPerTile;
  const tileCount = vectors.length / stride;
  const scores = new Float32Array(tileCount * FACTOR_COUNT);
  const shape = terrainShapePercentiles(clicked, vectors, layout, tileCount);
  const { fieldsByFactor: fields, offsets, lookups } = layout;
  const relief = fields.elevation.relief.offset;
  const position = fields.elevation.topo_position.offset;
  const rockClass = fields.geology.rock_class.offset;
  const volcanic = fields.geology.volcanic.offset;
  const impact = fields.geology.impact.offset;
  const iceFraction = fields.water_ice.ice_fraction.offset;
  const iceDepth = fields.water_ice.ice_depth.offset;
  const iceForm = fields.water_ice.ice_form.offset;
  const liquid = fields.water_ice.liquid_water.offset;
  const rockGroups = lookups.rock_class.groups;
  const relatedIceForms = lookups.ice_form.related ?? [];
  const w = (factor, field) => Math.max(fieldWeights?.[`${factor}.${field}`] ?? 1, 0);
  const fieldWeightsOf = (factor) => Object.values(fields[factor]).filter((field) => field.kind !== "embedding").map((field) => w(factor, field.id));
  // Terrain: the picture similarity and the slope/roughness pair count equally by default (50/50, as in the plan).
  const shapeWeight = w("terrain", "shape");
  const statisticsWeights = [w("terrain", "slope"), w("terrain", "roughness")];
  const statisticsWeight = (statisticsWeights[0] + statisticsWeights[1]) / 2;
  const mineralWeights = fieldWeightsOf("mineralogy");
  const climateWeights = fieldWeightsOf("climate");
  const atmosphereWeights = fieldWeightsOf("atmosphere");
  const [wRelief, wPosition] = [w("elevation", "relief"), w("elevation", "topo_position")];
  const [wRock, wVolcanic, wImpact] = [w("geology", "rock_class"), w("geology", "volcanic"), w("geology", "impact")];
  const [wIceFraction, wIceDepth, wIceForm, wLiquid] = [w("water_ice", "ice_fraction"), w("water_ice", "ice_depth"), w("water_ice", "ice_form"), w("water_ice", "liquid_water")];

  for (let tile = 0; tile < tileCount; tile++) {
    const base = tile * stride;
    const row = tile * FACTOR_COUNT;

    // 1 Terrain: 50% DINOv2 cosine similarity as a percentile among all candidates for this click,
    // 50% (1 − mean gap of the slope and roughness percentiles).
    const statistics = meanGap(clicked, vectors, base, offsets.terrainStatistics, false, statisticsWeights);
    const hasShape = !Number.isNaN(shape[tile]) && shapeWeight > 0;
    const hasStatistics = !Number.isNaN(statistics) && statisticsWeight > 0;
    scores[row] = hasShape && hasStatistics
      ? (shapeWeight * shape[tile] + statisticsWeight * statistics) / (shapeWeight + statisticsWeight)
      : hasShape ? shape[tile] : hasStatistics ? statistics : NaN;

    // 2 Elevation & topography: mean of (1 − relief gap) and the position code (same 1, neighbouring 0.5).
    let sum = 0;
    let count = 0;
    let a = clicked[relief];
    let b = vectors[base + relief];
    if (a !== NULL_CODE && b !== NULL_CODE) { sum += wRelief * (1 - Math.abs(a - b) / BYTE_SCALE); count += wRelief; }
    a = clicked[position];
    b = vectors[base + position];
    if (a !== NULL_CODE && b !== NULL_CODE) { sum += wPosition * (a === b ? 1 : Math.abs(a - b) === 1 ? 0.5 : 0); count += wPosition; }
    scores[row + 1] = count ? sum / count : NaN;

    // 3 Geology: rock-class lookup (same 1, same group 0.5), averaged with the volcanic and impact flags (equal 1).
    sum = 0;
    count = 0;
    a = clicked[rockClass];
    b = vectors[base + rockClass];
    if (a !== NULL_CODE && b !== NULL_CODE) { sum += wRock * (a === b ? 1 : rockGroups[a] === rockGroups[b] ? 0.5 : 0); count += wRock; }
    a = clicked[volcanic];
    b = vectors[base + volcanic];
    if (a !== NULL_CODE && b !== NULL_CODE) { sum += wVolcanic * (a === b ? 1 : 0); count += wVolcanic; }
    a = clicked[impact];
    b = vectors[base + impact];
    if (a !== NULL_CODE && b !== NULL_CODE) { sum += wImpact * (a === b ? 1 : 0); count += wImpact; }
    scores[row + 2] = count ? sum / count : NaN;

    // 4 Mineralogy, 5 Climate: 1 − mean gap. 6 Atmosphere: the same, but missing if any value is (the Moon has none).
    scores[row + 3] = meanGap(clicked, vectors, base, offsets.mineralogy, false, mineralWeights);
    scores[row + 4] = meanGap(clicked, vectors, base, offsets.climate, false, climateWeights);
    scores[row + 5] = meanGap(clicked, vectors, base, offsets.atmosphere, true, atmosphereWeights);

    // 7 Water & ice: mean of (1 − ice fraction gap), depth match, ice-form lookup and (1 − liquid-water fraction).
    sum = 0;
    count = 0;
    a = clicked[iceFraction];
    b = vectors[base + iceFraction];
    if (a !== NULL_CODE && b !== NULL_CODE) { sum += wIceFraction * (1 - Math.abs(a - b) / BYTE_SCALE); count += wIceFraction; }
    a = clicked[iceDepth];
    b = vectors[base + iceDepth];
    if (a !== NULL_CODE && b !== NULL_CODE) { sum += wIceDepth * (a === b ? 1 : 0); count += wIceDepth; }
    a = clicked[iceForm];
    b = vectors[base + iceForm];
    if (a !== NULL_CODE && b !== NULL_CODE) { sum += wIceForm * (a === b ? 1 : isRelated(relatedIceForms, a, b) ? 0.5 : 0); count += wIceForm; }
    b = vectors[base + liquid];
    if (b !== NULL_CODE) { sum += wLiquid * (1 - b / BYTE_SCALE); count += wLiquid; }
    scores[row + 6] = count ? sum / count : NaN;
  }
  return scores;
}

/** log(max(s, 0.05)) of every score, NaN kept for missing factors: computed once per click (plan v2.1). */
export function toLogScores(scores) {
  const logs = new Float32Array(scores.length);
  for (let index = 0; index < scores.length; index++) {
    const value = scores[index];
    logs[index] = Number.isNaN(value) ? NaN : Math.log(Math.max(value, FACTOR_FLOOR));
  }
  return logs;
}

/** Totals (0-100) for every tile from the stored logs: 100 × exp(Σ w·log s / Σ w) over present factors. */
export function combineLogs(logs, weights) {
  const weightList = FACTORS.map((factor) => Math.max(weights[factor] ?? 0, 0));
  const tileCount = logs.length / FACTOR_COUNT;
  const totals = new Float32Array(tileCount);
  for (let tile = 0; tile < tileCount; tile++) {
    let weightSum = 0;
    let logSum = 0;
    const row = tile * FACTOR_COUNT;
    for (let factor = 0; factor < FACTOR_COUNT; factor++) {
      const value = logs[row + factor];
      const weight = weightList[factor];
      if (weight === 0 || value !== value) continue; // value !== value is a fast NaN check
      weightSum += weight;
      logSum += weight * value;
    }
    totals[tile] = weightSum === 0 ? 0 : 100 * Math.exp(logSum / weightSum);
  }
  return totals;
}

/** The same totals straight from the scores (used by the tests and the sample generators). */
export function combineAll(scores, weights) {
  return combineLogs(toLogScores(scores), weights);
}

// ---- Helpers ---------------------------------------------------------------------------------------------------

function terrainShapePercentiles(clicked, vectors, layout, tileCount) {
  const offsets = layout.offsets.embedding;
  const stride = layout.bytesPerTile;
  const clickedEmbedding = offsets.map((offset) => decodeEmbedding(clicked[offset]));
  const clickedNorm = clickedEmbedding.reduce((sum, value) => sum + value * value, 0);
  const cosines = new Float32Array(tileCount);
  for (let tile = 0; tile < tileCount; tile++) {
    const base = tile * stride;
    let dot = 0;
    let norm = 0;
    for (let index = 0; index < offsets.length; index++) {
      const value = decodeEmbedding(vectors[base + offsets[index]]);
      dot += value * clickedEmbedding[index];
      norm += value * value;
    }
    cosines[tile] = norm && clickedNorm ? dot / Math.sqrt(norm * clickedNorm) : NaN;
  }
  const sorted = Float32Array.from(cosines).sort();
  const percentiles = new Float32Array(tileCount);
  for (let tile = 0; tile < tileCount; tile++) {
    percentiles[tile] = Number.isNaN(cosines[tile]) ? NaN : countBelow(sorted, cosines[tile]) / tileCount;
  }
  return percentiles;
}

// Weighted 1 − mean gap; weights default to 1 each (the plain mean). count holds the summed weights.
function meanGap(clicked, vectors, base, offsets, isNullIfAnyMissing, weights = null) {
  let sum = 0;
  let count = 0;
  for (let index = 0; index < offsets.length; index++) {
    const a = clicked[offsets[index]];
    const b = vectors[base + offsets[index]];
    if (a === NULL_CODE || b === NULL_CODE) {
      if (isNullIfAnyMissing) return NaN;
      continue;
    }
    const weight = weights ? weights[index] : 1;
    sum += weight * (1 - Math.abs(a - b) / BYTE_SCALE);
    count += weight;
  }
  return count ? sum / count : NaN;
}

function isRelated(pairs, a, b) {
  for (const [x, y] of pairs) if ((x === a && y === b) || (x === b && y === a)) return true;
  return false;
}

const decodeEmbedding = (byte) => (byte === NULL_CODE ? 0 : (byte / BYTE_SCALE) * 2 - 1);

// NaN cosines sort to the end of a Float32Array, so they never count as "below" a real value.
function countBelow(sortedValues, value) {
  let low = 0;
  let high = sortedValues.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (sortedValues[middle] < value) low = middle + 1; else high = middle;
  }
  return low;
}
