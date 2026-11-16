// A 0–100 match score drawn as a thin ring that fills clockwise in the score band's colour, with the number in the middle.
import { formatScore } from "../data/format.js";
import { scoreBand } from "../data/scoring.js";
import { BAND_LABELS } from "../content/labels.js";

const STROKE_WIDTH = 4;

export default function ScoreRing({ score, size = 72, isPercent = false }) {
  const radius = (size - STROKE_WIDTH) / 2;
  const circumference = 2 * Math.PI * radius;
  const filledLength = (Math.min(Math.max(score, 0), 100) / 100) * circumference;

  return (
    <div className={`score-ring band-${scoreBand(score)}`} style={{ width: size, height: size }} role="img" aria-label={`Match score ${formatScore(score)} out of 100, ${BAND_LABELS[scoreBand(score)].toLowerCase()}`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle className="score-ring-track" cx={size / 2} cy={size / 2} r={radius} strokeWidth={STROKE_WIDTH} />
        <circle
          className="score-ring-fill"
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={STROKE_WIDTH}
          strokeDasharray={`${filledLength} ${circumference}`}
          // Start the fill at 12 o'clock instead of 3 o'clock.
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <span className="score-ring-number" aria-hidden="true">{formatScore(score)}{isPercent && <span className="score-ring-percent">%</span>}</span>
    </div>
  );
}
