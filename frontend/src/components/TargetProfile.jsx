// A named site's own scored factors in plain words (when its data has them), shown inside the Details panel.
import { SCORED_FACTORS } from "../data/scoring.js";
import { FACTOR_LABELS } from "../content/labels.js";

export default function TargetProfile({ target }) {
  const factors = SCORED_FACTORS.filter((factor) => target.factors[factor] !== undefined);
  if (factors.length === 0) return null;

  return (
    <section className="target-profile" aria-labelledby="target-profile-title">
      <h3 id="target-profile-title" className="find-subheading">What {target.name} is like</h3>
      <dl className="find-facts">
        {factors.map((factor) => (
          <div className="find-fact" key={factor} style={{ "--factor-color": `var(--factor-${factor})` }}>
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
