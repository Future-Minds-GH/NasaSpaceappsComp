// One discovery written up for the Findings page: where it is, what it stands in for, what matches, where the
// analogy breaks and how it could help exploration, with the factor numbers on request.
import { useId } from "react";
import ScoreRing from "./ScoreRing.jsx";
import FactorBars from "./FactorBars.jsx";
import { EnvironmentTag } from "./SiteTags.jsx";
import { FINDINGS_EXPLORATION_USES } from "../content/about.js";
import { FACTOR_LABELS } from "../content/labels.js";
import { formatCoordinates, formatKm } from "../data/format.js";
import { FACTORS } from "../data/scoring.js";

/** How many of the closest and of the weakest factors each finding names. */
const NAMED_FACTOR_COUNT = 2;
const MAX_EXPLORATION_USES = 2;
const BODY_PLACES = { moon: "the Moon", mars: "Mars" };

/** One discovery written up: where it is, what it stands in for, the three questions, and the numbers on request. */
export default function FindingCard({ finding, target }) {
  const headingId = useId();
  const rankedFactors = rankFactors(finding.breakdown);
  const closestFactors = rankedFactors.slice(0, NAMED_FACTOR_COUNT);
  const weakestFactors = rankedFactors.slice(NAMED_FACTOR_COUNT).slice(-NAMED_FACTOR_COUNT).reverse();
  const place = BODY_PLACES[finding.body] ?? "another world";
  const distanceKm = finding.km_to_nearest_known_analog;

  return (
    <article className={`findings-item findings-for-${finding.body}`} aria-labelledby={headingId}>
      <header className="findings-item-header">
        <div className="findings-item-title">
          <h2 id={headingId} className="findings-item-name">{finding.name}</h2>
          <p className="findings-item-meta">
            <span>{formatCoordinates(finding.lat, finding.lon)}</span>
            <EnvironmentTag envType={finding.env_type} />
          </p>
          <p className="findings-item-target">
            Stands in for {target ? <strong>{target.name}</strong> : "a site"} on {place}
          </p>
          {typeof distanceKm === "number" && (
            <p className="findings-item-distance"><strong>{formatKm(distanceKm)}</strong> from the nearest known analog site</p>
          )}
        </div>
        <ScoreRing score={finding.score} size={72} />
      </header>

      <div className="findings-item-parts">
        <div className="findings-item-part">
          <h3 className="findings-item-part-title">What matches</h3>
          <PhraseList phrases={finding.why} />
          <FactorList label="Closest factors" factors={closestFactors} />
        </div>
        <div className="findings-item-part">
          <h3 className="findings-item-part-title">Where the analogy breaks</h3>
          <FactorList label="Weakest factors" factors={weakestFactors} />
          <PhraseList phrases={finding.cant_reproduce} />
        </div>
        <div className="findings-item-part">
          <h3 className="findings-item-part-title">How it helps exploration</h3>
          <p>{describeExplorationUse(finding.tags, target, place)}</p>
        </div>
      </div>

      <details className="findings-item-details">
        <summary>Show all nine factor scores</summary>
        <FactorBars breakdown={finding.breakdown} isShowingNumbers />
      </details>
    </article>
  );
}

/** A short bullet list of plain phrases, or nothing when there are none. */
function PhraseList({ phrases }) {
  if (!phrases?.length) return null;
  return <ul className="findings-phrases">{phrases.map((phrase) => <li key={phrase}>{phrase}</li>)}</ul>;
}

/** Factor names beside their legend swatches, under a short label. */
function FactorList({ label, factors }) {
  if (factors.length === 0) return null;
  return (
    <div className="findings-factors">
      <p className="findings-factors-label">{label}</p>
      <ul className="findings-factor-list">
        {factors.map((factor) => (
          <li key={factor} style={{ "--factor-color": `var(--factor-${factor})` }}>
            <span className="factor-swatch" aria-hidden="true" />
            {FACTOR_LABELS[factor]}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Factors that have a score, closest match first (ties keep the usual factor order). */
function rankFactors(breakdown) {
  return FACTORS.filter((factor) => typeof breakdown?.[factor] === "number")
    .sort((first, second) => breakdown[second] - breakdown[first]);
}

/** One plain sentence on what teams could rehearse there, built from the place's tags. */
function describeExplorationUse(tags, target, place) {
  const uses = [...new Set((tags ?? []).map((tag) => FINDINGS_EXPLORATION_USES[tag]).filter(Boolean))].slice(0, MAX_EXPLORATION_USES);
  const destination = target ? `at ${target.name} on ${place}` : `on ${place}`;
  if (uses.length === 0) return `A fresh place to field-test rovers and instruments before using them ${destination}.`;
  return `A place to run ${uses.join(" and ")} before trying them ${destination}.`;
}
