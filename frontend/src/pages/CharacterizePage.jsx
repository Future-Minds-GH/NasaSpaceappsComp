// Characterize mode: pick a famous test site or any spot on Earth's land and see which Moon and Mars sites it can stand in for.
import { useState } from "react";
import { CircleMarker } from "react-leaflet";
import EarthMap from "../components/EarthMap.jsx";
import ReportCard from "../components/ReportCard.jsx";
import CharacterizeNotice from "../components/CharacterizeNotice.jsx";
import CoordinateForm from "../components/CoordinateForm.jsx";
import { loadFamousSites, loadGridTile, loadTargets, loadWeights } from "../data/api.js";
import { useLoaded } from "../data/useLoaded.js";
import { cellKey, snapToCell, tileNameForCell } from "../data/earthGrid.js";
import { formatCoordinates } from "../data/format.js";
import "../styles/characterize.css";

// The best-known analog sites lead the list; the rest follow in file order.
const FEATURED_SITE_IDS = ["atacama", "haughton_crater", "death_valley"];

export default function CharacterizePage() {
  // { cell, famousSite?, focus? }: the picked 0.5° cell, the famous-site entry when a site button picked it,
  // and where to move the map (left out for map clicks, since the user is already looking there).
  const [selection, setSelection] = useState(null);
  const [referenceAttempt, setReferenceAttempt] = useState(0);
  const [tileAttempt, setTileAttempt] = useState(0);

  const reference = useLoaded(loadReferenceData, [referenceAttempt]);
  const tileName = selection && !selection.famousSite ? tileNameForCell(selection.cell) : null;
  const tile = useLoaded(() => (tileName ? loadTaggedTile(tileName) : null), [tileName, tileAttempt]);
  const report = resolveReport(selection, tile, tileName);
  const pickedCoordinates = selection ? formatCoordinates(selection.cell.lat, selection.cell.lon) : "";

  function handleFamousSiteClick(famousSite) {
    const { lat, lon } = famousSite.site;
    setSelection({ cell: snapToCell(lat, lon), famousSite, focus: [lat, lon] });
  }

  function handleSpotPick(lat, lon, isMovingMap = false) {
    const cell = snapToCell(lat, lon);
    setSelection({ cell, focus: isMovingMap ? [cell.lat, cell.lon] : undefined });
  }

  return (
    <div className="page characterize-page">
      <h1 className="page-title">Characterize a place</h1>
      <p className="page-lede">Pick a place on Earth and see which Moon and Mars sites it can stand in for.</p>

      <div className="characterize-layout">
        <div className="characterize-explore">
          <section aria-labelledby="characterize-famous-heading">
            <h2 id="characterize-famous-heading" className="control-label">Famous test sites</h2>
            {reference.error && (
              <CharacterizeNotice onRetry={() => setReferenceAttempt((count) => count + 1)}>
                The famous sites did not load. Check your connection, then try again.
              </CharacterizeNotice>
            )}
            {!reference.error && !reference.data && <p className="characterize-hint">Loading the famous sites…</p>}
            {reference.data && (
              <ul className="characterize-famous-list">
                {reference.data.famousSites.map((famousSite) => (
                  <li key={famousSite.site_id}>
                    <button
                      className="button button-quiet characterize-famous-button"
                      type="button"
                      aria-pressed={selection?.famousSite?.site_id === famousSite.site_id}
                      onClick={() => handleFamousSiteClick(famousSite)}
                    >
                      {famousSite.site.name}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="characterize-map" aria-labelledby="characterize-map-heading">
            <h2 id="characterize-map-heading" className="control-label">Or click any spot on land</h2>
            <EarthMap
              onPick={handleSpotPick}
              highlightBounds={selection?.cell.bounds}
              focus={selection?.focus}
              label="World map. Click a spot on land to see its report card."
            >
              {selection && (
                <CircleMarker center={[selection.cell.lat, selection.cell.lon]} radius={6} pathOptions={{ className: "characterize-pin" }} />
              )}
            </EarthMap>
            <CoordinateForm onSubmit={(lat, lon) => handleSpotPick(lat, lon, true)} />
          </section>
        </div>

        <div className="characterize-report-column">
          <p className="visually-hidden" role="status">{describeReport(report)}</p>
          {report.status === "empty" && (
            <CharacterizeNotice title="No place picked yet">
              Pick a famous test site or click anywhere on land. Its report card shows which Moon and Mars sites it is most
              like, the mission tests it suits and what it can't reproduce.
            </CharacterizeNotice>
          )}
          {report.status === "loading" && <p className="page-message">Loading the scores for {pickedCoordinates}…</p>}
          {report.status === "error" && (
            <CharacterizeNotice onRetry={() => setTileAttempt((count) => count + 1)}>
              The scores for this area did not load. Check your connection, then try again.
            </CharacterizeNotice>
          )}
          {report.status === "unscored" && (
            <CharacterizeNotice title="No score for this spot">
              {pickedCoordinates} has no score because only land is scored: oceans and ice sheets are left out. Try a
              desert, polar or volcanic region, or pick one of the famous test sites.
            </CharacterizeNotice>
          )}
          {report.status === "ready" && (
            <ReportCard entry={report.entry} targetsById={reference.data?.targetsById} presets={reference.data?.presets} />
          )}
        </div>
      </div>
    </div>
  );
}

/** Famous sites (featured first), targets by id for their names, and mission presets for their labels. */
function loadReferenceData() {
  return Promise.all([loadFamousSites(), loadTargets(), loadWeights()]).then(([sites, targets, weights]) => {
    const featuredSites = FEATURED_SITE_IDS.map((siteId) => sites.find((site) => site.site_id === siteId)).filter(Boolean);
    const otherSites = sites.filter((site) => !FEATURED_SITE_IDS.includes(site.site_id));
    const targetsById = Object.fromEntries(targets.map((target) => [target.target_id, target]));
    return { famousSites: [...featuredSites, ...otherSites], targetsById, presets: weights.presets ?? {} };
  });
}

/** Tags the tile's cells with its name, so a lookup never reads the previous tile while the next one loads. */
function loadTaggedTile(tileName) {
  return loadGridTile(tileName).then((cells) => ({ tileName, cells }));
}

/** What the report column shows: nothing picked yet, loading, an error, an unscored spot, or a report card. */
function resolveReport(selection, tile, tileName) {
  if (!selection) return { status: "empty" };
  if (selection.famousSite) return { status: "ready", entry: selection.famousSite };
  if (tile.data?.tileName !== tileName) return { status: tile.error ? "error" : "loading" };
  const entry = tile.data.cells[cellKey(selection.cell)];
  return entry ? { status: "ready", entry } : { status: "unscored" };
}

/** Short line for screen readers, so they hear the result without the whole card being read out. */
function describeReport(report) {
  if (report.status === "loading") return "Loading the scores for this spot.";
  if (report.status === "unscored") return "No score for this spot.";
  return report.status === "ready" ? `Showing the report card for ${report.entry.site.name}.` : "";
}
