// Left column of the sketch: the mode toggle, then one 0-100 weight slider per factor, grouped as in weights.json
// (weather / ground). Moving one slider never moves another. Any factor can be removed (one always stays) and added back
// from the dropdown.
import { FACTORS } from "../data/scoring.js";
import { DEFAULT_GROUPS, FACTOR_LABELS, FACTOR_MEANINGS, GROUP_LABELS } from "../content/labels.js";
import ModeToggle from "./ModeToggle.jsx";

/** A factor weight (0–100) in words, so the number needs no unit. */
function factorWord(value) {
  if (value === 0) return "Off";
  if (value < 34) return "Low";
  if (value < 67) return "Medium";
  return "High";
}

export default function FactorSidebar({ weights, groups = DEFAULT_GROUPS, mode, onChangeMode, onChangeWeight, shownFactors, onShowFactor, onHideFactor }) {
  const hiddenFactors = FACTORS.filter((factor) => !shownFactors.includes(factor));

  return (
    <aside className="factor-sidebar" aria-labelledby="factor-sidebar-title">
      <h2 id="factor-sidebar-title" className="factor-sidebar-title">Factor sliders</h2>
      <ModeToggle mode={mode} onChange={onChangeMode} />
      <p className="factor-sidebar-intro">How much each factor counts</p>

      <div className="factor-groups">
      {Object.entries(groups).map(([group, factors]) => {
        const shown = factors.filter((factor) => shownFactors.includes(factor));
        if (shown.length === 0) return null;
        return (
          <section key={group} aria-label={GROUP_LABELS[group] ?? group}>
            <h3 className="factor-group">{GROUP_LABELS[group] ?? group}</h3>
            <ul className="factor-slider-list">
              {shown.map((factor) => {
                const value = weights?.[factor] ?? 0;
                return (
                  <li key={factor} className="factor-slider" style={{ "--factor-color": `var(--factor-${factor})` }}>
                    <div className="factor-slider-head">
                      <label htmlFor={`slider-${factor}`} title={FACTOR_MEANINGS[factor]}>
                        <span className="factor-swatch" aria-hidden="true" />
                        {FACTOR_LABELS[factor]}
                      </label>
                      <output htmlFor={`slider-${factor}`} title={`${value} of 100`}>{factorWord(value)}</output>
                      {shownFactors.length > 1 && (
                        <button type="button" className="factor-remove" onClick={() => onHideFactor(factor)} aria-label={`Remove ${FACTOR_LABELS[factor]}`}>×</button>
                      )}
                    </div>
                    <input
                      id={`slider-${factor}`}
                      type="range" min="0" max="100" step="1" value={value} disabled={!weights}
                      aria-valuetext={`weight ${value} of 100`}
                      onChange={(event) => onChangeWeight(factor, Number(event.target.value))}
                    />
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
      </div>

      {hiddenFactors.length > 0 && (
        <label className="factor-add-select">
          <span className="visually-hidden">Add a factor back</span>
          <select value="" disabled={!weights} onChange={(event) => onShowFactor(event.target.value)}>
            <option value="" disabled>+ Add a factor</option>
            {hiddenFactors.map((factor) => <option key={factor} value={factor}>{FACTOR_LABELS[factor]}</option>)}
          </select>
        </label>
      )}
    </aside>
  );
}
