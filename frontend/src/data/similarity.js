// The live search (matcher v0.3, data/schema.json): compares one clicked tile vector with every
// candidate tile vector. A click computes the nine factor scores for every candidate once (scoreAllEarthTiles); moving a
// slider only recombines the stored scores (combineAll), so the ranking updates while dragging.
// Two modes: "absolute" scores the real units (kelvin, W/m2, degrees, metres), "relative" scores each planet's own
// percentile ranks. The loops read byte offsets and score lookup tables and allocate nothing per tile: 100k Earth tiles
// must score in well under a second.
import { FACTORS } from "./scoring.js";
import { kthLargest } from "./ranking.js";

export const NULL_CODE = 255;
const BYTE_SCALE = 254;
export const MODES = ["absolute", "relative"];

/**
 * Byte offsets and decoding data of every field, read from schema.json (v0.3): the factor fields in factor order,
 * then the relative (percentile) fields. The tile width is the number of fields, never a constant.
 */
export function readLayout(schema) {
  if (schema.factors.map((factor) => factor.id).join() !== FACTORS.join()) {
    throw new Error(`schema.json factors (${schema.factors.map((factor) => factor.id)}) do not match the site's factors (${FACTORS}).`);
  }
  let offset = 0;
  const fields = {};
  const factors = schema.factors.map((factor) => {
    const ids = factor.fields.map((field) => {
      fields[field.id] = { ...field, offset: offset++ };
      return field.id;
    });
    return { id: factor.id, label: factor.label, isVector: Boolean(factor.vector), fieldIds: ids };
  });
  for (const field of schema.relative_fields) fields[field.id] = { ...field, offset: offset++ };
  return { fields, factors, bytesPerTile: offset, relativeTol: schema.relative_tol, plans: {} };
}

/** Throws unless the bytes hold a whole number of tiles: a vector file of the wrong width must never be read. */
export function assertWholeTiles(bytes, layout, name = "vector file") {
  if (bytes.length % layout.bytesPerTile !== 0) {
    throw new Error(`${name} is ${bytes.length} bytes, not a multiple of ${layout.bytesPerTile} bytes per tile (schema.json).`);
  }
}

/** Decoded value of one field byte (null for the null code): real units, a 0-1 fraction or a 0-1 percentile. */
export function decodeByte(field, byte) {
  if (byte === NULL_CODE) return null;
  return field.kind === "value" ? field.min + (byte / BYTE_SCALE) * (field.max - field.min) : byte / BYTE_SCALE;
}

// Size of one byte step in the field's own units.
const stepOf = (field) => (field.kind === "value" ? (field.max - field.min) / BYTE_SCALE : 1 / BYTE_SCALE);

// Per factor: a vector (offsets) or scalar terms (offset + a table from |byte difference| to score). Built once per mode.
function planFor(layout, mode) {
  if (!MODES.includes(mode)) throw new Error(`Unknown mode "${mode}".`);
  if (layout.plans[mode]) return layout.plans[mode];
  const plan = layout.factors.map((factor) => {
    if (factor.isVector) return { isVector: true, offsets: factor.fieldIds.map((id) => layout.fields[id].offset), terms: [] };
    const terms = factor.fieldIds.map((id) => {
      const field = layout.fields[id];
      const relative = mode === "relative" ? Object.values(layout.fields).find((other) => other.rel_of === id) : null;
      const used = relative ?? field;
      const tol = relative ? layout.relativeTol : field.tol;
      const table = new Float32Array(BYTE_SCALE + 1);
      for (let gap = 0; gap <= BYTE_SCALE; gap++) table[gap] = Math.max(0, 1 - (gap * stepOf(used)) / tol);
      return { offset: used.offset, table };
    });
    return { isVector: false, offsets: [], terms };
  });
  layout.plans[mode] = plan;
  return plan;
}

/**
 * Nine factor scores of every candidate tile against the clicked tile.
 * Scalar: max(0, 1 - |a - b| / tol) on decoded values. Temperature: mean of the day and night scores that are present.
 * Vector (surface, minerals): max(0, 1 - 0.5 x sum |p - q|), missing if any component is null on either tile.
 * @param {"absolute" | "relative"} mode  which fields the scalar factors read (elev and the vectors read the same in both)
 * Missing data: when the clicked tile has a factor but a candidate does not, the candidate gets that factor's median
 * score over the candidates that have it (a typical value: no advantage for unmapped tiles, no penalty either).
 * Those cells are flagged in `scores.typical` (one bit per factor per tile). A factor the clicked tile lacks stays NaN.
 * @returns {Float32Array & { typical: Uint16Array }} N x 9 scores in FACTORS order.
 */
