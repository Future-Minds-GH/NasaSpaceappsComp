// The seven factor scores as labelled bars, like the unit boxes in a geologic map legend.
// Numbers appear only when the Details panel is open, so the default view stays simple.
import { FACTORS } from "../data/scoring.js";
import { FACTOR_LABELS, FACTOR_MEANINGS } from "../content/labels.js";

export default function FactorBars({ breakdown, isShowingNumbers = false, isMineralogyEstimated = false }) {
  return (
    <dl className={isShowingNumbers ? "factor-bars is-detailed" : "factor-bars"}>
      {FACTORS.map((factor) => {
        const value = breakdown?.[factor];
        const isEstimated = factor === "mineralogy" && isMineralogyEstimated;
        // A missing factor (no data, or no atmosphere on the Moon) is left out of the score, which is not the same as 0.
        if (value === null || value === undefined) {
          return (
            <div className="factor-row is-missing" key={factor} style={{ "--factor-color": `var(--factor-${factor})` }}>
              <dt className="factor-name">{FACTOR_LABELS[factor]}</dt>
              <dd className="factor-value factor-not-scored">{factor === "atmosphere" ? "Not applicable on the Moon" : "not compared (no data)"}</dd>
            </div>
          );
        }
        return (
          <div className="factor-row" key={factor} style={{ "--factor-color": `var(--factor-${factor})` }}>
            <dt className="factor-name">
              {FACTOR_LABELS[factor]}
              {isEstimated && <span className="factor-estimated">estimated</span>}
              {isShowingNumbers && <span className="factor-meaning">{FACTOR_MEANINGS[factor]}</span>}
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
