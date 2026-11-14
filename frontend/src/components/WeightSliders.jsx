// One slider per factor. The seven weights always sum to 1: moving one slider rescales the others in proportion,
// and a slider at 0 leaves that factor out of the score. Each move re-ranks the matches live.
import { FACTORS, normaliseWeights, rebalanceWeights } from "../data/scoring.js";
import { FACTOR_LABELS } from "../content/labels.js";

const SLIDER_STEP = 0.01;

export default function WeightSliders({ weights, onChange, onReset, isCustom }) {
  const shares = normaliseWeights(weights);

  return (
    <fieldset className="weight-sliders">
      <legend className="control-label">How much each factor counts (always adds up to 100%)</legend>
      {FACTORS.map((factor) => (
        <div className="weight-row" key={factor} style={{ "--factor-color": `var(--factor-${factor})` }}>
          <label htmlFor={`weight-${factor}`}>{FACTOR_LABELS[factor]}</label>
          <input
            id={`weight-${factor}`}
            type="range"
            min="0"
            max="1"
            step={SLIDER_STEP}
            value={shares[factor]}
            aria-valuetext={`${Math.round(shares[factor] * 100)}% of the score`}
            onChange={(event) => onChange(rebalanceWeights(shares, factor, Number(event.target.value)))}
          />
          <output htmlFor={`weight-${factor}`}>{Math.round(shares[factor] * 100)}%</output>
        </div>
      ))}
      <button className="button button-quiet" type="button" onClick={onReset} disabled={!isCustom}>
        Reset to mission type
      </button>
    </fieldset>
  );
}
