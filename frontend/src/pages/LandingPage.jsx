// Landing workspace, laid out like the team's paper sketch: the mode toggle and the factor sliders down the left
// (grouped weather / ground; three show at first, the other six come from "+ Add a factor"), two hovering planets
// joined by an animated arrow, small "other planets" buttons above side, and a Compute bar along the bottom. Clicking a small planet on the right adds it as another output globe;
// one Compute searches every output planet from the picked spot (its own planet too), shows a short loading bar, then
// one similarity vector per output planet.
import { useCallback, useMemo, useState, useEffect } from "react";
import { loadTargets, loadWeights } from "../data/api.js";
import { EXTRA_SITES, isPickableSite, shortSiteName } from "../content/notableSites.js";
import { useLoaded } from "../data/useLoaded.js";
import { useTileSearch } from "../data/useTileSearch.js";
import { FACTORS } from "../data/scoring.js";
import { BODY_RADIUS_KM, SAME_BODY_MIN_KM } from "../data/ranking.js";
import { BODY_NAMES, DEFAULT_SHOWN_FACTORS } from "../content/labels.js";
import PlanetGlobe, { GLOBE_TEXTURES } from "../components/PlanetGlobe.jsx";
import FactorSidebar from "../components/FactorSidebar.jsx";
import Coordinates from "../components/Coordinates.jsx";
import CoordinateInput from "../components/CoordinateInput.jsx";
import ComputeBar from "../components/ComputeBar.jsx";
import SimilarityVector from "../components/SimilarityVector.jsx";
import { MODES } from "../data/similarity.js";
import "../styles/landing.css";

const BODIES = ["earth", "moon", "mars"];
const PICK_COLOR = "#FF5A36"; // the picked spot
const MATCH_COLOR = "#7CC8FF"; // each output planet's best match (blue: green is kept for good scores)

