// Landing workspace, laid out like the team's paper sketch: factor sliders down the left (the main five, plus
// "add your own measurement"), two hovering planets joined by an animated arrow, small "other planets" buttons above
// each one, and a Compute bar along the bottom. Compute runs the real tile search, shows a short loading bar, then the
// similarity vector for the best match.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { loadWeights } from "../data/api.js";
import { useLoaded } from "../data/useLoaded.js";
import { useTileSearch } from "../data/useTileSearch.js";
import { FACTORS } from "../data/scoring.js";
import { formatCoordinates } from "../data/format.js";
import { BODY_NAMES } from "../content/labels.js";
import PlanetGlobe, { GLOBE_TEXTURES } from "../components/PlanetGlobe.jsx";
import FactorSidebar, { MAIN_FACTORS } from "../components/FactorSidebar.jsx";
import ComputeBar from "../components/ComputeBar.jsx";
import SimilarityVector from "../components/SimilarityVector.jsx";
import "../styles/landing.css";

const BODIES = ["earth", "moon", "mars"];

export default function LandingPage() {
  const presetsState = useLoaded(loadWeights, []);
  const presets = presetsState.data?.presets ?? {};
  const [inputBody, setInputBody] = useState("mars");
  const [targetBody, setTargetBody] = useState("earth");
  const [point, setPoint] = useState(null);
  const [presetId, setPresetId] = useState("balanced");
  const [weights, setWeights] = useState(null); // 0–100 per factor; null until presets load
  const [shownFactors, setShownFactors] = useState(MAIN_FACTORS);
  const [customMeasurements, setCustomMeasurements] = useState([]);
  // The search runs only on Compute: this holds the request that was computed.
  const [request, setRequest] = useState(null);
  const [startedAt, setStartedAt] = useState(0);
  const [finishedRequest, setFinishedRequest] = useState(null);

  useEffect(() => {
    if (weights || !presets[presetId]) return;
    setWeights(toPercent(presets[presetId].weights));
  }, [presets, presetId, weights]);

  const search = useTileSearch(request?.selection ?? null, request?.targetBody ?? targetBody, request?.weights);
  const bestMatch = search.data?.[0] ?? null;

  const handleFinished = useCallback(() => setFinishedRequest(request), [request]);

  const isSettled = Boolean(request) && !search.isLoading;
  const status = !request ? "idle" :  finishedRequest === request ? "done" : "computing";
  // Anything changed since the last Compute makes the shown result stale.
  const isStale = Boolean(request) && (request.point !== point || request.targetBody !== targetBody || request.inputBody !== inputBody || request.weightsKey !== JSON.stringify([weights, shownFactors]));

  const targetSites = useMemo(
    () => (status === "done" && bestMatch && !isStale ? [{ target_id: "best", name: `Best match · ${Math.round(bestMatch.score)}%`, lat: bestMatch.lat, lon: bestMatch.lon }] : []),
    [status, bestMatch, isStale],
  );
  const targetFocus = targetSites[0] ? { lat: targetSites[0].lat, lon: targetSites[0].lon } : null;

  function pickBody(side, body) {
    const [own, other, setOwn, setOther] = side === "input" ? [inputBody, targetBody, setInputBody, setTargetBody] : [targetBody, inputBody, setTargetBody, setInputBody];
    if (body === own) return;
    if (body === other) setOther(own); // never compare a body with itself: swap instead
    setOwn(body);
    if (side === "input" || body === other) setPoint(null);
  }

  function swap() {
    setInputBody(targetBody);
    setTargetBody(inputBody);
    setPoint(null);
  }

  function choosePreset(nextId) {
    setPresetId(nextId);
    if (presets[nextId]) setWeights(toPercent(presets[nextId].weights));
  }

  function compute() {
    if (!point || !weights) return;
    const scoredWeights = Object.fromEntries(FACTORS.map((factor) => [factor, shownFactors.includes(factor) ? weights[factor] / 100 : 0]));
    setStartedAt(performance.now());
    setRequest({ point, inputBody, targetBody, selection: { body: inputBody, ...point }, weights: scoredWeights, weightsKey: JSON.stringify([weights, shownFactors]) });
  }

  return (
    <div className="workspace">
      <FactorSidebar
        presets={presets}
        presetId={presetId}
        onSelectPreset={choosePreset}
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
          onPickBody={(body) => pickBody("input", body)}
          caption={point ? formatCoordinates(point.lat, point.lon) : `Click anywhere on ${BODY_NAMES[inputBody]}`}
        >
          <PlanetGlobe
            body={inputBody}
            isInteractive
            selectedTile={search.tile && request?.inputBody === inputBody && request?.point === point ? search.tile : null}
            sites={point ? [{ target_id: "pick", name: "Your spot", lat: point.lat, lon: point.lon }] : []}
            onPick={(lat, lon) => setPoint({ lat, lon })}
            label={`Globe of ${BODY_NAMES[inputBody]}. Drag to turn it, click a spot to pick it.`}
          />
        </PlanetColumn>

        <div className="workspace-arrow-wrap">
          <button type="button" className={`workspace-arrow is-${status}`} onClick={swap} aria-label={`Swap: compare ${BODY_NAMES[targetBody]} to ${BODY_NAMES[inputBody]} instead`}>
            <svg viewBox="0 0 160 60" aria-hidden="true">
              <path className="workspace-arrow-line" d="M8 38 C 50 6, 110 6, 146 30" />
              <path className="workspace-arrow-head" d="M134 18 L148 31 L130 36" />
            </svg>
          </button>
          <span className="workspace-arrow-label">{status === "computing" ? "Comparing…" : "Click to swap"}</span>
        </div>

        <PlanetColumn
          side="target"
          body={targetBody}
          onPickBody={(body) => pickBody("target", body)}
          caption={targetSites[0] ? `Best match: ${formatCoordinates(targetSites[0].lat, targetSites[0].lon)}` : `Searching every tile of ${BODY_NAMES[targetBody]}`}
        >
          <PlanetGlobe body={targetBody} isSpinning={!targetFocus} sites={targetSites} focus={targetFocus} label={`Globe of ${BODY_NAMES[targetBody]}, the body being searched.`} />
        </PlanetColumn>
      </section>

      <ComputeBar
        inputBody={inputBody}
        targetBody={targetBody}
        point={point}
        presetLabel={presets[presetId]?.label}
        status={isStale ? "stale" : status}
        startedAt={startedAt}
        isReady={isSettled}
        onFinished={handleFinished}
        onCompute={compute}
        isDisabled={!point || !weights || (status === "computing" && !isStale)}
      />

      {status === "done" && !isStale && (
        <SimilarityVector
          match={bestMatch}
          matchCount={search.data?.length ?? 0}
          error={search.error}
          hasNoData={search.hasNoData}
          isApproximate={search.isApproximate}
          inputBody={request.inputBody}
          targetBody={request.targetBody}
          point={request.point}
          weights={request.weights}
          customMeasurements={customMeasurements}
          exploreLink={`/explore/${request.inputBody}?to=${request.targetBody}&at=${request.point.lat.toFixed(2)},${request.point.lon.toFixed(2)}&preset=${presetId}`}
        />
      )}
    </div>
  );
}

function PlanetColumn({ side, body, onPickBody, caption, children }) {
  return (
    <div className={`planet-column planet-column-${side} body-${body}`}>
      <div className="other-planets" role="group" aria-label={side === "input" ? "Start from another body" : "Compare to another body"}>
        <span className="eyebrow other-planets-label">{side === "input" ? "From" : "Compare to"}</span>
        <div className="other-planets-row">
          {BODIES.filter((other) => other !== body).map((other) => (
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
