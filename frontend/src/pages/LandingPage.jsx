// Landing workspace, laid out like the team's paper sketch: the mode toggle and the five factor sliders down the left,
// the input planet and the output planets joined by a transfer arc, small "other planets" buttons above each side, and
// a Compute bar along the bottom. Clicking a small planet on the right adds it as another output globe; one Compute
// searches every output planet from the picked spot (its own planet too), then shows the best match on each.
import { useCallback, useMemo, useState, useEffect } from "react";
import { loadTargets, loadWeights } from "../data/api.js";
import { EXTRA_SITES, isPickableSite, shortSiteName } from "../content/notableSites.js";
import { useLoaded } from "../data/useLoaded.js";
import { useTileSearch } from "../data/useTileSearch.js";
import { FACTORS, SCORED_FACTORS } from "../data/scoring.js";
import { BODY_NAMES, FACTOR_SHORT_NAMES } from "../content/labels.js";
import PlanetGlobe, { GLOBE_TEXTURES } from "../components/PlanetGlobe.jsx";
import FactorSidebar from "../components/FactorSidebar.jsx";
import TransferArc from "../components/TransferArc.jsx";
import Coordinates from "../components/Coordinates.jsx";
import CoordinateInput from "../components/CoordinateInput.jsx";
import ComputeBar from "../components/ComputeBar.jsx";
import SimilarityVector from "../components/SimilarityVector.jsx";
import { MODES } from "../data/similarity.js";
import "../styles/landing.css";

