// A 0–100 match score drawn as a ring that fills clockwise, with the number in the middle.
import { formatScore } from "../data/format.js";

const STROKE_WIDTH = 6;

export default function ScoreRing({ score, size = 72 }) {
  const radius = (size - STROKE_WIDTH) / 2;
  const circumference = 2 * Math.PI * radius;
  const filledLength = (Math.min(Math.max(score, 0), 100) / 100) * circumference;

  return (
    <div className="score-ring" style={{ width: size, height: size }} role="img" aria-label={`Match score ${formatScore(score)} out of 100`}>
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
      <span className="score-ring-number" aria-hidden="true">{formatScore(score)}</span>
    </div>
  );
}
