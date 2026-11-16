// One row of the ranked matches: its picture, rank, place and score, then the plain reasons it matches. The five
// factor bars show only with Details open.
import ScoreRing from "./ScoreRing.jsx";
import BodyPhoto from "./BodyPhoto.jsx";
import FactorBars from "./FactorBars.jsx";
import { EnvironmentTag, SiteBadges } from "./SiteTags.jsx";
import { formatCoordinates } from "../data/format.js";
import { BAND_LABELS, FACTOR_REASONS } from "../content/labels.js";
import { SCORED_FACTORS, scoreBand } from "../data/scoring.js";

const SURFACE_NAMES = { earth: "Earth's land", moon: "the Moon's surface", mars: "Mars's surface" };
const SCORE_RING_SIZE = 56;

export default function MatchCard({ match, rank, isShowingDetails, onCompare }) {
  const coordinates = formatCoordinates(match.lat, match.lon);
  const placeName = match.name ?? coordinates;
  const band = scoreBand(match.score);
  // Featured sites come with written reasons; picked spots name their strongest scored factors instead.
  const reasons = match.why ?? (match.why_factors ?? []).filter((factor) => SCORED_FACTORS.includes(factor)).map((factor) => FACTOR_REASONS[factor]);

  return (
    <article className="match-card">
      <div className="match-photo">
        <MatchPhoto match={match} placeName={placeName} />
      </div>

      <header className="match-heading">
        {/* The list itself is numbered for screen readers, so the visible rank is hidden from them. */}
        <h3 className="match-name"><span className="match-rank" aria-hidden="true">{rank}</span>{placeName}</h3>
        <p className="match-meta">
          {match.name && <span className="match-coordinates">{coordinates}</span>}
          <EnvironmentTag envType={match.env_type} />
          <span className={`band-text band-${band}`}>{BAND_LABELS[band]}</span>
        </p>
      </header>

      <ScoreRing score={match.score} size={SCORE_RING_SIZE} />

      <div className="match-details">
        {reasons.length > 0 && <p className="match-reasons">{reasons.join(". ")}.</p>}
        {match.tags?.length > 0 && <p className="match-tags">{match.tags.join(", ")}</p>}
        {/* One decimal, capped below 100: the best tile beats everything except itself. */}
        {typeof match.earth_rank_pct === "number" && <p className="match-rank-pct">Better than {Math.min(99.9, match.earth_rank_pct).toFixed(1)}% of {SURFACE_NAMES[match.body ?? "earth"]}</p>}
        <SiteBadges site={match} />
        {isShowingDetails && <FactorBars breakdown={match.breakdown} isShowingNumbers isMineralogyEstimated={match.mineralogy_estimated} values={match.values} typicalFactors={match.typical_factors} tempNote={match.temp_note} />}
        <button className="button button-quiet match-compare" type="button" onClick={() => onCompare(match)}>
          Compare side by side
        </button>
      </div>
    </article>
  );
}

/** Earth matches have a satellite picture; Moon and Mars matches crop their globe's map; anything else says so. */
function MatchPhoto({ match, placeName }) {
  if (match.image_url) return <img src={match.image_url} alt={`Satellite view of ${placeName}`} loading="lazy" />;
  if (match.body && match.body !== "earth") {
    return <BodyPhoto body={match.body} lat={match.lat} lon={match.lon} label={`Orbital map around ${placeName}`} />;
  }
  return <div className="match-photo-missing">No photo yet</div>;
}