export function scoreAllEarthTiles(clicked, vectors, layout, mode = "absolute") {
  assertWholeTiles(vectors, layout, "candidate vectors");
  const stride = layout.bytesPerTile;
  const tileCount = vectors.length / stride;
  const factorCount = FACTORS.length;
  const scores = new Float32Array(tileCount * factorCount);
  const vectorStep = 0.5 / BYTE_SCALE;
  // Per click, each scalar term becomes a 256-entry table from the candidate's byte straight to its score (-1 for the
  // null code: scores are never negative), and terms or vector factors the clicked tile lacks are dropped up front.
  const parts = planFor(layout, mode).map((part) => {
    if (part.isVector) {
      const hasAll = part.offsets.every((offset) => clicked[offset] !== NULL_CODE);
      return { isVector: true, offsets: hasAll ? part.offsets : null, wants: part.offsets.map((offset) => clicked[offset]) };
    }
    const terms = part.terms.filter((term) => clicked[term.offset] !== NULL_CODE).map((term) => {
      const a = clicked[term.offset];
      const byCandidate = new Float32Array(NULL_CODE + 1).fill(-1);
      for (let b = 0; b < NULL_CODE; b++) byCandidate[b] = term.table[a > b ? a - b : b - a];
      return { offset: term.offset, byCandidate };
    });
    return { isVector: false, terms };
  });

  for (let factor = 0; factor < factorCount; factor++) {
    const part = parts[factor];
    if (part.isVector) {
      const { offsets, wants } = part;
      for (let tile = 0, base = 0, cell = factor; tile < tileCount; tile++, base += stride, cell += factorCount) {
        if (!offsets) { scores[cell] = NaN; continue; }   // the clicked tile lacks a component
        let gapSum = 0;
        let isMissing = false;
        for (let index = 0; index < offsets.length; index++) {
          const a = wants[index];
          const b = vectors[base + offsets[index]];
          if (b === NULL_CODE) { isMissing = true; break; }
          gapSum += a > b ? a - b : b - a;
        }
        scores[cell] = isMissing ? NaN : Math.max(0, 1 - gapSum * vectorStep);
      }
    } else if (part.terms.length === 1) {
      const { offset, byCandidate } = part.terms[0];
      for (let tile = 0, base = offset, cell = factor; tile < tileCount; tile++, base += stride, cell += factorCount) {
        const score = byCandidate[vectors[base]];
        scores[cell] = score < 0 ? NaN : score;
      }
    } else {
      const terms = part.terms;
      for (let tile = 0, base = 0, cell = factor; tile < tileCount; tile++, base += stride, cell += factorCount) {
        let sum = 0;
        let count = 0;
        for (let index = 0; index < terms.length; index++) {
          const score = terms[index].byCandidate[vectors[base + terms[index].offset]];
          if (score < 0) continue;   // the candidate lacks this term
          sum += score;
          count++;
        }
        scores[cell] = count ? sum / count : NaN;
      }
    }
  }
  scores.typical = fillWithTypical(scores, tileCount, factorCount);
  return scores;
}

/** Replaces each factor's missing scores with the median of the present ones; returns the bit flags of the filled cells. */
function fillWithTypical(scores, tileCount, factorCount) {
  const typical = new Uint16Array(tileCount);
  const present = new Float32Array(tileCount);
  // A tile with no real factor score at all stays empty: it is not a candidate (combineAll gives it -1).
  const hasData = new Uint8Array(tileCount);
  for (let tile = 0, cell = 0; tile < tileCount; tile++, cell += factorCount) {
    for (let factor = 0; factor < factorCount; factor++) if (scores[cell + factor] === scores[cell + factor]) { hasData[tile] = 1; break; }
  }
  for (let factor = 0; factor < factorCount; factor++) {
    let count = 0;
    for (let cell = factor; cell < scores.length; cell += factorCount) {
      if (scores[cell] === scores[cell]) present[count++] = scores[cell];   // x === x: not NaN
    }
    if (count === 0 || count === tileCount) continue;   // the clicked tile lacks it, or nothing is missing
    // The median by quickselect (linear) instead of sorting every score.
    const values = present.subarray(0, count);
    const half = count >> 1;
    const median = count % 2 ? kthLargest(values, half + 1) : (kthLargest(values, half + 1) + kthLargest(values, half)) / 2;
    for (let tile = 0; tile < tileCount; tile++) {
      const cell = tile * factorCount + factor;
      if (hasData[tile] && scores[cell] !== scores[cell]) { scores[cell] = median; typical[tile] |= 1 << factor; }
    }
  }
  return typical;
}

/** The factor ids filled with a typical value for one tile (see scoreAllEarthTiles). */
export function typicalFactorsOf(scores, row) {
  const bits = scores.typical?.[row] ?? 0;
  return FACTORS.filter((_, factor) => (bits >> factor) & 1);
}

/**
 * Totals (0-100) for every tile from the stored factor scores: 100 x sum(w x s) / sum(w) over the present factors
 * with w > 0. A tile with no present factor gets -1: it is not a candidate (ranking.js skips it).
 */
export function combineAll(scores, weights) {
  const factorCount = FACTORS.length;
  const weightList = FACTORS.map((factor) => Math.max(weights[factor] ?? 0, 0));
  const tileCount = scores.length / factorCount;
  const totals = new Float32Array(tileCount);
  for (let tile = 0; tile < tileCount; tile++) {
    let weightSum = 0;
    let sum = 0;
    const row = tile * factorCount;
    for (let factor = 0; factor < factorCount; factor++) {
      const value = scores[row + factor];
      const weight = weightList[factor];
      if (weight === 0 || value !== value) continue; // value !== value is a fast NaN check
      weightSum += weight;
      sum += weight * value;
    }
    totals[tile] = weightSum === 0 ? -1 : (100 * sum) / weightSum;
  }
  return totals;
}
