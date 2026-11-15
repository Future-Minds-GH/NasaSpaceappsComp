import { FACTORS } from "./scoring.js";
// Real values of a tile in plain words, decoded from its bytes with the layout of data/schema.json:
// "Night 170 K", or next to a match "Night 170 K vs 215 K". Used by the tile profile and the result cards.
import { decodeByte } from "./similarity.js";

// The scalar measurements to show per factor: [schema field id, label].
const PARTS = {
  temp: [["t_day_k", "Day"], ["t_night_k", "Night"]],
  swing: [["t_swing_k", "Swing"]],
  sun: [["sun_wm2", "Sunlight"]],
  slope: [["slope_deg", "Slope"]],
  rough: [["rough_m", "Roughness"]],
  ice: [["ice_prob", "Ice chance"]],
};
const CLASS_NAMES = { ironox: "iron oxide", feldspathic: "feldspar-rich rock", mafic: "basaltic rock" };

function formatNumber(field, number) {
  if (field.kind === "fraction") return `${Math.round(number * 100)}%`;
  const unit = field.unit === "°" ? "°" : ` ${field.unit}`;
  return `${Math.round(number)}${unit}`;
}

// "mostly rock (62%)" for a vector factor; null when a component is missing.
function dominantClass(layout, vector, factor) {
  const parts = layout.factors.find((item) => item.id === factor).fieldIds.map((id) => {
    const field = layout.fields[id];
    return { name: CLASS_NAMES[id.split("_")[1]] ?? id.split("_")[1], amount: decodeByte(field, vector[field.offset]) };
  });
  if (parts.some((part) => part.amount === null)) return null;
  return parts.sort((first, second) => second.amount - first.amount)[0];
}

/**
 * One factor of a tile as text, or null when it has no data. With `other`, the two tiles side by side:
 * "Night 170 K vs 215 K". Surface, minerals and elevation read as their main class or a percentile rank.
 */
export function describeFactorValue(layout, factor, vector, other = null) {
  if (factor === "surface" || factor === "minerals") {
    const first = dominantClass(layout, vector, factor);
    const second = other ? dominantClass(layout, other, factor) : null;
    if (!first || (other && !second)) return null;   // no one-sided text when the other tile has no data
    const text = (part) => `${part.name} (${Math.round(part.amount * 100)}%)`;
    return second ? `Largest: ${text(first)} vs ${text(second)}` : `Largest: ${text(first)}`;
  }
  if (factor === "elev") {
    const field = layout.fields.elev_pct;
    const first = decodeByte(field, vector[field.offset]);
    const second = other ? decodeByte(field, other[field.offset]) : null;
    if (first === null) return null;
    const rank = (value) => `${ordinal(Math.round(value * 100))} percentile`;
    return second === null ? `Higher than ${Math.round(first * 100)}% of its planet` : `${rank(first)} vs ${rank(second)}`;
  }
  const texts = PARTS[factor].map(([id, label]) => {
    const field = layout.fields[id];
    const first = decodeByte(field, vector[field.offset]);
    if (first === null) return null;
    const second = other ? decodeByte(field, other[field.offset]) : null;
    if (!other) return `${label} ${formatNumber(field, first)}`;
    return second === null ? null : `${label} ${formatNumber(field, first)} vs ${formatNumber(field, second)}`;
  }).filter(Boolean);
  return texts.length ? texts.join(", ") : null;
}

/** 1st, 2nd, 3rd, 4th, 11th, 12th, 13th, 21st ... */
export function ordinal(n) {
  const tens = n % 100;
  const suffix = tens >= 11 && tens <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" })[n % 10] ?? "th";
  return `${n}${suffix}`;
}

/** The factors (FACTORS order) a tile has no data for: they cannot be compared from this spot on any match. */
export function missingFactorsOf(layout, vector) {
  if (!layout || !vector) return [];
  return FACTORS.filter((factor) => describeFactorValue(layout, factor, vector) === null);
}

/** "This spot on Mars has no data for minerals, so it is left out of the score." (any body, any factors), or null. */
export function noDataSentence(bodyName, factorLabels) {
  if (factorLabels.length === 0) return null;
  const names = factorLabels.map((label) => label.toLowerCase());
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
  return `This spot on ${bodyName} has no data for ${list}, so ${names.length === 1 ? "it is" : "they are"} left out of the score.`;
}
