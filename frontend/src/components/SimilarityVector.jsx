// One output planet's answer after Compute. It leads with a picture of the matched place, the overall score (green
// 90–100, yellow 60–90, red under 60) and one plain sentence on why it matches; then how it ranks, what can never
// match (gravity, air, radiation: fixed limits of each planet, not scored data) and one bar per scored factor, with the
// real values underneath. Factors with no data are listed on one line instead
// of drawn as empty bars.
import { Link } from "react-router-dom";
import ScoreRing from "./ScoreRing.jsx";
import BodyPhoto from "./BodyPhoto.jsx";
import Coordinates from "./Coordinates.jsx";
import { FACTORS, scoreBand } from "../data/scoring.js";
import { halfTempNote, missingFactorsOf, noDataSentence } from "../data/fieldValues.js";
import { SAME_BODY_MIN_KM } from "../data/ranking.js";
import { BAND_LABELS, BODY_NAMES, FACTOR_LABELS, MODE_INFO } from "../content/labels.js";

const SHORT_NAMES = { temp: "temperature", swing: "day-night swing", sun: "sunlight", slope: "slope", rough: "roughness", elev: "elevation", surface: "surface type", minerals: "minerals", ice: "water ice" };
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
  const close = sorted.filter((item) => item.value >= 0.9).slice(0, 2).map((item) => SHORT_NAMES[item.factor]);
  const weakest = sorted[sorted.length - 1];
  const first = close.length ? `Very close on ${joinNames(close)}` : `Closest on ${SHORT_NAMES[sorted[0].factor]}`;
  return weakest && weakest.value < 0.85 && !close.includes(SHORT_NAMES[weakest.factor]) ? `${first}; differs most on ${SHORT_NAMES[weakest.factor]}.` : `${first}.`;
}

function breakdown(inputBody, body) {
  if (inputBody === body) return null;
  const from = PLANET_LIMITS[inputBody];
  const to = PLANET_LIMITS[body];
  return `gravity (${to.gravity} vs ${from.gravity}) · air (${to.air} vs ${from.air}) · radiation`;
}

export default function SimilarityVector({ body, isSameBody, match, matchCount, error, hasNoData, isApproximate, inputBody, weights, mode, exploreLink, clickedVector = null, layout = null }) {
  const heading = (
    <p className="similarity-body">
      {BODY_NAMES[body]}
      {isSameBody && <span className="similarity-same">same planet · {SAME_BODY_MIN_KM} km+ away</span>}
    </p>
  );
  const message = error
    ? "Couldn't finish this search. Press Retry below."
    : hasNoData
      ? inputBody === "earth" ? "Only dry, open land on Earth is scored. Try a desert, polar or volcanic spot." : "That spot has no data yet. Try one nearby."
      : !match ? "No match found." : null;
  if (message) return <article className={`similarity body-${body} is-message`}>{heading}<p role="status">{message}</p></article>;

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
      <div className="similarity-select">
        <span className="similarity-photo">
          {match.image_url ? <img src={match.image_url} alt={`Satellite view of the ${placeLabel}`} loading="lazy" /> : <BodyPhoto body={body} lat={match.lat} lon={match.lon} label={`Orbital map of the ${placeLabel}`} />}
        </span>
        <span className="similarity-head-text">
          {heading}
          <span className="similarity-place">{match.name ?? <Coordinates lat={match.lat} lon={match.lon} />}</span>
          {typeof match.earth_rank_pct === "number" && (
            <span className="similarity-rank">Top {Math.max(0.1, 100 - match.earth_rank_pct).toFixed(1)}% of {SURFACE_NAMES[body]}</span>
          )}
        </span>
        <span className="similarity-score">
          <ScoreRing score={match.score} size={56} isPercent />
          <span className="similarity-band">{BAND_LABELS[bandId]}</span>
        </span>
      </div>

      {scored.length > 0 && <p className="similarity-summary">{summarise(scored)}</p>}
      {limits && <p className="similarity-limits"><strong>Breaks down on:</strong> {limits}</p>}
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