const BODIES = ["earth", "moon", "mars"];
// A body's name inside a sentence ("Best match on the Moon").
const IN_SENTENCE = { earth: "Earth", moon: "the Moon", mars: "Mars" };
// What a planet is compared with when it becomes the starting planet and was the only output: never itself.
const DEFAULT_OUTPUT = { earth: "mars", moon: "earth", mars: "earth" };
const PICK_COLOR = "#FF5A36"; // the picked spot
const MATCH_COLOR = "#7CC8FF"; // each output planet's best match (blue: green is kept for good scores)
// The preset's most-weighted factor starts at Medium on its slider; the others keep their proportion to it.
const STARTING_SLIDER_LEVEL = 50;

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
  // The factors with a slider: the five scored ones to start with; the other four can be added from the sidebar.
  const [shownFactors, setShownFactors] = useState(SCORED_FACTORS);
  // Absolute or relative scoring; until a person picks one, the weights file's default.
  const [pickedMode, setPickedMode] = useState(null);
  const mode = pickedMode ?? (MODES.includes(presetsState.data?.default_mode) ? presetsState.data.default_mode : "absolute");
  // The searches run only on Compute: this holds the request that was computed.
  const [request, setRequest] = useState(null);
  const [startedAt, setStartedAt] = useState(0);
  const [finishedRequest, setFinishedRequest] = useState(null);

  useEffect(() => {
    if (weights || !presets[presetId]) return;
    setWeights(toSliderValues(presets[presetId].weights));
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
    const matches = search.data ?? [];
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

  // A planet is never compared with itself: starting from a planet that was an output drops it from the outputs (and
  // brings in another planet if it was the only one).
  function pickInputBody(body) {
    if (body === inputBody) return;
    setInputBody(body);
    setPoint(null);
    setTargets((current) => {
      const others = current.filter((target) => target !== body);
      return others.length > 0 ? others : [DEFAULT_OUTPUT[body]];
    });
  }

  // A new pick after a result goes back to the first screen: results cleared, globes full size, ready to compute.
  function pickPoint(lat, lon, name = null) {
    setPoint({ lat, lon, name });
    if (request) {
      setRequest(null);
      setFinishedRequest(null);
    }
  }

  // An added factor joins the list in its usual place, at Medium so it counts straight away.
  function showFactor(factor) {
    setShownFactors((current) => FACTORS.filter((other) => current.includes(other) || other === factor));
    setWeights((current) => ({ ...current, [factor]: STARTING_SLIDER_LEVEL }));
  }

  function hideFactor(factor) {
    setShownFactors((current) => current.filter((shown) => shown !== factor));
  }

  // Changing the mode reruns the search at once when a result is on screen; otherwise Compute uses it later.
  function changeMode(nextMode) {
    setPickedMode(nextMode);
    if (request && point && weights) compute(null, nextMode);
  }

  function addTarget(body) {
    if (body === inputBody) return;
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
    // Only factors with a slider count; any factor not in the sidebar is 0.
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

  // Every output's search starts from the same picked tile, so the first one's tile is the one to outline.
  const inputTile = request?.inputBody === inputBody && request?.point === point ? searches[request.targets[0]].tile : null;
  const addableBodies = BODIES.filter((other) => other !== inputBody && !targets.includes(other));

  return (
    <div className="workspace theme-space">
      <FactorSidebar
        weights={weights}
        mode={mode}
        shownFactors={shownFactors}
        onChangeMode={changeMode}
        onChangeWeight={(factor, value) => setWeights((current) => ({ ...current, [factor]: value }))}
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

        <TransferArc status={isStale ? "stale" : status} />

        <div className={`planet-column planet-column-target targets-${targets.length}`}>
          <div className="other-planets" role="group" aria-label="Add an output planet">
            <span className="eyebrow other-planets-label">{addableBodies.length > 0 ? "Compare with" : "Comparing with both"}</span>
            <div className="other-planets-row">
              {addableBodies.map((other) => (
                <button key={other} type="button" className="other-planet is-addable" onClick={() => addTarget(other)} aria-label={`Also compare with ${IN_SENTENCE[other]}`}>
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
        <section className="similarity-results" aria-labelledby="similarity-results-title">
          <header className="similarity-results-header">
            <h2 id="similarity-results-title" className="similarity-results-title">
              {request.targets.length === 1 ? `Best match on ${IN_SENTENCE[request.targets[0]]}` : "Best match on each planet"}
            </h2>
            <p className="similarity-results-lede">Scored on {joinWords(FACTORS.filter((factor) => request.weights[factor] > 0).map((factor) => FACTOR_SHORT_NAMES[factor]))}.</p>
          </header>
          <div className="similarity-cards">
            {request.targets.map((body) => (
              <SimilarityVector
                key={body}
                body={body}
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
                exploreLink={`/explore/${request.inputBody}?to=${body}&at=${request.point.lat.toFixed(2)},${request.point.lon.toFixed(2)}&preset=${presetId}&mode=${request.mode}`}
              />
            ))}
          </div>
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
      <div className="globe-frame">{children}</div>
      <div className="planet-caption">
        <span className="planet-caption-name">{BODY_NAMES[body]}</span>
        <span className="planet-caption-detail">{caption}</span>
      </div>
    </div>
  );
}

// One output globe. The best-match label and focus are memoised so the globe only flies when the result changes.
function TargetGlobe({ body, best, onRemove }) {
  const sites = useMemo(() => (best ? [{ target_id: "best", name: `${Math.round(best.score)}%`, lat: best.lat, lon: best.lon }] : []), [best]);
  const focus = useMemo(() => (best ? { lat: best.lat, lon: best.lon } : null), [best]);
  const markers = useMemo(() => (best ? [{ lat: best.lat, lon: best.lon, color: MATCH_COLOR }] : []), [best]);
  return (
    <div className={`target-globe body-${body}${best ? " has-result" : ""}`}>
      <div className="globe-frame">
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
        <span className="planet-caption-detail">{best ? <><strong className="caption-score">{Math.round(best.score)}%</strong> <Coordinates lat={best.lat} lon={best.lon} /></> : "Every tile"}</span>
      </div>
    </div>
  );
}

function formatList(names) {
  return names.length < 3 ? names.join(" & ") : `${names.slice(0, -1).join(", ")} & ${names[names.length - 1]}`;
}

/** "temperature, slope and water ice" */
function joinWords(words) {
  return words.length < 2 ? words.join("") : `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

/**
 * Slider values (0–100) from a preset's weights. Only the ratios between weights change a score, so the top factor is
 * set to Medium rather than to its raw 15%: five equal weights read as five Mediums, not five Lows.
 */
function toSliderValues(presetWeights) {
  const topWeight = Math.max(...SCORED_FACTORS.map((factor) => presetWeights[factor] ?? 0));
  return Object.fromEntries(FACTORS.map((factor) => [
    factor,
    topWeight > 0 && SCORED_FACTORS.includes(factor) ? Math.round(((presetWeights[factor] ?? 0) / topWeight) * STARTING_SLIDER_LEVEL) : 0,
  ]));
}
