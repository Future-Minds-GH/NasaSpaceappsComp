// Landing workspace, laid out like the team's paper sketch: factor sliders down the left (the main five, plus
// "add your own measurement"), two hovering planets joined by an animated arrow, small "other planets" buttons above
// side, and a Compute bar along the bottom. Clicking a small planet on the right adds it as another output globe;
// one Compute searches every output planet from the picked spot (its own planet too), shows a short loading bar, then
// one similarity vector per output planet.
import { useCallback, useMemo, useState, useEffect } from "react";
import { loadWeights } from "../data/api.js";
import { useLoaded } from "../data/useLoaded.js";
import { useTileSearch } from "../data/useTileSearch.js";
import { FACTORS } from "../data/scoring.js";
import { formatCoordinates } from "../data/format.js";
import { BODY_RADIUS_KM } from "../data/ranking.js";
import { BODY_NAMES } from "../content/labels.js";
import PlanetGlobe, { GLOBE_TEXTURES } from "../components/PlanetGlobe.jsx";
import FactorSidebar, { MAIN_FACTORS } from "../components/FactorSidebar.jsx";
import ComputeBar from "../components/ComputeBar.jsx";
import SimilarityVector from "../components/SimilarityVector.jsx";
import "../styles/landing.css";

const BODIES = ["earth", "moon", "mars"];
// Same-body searches skip tiles this close to the picked spot, or the best match is the spot itself (plan rule 2).
const SAME_BODY_EXCLUSION_KM = 300;

