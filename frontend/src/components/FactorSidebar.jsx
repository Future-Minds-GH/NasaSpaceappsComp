// Left column of the workspace: how to compare (Absolute or Relative), then one 0-100 weight slider per scored factor.
// Moving one slider never moves another, and a slider at Off leaves that factor out. On phones the panel folds away
// behind one button, so the globes come first.
import { useState } from "react";
import { FACTORS, SCORED_FACTORS } from "../data/scoring.js";
import { FACTOR_LABELS, FACTOR_MEANINGS } from "../content/labels.js";
import ModeToggle from "./ModeToggle.jsx";

export default function FactorSidebar({ weights, mode, onChangeMode, onChangeWeight }) {
  const [isOpenOnPhone, setIsOpenOnPhone] = useState(false);

  return (
    <aside className="factor-sidebar" aria-labelledby="factor-sidebar-title">
      <div className="factor-sidebar-head">
        <h2 id="factor-sidebar-title" className="factor-sidebar-title">What counts</h2>
        {/* Only shown on phones; on wider screens the panel is always open. */}
        <button
          type="button"
          className="button button-quiet factor-sidebar-toggle"
          aria-expanded={isOpenOnPhone}
          aria-controls="factor-sidebar-body"
          onClick={() => setIsOpenOnPhone((isOpen) => !isOpen)}
        >
          {isOpenOnPhone ? "Done" : "Adjust"}
        </button>
      </div>

      <div id="factor-sidebar-body" className={isOpenOnPhone ? "factor-sidebar-body is-open" : "factor-sidebar-body"}>
        <ModeToggle mode={mode} onChange={onChangeMode} />

        <fieldset className="factor-sliders">
          <legend className="control-label">How much each factor counts</legend>
          <ul className="factor-slider-list">
            {SCORED_FACTORS.map((factor) => (
              <FactorSlider key={factor} factor={factor} value={weights?.[factor] ?? 0} isDisabled={!weights} onChange={onChangeWeight} />
            ))}
          </ul>
        </fieldset>

        <p className="factor-sidebar-note">
          {SCORED_FACTORS.length} of the {FACTORS.length} measured factors count: the ones the Balanced mission type weighs most.
        </p>
      </div>
    </aside>
  );
}

function FactorSlider({ factor, value, isDisabled, onChange }) {
  const inputId = `slider-${factor}`;
  return (
    <li className="factor-slider" style={{ "--factor-color": `var(--factor-${factor})` }}>
      <div className="factor-slider-head">
        <label htmlFor={inputId} title={FACTOR_MEANINGS[factor]}>
          <span className="factor-swatch" aria-hidden="true" />
          {FACTOR_LABELS[factor]}
        </label>
        <output htmlFor={inputId}>{describeWeight(value)}</output>
      </div>
      <input
        id={inputId}
        className="range"
        type="range"
        min="0"
        max="100"
        step="1"
        value={value}
        disabled={isDisabled}
        style={{ "--fill": `${value}%` }}
        aria-valuetext={`${describeWeight(value)}, ${value} of 100`}
        aria-description={FACTOR_MEANINGS[factor]}
        onChange={(event) => onChange(factor, Number(event.target.value))}
      />
    </li>
  );
}

/** A factor weight (0–100) in words, so the number needs no unit. */
function describeWeight(value) {
  if (value === 0) return "Off";
  if (value < 34) return "Low";
  if (value < 67) return "Medium";
  return "High";
}
