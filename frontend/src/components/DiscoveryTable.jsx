// Ranked table of Discover candidates in their live order. Each place name is a button that shows that candidate on
// the map. On phones each row restacks into a block (discover.css), so the table never scrolls sideways.
import ScoreRing from "./ScoreRing.jsx";
import { EnvironmentTag } from "./SiteTags.jsx";
import { BODY_NAMES } from "../content/labels.js";
import { formatCoordinates, formatKm } from "../data/format.js";

const SCORE_RING_SIZE = 44;

/**
 * Candidates carry a live `rank` (from the current weights) and a fixed `published_rank` (their place in the
 * published file), which also serves as their id.
 * @param {{ candidates: object[], targetsById: Record<string, object>, selectedId: number | null,
 *           onSelect: (candidate: object) => void }} props
 */
export default function DiscoveryTable({ candidates, targetsById, selectedId, onSelect }) {
  // The published list has no environment types yet; a column of blanks would only add noise.
  const hasEnvironments = candidates.some((candidate) => candidate.env_type);

  return (
    <table className="discover-table">
      <caption className="visually-hidden">Candidate places, best score first under the chosen weights</caption>
      <thead>
        <tr>
          <th scope="col">Rank</th>
          <th scope="col">Place</th>
          {hasEnvironments && <th scope="col">Environment</th>}
          <th scope="col">Best Moon or Mars match</th>
          <th scope="col">Score</th>
          <th scope="col">Nearest known test site</th>
          <th scope="col">Why it stands out</th>
        </tr>
      </thead>
      <tbody>
        {candidates.map((candidate) => (
          <DiscoveryRow
            key={candidate.published_rank}
            candidate={candidate}
            target={targetsById[candidate.best_target_id]}
            isSelected={candidate.published_rank === selectedId}
            hasEnvironment={hasEnvironments}
            onSelect={onSelect}
          />
        ))}
      </tbody>
    </table>
  );
}

/** One candidate. The data-label attributes become the visible field names when rows restack on phones. */
function DiscoveryRow({ candidate, target, isSelected, hasEnvironment, onSelect }) {
  const body = candidate.body ?? target?.body;
  const rowClassName = ["discover-row", body && `discover-for-${body}`, isSelected && "is-selected"].filter(Boolean).join(" ");
  const distanceKm = candidate.km_to_nearest_known_analog;

  return (
    <tr className={rowClassName}>
      <td className="discover-cell-rank">
        <span className="discover-rank">{candidate.rank}</span>
        <RankChange rank={candidate.rank} publishedRank={candidate.published_rank} />
      </td>
      <th scope="row" className="discover-cell-place">
        <button type="button" className="discover-place-button" aria-pressed={isSelected} onClick={() => onSelect(candidate)}>
          <span className="visually-hidden">Show on map: </span>
          {candidate.name}
        </button>
        <span className="discover-coordinates">{formatCoordinates(candidate.lat, candidate.lon)}</span>
      </th>
      {hasEnvironment && (
        <td className="discover-cell-environment" data-label="Environment">
          <EnvironmentTag envType={candidate.env_type} />
        </td>
      )}
      <td className="discover-cell-match" data-label="Best match">
        <span className="discover-target-name">{target?.name ?? candidate.best_target_id}</span>
        {body && <span className="discover-body">{BODY_NAMES[body] ?? body}</span>}
      </td>
      <td className="discover-cell-score">
        <ScoreRing score={candidate.score} size={SCORE_RING_SIZE} />
      </td>
      <td className="discover-cell-distance" data-label="Nearest test site">
        {typeof distanceKm === "number" ? `${formatKm(distanceKm)} away` : "Not measured"}
      </td>
      <td className="discover-cell-why" data-label="Why it stands out">
        {candidate.why?.length > 0 && (
          <ul className="discover-why">
            {candidate.why.map((reason) => <li key={reason}>{reason}</li>)}
          </ul>
        )}
      </td>
    </tr>
  );
}

/** How far the current weights moved a place from its published rank; nothing when it hasn't moved. */
function RankChange({ rank, publishedRank }) {
  const placesMoved = publishedRank - rank;
  if (!publishedRank || placesMoved === 0) return null;
  return (
    <span className="discover-rank-change">
      {placesMoved > 0 ? `Up ${placesMoved}` : `Down ${-placesMoved}`}
      <span className="visually-hidden"> from the published list</span>
    </span>
  );
}
