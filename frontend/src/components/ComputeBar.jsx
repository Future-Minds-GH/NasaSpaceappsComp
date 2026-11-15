// The Compute bar along the bottom of the workspace: what will be compared, a Compute button, and while the search
// runs a loading bar with the step it is on. The bar creeps toward 90% while waiting and jumps to 100% when the search
// has answered, so it never sits "full" before the result exists.
import { useEffect, useRef, useState } from "react";
import Coordinates from "./Coordinates.jsx";
import { BODY_NAMES } from "../content/labels.js";

const STEPS = [
  { until: 20, label: "Reading the tile you picked" },
  { until: 45, label: "Loading every target tile" },
  { until: 85, label: "Scoring each factor" },
  { until: 101, label: "Building the similarity vector" },
];
const CREEP_LIMIT = 90;
// The bar takes at least this long to fill, then holds at 100% for a beat before the result shows.
const MIN_FILL_MS = 1400;
const HOLD_FULL_MS = 250;

export default function ComputeBar({ inputBody, targetNames, point, status, startedAt, isReady, onFinished, onCompute, isDisabled }) {
  const progress = useProgress(status === "computing", startedAt, isReady, onFinished);
  const step = STEPS.find((candidate) => progress < candidate.until) ?? STEPS[STEPS.length - 1];
  const isComputing = status === "computing";

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

      <div className="compute-progress" role="progressbar" aria-label="Computing similarity" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(isComputing ? progress : status === "done" ? 100 : 0)} hidden={!isComputing}>
        <div className="compute-progress-track"><div className="compute-progress-fill" style={{ transform: `scaleX(${progress / 100})` }} /></div>
        <span className="compute-progress-label" aria-live="polite">{step.label}… {Math.round(progress)}%</span>
      </div>
      {!isComputing && (
        <p className="compute-hint">
          {status === "stale" ? "Settings changed. Compute again to update the result." : status === "done" ? "Done. The similarity vectors are below." : point ? "Ready when you are." : `Click a spot on ${BODY_NAMES[inputBody]} first.`}
        </p>
      )}

      <button type="button" className="button button-primary compute-button" onClick={onCompute} disabled={isDisabled}>
        {isComputing ? "Computing…" : status === "done" ? "Compute again" : "Compute"}
      </button>
    </div>
  );
}

/** 0–100. Eases toward CREEP_LIMIT while the search runs, fills to 100 once it is ready, then calls onFinished. */
function useProgress(isComputing, startedAt, isReady, onFinished) {
  const [progress, setProgress] = useState(0);
  const shownRef = useRef(0); // survives the effect re-running when isReady flips, so the bar never jumps back
  useEffect(() => {
    if (!isComputing) { shownRef.current = 0; setProgress(0); return undefined; }
    let frame;
    let finishTimer;
    const tick = () => {
      const elapsedMs = performance.now() - startedAt;
      const goal = isReady ? 100 : CREEP_LIMIT * (1 - Math.exp(-elapsedMs / 900));
      const timeCap = (elapsedMs / MIN_FILL_MS) * 100;
      const shown = Math.max(shownRef.current, Math.min(goal, timeCap));
      shownRef.current = shown;
      setProgress(shown);
      if (shown >= 100) { finishTimer = setTimeout(onFinished, HOLD_FULL_MS); return; }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(frame); clearTimeout(finishTimer); };
  }, [isComputing, startedAt, isReady, onFinished]);
  return progress;
}
