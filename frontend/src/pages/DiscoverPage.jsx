// Discover mode: strong Earth stand-ins far from every known test site, re-ranked live by mission type and weight sliders.
import { useRef, useState } from "react";
import DiscoveryFilters, { NO_FILTERS, buildFilterOptions, filterCandidates } from "../components/DiscoveryFilters.jsx";
import DiscoveryTable from "../components/DiscoveryTable.jsx";
import DiscoveryMap, { inDrawOrder } from "../components/DiscoveryMap.jsx";
import DiscoveryWeights, { useLiveRanking } from "../components/DiscoveryWeights.jsx";
import { dataFileUrl, loadDiscoveries, loadTargets, loadWeights } from "../data/api.js";
import { useLoaded } from "../data/useLoaded.js";
import "../styles/discover.css";

const ROWS_PER_PAGE = 50;

export default function DiscoverPage() {
  const { data, error, isLoading } = useLoaded(() => Promise.all([loadDiscoveries(), loadTargets(), loadWeights()]), []);

  return (
    <div className="page discover-page">
      <h1 className="page-title">Discover new analogs</h1>
      <p className="page-lede">Strong Earth stand-ins for the Moon and Mars that are far from every site already used for testing.</p>
      {isLoading && <p className="page-message" role="status">Loading the candidate list…</p>}
      {error && (
        <p className="page-message" role="alert">
          The candidate list didn't load ({error.message}). Check your connection, then reload the page.
        </p>
      )}
      {data && <DiscoveryCatalogue discoveries={data[0]} targets={data[1]} weightsFile={data[2]} />}
    </div>
  );
}

/** Ranking controls, filters, map and table. Its own component so their state only starts once the data is in. */
function DiscoveryCatalogue({ discoveries, targets, weightsFile }) {
  const ranking = useLiveRanking(discoveries, weightsFile);
  const [filters, setFilters] = useState(NO_FILTERS);
  const [selectedId, setSelectedId] = useState(null);
  const [mapFocus, setMapFocus] = useState(undefined);
  const [visibleCount, setVisibleCount] = useState(ROWS_PER_PAGE);
  const mapRef = useRef(null);

  const targetsById = Object.fromEntries(targets.map((target) => [target.target_id, target]));
  const shownCandidates = filterCandidates(ranking.rankedCandidates, filters, targetsById);
  const listedCandidates = shownCandidates.slice(0, visibleCount);
  const selectedCandidate = shownCandidates.find((candidate) => candidate.published_rank === selectedId) ?? null;
  const isSelectedListed = selectedCandidate !== null && listedCandidates.includes(selectedCandidate);
  const pins = inDrawOrder(listedCandidates, selectedCandidate);

  /** Picking a place in the table flies the map to it and brings the map into view. */
  const handleTableSelect = (candidate) => {
    setSelectedId(candidate.published_rank);
    setMapFocus([candidate.lat, candidate.lon]);
    const isReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    mapRef.current?.scrollIntoView({ block: "nearest", behavior: isReducedMotion ? "auto" : "smooth" });
  };

  if (discoveries.length === 0) {
    return <p className="page-message">No candidates have been found yet. Check back once the analysis has run.</p>;
  }

  return (
    <>
      {ranking.presetId && (
        <DiscoveryWeights
          presets={ranking.presets}
          presetId={ranking.presetId}
          weights={ranking.weights}
          groups={ranking.groups}
          isCustom={ranking.isCustom}
          onSelectPreset={ranking.selectPreset}
          onChangeWeights={ranking.setCustomWeights}
        />
      )}

      <div className="discover-filter-bar">
        <DiscoveryFilters filters={filters} optionsByFilter={buildFilterOptions(discoveries)} onChange={setFilters} />
        <p className="discover-count" aria-live="polite">{describeCount(shownCandidates.length, discoveries.length)}</p>
      </div>

      <div className="discover-map" ref={mapRef}>
        <DiscoveryMap
          pins={pins}
          selectedCandidate={selectedCandidate}
          selectedId={selectedId}
          isSelectedListed={isSelectedListed}
          targetsById={targetsById}
          focus={mapFocus}
          onSelectPin={setSelectedId}
        />
      </div>

      <div className="discover-list-header">
        <h2 className="section-heading">Ranked list</h2>
        <div className="discover-downloads">
          <a className="button button-quiet" href={dataFileUrl("discoveries.csv")} download>Download CSV</a>
          <a className="button button-quiet" href={dataFileUrl("discoveries.geojson")} download>Download GeoJSON</a>
          <p className="discover-download-note">Files hold every candidate, whatever the filters.</p>
        </div>
      </div>

      {shownCandidates.length > 0 ? (
        <DiscoveryTable candidates={listedCandidates} targetsById={targetsById} selectedId={selectedId} onSelect={handleTableSelect} />
      ) : (
        <div className="discover-empty">
          <p>No candidates match these filters. Clear them to see the whole list again.</p>
          <button type="button" className="button button-quiet" onClick={() => setFilters(NO_FILTERS)}>Clear filters</button>
        </div>
      )}
      {shownCandidates.length > visibleCount && (
        <div className="discover-more">
          <p>Showing the top {visibleCount} of {shownCandidates.length}.</p>
          <button type="button" className="button button-quiet" onClick={() => setVisibleCount((count) => count + ROWS_PER_PAGE)}>
            Show {Math.min(ROWS_PER_PAGE, shownCandidates.length - visibleCount)} more
          </button>
        </div>
      )}
      <p className="discover-table-note">
        The downloads keep the published ranking{ranking.publishedPresetLabel ? `, made with the ${ranking.publishedPresetLabel} weights` : ""},
        not the order set by the mission type and sliders above.
      </p>
    </>
  );
}

function describeCount(shownCount, totalCount) {
  const noun = totalCount === 1 ? "candidate" : "candidates";
  return shownCount === totalCount ? `Showing all ${totalCount} ${noun}` : `Showing ${shownCount} of ${totalCount} ${noun}`;
}
