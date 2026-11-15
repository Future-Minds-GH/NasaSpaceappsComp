// The nine factor scores as labelled bars, like the unit boxes in a geologic map legend. Numbers (and the real values
// of the two places, when known) appear only when the Details panel is open, so the default view stays simple.
import { FACTORS } from "../data/scoring.js";
import { FACTOR_LABELS, FACTOR_MEANINGS } from "../content/labels.js";

export default function FactorBars({ breakdown, isShowingNumbers = false, isMineralogyEstimated = false, values = null, typicalFactors = [], tempNote = null }) {
  return (
    <dl className={isShowingNumbers ? "factor-bars is-detailed" : "factor-bars"}>
      {FACTORS.map((factor) => {
        const value = breakdown?.[factor];
        const isEstimated = factor === "minerals" && isMineralogyEstimated;
        // A missing factor (no data on one of the two places) is left out of the score, which is not the same as 0.
        if (value === null || value === undefined) {
          return (
            <div className="factor-row is-missing" key={factor} style={{ "--factor-color": `var(--factor-${factor})` }}>
              <dt className="factor-name">{FACTOR_LABELS[factor]}</dt>
              <dd className="factor-value factor-not-scored">no data</dd>
            </div>
          );
        }
        return (
          <div className="factor-row" key={factor} style={{ "--factor-color": `var(--factor-${factor})` }}>
            <dt className="factor-name">
              {FACTOR_LABELS[factor]}
              {isEstimated && <span className="factor-estimated">estimated</span>}
              {typicalFactors.includes(factor) && <span className="factor-estimated">no data: typical score</span>}
              {isShowingNumbers && <span className="factor-meaning">{FACTOR_MEANINGS[factor]}</span>}
              {isShowingNumbers && values?.[factor] && <span className="factor-real-value">{values[factor]}</span>}
              {factor === "temp" && tempNote && <span className="factor-real-value">{tempNote}</span>}
            </dt>
            <dd className="factor-value">
              <span className={isEstimated ? "factor-bar is-estimated" : "factor-bar"}>
                <span className="factor-bar-fill" style={{ width: `${Math.round(value * 100)}%` }} />
              </span>
              {isShowingNumbers ? (
                <span className="factor-number">{value.toFixed(2)}</span>
              ) : (
                <span className="visually-hidden">{Math.round(value * 100)} out of 100</span>
              )}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}
