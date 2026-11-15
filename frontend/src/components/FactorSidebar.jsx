// Left column of the sketch: "Factor sliders — main five — + add their own measurement". Each factor slider is its own
// 0–100 weight (moving one never moves another). the "+ Add a measurement" dropdown lists the single measurements each factor is
// built from (temperature, slope, clays…); an added one gets its own slider under its factor that sets how much it
// counts inside that factor (1× is the default). Only measurements with data are listed. Any factor can be removed (one always stays) and added back.
import { FACTORS } from "../data/scoring.js";
import { FACTOR_LABELS, FACTOR_MEANINGS, FACTORS_WITH_DATA, MEASUREMENTS } from "../content/labels.js";

export const MAIN_FACTORS = ["terrain", "elevation", "mineralogy", "climate", "water_ice"];
export const MEASUREMENT_DEFAULT = 100; // 100 = 1×

/** A factor weight (0–100) in words, so the number needs no unit. */
function factorWord(value) {
  if (value === 0) return "Off";
  if (value < 34) return "Low";
  if (value < 67) return "Medium";
  return "High";
}

/** A measurement multiplier (0–300, 100 = normal) in words. */
function measurementWord(value) {
  if (value === 0) return "Off";
  if (value < 100) return "Less";
  if (value === 100) return "Normal";
  if (value < 200) return "More";
  return "Much more";
}

export default function FactorSidebar({ weights, onChangeWeight, shownFactors, onShowFactor, onHideFactor, measurements, onAddMeasurement, onChangeMeasurement, onRemoveMeasurement }) {
  // Only factors the data has can be added back; geology and atmosphere have no values yet.
  const hiddenFactors = FACTORS_WITH_DATA.filter((factor) => !shownFactors.includes(factor));

  return (
    <aside className="factor-sidebar" aria-labelledby="factor-sidebar-title">
      <h2 id="factor-sidebar-title" className="factor-sidebar-title">Factor sliders</h2>
      <p className="factor-sidebar-intro">Weights of the measurements: how much each one counts</p>

      <ul className="factor-slider-list">
        {shownFactors.map((factor) => {
          const value = weights?.[factor] ?? 0;
          const added = MEASUREMENTS.filter((item) => item.factor === factor && item.key in measurements);
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
              {added.length > 0 && (
                <ul className="measurement-list" aria-label={`Measurements inside ${FACTOR_LABELS[factor]}`}>
                  {added.map((item) => {
                    const measurementValue = measurements[item.key];
                    return (
                      <li key={item.key} className="measurement-slider">
                        <div className="factor-slider-head">
                          <label htmlFor={`slider-${item.key}`}>{item.label}</label>
                          <output htmlFor={`slider-${item.key}`} title={`${(measurementValue / 100).toFixed(1)}×`}>{measurementWord(measurementValue)}</output>
                          <button type="button" className="factor-remove" onClick={() => onRemoveMeasurement(item.key)} aria-label={`Remove ${item.label}`}>×</button>
                        </div>
                        <input
                          id={`slider-${item.key}`}
                          type="range" min="0" max="300" step="10" value={measurementValue}
                          aria-valuetext={`${(measurementValue / 100).toFixed(1)} times its usual weight inside ${FACTOR_LABELS[factor]}`}
                          onChange={(event) => onChangeMeasurement(item.key, Number(event.target.value))}
                        />
                      </li>
                    );
                  })}
                  {value === 0 && <li className="measurement-note">{FACTOR_LABELS[factor]} is at 0, so these don't count yet.</li>}
                </ul>
              )}
            </li>
          );
        })}
      </ul>

      {/* One dropdown, grouped by factor: picking an entry adds it and the dropdown goes back to its prompt. */}
      <label className="factor-add-select">
        <span className="visually-hidden">Add a measurement</span>
        <select
          value=""
          onChange={(event) => {
            const choice = event.target.value;
            if (choice.startsWith("factor:")) onShowFactor(choice.slice(7));
            else {
              const item = MEASUREMENTS.find((measurement) => measurement.key === choice);
              if (item) onAddMeasurement(item);
            }
          }}
        >
          <option value="" disabled>+ Add a measurement</option>
          {FACTORS.map((factor) => {
            const available = MEASUREMENTS.filter((item) => item.factor === factor && !(item.key in measurements));
            if (available.length === 0) return null;
            return (
              <optgroup key={factor} label={FACTOR_LABELS[factor]}>
                {available.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
              </optgroup>
            );
          })}
          {hiddenFactors.length > 0 && (
            <optgroup label="Whole factors">
              {hiddenFactors.map((factor) => <option key={factor} value={`factor:${factor}`}>{FACTOR_LABELS[factor]}</option>)}
            </optgroup>
          )}
        </select>
      </label>
    </aside>
  );
}
