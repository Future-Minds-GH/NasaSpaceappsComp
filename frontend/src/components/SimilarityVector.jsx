// One output planet's answer after Compute. It leads with a picture of the matched place and the overall score as a big
// readout (green 90–100, yellow 60–90, red under 60), then one plain sentence on why it matches, what can never match
// (gravity, air, radiation: fixed limits of each planet, not scored data) and one bar per scored factor, with the real
// values underneath. Factors with no data are listed on one line instead of drawn as empty bars.
import { Link } from "react-router-dom";
import BodyPhoto from "./BodyPhoto.jsx";
import Coordinates from "./Coordinates.jsx";
import { FACTORS, scoreBand } from "../data/scoring.js";
import { formatScore } from "../data/format.js";
import { halfTempNote, missingFactorsOf, noDataSentence } from "../data/fieldValues.js";
import { nearestButtonLabel, noScoreNote, snapNote } from "../data/earthSnap.js";
import { BAND_LABELS, BODY_NAMES, FACTOR_LABELS, FACTOR_SHORT_NAMES, MODE_INFO } from "../content/labels.js";

// What no place on another body can reproduce: shown as "breaks down on" when the two planets differ.
const PLANET_LIMITS = {
  earth: { gravity: "1 g", air: "thick air" },
  moon: { gravity: "⅙ g", air: "vacuum" },
  mars: { gravity: "⅜ g", air: "thin CO₂ air" },
};
const SURFACE_NAMES = { earth: "Earth's land", moon: "the Moon", mars: "Mars" };

