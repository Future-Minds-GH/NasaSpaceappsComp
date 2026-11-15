// Report card for one place on Earth: its tags, the Moon and Mars sites it can stand in for, best first, and a Details view of the numbers.
import { useState } from "react";
import ScoreRing from "./ScoreRing.jsx";
import FactorBars from "./FactorBars.jsx";
import { EnvironmentTag } from "./SiteTags.jsx";
import { BODY_NAMES } from "../content/labels.js";
import { formatCoordinates } from "../data/format.js";

// The default view stays short; the rest is one click away.
const TOP_MATCH_COUNT = 3;

/**
 * @param {{ entry: { site: object, targets: object[] }, targetsById: Record<string, object>,
 *           presets: Record<string, { label: string }> }} props
 */
export default function ReportCard({ entry, targetsById = {}, presets = {} }) {
  const [isShowingDetails, setIsShowingDetails] = useState(false);
  const [isShowingAll, setIsShowingAll] = useState(false);
  const { site } = entry;
  const rankedMatches = [...(entry.targets ?? [])].sort((first, second) => second.score - first.score);

  return (
    <article className="characterize-report" aria-labelledby="characterize-report-name">
      <header className="characterize-report-header">
        <h2 id="characterize-report-name" className="characterize-report-name">{site.name}</h2>
        {Array.isArray(site.tags) && site.tags.length > 0 && (
          <p className="characterize-report-tags">
            <span className="visually-hidden">Tags: </span>
            {describeTags(site.tags)}
          </p>
        )}
        {site.nearest_km > 0 && <p className="characterize-report-note">Scored from the nearest land tile, {site.nearest_km} km away.</p>}
        <p className="characterize-report-place">
          <span>{formatCoordinates(site.lat, site.lon)}</span>
          <EnvironmentTag envType={site.env_type} />
        </p>
      </header>

      <div className="characterize-report-toolbar">
        <h3 className="characterize-report-heading">Best Moon and Mars matches</h3>
        <button
          className="button button-quiet characterize-details-toggle"
          type="button"
          aria-expanded={isShowingDetails}
          onClick={() => setIsShowingDetails((isOpen) => !isOpen)}
        >
          {isShowingDetails ? "Hide details" : "Show details"}
        </button>
      </div>

      {rankedMatches.length > 0 ? (
        <ol className="characterize-matches">
          {rankedMatches.slice(0, isShowingAll ? undefined : TOP_MATCH_COUNT).map((match) => (
            <TargetMatch
              key={match.target_id}
              match={match}
              targetName={targetsById[match.target_id]?.name ?? match.target_id}
              realityGap={targetsById[match.target_id]?.reality_gap}
              presetLabel={presets[match.best_preset]?.label ?? match.best_preset}
              isShowingDetails={isShowingDetails}
            />
          ))}
        </ol>
      ) : (
        <p className="characterize-report-note">No Moon or Mars site has been scored against this place yet.</p>
      )}
      {rankedMatches.length > TOP_MATCH_COUNT && (
        <button className="button button-quiet characterize-show-all" type="button" onClick={() => setIsShowingAll((isShown) => !isShown)}>
          {isShowingAll ? `Show the top ${TOP_MATCH_COUNT} only` : `Show all ${rankedMatches.length} matches`}
        </button>
      )}

      {isShowingDetails && site.factors && (
        <section className="characterize-site-factors" aria-labelledby="characterize-site-factors-heading">
          <h3 id="characterize-site-factors-heading" className="characterize-report-heading">How extreme this place is</h3>
          <p className="characterize-report-note">
            Each factor runs from 0 to 1 compared with the rest of Earth's land: 0 is ordinary, 1 is as extreme as it gets.
          </p>
          <FactorBars breakdown={site.factors} isShowingNumbers />
        </section>
      )}
    </article>
  );
}

/** One Moon or Mars site in the ranking: name, body, score, best mission type, what it suits and what it can't do. */
function TargetMatch({ match, targetName, realityGap, presetLabel, isShowingDetails }) {
  return (
    <li className={`characterize-match characterize-match-${match.body}`}>
      <div className="characterize-match-header">
        <div>
          <h4 className="characterize-match-name">{targetName}</h4>
          <p className="characterize-match-meta">
            <span className="characterize-match-body">{BODY_NAMES[match.body] ?? match.body}</span>
            {presetLabel && <span>Best mission type: {presetLabel}</span>}
          </p>
        </div>
        <ScoreRing score={match.score} size={60} />
      </div>

      <div className="characterize-match-lists">
        <ReasonList title="Mission tests it suits" items={match.good_for} />
        <ReasonList title="What it can't reproduce" items={match.cant_reproduce ?? realityGap} />
      </div>

      {isShowingDetails && match.breakdown && (
        <div className="characterize-match-details">
          <p className="characterize-report-note">How alike the two places are on each factor, from 0 (not at all) to 1 (the same).</p>
          <FactorBars breakdown={match.breakdown} isShowingNumbers typicalFactors={match.typical_factors ?? []} />
        </div>
      )}
    </li>
  );
}

/** Habitability and process tags as one short line: "Hyperarid soil, aeolian". */
function describeTags(tags) {
  const line = tags.join(", ");
  return line.charAt(0).toUpperCase() + line.slice(1);
}

function ReasonList({ title, items }) {
  if (!items?.length) return null;
  return (
    <div className="characterize-reasons">
      <p className="characterize-reasons-title">{title}</p>
      <ul className="characterize-reasons-list">
        {items.map((item) => <li key={item}>{item}</li>)}
      </ul>
    </div>
  );
}
