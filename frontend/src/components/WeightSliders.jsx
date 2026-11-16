// One slider per scored factor (Explore and Discover). The weights always sum to 1: moving one slider rescales the
// others in proportion, and a slider at 0 leaves that factor out of the score. Each move re-ranks the matches live.
import { SCORED_FACTORS, normaliseWeights, rebalanceWeights } from "../data/scoring.js";
import { FACTOR_LABELS } from "../content/labels.js";

const SLIDER_STEP = 0.01;

export default function WeightSliders({ weights, onChange, onReset, isCustom }) {
  const shares = normaliseWeights(weights, SCORED_FACTORS);

  return (
    <fieldset className="weight-sliders">
      <legend className="control-label">How much each factor counts (adds up to 100%)</legend>
      {SCORED_FACTORS.map((factor) => {
        const percent = Math.round(shares[factor] * 100);
        return (
          <div className="weight-row" key={factor} style={{ "--factor-color": `var(--factor-${factor})`, "--fill": `${percent}%` }}>
            <label htmlFor={`weight-${factor}`}>
              <span className="factor-swatch" aria-hidden="true" />
              {FACTOR_LABELS[factor]}
            </label>
            <input
              id={`weight-${factor}`}
              className="range"
              type="range"
              min="0"
              max="1"
              step={SLIDER_STEP}
              value={shares[factor]}
              aria-valuetext={`${percent}% of the score`}
              onChange={(event) => onChange(rebalanceWeights(shares, factor, Number(event.target.value), SCORED_FACTORS))}
            />
            <output htmlFor={`weight-${factor}`}>{percent}%</output>
          </div>
        );
      })}
      <button className="button button-quiet" type="button" onClick={onReset} disabled={!isCustom}>
        Reset to mission type
      </button>
    </fieldset>
  );
}
