// Report card for one place on Earth: its name and place, the Moon and Mars sites it can stand in for (best first),
// what it can't reproduce of each world, and a Details view of the numbers. Every factor it names is a scored one.
import { useState } from "react";
import ScoreRing from "./ScoreRing.jsx";
import FactorBars from "./FactorBars.jsx";
import { EnvironmentTag } from "./SiteTags.jsx";
import { BAND_LABELS, BODY_NAMES, FACTOR_LABELS } from "../content/labels.js";
import { formatCoordinates } from "../data/format.js";
import { SCORED_FACTORS, scoreBand } from "../data/scoring.js";

// The default view stays short; the rest is one click away.
const TOP_MATCH_COUNT = 3;
// A factor counts as alike from this score up: the same bar as Explore's plain reasons (DEFAULT_REASON_MIN in tileSearch.js).
const ALIKE_MIN = 0.6;
// A name ending in a bracketed note: "Atacama Desert (Yungay region, Mars analog)".
const NAME_WITH_NOTE = /^(.+?)\s*\(([^()]+)\)$/;

/**
 * @param {{ entry: { site: object, targets: object[] }, targetsById: Record<string, object>,
 *           presets: Record<string, { label: string }> }} props
 */
export default function ReportCard({ entry, targetsById = {}, presets = {} }) {
  const [isShowingDetails, setIsShowingDetails] = useState(false);
  const [isShowingAll, setIsShowingAll] = useState(false);
  const { site } = entry;
  const placeName = splitPlaceName(site.name);
  const rankedMatches = [...(entry.targets ?? [])].sort((first, second) => second.score - first.score);
  const shownMatches = isShowingAll ? rankedMatches : rankedMatches.slice(0, TOP_MATCH_COUNT);
  const gapsByBody = groupGapsByBody(shownMatches, targetsById);

  return (
    <article className="characterize-report" aria-labelledby="characterize-report-name">
      <header className="characterize-report-header">
        <h2 id="characterize-report-name" className="characterize-report-name">{placeName.main}</h2>
        {placeName.note && <p className="characterize-report-subtitle">{placeName.note}</p>}
        <p className="characterize-report-place">
          <span className="characterize-report-coordinates">{formatCoordinates(site.lat, site.lon)}</span>
          <EnvironmentTag envType={site.env_type} />
        </p>
        {site.tags?.length > 0 && (
          <p className="characterize-report-small">
            <span className="visually-hidden">Tags: </span>
            {capitalise(site.tags.join(", "))}
          </p>
        )}
        {site.nearest_km > 0 && <p className="characterize-report-small">Scored from the nearest land tile, {site.nearest_km} km away.</p>}
      </header>

      <section className="characterize-report-section" aria-labelledby="characterize-matches-heading">
        <div className="characterize-report-toolbar">
          <h3 id="characterize-matches-heading" className="characterize-report-heading">Best Moon and Mars matches</h3>
          <button
            className="button button-quiet"
            type="button"
            aria-expanded={isShowingDetails}
            onClick={() => setIsShowingDetails((isOpen) => !isOpen)}
          >
            {isShowingDetails ? "Hide details" : "Show details"}
          </button>
        </div>
        {rankedMatches.length > 0 ? (
          <ol className="characterize-matches">
            {shownMatches.map((match) => (
              <TargetMatch
                key={match.target_id}
                match={match}
                targetName={targetsById[match.target_id]?.name ?? match.target_id}
                presetLabel={presets[match.best_preset]?.label ?? match.best_preset}
                isShowingDetails={isShowingDetails}
              />
            ))}
          </ol>
        ) : (
          <p className="characterize-report-small">No Moon or Mars site has been scored against this place yet.</p>
        )}
        {rankedMatches.length > TOP_MATCH_COUNT && (
          <button className="button button-quiet characterize-show-all" type="button" onClick={() => setIsShowingAll((isShown) => !isShown)}>
            {isShowingAll ? `Show the top ${TOP_MATCH_COUNT} only` : `Show all ${rankedMatches.length} matches`}
          </button>
        )}
      </section>

      {gapsByBody.length > 0 && (
        <section className="characterize-report-section" aria-labelledby="characterize-gaps-heading">
          <h3 id="characterize-gaps-heading" className="characterize-report-heading">What it can't reproduce</h3>
          <div className="characterize-gaps">
            {gapsByBody.map(({ body, gaps }) => (
              <div key={body} className={`characterize-gap characterize-body-${body}`}>
                <h4 className="characterize-body-label">{BODY_NAMES[body] ?? body}</h4>
                <ul className="characterize-bullet-list">
                  {gaps.map((gap) => <li key={gap}>{gap}</li>)}
                </ul>
              </div>
            ))}
          </div>
        </section>
      )}

      {isShowingDetails && site.factors && (
        <section className="characterize-report-section characterize-reveal" aria-labelledby="characterize-site-factors-heading">
          <h3 id="characterize-site-factors-heading" className="characterize-report-heading">How extreme this place is</h3>
          <p className="characterize-report-small">
            Each of the {SCORED_FACTORS.length} scored factors runs from 0 to 1 compared with the rest of Earth's land: 0 is
            ordinary, 1 is as extreme as it gets.
          </p>
          <FactorBars breakdown={site.factors} isShowingNumbers />
        </section>
      )}
    </article>
  );
}

