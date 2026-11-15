// Discover's ranking: the mission type picker, a Details panel with the nine weight sliders, and the hook that
// re-scores and re-sorts the published candidates live under the chosen weights.
import { useMemo, useState } from "react";
import PresetPicker from "./PresetPicker.jsx";
import WeightSliders from "./WeightSliders.jsx";
import { areWeightsEqual, combineScore, rescoreMatches } from "../data/scoring.js";

// Published scores are rounded (at most to whole numbers), so a preset made the published list if it reproduces
// every one of them this closely.
const PUBLISHED_SCORE_TOLERANCE = 0.51;

/**
 * @param {{ presets: Record<string, { label?: string, description?: string, weights: object }>, presetId: string,
 *           weights: object, isCustom: boolean, onSelectPreset: (presetId: string) => void,
 *           onChangeWeights: (weights: object | null) => void }} props  onChangeWeights(null) goes back to the preset.
 */
export default function DiscoveryWeights({ presets, presetId, weights, isCustom, groups, onSelectPreset, onChangeWeights }) {
  return (
    <section className="discover-weights" aria-label="How the list is ranked">
      <div className="discover-weights-bar">
        <PresetPicker presets={presets} selectedPresetId={presetId} onSelect={onSelectPreset} name="discover-preset" />
      </div>
      <p className="discover-weights-summary">
        {isCustom ? "Ranked with your own weights." : presets[presetId]?.description}
      </p>

      {/* The sliders are always on show: weighting the criteria is the point of this list. */}
      <div className="weight-panel">
        <p className="weight-panel-intro">
          <strong>Weight the criteria.</strong> Every place scores 0 to 1 on nine factors; the total is their weighted
          average. Drag a slider and the list and the map re-rank at once.
        </p>
        <WeightSliders groups={groups} weights={weights} onChange={onChangeWeights} onReset={() => onChangeWeights(null)} isCustom={isCustom} />
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
    groups: weightsFile.groups,
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
  return Object.keys(presets).find((presetId) => matchesEveryScore(presets[presetId].weights ?? {})) ?? null;
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