export default function LandingPage() {
  const presetsState = useLoaded(loadWeights, []);
  const presets = presetsState.data?.presets ?? {};
  const [inputBody, setInputBody] = useState("mars");
  // Output planets: clicking a small planet on the right adds it as another globe; Compute searches each one.
  const [targets, setTargets] = useState(["earth"]);
  const [selectedBody, setSelectedBody] = useState(null); // result card highlighted after Compute
  const [point, setPoint] = useState(null);
  // Sliders start from the Balanced preset; the preset picker was removed, so people only move the sliders.
  const presetId = presetsState.data?.default_preset ?? "balanced";
  const [weights, setWeights] = useState(null); // 0–100 per factor; null until presets load
  const [shownFactors, setShownFactors] = useState(MAIN_FACTORS);
  const [customMeasurements, setCustomMeasurements] = useState([]);
  // The searches run only on Compute: this holds the request that was computed.
  const [request, setRequest] = useState(null);
  const [startedAt, setStartedAt] = useState(0);
  const [finishedRequest, setFinishedRequest] = useState(null);

  useEffect(() => {
    if (weights || !presets[presetId]) return;
    setWeights(toPercent(presets[presetId].weights));
  }, [presets, presetId, weights]);

  // One search per output planet, all from the same picked spot. Planets that weren't added get no selection, so
  // their search never runs.
  const selectionFor = (body) => (request?.targets.includes(body) ? request.selection : null);
  const searches = {
    earth: useTileSearch(selectionFor("earth"), "earth", request?.weights),
    moon: useTileSearch(selectionFor("moon"), "moon", request?.weights),
    mars: useTileSearch(selectionFor("mars"), "mars", request?.weights),
  };
  const results = Object.fromEntries(BODIES.map((body) => {
    const search = searches[body];
    const matches = (search.data ?? []).filter((match) => !(request && body === request.inputBody && distanceKm(match, request.point, body) < SAME_BODY_EXCLUSION_KM));
    return [body, { search, matches, best: matches[0] ?? null }];
  }));

  const isSettled = Boolean(request) && BODIES.every((body) => !searches[body].isLoading);
  const handleFinished = useCallback(() => setFinishedRequest(request), [request]);
  const status = !request ? "idle" : finishedRequest === request ? "done" : "computing";
  const settingsKey = JSON.stringify([weights, shownFactors, targets]);
  const isStale = Boolean(request) && (request.point !== point || request.inputBody !== inputBody || request.settingsKey !== settingsKey);
  const isShowingResult = status === "done" && !isStale;

  const bestOn = (body) => (isShowingResult ? results[body].best : null);

  function pickInputBody(body) {
    if (body === inputBody) return;
    setInputBody(body);
    setPoint(null);
  }

  // Swap the input with the first output planet.
  function swap() {
    const [first, ...rest] = targets;
    setInputBody(first);
    setTargets([inputBody, ...rest.filter((body) => body !== inputBody)]);
    setPoint(null);
  }

  function addTarget(body) {
    setTargets((current) => (current.includes(body) ? current : BODIES.filter((other) => current.includes(other) || other === body)));
  }

  function removeTarget(body) {
    setTargets((current) => (current.length > 1 ? current.filter((other) => other !== body) : current));
  }

  function compute() {
    if (!point || !weights) return;
    const scoredWeights = Object.fromEntries(FACTORS.map((factor) => [factor, shownFactors.includes(factor) ? weights[factor] / 100 : 0]));
    setStartedAt(performance.now());
    setRequest({ point, inputBody, targets, selection: { body: inputBody, ...point }, weights: scoredWeights, settingsKey });
  }

  const inputTile = request?.inputBody === inputBody && request?.point === point ? searches[inputBody].tile : null;

  return (
    <div className="workspace">
      <FactorSidebar
        weights={weights}
        onChangeWeight={(factor, value) => setWeights((current) => ({ ...current, [factor]: value }))}
        shownFactors={shownFactors}
        onShowFactor={(factor) => setShownFactors((current) => [...current, factor])}
        onHideFactor={(factor) => setShownFactors((current) => current.filter((shown) => shown !== factor))}
        customMeasurements={customMeasurements}
        onAddCustom={(name) => setCustomMeasurements((current) => [...current, { id: `${Date.now()}`, name, weight: 50 }])}
        onChangeCustom={(id, weight) => setCustomMeasurements((current) => current.map((item) => (item.id === id ? { ...item, weight } : item)))}
        onRemoveCustom={(id) => setCustomMeasurements((current) => current.filter((item) => item.id !== id))}
      />

      <section className="workspace-stage" aria-label="Pick a spot, then compare">
        <PlanetColumn
          side="input"
          body={inputBody}
          choices={BODIES.filter((other) => other !== inputBody)}
          onPickBody={pickInputBody}
          caption={point ? formatCoordinates(point.lat, point.lon) : `Click anywhere on ${BODY_NAMES[inputBody]}`}
        >
          <PlanetGlobe
            body={inputBody}
            isInteractive
            selectedTile={inputTile}
            sites={point ? [{ target_id: "pick", name: "Your spot", lat: point.lat, lon: point.lon }] : []}
            onPick={(lat, lon) => setPoint({ lat, lon })}
            label={`Globe of ${BODY_NAMES[inputBody]}. Drag to turn it, click a spot to pick it.`}
          />
        </PlanetColumn>

        <div className="workspace-arrow-wrap">
          <button type="button" className={`workspace-arrow is-${status}`} onClick={swap} aria-label={`Swap: start from ${BODY_NAMES[targets[0]]} instead`}>
            <svg viewBox="0 0 160 60" aria-hidden="true">
              <path className="workspace-arrow-line" d="M8 38 C 50 6, 110 6, 146 30" />
              <path className="workspace-arrow-head" d="M134 18 L148 31 L130 36" />
            </svg>
          </button>
          <span className="workspace-arrow-label">{status === "computing" ? "Comparing…" : "Click to swap"}</span>
        </div>

        <div className={`planet-column planet-column-target targets-${targets.length}`}>
          <div className="other-planets" role="group" aria-label="Add an output planet">
            <span className="eyebrow other-planets-label">{targets.length < BODIES.length ? "Compare to · click to add" : "Comparing to all three"}</span>
            <div className="other-planets-row">
              {BODIES.filter((other) => !targets.includes(other)).map((other) => (
                <button key={other} type="button" className="other-planet is-addable" onClick={() => addTarget(other)} title={`Add ${BODY_NAMES[other]}`}>
                  <span className="other-planet-globe" style={{ backgroundImage: `url(${GLOBE_TEXTURES[other].url})` }} aria-hidden="true" />
                  <span className="other-planet-name">+ {BODY_NAMES[other]}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="target-globes">
            {targets.map((body) => (
              <TargetGlobe
                key={body}
                body={body}
                best={bestOn(body)}
                isSelected={selectedBody === body}
                isSamePlanet={body === inputBody}
                onRemove={targets.length > 1 ? () => removeTarget(body) : null}
              />
            ))}
          </div>
        </div>
      </section>

      <ComputeBar
        inputBody={inputBody}
        targetNames={formatList(targets.map((body) => BODY_NAMES[body]))}
        point={point}
        status={isStale ? "stale" : status}
        startedAt={startedAt}
        isReady={isSettled}
        onFinished={handleFinished}
        onCompute={compute}
        isDisabled={!point || !weights || (status === "computing" && !isStale)}
      />

      {isShowingResult && (
        <section className="similarity-results" aria-label="Similarity on each output planet">
          {request.targets.map((body) => (
            <SimilarityVector
              key={body}
              body={body}
              isSameBody={body === request.inputBody}
              isSelected={body === selectedBody}
              onSelect={() => setSelectedBody(body)}
              match={results[body].best}
              matchCount={results[body].matches.length}
              error={results[body].search.error}
              hasNoData={results[body].search.hasNoData}
              isApproximate={results[body].search.isApproximate}
              inputBody={request.inputBody}
              weights={request.weights}
              customMeasurements={customMeasurements}
              exploreLink={body === request.inputBody ? null : `/explore/${request.inputBody}?to=${body}&at=${request.point.lat.toFixed(2)},${request.point.lon.toFixed(2)}&preset=${presetId}`}
            />
          ))}
        </section>
      )}
    </div>
  );
}

function PlanetColumn({ side, body, choices, onPickBody, caption, children }) {
  return (
    <div className={`planet-column planet-column-${side} body-${body}`}>
      <div className="other-planets" role="group" aria-label="Start from another body">
        <span className="eyebrow other-planets-label">From</span>
        <div className="other-planets-row">
          {choices.map((other) => (
            <button key={other} type="button" className="other-planet" onClick={() => onPickBody(other)} title={BODY_NAMES[other]}>
              <span className="other-planet-globe" style={{ backgroundImage: `url(${GLOBE_TEXTURES[other].url})` }} aria-hidden="true" />
              <span className="other-planet-name">{BODY_NAMES[other]}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="hovering-planet">{children}</div>
      <div className="planet-caption">
        <span className="planet-caption-name">{BODY_NAMES[body]}</span>
        <span className="planet-caption-detail">{caption}</span>
      </div>
    </div>
  );
}

// One output globe. The best-match label and focus are memoised so the globe only flies when the result changes.
function TargetGlobe({ body, best, isSelected, isSamePlanet, onRemove }) {
  const sites = useMemo(() => (best ? [{ target_id: "best", name: `${Math.round(best.score)}%`, lat: best.lat, lon: best.lon }] : []), [best]);
  const focus = useMemo(() => (best ? { lat: best.lat, lon: best.lon } : null), [best]);
  return (
    <div className={`target-globe body-${body}${isSelected ? " is-selected" : ""}`}>
      <div className="hovering-planet">
        <PlanetGlobe body={body} isSpinning={!best} sites={sites} focus={focus} label={`Globe of ${BODY_NAMES[body]}, an output planet.`} />
        {/* Hovering the planet shows a big X over it; clicking the planet removes it (at least one always stays). */}
        {onRemove && (
          <button type="button" className="target-remove" onClick={onRemove} aria-label={`Remove ${BODY_NAMES[body]}`}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6 L18 18 M18 6 L6 18" /></svg>
          </button>
        )}
      </div>
      <div className="planet-caption">
        <span className="planet-caption-name">{BODY_NAMES[body]}</span>
        <span className="planet-caption-detail">{best ? `${Math.round(best.score)}% · ${formatCoordinates(best.lat, best.lon)}` : isSamePlanet ? "Same planet" : "Every tile"}</span>
      </div>
    </div>
  );
}

function formatList(names) {
  return names.length < 3 ? names.join(" & ") : `${names.slice(0, -1).join(", ")} & ${names[names.length - 1]}`;
}

function toPercent(presetWeights) {
  return Object.fromEntries(FACTORS.map((factor) => [factor, Math.round((presetWeights[factor] ?? 0) * 100)]));
}

function distanceKm(a, b, body) {
  const toRadians = (degrees) => (degrees * Math.PI) / 180;
  const h = Math.sin(toRadians(b.lat - a.lat) / 2) ** 2 + Math.cos(toRadians(a.lat)) * Math.cos(toRadians(b.lat)) * Math.sin(toRadians(b.lon - a.lon) / 2) ** 2;
  return 2 * BODY_RADIUS_KM[body] * Math.asin(Math.sqrt(h));
}
