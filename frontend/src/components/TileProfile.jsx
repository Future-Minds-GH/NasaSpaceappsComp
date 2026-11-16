// The picked tile's scored factors in plain words, read straight from its vector before any search finishes: its real
// values in the units of data/schema.json ("Day 274 K, Night 190 K", "2°"). Only the five scored factors are listed.
import { SCORED_FACTORS } from "../data/scoring.js";
import { describeFactorValue, halfTempNote, missingFactorsOf } from "../data/fieldValues.js";
import { FACTOR_LABELS } from "../content/labels.js";

export default function TileProfile({ vector, layout }) {
  if (!vector || !layout) return null;
  const facts = SCORED_FACTORS.map((factor) => ({ factor, text: describeFactorValue(layout, factor, vector) })).filter((fact) => fact.text);
  const missing = missingFactorsOf(layout, vector).filter((factor) => SCORED_FACTORS.includes(factor));
  const tempNote = halfTempNote(layout, vector);
  if (facts.length === 0 && missing.length === 0) return null;

  return (
    <section className="tile-profile" aria-labelledby="tile-profile-title">
      <h3 id="tile-profile-title" className="find-subheading">What this tile is like</h3>
      <dl className="find-facts">
        {facts.map(({ factor, text }) => (
          <div className="find-fact" key={factor} style={{ "--factor-color": `var(--factor-${factor})` }}>
            <dt><span className="factor-swatch" aria-hidden="true" />{FACTOR_LABELS[factor]}</dt>
            <dd>{withoutRepeatedLabel(text, FACTOR_LABELS[factor])}</dd>
          </div>
        ))}
      </dl>
      {tempNote && <p className="find-note" role="note">{tempNote}</p>}
      {missing.length > 0 && (
        <p className="find-note" role="note">
          No data for this spot: {missing.map((factor) => FACTOR_LABELS[factor]).join(", ")}. These factors are left out of every match from here.
        </p>
      )}
    </section>
  );
}

/** "Slope 2°" under the label "Slope" reads as "2°": the value names its own measurement, which the label already says. */
function withoutRepeatedLabel(text, label) {
  return text.startsWith(`${label} `) ? text.slice(label.length + 1) : text;
}
