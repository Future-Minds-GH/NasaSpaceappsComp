// The clicked tile in plain words, read straight from its vector before any search finishes (plan v2.1 "Tile profile"):
// "As cold as Earth's coldest 1%, ice-rich, basaltic". Every number in a vector is an Earth percentile, so each phrase
// compares the tile with Earth's land. Codes (rock class, ice form) are named with schema.json's lookup tables.
import { NULL_CODE } from "../data/similarity.js";

const BYTE_SCALE = 254;
const MINERAL_WORDS = {
  mafic: "iron- and magnesium-rich rock (like basalt)",
  clays: "clay minerals, which form in water",
  sulfates: "sulfate salts",
  carbonates: "carbonates",
  iron_oxides: "rusty iron oxides",
  salts: "salts",
};

export default function TileProfile({ vector, layout }) {
  if (!vector || !layout) return null;
  const phrases = describeTile(vector, layout);
  if (phrases.length === 0) return null;
  return (
    <section className="tile-profile" aria-label="What this tile is like">
      <h3 className="tile-profile-title">What this tile is like</h3>
      <ul className="tile-profile-list">
        {phrases.map((phrase) => <li key={phrase}>{phrase}</li>)}
      </ul>
    </section>
  );
}

function describeTile(vector, layout) {
  const { fieldsByFactor: fields, lookups } = layout;
  const value = (field) => (vector[field.offset] === NULL_CODE ? null : vector[field.offset] / BYTE_SCALE);
  const code = (field) => (vector[field.offset] === NULL_CODE ? null : vector[field.offset]);
  const phrases = [];

  phrases.push(extremePhrase(value(fields.climate.cold_extreme), "cold", "coldest", "Milder than most of Earth's land"));
  phrases.push(extremePhrase(value(fields.climate.aridity), "dry", "driest", "Wetter than most of Earth's land"));

  const pressure = value(fields.atmosphere.pressure);
  phrases.push(pressure === null ? "No air at all" : pressure < 0.02 ? "Air far thinner than anywhere on Earth" : null);

  const rock = code(fields.geology.rock_class);
  if (rock !== null && lookups.rock_class.names[rock]) {
    const extras = [code(fields.geology.volcanic) === 1 && "volcanic", code(fields.geology.impact) === 1 && "cratered by impacts"].filter(Boolean);
    phrases.push(`${capitalise(lookups.rock_class.names[rock])} rock${extras.length ? `, ${extras.join(" and ")}` : ""}`);
  }

  const minerals = Object.entries(fields.mineralogy).map(([id, field]) => [id, value(field)]).filter(([, amount]) => amount !== null);
  const [topMineral, topAmount] = minerals.sort((first, second) => second[1] - first[1])[0] ?? [];
  if (topMineral && topAmount >= 0.4) phrases.push(`Rich in ${MINERAL_WORDS[topMineral] ?? topMineral.replace(/_/g, " ")}`);

  const iceFraction = value(fields.water_ice.ice_fraction);
  const iceForm = code(fields.water_ice.ice_form);
  const iceDepth = code(fields.water_ice.ice_depth);
  if (iceFraction !== null && iceFraction >= 0.1 && iceForm) {
    const depth = iceDepth !== null ? lookups.ice_depth.names[iceDepth] : null;
    phrases.push(`${iceFraction >= 0.5 ? "Ice-rich" : "Some"} ${lookups.ice_form.names[iceForm]}${depth && depth !== "none" ? ` (${depth})` : ""}`);
  } else if (iceFraction !== null) {
    phrases.push("No ice in the ground");
  }

  const slope = value(fields.terrain.slope);
  if (slope !== null) phrases.push(slope >= 0.5 ? `Steeper than ${Math.round(slope * 100)}% of Earth's land` : `Flatter than ${Math.round((1 - slope) * 100)}% of Earth's land`);

  return phrases.filter(Boolean);
}

// Percentiles are clamped to Earth's 1st-99th, so the top of the scale reads "as … as Earth's …est 1%".
function extremePhrase(percentile, adjective, superlative, mildText) {
  if (percentile === null) return null;
  if (percentile >= 0.99) return `As ${adjective} as Earth's ${superlative} 1%`;
  if (percentile >= 0.5) return `${capitalise(adjective === "cold" ? "colder" : "drier")} than ${Math.round(percentile * 100)}% of Earth's land`;
  return mildText;
}

function capitalise(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
