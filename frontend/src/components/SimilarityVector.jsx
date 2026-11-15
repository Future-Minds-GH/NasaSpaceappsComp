// One body's answer after Compute (three of these sit side by side: Earth, Moon, Mars). It shows the best match, its
// overall score in the plan's colours (green 90–100, yellow 60–90, red under 60) and the similarity vector: one 0–1
// score per factor, written out and drawn as bars. Clicking the card shows that body on the right-hand globe.
import { Link } from "react-router-dom";
import ScoreRing from "./ScoreRing.jsx";
import { FACTORS } from "../data/scoring.js";
import Coordinates from "./Coordinates.jsx";
import { BODY_NAMES, FACTOR_LABELS } from "../content/labels.js";

function band(score) {
  if (score >= 90) return { id: "green", label: "Strong analog" };
  if (score >= 60) return { id: "yellow", label: "Partial analog" };
  return { id: "red", label: "Weak analog" };
}

export default function SimilarityVector({
  body, isSameBody, isSelected, onSelect, match, matchCount, error, hasNoData, isApproximate, inputBody, weights, measurementNote, exploreLink,
}) {
  const heading = (
    <p className="similarity-body">
      {BODY_NAMES[body]}
      {isSameBody && <span className="similarity-same">same body · 300 km+ away</span>}
    </p>
  );
  const message = error
    ? "This search didn't finish. Compute again."
    : hasNoData
      ? inputBody === "earth" ? "Only dry, open land on Earth is scored. Try a desert, polar or volcanic spot." : "That tile has no data yet. Try a spot nearby."
      : !match ? "No match found." : null;
  if (message) return <article className={`similarity body-${body} is-message`}>{heading}<p role="status">{message}</p></article>;

  const scoreBand = band(match.score);
  const usedFactors = FACTORS.filter((factor) => (weights[factor] ?? 0) > 0);
  const vectorText = usedFactors.map((factor) => (match.breakdown?.[factor] == null ? "—" : match.breakdown[factor].toFixed(2))).join(", ");

  return (
    <article className={`similarity body-${body} band-${scoreBand.id}${isSelected ? " is-selected" : ""}`} aria-label={`Best match on ${BODY_NAMES[body]}`}>
      <button type="button" className="similarity-select" onClick={onSelect} aria-pressed={isSelected}>
        <ScoreRing score={match.score} size={64} />
        <span className="similarity-head-text">
          {heading}
          <span className="eyebrow">{scoreBand.label}</span>
          <span className="similarity-place">{match.name ?? <Coordinates lat={match.lat} lon={match.lon} />}</span>
        </span>
      </button>
      <p className="similarity-vector-text"><code>s = [{vectorText}]</code></p>
      {isApproximate && <p className="similarity-note">Approximate: from a precomputed shortlist.</p>}

      <ul className="similarity-bars">
        {usedFactors.map((factor) => {
          const value = match.breakdown?.[factor];
          const isMissing = value === null || value === undefined;
          return (
            <li key={factor} className={`similarity-bar ${isMissing ? "is-missing" : `band-${band(value * 100).id}`}`} style={{ "--factor-color": `var(--factor-${factor})` }}>
              <span className="similarity-bar-name"><span className="factor-swatch" aria-hidden="true" />{FACTOR_LABELS[factor]}</span>
              <span className="similarity-bar-track"><span className="similarity-bar-fill" style={{ transform: `scaleX(${isMissing ? 0 : value})` }} /></span>
              <span className="similarity-bar-value">{isMissing ? "no data" : value.toFixed(2)}</span>
            </li>
          );
        })}
      </ul>

      {measurementNote && <p className="similarity-measurements">Measurement weights: {measurementNote}</p>}
      <p className="similarity-footer">
        Best of {matchCount} ranked sites.{" "}
        {exploreLink && <Link className="arrow-link" to={exploreLink}>All matches</Link>}
      </p>
    </article>
  );
}
