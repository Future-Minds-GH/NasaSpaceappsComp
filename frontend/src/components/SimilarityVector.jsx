// The final answer after Compute: the best match, its overall score in the plan's colours (green 90–100, yellow
// 60–90, red under 60) and the similarity vector itself, one 0–1 score per factor, written out and drawn as bars.
import { Link } from "react-router-dom";
import ScoreRing from "./ScoreRing.jsx";
import { FACTORS } from "../data/scoring.js";
import { formatCoordinates } from "../data/format.js";
import { BODY_NAMES, FACTOR_LABELS } from "../content/labels.js";

function band(score) {
  if (score >= 90) return { id: "green", label: "Strong analog" };
  if (score >= 60) return { id: "yellow", label: "Partial analog" };
  return { id: "red", label: "Weak analog" };
}

export default function SimilarityVector({ match, matchCount, error, hasNoData, isApproximate, inputBody, targetBody, point, weights, customMeasurements, exploreLink }) {
  if (error) return <section className="similarity is-message"><p role="alert">The search didn't finish. Check your connection and compute again.</p></section>;
  if (hasNoData) {
    return (
      <section className="similarity is-message">
        <p role="status">{inputBody === "earth" ? "Only dry, open land on Earth is scored. Try a desert, polar or volcanic spot." : "That tile has no data yet. Try a spot nearby."}</p>
      </section>
    );
  }
  if (!match) return <section className="similarity is-message"><p>No match found. Try another spot or preset.</p></section>;

  const scoreBand = band(match.score);
  const usedFactors = FACTORS.filter((factor) => (weights[factor] ?? 0) > 0);
  const vectorText = usedFactors.map((factor) => (match.breakdown?.[factor] == null ? "—" : match.breakdown[factor].toFixed(2))).join(", ");

  return (
    <section className={`similarity band-${scoreBand.id}`} aria-labelledby="similarity-title">
      <header className="similarity-header">
        <ScoreRing score={match.score} size={88} />
        <div>
          <p className="eyebrow">Similarity vector · {scoreBand.label}</p>
          <h2 id="similarity-title" className="similarity-title">
            {BODY_NAMES[inputBody]} {formatCoordinates(point.lat, point.lon)} → {match.name ?? `${BODY_NAMES[targetBody]} ${formatCoordinates(match.lat, match.lon)}`}
          </h2>
          <p className="similarity-vector-text"><code>s = [{vectorText}]</code></p>
          {isApproximate && <p className="similarity-note">Approximate: from a precomputed shortlist.</p>}
        </div>
      </header>

      <ul className="similarity-bars">
        {usedFactors.map((factor) => {
          const value = match.breakdown?.[factor];
          const isMissing = value === null || value === undefined;
          const factorBand = isMissing ? null : band(value * 100);
          return (
            <li key={factor} className={`similarity-bar ${isMissing ? "is-missing" : `band-${factorBand.id}`}`} style={{ "--factor-color": `var(--factor-${factor})` }}>
              <span className="similarity-bar-name"><span className="factor-swatch" aria-hidden="true" />{FACTOR_LABELS[factor]}</span>
              <span className="similarity-bar-track"><span className="similarity-bar-fill" style={{ transform: `scaleX(${isMissing ? 0 : value})` }} /></span>
              <span className="similarity-bar-value">{isMissing ? "no data" : value.toFixed(2)}</span>
            </li>
          );
        })}
        {customMeasurements.map((item) => (
          <li key={item.id} className="similarity-bar is-missing">
            <span className="similarity-bar-name"><span className="factor-swatch" aria-hidden="true" />{item.name}</span>
            <span className="similarity-bar-track" />
            <span className="similarity-bar-value">no data</span>
          </li>
        ))}
      </ul>

      <p className="similarity-footer">
        Best of {matchCount} ranked sites on {BODY_NAMES[targetBody]}. <Link className="arrow-link" to={exploreLink}>See all matches and details</Link>
      </p>
    </section>
  );
}
