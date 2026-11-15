// The Compute bar along the bottom of the workspace: what will be compared, a Compute button, and while the searches
// run a progress bar tied to the real work. It never runs ahead of the output planets that have answered: each planet
// that finishes moves the floor up, and the bar only reaches 100% when all of them have. If a search fails, the bar
// stops where it got to, turns red, names the planet, and Compute becomes Retry.
import { useEffect, useRef, useState } from "react";
import Coordinates from "./Coordinates.jsx";
import { parse } from "./CoordinateInput.jsx";
import { BODY_NAMES } from "../content/labels.js";

// Within one planet's share of the bar, the bar eases forward while that planet is still searching, but stops short
// of the planet's end until it actually answers.
const WITHIN_PLANET_LIMIT = 0.85;
// The bar takes at least this long to fill, then holds at 100% for a beat before the result shows.
const MIN_FILL_MS = 1200;
const HOLD_FULL_MS = 250;

export default function ComputeBar({ inputBody, targetNames, point, status, startedAt, isReady, doneCount = 0, totalCount = 1, failedNames = [], onFinished, onCompute, onSetPoint, isDisabled }) {
  const [typed, setTyped] = useState("");
  const [isTypedInvalid, setIsTypedInvalid] = useState(false);
  // Typed coordinates: Enter sets the spot; Compute uses them too if something valid is typed.
  function readTyped() {
    if (!typed.trim()) return null;
    const parsed = parse(typed);
    setIsTypedInvalid(!parsed);
    return parsed;
  }
  const isComputing = status === "computing";
  const isFailed = status === "failed";
  const progress = useProgress(isComputing, startedAt, isReady, doneCount, totalCount, onFinished);
  const failedProgress = (doneCount / Math.max(totalCount, 1)) * 100;
  const shownProgress = isFailed ? failedProgress : progress;
  const label = isFailed
    ? `Couldn't finish ${failedNames.join(" & ")}. Check your connection and retry.`
    : doneCount === 0 ? `Searching ${targetNames}…` : `Scored ${doneCount} of ${totalCount} planet${totalCount === 1 ? "" : "s"}…`;

  return (
    <div className={`compute-bar is-${status}`}>
      <p className="compute-summary">
        <span className="compute-from">
          <span className="eyebrow">From</span>
          <strong>{BODY_NAMES[inputBody]}</strong> {point ? <Coordinates lat={point.lat} lon={point.lon} /> : "· pick a spot"}
        </span>
        <span className="compute-to" aria-hidden="true">→</span>
        <span className="compute-from">
          <span className="eyebrow">To</span>
          <strong>{targetNames}</strong>
        </span>
      </p>

      {isComputing || isFailed ? (
        <div className="compute-progress" role="progressbar" aria-label="Search progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(shownProgress)}>
          <div className="compute-progress-track"><div className="compute-progress-fill" style={{ transform: `scaleX(${shownProgress / 100})` }} /></div>
          <span className="compute-progress-label" aria-live="polite">{label}{isComputing ? ` ${Math.round(progress)}%` : ""}</span>
        </div>
      ) : (
        <p className="compute-hint">
          {status === "stale" ? "Settings changed. Compute again to update the result." : status === "done" ? "Done. The results are below." : point ? "Ready when you are." : ""}
        </p>
      )}

      <div className="compute-actions">
        <form
          className="compute-coords"
          onSubmit={(event) => {
            event.preventDefault();
            const parsed = readTyped();
            if (parsed) { onSetPoint(parsed.lat, parsed.lon); setTyped(""); }
          }}
        >
          <input
            value={typed}
            onChange={(event) => { setTyped(event.target.value); setIsTypedInvalid(false); }}
            placeholder="lat, lon"
            aria-label={`Type a latitude and longitude on ${BODY_NAMES[inputBody]}, e.g. 18.4, 77.5`}
            aria-invalid={isTypedInvalid}
            title="Latitude, longitude (e.g. 18.4, 77.5 or 18.4 N 77.5 E). Press Enter to set it."
          />
        </form>
        <button
          type="button"
          className="button button-primary compute-button"
          onClick={() => {
            const parsed = readTyped();
            if (typed.trim() && !parsed) return;
            onCompute(parsed);
            setTyped("");
          }}
          disabled={isDisabled && !typed.trim()}
        >
          {!point && !typed.trim() ? "Pick a spot first" : isComputing ? "Computing…" : isFailed ? "Retry" : status === "done" ? "Compute again" : "Compute"}
        </button>
      </div>
    </div>
  );
}

/** 0–100, held below the share of planets that have answered; fills to 100 once all have, then calls onFinished. */
function useProgress(isComputing, startedAt, isReady, doneCount, totalCount, onFinished) {
  const [progress, setProgress] = useState(0);
  const shownRef = useRef(0); // survives the effect re-running as planets answer, so the bar never jumps back
  useEffect(() => {
    if (!isComputing) { shownRef.current = 0; setProgress(0); return undefined; }
    let frame;
    let finishTimer;
    const share = 100 / Math.max(totalCount, 1);
    const tick = () => {
      const elapsedMs = performance.now() - startedAt;
      // The current planet's slice eases forward over time but stops at WITHIN_PLANET_LIMIT until it answers.
      const withinPlanet = WITHIN_PLANET_LIMIT * (1 - Math.exp(-elapsedMs / 1200));
      const goal = isReady ? 100 : Math.min(100, doneCount * share + withinPlanet * share);
      const timeCap = (elapsedMs / MIN_FILL_MS) * 100;
      const shown = Math.max(shownRef.current, Math.min(goal, timeCap));
      shownRef.current = shown;
      setProgress(shown);
      if (shown >= 100) { finishTimer = setTimeout(onFinished, HOLD_FULL_MS); return; }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(frame); clearTimeout(finishTimer); };
  }, [isComputing, startedAt, isReady, doneCount, totalCount, onFinished]);
  return progress;
}
