// One Earth match: photo, place, score and plain reasons. The seven factor bars show only with Details open.
import ScoreRing from "./ScoreRing.jsx";
import BodyPhoto from "./BodyPhoto.jsx";
import FactorBars from "./FactorBars.jsx";
import LimitsList from "./LimitsList.jsx";
import { EnvironmentTag, SiteBadges } from "./SiteTags.jsx";
import { formatCoordinates } from "../data/format.js";
import { FACTOR_REASONS } from "../content/labels.js";

const SURFACE_NAMES = { earth: "Earth's land", moon: "the Moon's surface", mars: "Mars's surface" };

export default function MatchCard({ match, targetBody, isShowingDetails, onCompare }) {
  const coordinates = formatCoordinates(match.lat, match.lon);
  const placeName = match.name ?? coordinates;
  // Featured sites come with written reasons; picked spots name their strongest factors instead.
  const reasons = match.why ?? (match.why_factors ?? []).map((factor) => FACTOR_REASONS[factor]);

  return (
    <article className="match-card">
      <div className="match-photo">
        {match.image_url ? (
          <img src={match.image_url} alt={`Satellite view of ${placeName}`} loading="lazy" />
        ) : match.body && match.body !== "earth" ? (
          <BodyPhoto body={match.body} lat={match.lat} lon={match.lon} label={`Orbital map around ${placeName}`} />
        ) : (
          <div className="match-photo-missing">No photo for this spot yet</div>
        )}
        <ScoreRing score={match.score} size={60} />
      </div>

      <div className="match-body">
        <h3 className="match-name">{placeName}</h3>
        <p className="match-meta">
          {match.name && <span>{coordinates}</span>}
          <EnvironmentTag envType={match.env_type} />
        </p>
        {reasons.length > 0 && <p className="match-reasons">{reasons.join(". ")}.</p>}
        {match.tags?.length > 0 && <p className="match-tags">{match.tags.join(", ")}</p>}
        {/* One decimal, capped below 100: the best tile beats everything except itself. */}
        {typeof match.earth_rank_pct === "number" && <p className="match-rank-pct">Better than {Math.min(99.9, match.earth_rank_pct).toFixed(1)}% of {SURFACE_NAMES[match.body ?? "earth"]}</p>}
        <SiteBadges site={match} />
        <LimitsList body={targetBody} />
        {isShowingDetails && <FactorBars breakdown={match.breakdown} isShowingNumbers isMineralogyEstimated={match.mineralogy_estimated} />}
        <button className="button button-quiet match-compare" type="button" onClick={() => onCompare(match)}>
          Compare side by side
        </button>
      </div>
    </article>
  );
}