/** "Atacama Desert (Yungay region, Mars analog)" as { main: "Atacama Desert", note: "Yungay region, Mars analog" }. */
export function splitPlaceName(name) {
  const parts = String(name ?? "").match(NAME_WITH_NOTE);
  return parts ? { main: parts[1], note: capitalise(parts[2]) } : { main: name, note: "" };
}

/** One Moon or Mars site in the ranking: name, world, score band, best mission type and the factors it is closest on. */
function TargetMatch({ match, targetName, presetLabel, isShowingDetails }) {
  const band = scoreBand(match.score);
  const alikeFactors = findAlikeFactors(match);

  return (
    <li className={`characterize-match characterize-body-${match.body}`}>
      <div className="characterize-match-header">
        <div className="characterize-match-title">
          <h4 className="characterize-match-name">{targetName}</h4>
          <p className="characterize-match-meta">
            <span className="characterize-body-label">{BODY_NAMES[match.body] ?? match.body}</span>
            <span className={`band-text band-${band}`}>{BAND_LABELS[band]}</span>
            {presetLabel && <span>Best mission type: {presetLabel}</span>}
          </p>
        </div>
        <ScoreRing score={match.score} size={56} />
      </div>

      {alikeFactors.length > 0 && (
        <p className="characterize-match-alike">
          Most alike in {joinWithAnd(alikeFactors.map((factor) => FACTOR_LABELS[factor].toLowerCase()))}.
        </p>
      )}
      {match.good_for?.length > 0 && (
        <div>
          <p className="characterize-report-small">Mission tests it suits</p>
          <ul className="characterize-bullet-list">
            {match.good_for.map((test) => <li key={test}>{test}</li>)}
          </ul>
        </div>
      )}

      {isShowingDetails && match.breakdown && (
        <div className="characterize-match-details characterize-reveal">
          <p className="characterize-report-small">How alike the two places are on each scored factor, from 0 (not at all) to 1 (the same).</p>
          <FactorBars breakdown={match.breakdown} isShowingNumbers typicalFactors={match.typical_factors ?? []} />
        </div>
      )}
    </li>
  );
}

/** The scored factors a match is close on (measured on both places, ALIKE_MIN and up), closest first. */
function findAlikeFactors(match) {
  const typicalFactors = match.typical_factors ?? [];
  return SCORED_FACTORS
    .filter((factor) => !typicalFactors.includes(factor) && (match.breakdown?.[factor] ?? -1) >= ALIKE_MIN)
    .sort((first, second) => match.breakdown[second] - match.breakdown[first]);
}

/**
 * What each world has that this place can't reproduce, listed once per world: every target on a world shares that
 * world's list, so repeating it under each match only made the card longer.
 */
function groupGapsByBody(matches, targetsById) {
  const gapsByBody = new Map();
  for (const match of matches) {
    const gaps = match.cant_reproduce ?? targetsById[match.target_id]?.reality_gap ?? [];
    const bodyGaps = gapsByBody.get(match.body) ?? new Set();
    gaps.forEach((gap) => bodyGaps.add(gap));
    gapsByBody.set(match.body, bodyGaps);
  }
  return [...gapsByBody]
    .filter(([, gaps]) => gaps.size > 0)
    .map(([body, gaps]) => ({ body, gaps: [...gaps] }));
}

/** ["slope", "roughness", "water ice"] as "slope, roughness and water ice". */
function joinWithAnd(words) {
  return words.length < 2 ? words.join("") : `${words.slice(0, -1).join(", ")} and ${words.at(-1)}`;
}

function capitalise(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
