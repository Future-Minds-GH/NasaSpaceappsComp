// Landing workspace, laid out like the team's paper sketch: factor sliders down the left (the main five, plus
// "add your own measurement"), two hovering planets joined by an animated arrow, small "other planets" buttons above
// each one, and a Compute bar along the bottom. One Compute searches Earth, the Moon and Mars at once from the picked
// spot (including the spot's own body), shows a short loading bar, then one similarity vector per body.
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
  const [viewBody, setViewBody] = useState("earth"); // which result body the right-hand globe shows
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

  // One search per body, all from the same picked spot.
  const selection = request?.selection ?? null;
  const searches = {
    earth: useTileSearch(selection, "earth", request?.weights),
    moon: useTileSearch(selection, "moon", request?.weights),
    mars: useTileSearch(selection, "mars", request?.weights),
  };
  const results = Object.fromEntries(BODIES.map((body) => {
    const search = searches[body];
    const matches = (search.data ?? []).filter((match) => !(request && body === request.inputBody && distanceKm(match, request.point, body) < SAME_BODY_EXCLUSION_KM));
    return [body, { search, matches, best: matches[0] ?? null }];
  }));

  const isSettled = Boolean(request) && BODIES.every((body) => !searches[body].isLoading);
  const handleFinished = useCallback(() => setFinishedRequest(request), [request]);
  const status = !request ? "idle" : finishedRequest === request ? "done" : "computing";
  const settingsKey = JSON.stringify([weights, shownFactors]);
  const isStale = Boolean(request) && (request.point !== point || request.inputBody !== inputBody || request.settingsKey !== settingsKey);
  const isShowingResult = status === "done" && !isStale;

  const viewBest = isShowingResult ? results[viewBody].best : null;
  const viewSites = useMemo(
    () => (viewBest ? [{ target_id: "best", name: `Best match · ${Math.round(viewBest.score)}%`, lat: viewBest.lat, lon: viewBest.lon }] : []),
    [viewBest],
  );
  const viewFocus = useMemo(() => (viewBest ? { lat: viewBest.lat, lon: viewBest.lon } : null), [viewBest]);

  function pickInputBody(body) {
    if (body === inputBody) return;
    setInputBody(body);
    setPoint(null);
  }

  function swap() {
    setInputBody(viewBody);
    setViewBody(inputBody);
    setPoint(null);
  }

  function compute() {
    if (!point || !weights) return;
    const scoredWeights = Object.fromEntries(FACTORS.map((factor) => [factor, shownFactors.includes(factor) ? weights[factor] / 100 : 0]));
    setStartedAt(performance.now());
    setRequest({ point, inputBody, selection: { body: inputBody, ...point }, weights: scoredWeights, settingsKey });
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
          <button type="button" className={`workspace-arrow is-${status}`} onClick={swap} aria-label={`Swap: start from ${BODY_NAMES[viewBody]} instead`}>
            <svg viewBox="0 0 160 60" aria-hidden="true">
              <path className="workspace-arrow-line" d="M8 38 C 50 6, 110 6, 146 30" />
              <path className="workspace-arrow-head" d="M134 18 L148 31 L130 36" />
            </svg>
          </button>
          <span className="workspace-arrow-label">{status === "computing" ? "Comparing…" : "Click to swap"}</span>
        </div>

        <PlanetColumn
          side="target"
          body={viewBody}
          choices={BODIES.filter((other) => other !== viewBody)}
          onPickBody={setViewBody}
          caption={viewBest ? `Best match: ${formatCoordinates(viewBest.lat, viewBest.lon)}` : viewBody === inputBody ? `Other places on ${BODY_NAMES[viewBody]}` : `Every tile of ${BODY_NAMES[viewBody]}`}
        >
          <PlanetGlobe body={viewBody} isSpinning={!viewFocus} sites={viewSites} focus={viewFocus} label={`Globe of ${BODY_NAMES[viewBody]}, one of the bodies searched.`} />
        </PlanetColumn>
      </section>

      <ComputeBar
        inputBody={inputBody}
        point={point}
        status={isStale ? "stale" : status}
        startedAt={startedAt}
        isReady={isSettled}
        onFinished={handleFinished}
        onCompute={compute}
        isDisabled={!point || !weights || (status === "computing" && !isStale)}
      />

      {isShowingResult && (
        <section className="similarity-results" aria-label="Similarity on Earth, the Moon and Mars">
          {BODIES.map((body) => (
            <SimilarityVector
              key={body}
              body={body}
              isSameBody={body === request.inputBody}
              isSelected={body === viewBody}
              onSelect={() => setViewBody(body)}
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
      <div className="other-planets" role="group" aria-label={side === "input" ? "Start from another body" : "Show another body's result"}>
        <span className="eyebrow other-planets-label">{side === "input" ? "From" : "Showing"}</span>
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

function toPercent(presetWeights) {
  return Object.fromEntries(FACTORS.map((factor) => [factor, Math.round((presetWeights[factor] ?? 0) * 100)]));
}

function distanceKm(a, b, body) {
  const toRadians = (degrees) => (degrees * Math.PI) / 180;
  const h = Math.sin(toRadians(b.lat - a.lat) / 2) ** 2 + Math.cos(toRadians(a.lat)) * Math.cos(toRadians(b.lat)) * Math.sin(toRadians(b.lon - a.lon) / 2) ** 2;
  return 2 * BODY_RADIUS_KM[body] * Math.asin(Math.sqrt(h));
}
