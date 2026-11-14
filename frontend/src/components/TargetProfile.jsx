// The chosen featured site's seven factors in plain words, shown inside the Details panel.
import { FACTORS } from "../data/scoring.js";
import { FACTOR_LABELS } from "../content/labels.js";

export default function TargetProfile({ target }) {
  return (
    <section className={`target-profile body-${target.body}`} aria-labelledby="target-profile-title">
      <h3 id="target-profile-title" className="target-profile-title">What {target.name} is like</h3>
      <dl className="profile-list">
        {FACTORS.map((factor) => (
          <div className="profile-row" key={factor} style={{ "--factor-color": `var(--factor-${factor})` }}>
            <dt><span className="factor-swatch" aria-hidden="true" />{FACTOR_LABELS[factor]}</dt>
            <dd>{describeFactor(target.factors[factor])}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/** Factors may come as plain text, or as { text, value } once Role 2 adds numbers; show the words either way. */
function describeFactor(factorValue) {
  if (factorValue === undefined || factorValue === null) return "Not measured";
  if (typeof factorValue === "string") return factorValue;
  if (typeof factorValue === "number") return `${Math.round(factorValue * 100)} / 100`;
  return factorValue.text ?? factorValue.label ?? "Not measured";
}
