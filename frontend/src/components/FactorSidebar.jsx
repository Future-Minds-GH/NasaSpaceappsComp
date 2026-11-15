// Left column of the sketch: "Factor sliders — main five — + add their own measurement". Each slider is a 0–100
// weight; the share each one ends up with is shown beside it. The two other data factors (geology, atmosphere) can be
// added back, and people can add a measurement of their own: it is listed but not scored until the data has it.
import { useState } from "react";
import { FACTORS } from "../data/scoring.js";
import { FACTOR_LABELS, FACTOR_MEANINGS } from "../content/labels.js";

export const MAIN_FACTORS = ["terrain", "elevation", "mineralogy", "climate", "water_ice"];

export default function FactorSidebar({
  presets, presetId, onSelectPreset, weights, onChangeWeight, shownFactors, onShowFactor, onHideFactor,
  customMeasurements, onAddCustom, onChangeCustom, onRemoveCustom,
}) {
  const [isAdding, setIsAdding] = useState(false);
  const [customName, setCustomName] = useState("");
  const hiddenFactors = FACTORS.filter((factor) => !shownFactors.includes(factor));
  const total = shownFactors.reduce((sum, factor) => sum + (weights?.[factor] ?? 0), 0);

  function submitCustom(event) {
    event.preventDefault();
    const name = customName.trim();
    if (!name) return;
    onAddCustom(name);
    setCustomName("");
    setIsAdding(false);
  }

  return (
    <aside className="factor-sidebar" aria-labelledby="factor-sidebar-title">
      <h2 id="factor-sidebar-title" className="factor-sidebar-title">Factor sliders</h2>

      <label className="factor-preset">
        <span className="eyebrow">What are you testing?</span>
        <select value={presetId} onChange={(event) => onSelectPreset(event.target.value)}>
          {Object.entries(presets).map(([id, preset]) => <option key={id} value={id}>{preset.label}</option>)}
        </select>
      </label>

      <ul className="factor-slider-list">
        {shownFactors.map((factor) => {
          const value = weights?.[factor] ?? 0;
          const share = total > 0 ? Math.round((value / total) * 100) : 0;
          return (
            <li key={factor} className="factor-slider" style={{ "--factor-color": `var(--factor-${factor})` }}>
              <div className="factor-slider-head">
                <label htmlFor={`slider-${factor}`} title={FACTOR_MEANINGS[factor]}>
                  <span className="factor-swatch" aria-hidden="true" />
                  {FACTOR_LABELS[factor]}
                </label>
                <output htmlFor={`slider-${factor}`}>{share}%</output>
                {!MAIN_FACTORS.includes(factor) && (
                  <button type="button" className="factor-remove" onClick={() => onHideFactor(factor)} aria-label={`Remove ${FACTOR_LABELS[factor]}`}>×</button>
                )}
              </div>
              <input
                id={`slider-${factor}`}
                type="range" min="0" max="100" step="1" value={value} disabled={!weights}
                aria-valuetext={`${share}% of the score`}
                onChange={(event) => onChangeWeight(factor, Number(event.target.value))}
              />
            </li>
          );
        })}
        {customMeasurements.map((item) => (
          <li key={item.id} className="factor-slider is-custom">
            <div className="factor-slider-head">
              <label htmlFor={`slider-${item.id}`}>
                <span className="factor-swatch" aria-hidden="true" />
                {item.name}
              </label>
              <output htmlFor={`slider-${item.id}`}>{item.weight}</output>
              <button type="button" className="factor-remove" onClick={() => onRemoveCustom(item.id)} aria-label={`Remove ${item.name}`}>×</button>
            </div>
            <input id={`slider-${item.id}`} type="range" min="0" max="100" step="1" value={item.weight} onChange={(event) => onChangeCustom(item.id, Number(event.target.value))} />
            <p className="factor-custom-note">No data yet: listed, not scored.</p>
          </li>
        ))}
      </ul>

      {isAdding ? (
        <form className="factor-add-form" onSubmit={submitCustom}>
          {hiddenFactors.length > 0 && (
            <div className="factor-add-known">
              <span className="eyebrow">From our data</span>
              {hiddenFactors.map((factor) => (
                <button key={factor} type="button" className="factor-add-chip" onClick={() => { onShowFactor(factor); setIsAdding(false); }}>
                  + {FACTOR_LABELS[factor]}
                </button>
              ))}
            </div>
          )}
          <label className="factor-add-custom">
            <span className="eyebrow">Or name your own</span>
            <input type="text" value={customName} onChange={(event) => setCustomName(event.target.value)} placeholder="e.g. Radiation dose" autoFocus />
          </label>
          <div className="factor-add-actions">
            <button type="submit" className="button button-quiet" disabled={!customName.trim()}>Add</button>
            <button type="button" className="button button-quiet" onClick={() => setIsAdding(false)}>Cancel</button>
          </div>
        </form>
      ) : (
        <button type="button" className="factor-add" onClick={() => setIsAdding(true)}>
          <span aria-hidden="true">+</span> Add your own measurement
        </button>
      )}
    </aside>
  );
}
