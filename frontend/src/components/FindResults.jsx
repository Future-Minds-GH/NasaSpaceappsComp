// Results of a search: the picked place in a sentence and as a fact sheet of its scored factors, the mission type and
// compare mode, then the weight sliders beside the ranked matches (map, rows, downloads). Details adds every match's
// factor numbers and explains the score.
import { useState } from "react";
import PresetPicker from "./PresetPicker.jsx";
import ModeToggle from "./ModeToggle.jsx";
import WeightSliders from "./WeightSliders.jsx";
import MatchExports from "./MatchExports.jsx";
import MatchCard from "./MatchCard.jsx";
import CompareDialog from "./CompareDialog.jsx";
import TargetProfile from "./TargetProfile.jsx";
import TileProfile from "./TileProfile.jsx";
import ResultsMap from "./ResultsMap.jsx";
import { SCORED_FACTORS, areWeightsEqual, normaliseWeights } from "../data/scoring.js";
import { snapNote } from "../data/earthSnap.js";

export default function FindResults({ target, matchBodyName = "Earth", matches, matchesState, snapKm = null, presets, presetId, onSelectPreset, mode, onChangeMode, customWeights, onChangeWeights }) {
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const [comparedMatch, setComparedMatch] = useState(null);

  const preset = presets[presetId];
  const presetWeights = preset?.weights ?? {};
  // Slider weights are shares that add up to 1 and a preset's need not be, so both are compared as shares.
  const isCustom = Boolean(customWeights) && !areWeightsEqual(normaliseWeights(customWeights, SCORED_FACTORS), normaliseWeights(presetWeights, SCORED_FACTORS), SCORED_FACTORS);
  const weightsUsed = customWeights ?? presetWeights;

  return (
    <section className="find-results" aria-labelledby="find-results-title">
      <header className="find-results-header">
        <h2 id="find-results-title" className="find-results-title">Best {matchBodyName} matches for {target.name}</h2>
        {target.summary && <p className="find-results-summary">{target.summary}</p>}
        {target.resources && (
          <p className="find-results-resources">
            <span><strong>Water and ice:</strong> {target.resources.water_ice}</span>
            <span><strong>Sunlight:</strong> {target.resources.illumination}</span>
          </p>
        )}
        {snapKm !== null && <p className="find-note" role="note">{snapNote(snapKm)}</p>}
      </header>

      <TileProfile vector={matchesState.clickedVector} layout={matchesState.layout} />

      <div className="find-scoring">
        <PresetPicker presets={presets} selectedPresetId={presetId} onSelect={onSelectPreset} name="explore-preset" />
        <ModeToggle mode={mode} onChange={onChangeMode} name="explore-mode" />
      </div>

      <div className="find-layout">
        <section className="weight-panel find-weights" aria-label="Weight the criteria">
          <p className="weight-panel-intro">
            <strong>Weight the criteria.</strong> The matches re-rank as you drag.{" "}
            {isCustom ? "You're using your own weights." : `Starting from ${preset?.label ?? "the mission type"}.`}
          </p>
          <WeightSliders weights={weightsUsed} onChange={onChangeWeights} onReset={() => onChangeWeights(null)} isCustom={isCustom} />
        </section>

        <div className="find-matches">
          <div className="find-matches-bar">
            {matches.length > 0 && <p className="find-matches-count">{matches.length} matches, best first</p>}
            <button
              type="button"
              className="button button-quiet find-details-toggle"
              aria-expanded={isDetailsOpen}
              aria-controls="find-details"
              onClick={() => setIsDetailsOpen((isOpen) => !isOpen)}
            >
              {isDetailsOpen ? "Hide details" : "Details"}
            </button>
          </div>
          <div id="find-details" className="find-details" hidden={!isDetailsOpen}>
            {/* Not the preset's description from weights.json: it still names factors the site no longer scores. */}
            <p className="find-details-intro">
              Each of the five factors scores from 0 (unlike) to 1 (alike). The match score is their weighted average, scored
              in {mode} mode with {isCustom ? "your own weights" : `the ${preset?.label ?? "mission type"} weights`} shown in the sliders.
            </p>
            {target.factors && <TargetProfile target={target} />}
          </div>

          {matchesState.isApproximate && matches.length > 0 && (
            <p className="find-note find-approximate" role="status">
              <strong>Approximate.</strong> These come from a precomputed shortlist because the full search is slow or
              unavailable on this device. They update by themselves when the full search finishes.
            </p>
          )}
          {matches.length > 0 && <ResultsMap matches={matches} body={matches[0].body ?? "earth"} />}
          <MatchList matches={matches} matchesState={matchesState} matchBodyName={matchBodyName} isShowingDetails={isDetailsOpen} onCompare={setComparedMatch} />
          {matches.length > 0 && (
            <MatchExports matches={matches} weights={weightsUsed} clickedTileId={target.target_id} fileStem={`${target.target_id}_${isCustom ? "custom" : presetId}_${mode}_matches`} />
          )}
        </div>
      </div>

      <CompareDialog target={target} match={comparedMatch} onClose={() => setComparedMatch(null)} />
    </section>
  );
}

function MatchList({ matches, matchesState, matchBodyName, isShowingDetails, onCompare }) {
  if (matchesState.error) {
    return <p className="page-message" role="alert">The matches didn't load. Check your connection, then pick the spot again.</p>;
  }
  if (matchesState.isLoading && matches.length === 0) return <p className="page-message" role="status">Finding matches…</p>;
  if (matches.length === 0) return <p className="page-message">No {matchBodyName} matches for this spot yet. Try another spot or mission type.</p>;

  return (
    <ol className="match-list" aria-busy={matchesState.isLoading}>
      {matches.map((match, index) => (
        <li key={`${match.lat}-${match.lon}`}>
          <MatchCard match={match} rank={match.rank ?? index + 1} isShowingDetails={isShowingDetails} onCompare={onCompare} />
        </li>
      ))}
    </ol>
  );
}
