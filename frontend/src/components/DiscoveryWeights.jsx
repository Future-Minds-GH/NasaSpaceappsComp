// Discover's ranking console: the mission type picker beside the five weight sliders, a plain sentence on what the
// weights count most, and the hook that re-scores and re-sorts the published candidates live under the chosen weights.
import { useMemo, useState } from "react";
import PresetPicker from "./PresetPicker.jsx";
import WeightSliders from "./WeightSliders.jsx";
import { FACTOR_LABELS } from "../content/labels.js";
import { SCORED_FACTORS, areWeightsEqual, combineScore, normaliseWeights, rescoreMatches } from "../data/scoring.js";

// Published scores are rounded (at most to whole numbers), so a preset made the published list if it reproduces
// every one of them this closely.
const PUBLISHED_SCORE_TOLERANCE = 0.51;
/** Factor names as they read inside a sentence; the labels are written to stand alone. */
const FACTOR_NAMES_IN_TEXT = { temp: "temperature", slope: "slope", rough: "roughness", minerals: "minerals", ice: "water ice" };

/**
 * @param {{ presets: Record<string, { label?: string, weights: object }>, presetId: string, weights: object,
 *           isCustom: boolean, onSelectPreset: (presetId: string) => void,
 *           onChangeWeights: (weights: object | null) => void }} props  onChangeWeights(null) goes back to the preset.
 */
export default function DiscoveryWeights({ presets, presetId, weights, isCustom, onSelectPreset, onChangeWeights }) {
  return (
    <section className="page-section" aria-labelledby="discover-ranking-heading">
      <div className="discover-section-intro">
        <h2 id="discover-ranking-heading" className="section-heading">Rank for a mission</h2>
        <p className="section-lede">
          Every place scores 0 to 1 on five factors, and its total is their weighted average. Pick a mission type or drag a
          slider, and the map and the list re-rank at once.
        </p>
      </div>

      {/* The sliders are always on show: weighting the factors is the point of this list. */}
      <div className="weight-panel discover-console">
        <div className="discover-mission">
          <PresetPicker presets={presets} selectedPresetId={presetId} onSelect={onSelectPreset} name="discover-preset" />
          <p className="discover-mission-summary">{describeWeights(weights, isCustom)}</p>
        </div>
        <WeightSliders weights={weights} onChange={onChangeWeights} onReset={() => onChangeWeights(null)} isCustom={isCustom} />
      </div>
    </section>
  );
}

/**
 * Live ranking state: the chosen preset, any slider weights, and the candidates re-scored and re-sorted under them.
 * Each candidate gets a live `rank` and keeps `published_rank` (its place in the published list) as a fixed id.
 */
export function useLiveRanking(discoveries, weightsFile) {
  const presets = useMemo(() => weightsFile.presets ?? {}, [weightsFile]);
  const publishedPresetId = useMemo(() => findPublishedPresetId(discoveries, presets), [discoveries, presets]);
  const publishedList = useMemo(
    () => withPublishedRank(discoveries, presets[publishedPresetId]?.weights),
    [discoveries, presets, publishedPresetId],
  );
  const [presetId, setPresetId] = useState(publishedPresetId ?? weightsFile.default_preset ?? Object.keys(presets)[0] ?? null);
  const [customWeights, setCustomWeights] = useState(null);

  const presetWeights = presets[presetId]?.weights;
  const weights = customWeights ?? presetWeights;
  const rankedCandidates = useMemo(() => (weights ? rescoreMatches(publishedList, weights) : publishedList), [publishedList, weights]);

  return {
    presets,
    presetId,
    weights,
    rankedCandidates,
    publishedPresetLabel: presets[publishedPresetId]?.label ?? null,
    isCustom: Boolean(customWeights) && !areWeightsEqual(customWeights, presetWeights ?? {}),
    selectPreset: (nextPresetId) => {
      setPresetId(nextPresetId);
      setCustomWeights(null);
    },
    setCustomWeights,
  };
}

/** The preset whose weights reproduce every published score, i.e. the one the published list was ranked with. */
function findPublishedPresetId(candidates, presets) {
  const scored = candidates.filter((candidate) => typeof candidate.score === "number" && candidate.breakdown);
  if (scored.length === 0) return null;
  const matchesEveryScore = (weights) =>
    scored.every((candidate) => Math.abs(combineScore(candidate.breakdown, weights) - candidate.score) <= PUBLISHED_SCORE_TOLERANCE);
  // Role 2's own lists were scored with the file's weights (all nine factors, kept as published_weights); lists rebuilt
  // by scripts/make-discoveries.mjs use the site's scored five. Either one identifies the preset.
  return Object.keys(presets).find((presetId) => {
    const { published_weights: publishedWeights, weights } = presets[presetId];
    return (publishedWeights !== undefined && matchesEveryScore(publishedWeights)) || matchesEveryScore(weights ?? {});
  }) ?? null;
}

/**
 * Numbers the published list. With the published preset known it is re-ranked by that preset, so near-ties break the
 * same way as the live ranking and the first view shows no false moves; otherwise it follows the published scores.
 */
function withPublishedRank(discoveries, publishedWeights) {
  // A candidate without factor scores can't be re-scored: an empty breakdown scores 0 and sinks to the bottom.
  const scorable = discoveries.map((candidate) => (candidate.breakdown ? candidate : { ...candidate, breakdown: {} }));
  const publishedOrder = publishedWeights
    ? rescoreMatches(scorable, publishedWeights)
    : [...scorable].sort((first, second) => (second.score ?? 0) - (first.score ?? 0));
  return publishedOrder.map((candidate, index) => ({ ...candidate, rank: index + 1, published_rank: index + 1 }));
}

/**
 * One plain sentence on what the current weights count most, e.g. "Counts minerals most, then water ice."
 * Written from the five scored weights, not the preset's own description, which can name factors the site ignores.
 */
function describeWeights(weights, isCustom) {
  const shares = normaliseWeights(weights, SCORED_FACTORS);
  // Whole percents, as the sliders show them, so weights that look equal read as a tie.
  const percentOf = (factor) => Math.round(shares[factor] * 100);
  const [topPercent, nextPercent] = [...new Set(SCORED_FACTORS.map(percentOf))]
    .filter((percent) => percent > 0)
    .sort((first, second) => second - first);
  const namesAt = (percent) => joinNames(SCORED_FACTORS.filter((factor) => percentOf(factor) === percent).map(nameInText));
  const opening = isCustom ? "Your weights count" : "Counts";

  if (SCORED_FACTORS.every((factor) => percentOf(factor) === topPercent)) return `${opening} every factor the same.`;
  return `${opening} ${namesAt(topPercent)} most${nextPercent ? `, then ${namesAt(nextPercent)}` : ""}.`;
}

function nameInText(factor) {
  return FACTOR_NAMES_IN_TEXT[factor] ?? FACTOR_LABELS[factor].toLowerCase();
}

/** ["slope", "roughness", "minerals"] → "slope, roughness and minerals" */
function joinNames(names) {
  if (names.length < 2) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}