function joinNames(names) {
  return names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** "Very close on slope and water ice; differs most on temperature." */
function summarise(scored) {
  const sorted = [...scored].sort((a, b) => b.value - a.value);
  const close = sorted.filter((item) => item.value >= 0.9).slice(0, 2).map((item) => FACTOR_SHORT_NAMES[item.factor]);
  const weakest = sorted[sorted.length - 1];
  const first = close.length ? `Very close on ${joinNames(close)}` : `Closest on ${FACTOR_SHORT_NAMES[sorted[0].factor]}`;
  return weakest && weakest.value < 0.85 && !close.includes(FACTOR_SHORT_NAMES[weakest.factor]) ? `${first}; differs most on ${FACTOR_SHORT_NAMES[weakest.factor]}.` : `${first}.`;
}

function breakdown(inputBody, body) {
  if (inputBody === body) return null;
  const from = PLANET_LIMITS[inputBody];
  const to = PLANET_LIMITS[body];
  return `gravity (${to.gravity} vs ${from.gravity}), air (${to.air} vs ${from.air}) and radiation.`;
}

export default function SimilarityVector({ body, match, matchCount, error, hasNoData, isApproximate, inputBody, weights, mode, exploreLink, clickedVector = null, layout = null, snapKm = null, nearestScored = null, onUseNearest = null }) {
  const heading = (
    <p className="similarity-body">
      <span className="eyebrow">{BODY_NAMES[body]}</span>
    </p>
  );
  const noScoreEarth = hasNoData && inputBody === "earth" && nearestScored;
  const message = error
    ? "Couldn't finish this search. Press Retry below."
    : hasNoData
      ? noScoreEarth ? noScoreNote(nearestScored.km) : "That spot has no data yet. Try one nearby."
      : !match ? "No match found." : null;
  if (message) {
    return (
      <article className={`similarity body-${body} is-message`}>
        {heading}
        <p role="status">{message}</p>
        {noScoreEarth && onUseNearest && (
          <button type="button" className="button" onClick={() => onUseNearest(nearestScored.lat, nearestScored.lon)}>{nearestButtonLabel(nearestScored.km)}</button>
        )}
      </article>
    );
  }

  const bandId = scoreBand(match.score);
  const usedFactors = FACTORS.filter((factor) => (weights[factor] ?? 0) > 0);
  const scored = usedFactors.filter((factor) => match.breakdown?.[factor] != null).map((factor) => ({ factor, value: match.breakdown[factor] }));
  const notScored = usedFactors.filter((factor) => match.breakdown?.[factor] == null);
  // Missing on the clicked spot itself: say so plainly. Anything else missing is listed as before.
  const spotMissing = new Set(missingFactorsOf(layout, clickedVector));
  const spotSentence = noDataSentence(inputBody === "moon" ? "the Moon" : BODY_NAMES[inputBody] ?? inputBody, notScored.filter((factor) => spotMissing.has(factor)).map((factor) => FACTOR_LABELS[factor]));
  const tempNote = scored.some((item) => item.factor === "temp") ? match.temp_note ?? halfTempNote(layout, clickedVector) : null;
  const otherNotScored = notScored.filter((factor) => !spotMissing.has(factor));
  const limits = breakdown(inputBody, body);
  const placeLabel = `${BODY_NAMES[body]} match at ${Math.abs(match.lat).toFixed(2)}°, ${Math.abs(match.lon).toFixed(2)}°`;

  return (
    <article className={`similarity body-${body} band-${bandId}`} aria-label={`Best match on ${BODY_NAMES[body]}`}>
      <header className="similarity-head">
        <span className="similarity-photo">
          {match.image_url ? <img src={match.image_url} alt={`Satellite view of the ${placeLabel}`} loading="lazy" /> : <BodyPhoto body={body} lat={match.lat} lon={match.lon} label={`Orbital map of the ${placeLabel}`} />}
        </span>
        <div className="similarity-head-text">
          {heading}
          {/* Moon and Mars tiles have no place names: their coordinates are the name. */}
          <h3 className="similarity-place">{match.name ?? <Coordinates lat={match.lat} lon={match.lon} />}</h3>
          {match.name && <Coordinates lat={match.lat} lon={match.lon} />}
          {typeof match.earth_rank_pct === "number" && (
            <span className="similarity-rank">Top {Math.max(0.1, 100 - match.earth_rank_pct).toFixed(1)}% of {SURFACE_NAMES[body]}</span>
          )}
        </div>
        {/* NASA "mission status" readout: the score as a big mono number in its band colour, the band in words. */}
        <p className="similarity-score" role="img" aria-label={`Match score ${formatScore(match.score)} out of 100, ${BAND_LABELS[bandId].toLowerCase()}`}>
          <span className="similarity-score-value" aria-hidden="true">{formatScore(match.score)}<span className="similarity-score-unit">%</span></span>
          <span className="similarity-band" aria-hidden="true">{BAND_LABELS[bandId]}</span>
        </p>
      </header>

      {scored.length > 0 && <p className="similarity-summary">{summarise(scored)}</p>}
      {limits && <p className="similarity-limits"><strong>Breaks down on:</strong> {limits}</p>}
      {snapKm !== null && <p className="similarity-no-data" role="note">{snapNote(snapKm)}</p>}
      {isApproximate && <p className="similarity-note">Approximate: from a precomputed shortlist.</p>}

      <ul className="similarity-bars" aria-label="How alike each factor is, 100% = identical">
        {scored.map(({ factor, value }) => (
          <li key={factor} className={`similarity-bar band-${scoreBand(value * 100)}`} style={{ "--factor-color": `var(--factor-${factor})` }}>
            <span className="similarity-bar-name"><span className="factor-swatch" aria-hidden="true" />{FACTOR_LABELS[factor]}</span>
            <span className="similarity-bar-track"><span className="similarity-bar-fill" style={{ transform: `scaleX(${value})` }} /></span>
            <span className="similarity-bar-value">{Math.round(value * 100)}%</span>
            {match.values?.[factor] && <span className="similarity-bar-real">{match.values[factor]}</span>}
          </li>
        ))}
      </ul>

      {tempNote && <p className="similarity-no-data" role="note">{tempNote}</p>}
      {spotSentence && <p className="similarity-no-data" role="note">{spotSentence}</p>}
      <p className="similarity-footer">
        {otherNotScored.length > 0 && <span>Not scored here: {otherNotScored.map((factor) => FACTOR_LABELS[factor]).join(", ")}. </span>}
        {mode && <span>{MODE_INFO[mode].label} mode. </span>}
        {matchCount > 1 && <span>Best of {matchCount}. </span>}
        {exploreLink && <Link className="arrow-link" to={exploreLink}>All matches</Link>}
      </p>
    </article>
  );
}
