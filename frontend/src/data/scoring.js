// Scoring rules shared by every screen (plan v2.1): combining the seven factor scores into one 0-100 score, and
// the thresholds behind the "new analog" and "false friend" badges. similarity.js computes the factor scores.

/** The seven factors, in the order the vectors, presets and every bar chart use. */
export const FACTORS = ["terrain", "elevation", "geology", "mineralogy", "climate", "atmosphere", "water_ice"];

/** A site this far from every catalogued analog counts as a new analog. */
const NEW_ANALOG_MIN_KM = 300;
/** One weak factor drags the total down without zeroing it. */
export const FACTOR_FLOOR = 0.05;
// False friend: alike from above (terrain) while the factor the mission cares most about is far off.
const FALSE_FRIEND_TERRAIN = 0.7;
const FALSE_FRIEND_TOP_FACTOR = 0.4;

/**
 * S = 100 × Π max(s_f, 0.05) ^ (w_f / Σ w), over the factors present on both sites. A factor that is null on either
 * site (the Moon has no atmosphere) or weighted 0 is left out, and the remaining weights are renormalised.
 */
export function combineScore(breakdown, weights) {
  let weightSum = 0;
  let logSum = 0;
  for (const factor of FACTORS) {
    const weight = Math.max(weights[factor] ?? 0, 0);
    const factorScore = breakdown[factor];
    if (weight === 0 || factorScore === null || factorScore === undefined) continue;
    weightSum += weight;
    logSum += weight * Math.log(Math.max(factorScore, FACTOR_FLOOR));
  }
  return weightSum === 0 ? 0 : 100 * Math.exp(logSum / weightSum);
}

/** Weights scaled to sum to 1, as the sliders show them. */
export function normaliseWeights(weights) {
  const total = FACTORS.reduce((sum, factor) => sum + Math.max(weights[factor] ?? 0, 0), 0);
  if (total === 0) return Object.fromEntries(FACTORS.map((factor) => [factor, 1 / FACTORS.length]));
  return Object.fromEntries(FACTORS.map((factor) => [factor, Math.max(weights[factor] ?? 0, 0) / total]));
}

/** Sets one factor's share and scales the others in proportion so all seven still sum to 1 (the sliders' rule). */
export function rebalanceWeights(shares, changedFactor, newShare) {
  const others = FACTORS.filter((factor) => factor !== changedFactor);
  const othersTotal = others.reduce((sum, factor) => sum + (shares[factor] ?? 0), 0);
  const remaining = 1 - newShare;
  const next = { [changedFactor]: newShare };
  for (const factor of others) {
    // If every other slider sits at 0, share the rest equally instead of dividing by zero.
    next[factor] = othersTotal > 0 ? ((shares[factor] ?? 0) / othersTotal) * remaining : remaining / others.length;
  }
  return next;
}

/** Re-scores and re-ranks matches under new weights; returns new objects and leaves the input untouched. */
export function rescoreMatches(matches, weights) {
  return matches
    .map((match) => ({ ...match, score: combineScore(match.breakdown, weights), false_friend: isFalseFriend(match.breakdown, weights) }))
    .sort((first, second) => second.score - first.score)
    .map((match, index) => ({ ...match, rank: index + 1 }));
}

export function isNewAnalog(site) {
  return typeof site.km_to_nearest_known_analog === "number" && site.km_to_nearest_known_analog > NEW_ANALOG_MIN_KM;
}

/** Terrain ≥ 0.7 while the most heavily weighted other factor is below 0.4. */
export function isFalseFriend(breakdown, weights) {
  if ((breakdown.terrain ?? 0) < FALSE_FRIEND_TERRAIN) return false;
  const topFactor = heaviestFactor(breakdown, weights);
  return topFactor !== null && breakdown[topFactor] < FALSE_FRIEND_TOP_FACTOR;
}

/** The factor (other than terrain, and present on both sites) the current weights count most. */
export function heaviestFactor(breakdown, weights) {
  let best = null;
  for (const factor of FACTORS) {
    if (factor === "terrain" || breakdown[factor] === null || breakdown[factor] === undefined) continue;
    if (best === null || (weights[factor] ?? 0) > (weights[best] ?? 0)) best = factor;
  }
  return best;
}

/** The factor where a match does worst, used to explain a false friend when no weights are at hand. */
export function weakestFactor(breakdown) {
  return FACTORS.filter((factor) => typeof breakdown[factor] === "number")
    .reduce((weakest, factor) => (weakest === null || breakdown[factor] < breakdown[weakest] ? factor : weakest), null) ?? FACTORS[0];
}

export function areWeightsEqual(first, second) {
  return FACTORS.every((factor) => Math.abs((first[factor] ?? 0) - (second[factor] ?? 0)) < 1e-9);
}
