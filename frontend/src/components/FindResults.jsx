// Results of a search: the picked site in a few words and as a tile profile, mission type and the always-visible weight
// sliders, the Details panel (site profile, factor numbers, downloads) and the top 10 matches as cards on a map.
import { useState } from "react";
import PresetPicker from "./PresetPicker.jsx";
import WeightSliders from "./WeightSliders.jsx";
import MatchExports from "./MatchExports.jsx";
import MatchCard from "./MatchCard.jsx";
import CompareDialog from "./CompareDialog.jsx";
import TargetProfile from "./TargetProfile.jsx";
import TileProfile from "./TileProfile.jsx";
import ResultsMap from "./ResultsMap.jsx";
import { areWeightsEqual } from "../data/scoring.js";

export default function FindResults({ target, matchBodyName = "Earth", matches, matchesState, presets, presetId, onSelectPreset, customWeights, onChangeWeights }) {
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const [comparedMatch, setComparedMatch] = useState(null);

  const presetWeights = presets[presetId]?.weights ?? {};
  const isCustom = Boolean(customWeights) && !areWeightsEqual(customWeights, presetWeights);
  const weightsUsed = customWeights ?? presetWeights;

  return (
    <section className="find-results" aria-labelledby="find-results-title">
      <header className={`find-results-header body-${target.body}`}>
        <h2 id="find-results-title" className="find-results-title">Best {matchBodyName} matches for {target.name}</h2>
        {target.summary && <p className="find-results-summary">{target.summary}</p>}
        {target.resources && (
          <p className="find-results-resources">
            <span><strong>Water and ice:</strong> {target.resources.water_ice}</span>
            <span><strong>Sunlight:</strong> {target.resources.illumination}</span>
          </p>
        )}
      </header>

      <TileProfile vector={matchesState.clickedVector} layout={matchesState.layout} />

      <div className="find-toolbar">
        <PresetPicker presets={presets} selectedPresetId={presetId} onSelect={onSelectPreset} />
        <button
          type="button"
          className="button button-quiet"
          aria-expanded={isDetailsOpen}
          aria-controls="find-details"
          onClick={() => setIsDetailsOpen((isOpen) => !isOpen)}
        >
          {isDetailsOpen ? "Hide details" : "Details"}
        </button>
      </div>
      <section className="weight-panel" aria-label="Weight the criteria">
        <p className="weight-panel-intro">
          <strong>Weight the criteria.</strong> Drag a slider to say how much each one matters; the matches re-rank as you
          drag. {isCustom ? "You're using your own weights." : `Starting from ${presets[presetId]?.label ?? "the mission type"}.`}
        </p>
        <WeightSliders weights={weightsUsed} onChange={onChangeWeights} onReset={() => onChangeWeights(null)} isCustom={isCustom} />
      </section>

      <div id="find-details" className="find-details" hidden={!isDetailsOpen}>
        {target.factors && <TargetProfile target={target} />}
        <div className="find-details-scoring">
          <p className="find-details-intro">
            Each factor scores from 0 (unlike) to 1 (alike). The match score multiplies them, so one weak factor pulls it
            down. {isCustom ? "Scored with your own weights." : presets[presetId]?.description}
          </p>
          <MatchExports matches={matches} weights={weightsUsed} clickedTileId={target.target_id} fileStem={`${target.target_id}_${isCustom ? "custom" : presetId}_matches`} />
        </div>
      </div>

      {matchesState.isApproximate && matches.length > 0 && (
        <p className="find-approximate" role="status">
          Approximate: these come from a precomputed shortlist because the full search is slow or unavailable on this
          device. They update by themselves when the full search finishes.
        </p>
      )}

      {matches.length > 0 && <ResultsMap matches={matches} body={matches[0].body ?? "earth"} />}

      <MatchList matches={matches} matchesState={matchesState} matchBodyName={matchBodyName} isShowingDetails={isDetailsOpen} onCompare={setComparedMatch} />

      <CompareDialog target={target} match={comparedMatch} onClose={() => setComparedMatch(null)} />
    </section>
  );
}

function MatchList({ matches, matchesState, matchBodyName, isShowingDetails, onCompare }) {
  if (matchesState.error) {
    return <p className="page-message" role="alert">The matches didn't load. Check your connection, then pick the spot again.</p>;
  }
  if (matchesState.isLoading && matches.length === 0) return <p className="page-message">Finding matches…</p>;
  if (matches.length === 0) return <p className="page-message">No {matchBodyName} matches for this spot yet. Try another spot or mission type.</p>;

  return (
    <ol className="match-list" aria-busy={matchesState.isLoading}>
      {matches.map((match) => (
        <li key={`${match.lat}-${match.lon}`}>
          <MatchCard match={match} isShowingDetails={isShowingDetails} onCompare={onCompare} />
        </li>
      ))}
    </ol>
  );
}
