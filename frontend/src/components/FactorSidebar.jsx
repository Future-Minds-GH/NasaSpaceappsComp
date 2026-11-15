// Left column of the sketch: "Factor sliders — main five — + add their own measurement". Each factor slider is its own
// 0–100 weight (moving one never moves another). "+ Add a measurement" lists the single measurements each factor is
// built from (temperature, slope, clays…); an added one gets its own slider under its factor that sets how much it
// counts inside that factor (1× is the default). Any factor can be removed (one always stays) and added back.
import { useState } from "react";
import { FACTORS } from "../data/scoring.js";
import { FACTOR_LABELS, FACTOR_MEANINGS, MEASUREMENTS } from "../content/labels.js";

export const MAIN_FACTORS = ["terrain", "elevation", "mineralogy", "climate", "water_ice"];
export const MEASUREMENT_DEFAULT = 100; // 100 = 1×

export default function FactorSidebar({ weights, onChangeWeight, shownFactors, onShowFactor, onHideFactor, measurements, onAddMeasurement, onChangeMeasurement, onRemoveMeasurement }) {
  const [isAdding, setIsAdding] = useState(false);
  const hiddenFactors = FACTORS.filter((factor) => !shownFactors.includes(factor));

  return (
    <aside className="factor-sidebar" aria-labelledby="factor-sidebar-title">
      <h2 id="factor-sidebar-title" className="factor-sidebar-title">Factor sliders</h2>
      <p className="factor-sidebar-intro">Weights of the measurements</p>

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
                <output htmlFor={`slider-${factor}`}>{value}</output>
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
                          <output htmlFor={`slider-${item.key}`}>{(measurementValue / 100).toFixed(1)}×</output>
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

      {isAdding ? (
        <div className="factor-add-panel">
          <div className="factor-add-panel-head">
            <span className="eyebrow">Add a measurement</span>
            <button type="button" className="factor-remove" onClick={() => setIsAdding(false)} aria-label="Close">×</button>
          </div>
          {FACTORS.map((factor) => {
            const available = MEASUREMENTS.filter((item) => item.factor === factor && !(item.key in measurements));
            if (available.length === 0) return null;
            return (
              <div key={factor} className="factor-add-group" style={{ "--factor-color": `var(--factor-${factor})` }}>
                <span className="factor-add-group-name"><span className="factor-swatch" aria-hidden="true" />{FACTOR_LABELS[factor]}</span>
                <div className="factor-add-chips">
                  {available.map((item) => (
                    <button key={item.key} type="button" className="factor-add-chip" onClick={() => onAddMeasurement(item)}>+ {item.label}</button>
                  ))}
                </div>
              </div>
            );
          })}
          {hiddenFactors.length > 0 && (
            <div className="factor-add-group">
              <span className="factor-add-group-name">Whole factors</span>
              <div className="factor-add-chips">
                {hiddenFactors.map((factor) => (
                  <button key={factor} type="button" className="factor-add-chip" onClick={() => onShowFactor(factor)}>+ {FACTOR_LABELS[factor]}</button>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        <button type="button" className="factor-add" onClick={() => setIsAdding(true)}>
          <span aria-hidden="true">+</span> Add a measurement
        </button>
      )}
    </aside>
  );
}
