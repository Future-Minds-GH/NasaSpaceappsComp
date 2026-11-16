// Scoring rules shared by every screen (matcher v0.3): combining the nine factor scores into one
// 0-100 score, the score bands, and the thresholds behind the "new analog" and "false friend" badges.
// similarity.js computes the factor scores.

/** The nine factors, in the order the vectors, presets and every bar chart use (same as data/schema.json). */
export const FACTORS = ["temp", "swing", "sun", "slope", "rough", "elev", "surface", "minerals", "ice"];

/** A site this far from every catalogued analog counts as a new analog. */
const NEW_ANALOG_MIN_KM = 300;
/** Score bands: green from 90, yellow from 60, else red. */
const BAND_GREEN_MIN = 90;
const BAND_YELLOW_MIN = 60;
// False friend: same slope and roughness, but the factor the mission cares most about is far off.
const FALSE_FRIEND_GROUND = 0.7;
const FALSE_FRIEND_TOP_FACTOR = 0.4;
const GROUND_FACTORS = ["slope", "rough"];

/**
 * S = 100 x sum(w x s) / sum(w), over the factors with w > 0 that are present (not null) on both sites.
 * Arithmetic mean: no floor, no logs. No factor present gives 0 (the search treats such a tile as not a candidate).
 */
export function combineScore(breakdown, weights) {
  let weightSum = 0;
  let total = 0;
  for (const factor of FACTORS) {
    const weight = Math.max(weights[factor] ?? 0, 0);
    const factorScore = breakdown[factor];
    if (weight === 0 || factorScore === null || factorScore === undefined) continue;
    weightSum += weight;
    total += weight * factorScore;
  }
  return weightSum === 0 ? 0 : (100 * total) / weightSum;
}

/** "green" from 90.0, "yellow" from 60.0, else "red". */
export function scoreBand(score) {
  if (score >= BAND_GREEN_MIN) return "green";
  if (score >= BAND_YELLOW_MIN) return "yellow";
  return "red";
}

/** Weights scaled to sum to 1, as the sliders show them. */
export function normaliseWeights(weights) {
  const total = FACTORS.reduce((sum, factor) => sum + Math.max(weights[factor] ?? 0, 0), 0);
  if (total === 0) return Object.fromEntries(FACTORS.map((factor) => [factor, 1 / FACTORS.length]));
  return Object.fromEntries(FACTORS.map((factor) => [factor, Math.max(weights[factor] ?? 0, 0) / total]));
}

/** Sets one factor's share and scales the others in proportion so all nine still sum to 1 (the sliders' rule). */
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
    .map((match) => {
      const score = combineScore(match.breakdown, weights);
      return { ...match, score, band: scoreBand(score), false_friend: isFalseFriend(match.breakdown, weights) };
    })
    .sort((first, second) => second.score - first.score)
    .map((match, index) => ({ ...match, rank: index + 1 }));
}

export function isNewAnalog(site) {
  return typeof site.km_to_nearest_known_analog === "number" && site.km_to_nearest_known_analog > NEW_ANALOG_MIN_KM;
}

/** Slope and roughness both >= 0.7 while the most heavily weighted other factor is below 0.4. */
export function isFalseFriend(breakdown, weights) {
  if (GROUND_FACTORS.some((factor) => (breakdown[factor] ?? 0) < FALSE_FRIEND_GROUND)) return false;
  const topFactor = heaviestFactor(breakdown, weights);
  return topFactor !== null && breakdown[topFactor] < FALSE_FRIEND_TOP_FACTOR;
}

/** The factor (not slope or rough, present on both sites, weight > 0) the current weights count most; first wins a tie. */
export function heaviestFactor(breakdown, weights) {
  let best = null;
  for (const factor of FACTORS) {
    if (GROUND_FACTORS.includes(factor) || breakdown[factor] === null || breakdown[factor] === undefined) continue;
    const weight = weights[factor] ?? 0;
    if (weight <= 0) continue;
    if (best === null || weight > (weights[best] ?? 0)) best = factor;
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