export default function LandingPage() {
  const presetsState = useLoaded(loadWeights, []);
  const targetsState = useLoaded(loadTargets, []);
  const presets = presetsState.data?.presets ?? {};
  const [inputBody, setInputBody] = useState("mars");
  // Output planets: clicking a small planet on the right adds it as another globe; Compute searches each one.
  const [targets, setTargets] = useState(["earth"]);
  const [point, setPoint] = useState(null);
  // Sliders start from the Balanced preset; the preset picker was removed, so people only move the sliders.
  const presetId = presetsState.data?.default_preset ?? "balanced";
  const [weights, setWeights] = useState(null); // 0–100 per factor; null until presets load
  // The site opens with three factor sliders (temperature, relative elevation, minerals); the other six are added from "+ Add a factor".
  const [shownFactors, setShownFactors] = useState(DEFAULT_SHOWN_FACTORS);
  // Absolute or relative scoring; until a person picks one, the weights file's default.
  const [pickedMode, setPickedMode] = useState(null);
  const mode = pickedMode ?? (MODES.includes(presetsState.data?.default_mode) ? presetsState.data.default_mode : "absolute");
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
    earth: useTileSearch(selectionFor("earth"), "earth", request?.weights, request?.mode, request?.attempt ?? 0),
    moon: useTileSearch(selectionFor("moon"), "moon", request?.weights, request?.mode, request?.attempt ?? 0),
    mars: useTileSearch(selectionFor("mars"), "mars", request?.weights, request?.mode, request?.attempt ?? 0),
  };
  const results = Object.fromEntries(BODIES.map((body) => {
    const search = searches[body];
    // The ranking already skips these tiles; this guards the fallbacks.
    const matches = (search.data ?? []).filter((match) => !(request && body === request.inputBody && distanceKm(match, search.searchPoint ?? request.point, body) < SAME_BODY_MIN_KM));
    return [body, { search, matches, best: matches[0] ?? null }];
  }));

  // Real progress: how many output planets have answered, and which failed.
  const targetBodies = request?.targets ?? [];
  const failedBodies = targetBodies.filter((body) => searches[body].error);
  const doneCount = targetBodies.filter((body) => !searches[body].isLoading && !searches[body].error).length;
  const isSettled = Boolean(request) && targetBodies.every((body) => !searches[body].isLoading);
  const canAutoRetry = Boolean(request) && request.attempt === request.firstAttempt;
  const hasFailed = isSettled && failedBodies.length > 0 && !canAutoRetry;
  const handleFinished = useCallback(() => setFinishedRequest(request), [request]);
  const status = !request ? "idle" : hasFailed ? "failed" : finishedRequest === request ? "done" : "computing";

  // A failed search is retried once on its own (fresh files, fresh worker) before the bar reports it.
  useEffect(() => {
    if (request && isSettled && failedBodies.length > 0 && canAutoRetry) setRequest((current) => ({ ...current, attempt: current.attempt + 1 }));
  }, [request, isSettled, failedBodies.length, canAutoRetry]);
  const settingsKey = JSON.stringify([weights, shownFactors, targets, mode]);
  const isStale = Boolean(request) && (request.point !== point || request.inputBody !== inputBody || request.settingsKey !== settingsKey);
  const isShowingResult = (status === "done" || status === "failed") && !isStale;

  // When a Compute finishes, scroll down to its results (they sit below the planets).
  useEffect(() => {
    if (!isShowingResult) return;
    const isReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    document.querySelector(".similarity-results")?.scrollIntoView({ behavior: isReducedMotion ? "auto" : "smooth", block: "start" });
  }, [isShowingResult, request]);

  const bestOn = (body) => (isShowingResult ? results[body].best : null);

  function pickInputBody(body) {
    if (body === inputBody) return;
    setInputBody(body);
    setPoint(null);
  }

  // A new pick after a result goes back to the first screen: results cleared, globes full size, ready to compute.
  function pickPoint(lat, lon, name = null) {
    setPoint({ lat, lon, name });
    if (request) {
      setRequest(null);
      setFinishedRequest(null);
    }
  }

  // Re-added factors go back to their usual place in the list, with a starting weight if theirs was 0 so they count.
  function showFactor(factor) {
    if (!weights) return;   // the presets are still loading: the dropdown is disabled until then
    setShownFactors((current) => FACTORS.filter((other) => current.includes(other) || other === factor));
    setWeights((current) => (current[factor] ? current : { ...current, [factor]: 20 }));
  }

  // At least one factor always stays.
  function hideFactor(factor) {
    if (shownFactors.length <= 1) return;
    setShownFactors((current) => current.filter((shown) => shown !== factor));
  }

  // Changing the mode reruns the search at once when a result is on screen; otherwise Compute uses it later.
  function changeMode(nextMode) {
    setPickedMode(nextMode);
    if (request && point && weights) compute(null, nextMode);
  }

  function addTarget(body) {
    setTargets((current) => (current.includes(body) ? current : BODIES.filter((other) => current.includes(other) || other === body)));
  }

  function removeTarget(body) {
    setTargets((current) => (current.length > 1 ? current.filter((other) => other !== body) : current));
  }

  // Compute can be given typed coordinates from the Compute bar: they become the picked spot first.
  function compute(typedPoint = null, nextMode = mode) {
    const spot = typedPoint ? { lat: typedPoint.lat, lon: typedPoint.lon, name: null } : point;
    if (!spot || !weights) return;
    if (typedPoint) setPoint(spot);
    const scoredWeights = Object.fromEntries(FACTORS.map((factor) => [factor, shownFactors.includes(factor) ? weights[factor] / 100 : 0]));
    setStartedAt(performance.now());
    // After a failure, Compute is a retry: a new attempt number reloads the files and restarts the search workers.
    const attempt = (request?.attempt ?? 0) + (status === "failed" ? 1 : 0);
    setRequest({ point: spot, inputBody, targets, selection: { body: inputBody, lat: spot.lat, lon: spot.lon }, weights: scoredWeights, mode: nextMode, settingsKey: JSON.stringify([weights, shownFactors, targets, nextMode]), attempt, firstAttempt: attempt });
  }

  // Notable sites on the input planet: the project's named sites plus well-known landmarks. Clicking one picks it.
  const notableSites = useMemo(
    () => [...(targetsState.data ?? []).filter(isPickableSite), ...EXTRA_SITES]
      .filter((site) => site.body === inputBody)
      .map((site) => ({ ...site, name: shortSiteName(site.name) }))
      // Sites within 2° of one already shown (e.g. the three Dry Valleys sites) would stack into one blob: keep the first.
      .filter((site, index, all) => !all.slice(0, index).some((other) => Math.abs(other.lat - site.lat) < 2 && Math.abs(other.lon - site.lon) < 2)),
    [targetsState.data, inputBody],
  );

  // The picked spot: a bright marker with a pulsing ring.
  const pickMarkers = useMemo(() => (point ? [{ lat: point.lat, lon: point.lon, color: PICK_COLOR }] : []), [point]);

  const inputTile = request?.inputBody === inputBody && request?.point === point ? searches[inputBody].tile : null;

  return (
    <div className="workspace">
      <FactorSidebar
        weights={weights}
        groups={presetsState.data?.groups}
        mode={mode}
        onChangeMode={changeMode}
        onChangeWeight={(factor, value) => setWeights((current) => ({ ...current, [factor]: value }))}
        shownFactors={shownFactors}
        onShowFactor={showFactor}
        onHideFactor={hideFactor}
      />

      <section className="workspace-stage" aria-label="Pick a spot, then compare">
        <PlanetColumn
          side="input"
          body={inputBody}
          choices={BODIES.filter((other) => other !== inputBody)}
          onPickBody={pickInputBody}
          caption={point ? <>{point.name && <span className="picked-site-name">{point.name}</span>}<CoordinateInput point={point} onChange={(lat, lon) => pickPoint(lat, lon)} /></> : null}
        >
          <PlanetGlobe
            body={inputBody}
            isInteractive
            selectedTile={inputTile}
            markers={pickMarkers}
            sites={notableSites}
            onSelectSite={(site) => pickPoint(site.lat, site.lon, site.name)}
            onPick={pickPoint}
            label={`Globe of ${BODY_NAMES[inputBody]}. Drag to turn it, click a spot to pick it.`}
          />
          {!point && <span className="pick-prompt" aria-hidden="true">Click a spot to start</span>}
        </PlanetColumn>

        <div className="workspace-arrow-wrap">
          <div className={`workspace-arrow is-${status}`} aria-hidden="true">
            <svg viewBox="0 0 160 60">
              <path className="workspace-arrow-line" d="M8 38 C 50 6, 110 6, 146 30" />
              <path className="workspace-arrow-head" d="M134 18 L148 31 L130 36" />
            </svg>
          </div>
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
        isReady={isSettled && failedBodies.length === 0}
        doneCount={doneCount}
        totalCount={targetBodies.length}
        failedNames={failedBodies.map((body) => BODY_NAMES[body])}
        onFinished={handleFinished}
        onCompute={compute}
        onSetPoint={(lat, lon) => pickPoint(lat, lon)}
        isDisabled={!point || !weights || (status === "computing" && !isStale)}
      />

      {isShowingResult && (
        <section className="similarity-results" aria-label="Similarity on each output planet">
          {request.targets.map((body) => (
            <SimilarityVector
              key={body}
              body={body}
              isSameBody={body === request.inputBody}
              match={results[body].best}
              matchCount={results[body].matches.length}
              error={results[body].search.error}
              hasNoData={results[body].search.hasNoData}
              isApproximate={results[body].search.isApproximate}
              inputBody={request.inputBody}
              weights={request.weights}
              mode={request.mode}
              clickedVector={results[body].search.clickedVector}
              layout={results[body].search.layout}
              snapKm={results[body].search.snapKm}
              nearestScored={results[body].search.nearestScored}
              // The nearest-spot button is the same on every card: offer it on the first card only.
              onUseNearest={body === request.targets[0] ? (lat, lon) => compute({ lat, lon }) : null}
              exploreLink={body === request.inputBody ? null : `/explore/${request.inputBody}?to=${body}&at=${request.point.lat.toFixed(2)},${request.point.lon.toFixed(2)}&preset=${presetId}&mode=${request.mode}`}
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
function TargetGlobe({ body, best, isSamePlanet, onRemove }) {
  const sites = useMemo(() => (best ? [{ target_id: "best", name: `${Math.round(best.score)}%`, lat: best.lat, lon: best.lon }] : []), [best]);
  const focus = useMemo(() => (best ? { lat: best.lat, lon: best.lon } : null), [best]);
  const markers = useMemo(() => (best ? [{ lat: best.lat, lon: best.lon, color: MATCH_COLOR }] : []), [best]);
  return (
    <div className={`target-globe body-${body}${best ? " has-result" : ""}`}>
      <div className="hovering-planet">
        <PlanetGlobe body={body} isDraggable={Boolean(best)} isSpinning={!best} sites={sites} markers={markers} focus={focus} label={`Globe of ${BODY_NAMES[body]}, an output planet.`} />
        {/* Hovering the planet shows a big X over it; clicking the planet removes it (at least one always stays). */}
        {onRemove && (
          <button type="button" className="target-remove" onClick={onRemove} aria-label={`Remove ${BODY_NAMES[body]}`}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6 L18 18 M18 6 L6 18" /></svg>
          </button>
        )}
      </div>
      <div className="planet-caption">
        <span className="planet-caption-name">{BODY_NAMES[body]}</span>
        <span className="planet-caption-detail">{best ? <><strong className="caption-score">{Math.round(best.score)}%</strong> <Coordinates lat={best.lat} lon={best.lon} /></> : isSamePlanet ? "Same planet" : "Every tile"}</span>
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
