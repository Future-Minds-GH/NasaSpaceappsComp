// Explore: pick a spot on Earth, the Moon or Mars, and rank every tile of one of the other two bodies against it.
// The URL keeps the choice: #/explore/moon?to=earth&site=shackleton_ridge or ?at=-89.45,-136.00, plus &preset=landing and &mode=relative.
// After a pick the globe stays free to turn and zoom; it only flies on its own when a named site is chosen.
import { useEffect, useMemo, useState } from "react";
import { Link, Navigate, useParams, useSearchParams } from "react-router-dom";
import { loadBodyMeta, loadTargets, loadWeights } from "../data/api.js";
import { useLoaded } from "../data/useLoaded.js";
import { useTileSearch } from "../data/useTileSearch.js";
import { MODES } from "../data/similarity.js";
import { describeSelection, parsePoint } from "../data/exploreSelection.js";
import { BODY_NAMES } from "../content/labels.js";
import PlanetGlobe, { GLOBE_TEXTURES } from "../components/PlanetGlobe.jsx";
import FindResults from "../components/FindResults.jsx";
import ResultBodyTabs, { RESULTS_PANEL_ID } from "../components/ResultBodyTabs.jsx";
import "../styles/explore.css";
import "../styles/find.css";

const BODIES = ["earth", "moon", "mars"];
// What a body is usually compared with first: the Moon and Mars with Earth (the challenge), Earth with Mars.
const DEFAULT_TARGET = { earth: "mars", moon: "earth", mars: "earth" };
const ON_BODY = { earth: "Earth", moon: "the Moon", mars: "Mars" };

export default function ExplorePage() {
  const { body } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const [isShowingCaves, setIsShowingCaves] = useState(false);
  // Slider weights belong to one planet: they are stored with their body, so each body starts again from the preset.
  const [customState, setCustomState] = useState(null);
  const customWeights = customState?.body === body ? customState.weights : null;
  const setCustomWeights = (weights) => setCustomState(weights ? { body, weights } : null);
  // Leaving a planet drops its custom weights, so coming back (Mars → Earth → Mars) also starts from the preset.
  useEffect(() => setCustomState(null), [body]);
  const [focus, setFocus] = useState(null);
  const targetsState = useLoaded(loadTargets, []);
  const presetsState = useLoaded(loadWeights, []);
  const bodyMeta = useLoaded(() => (BODIES.includes(body) && body !== "earth" ? loadBodyMeta(body) : null), [body]);

  const requestedTarget = searchParams.get("to");
  const targetBody = BODIES.includes(requestedTarget) && requestedTarget !== body ? requestedTarget : DEFAULT_TARGET[body];
  const bodySites = (targetsState.data ?? []).filter((site) => site.body === body);
  const shownSites = bodySites.filter((site) => site.track !== "cave" || isShowingCaves);
  const namedSite = bodySites.find((site) => site.target_id === searchParams.get("site")) ?? null;
  const pickedPoint = useMemo(() => parsePoint(searchParams.get("at")), [searchParams]);
  const selection = useMemo(() => {
    if (namedSite) return { body, lat: namedSite.lat, lon: namedSite.lon };
    return pickedPoint ? { body, ...pickedPoint } : null;
  }, [body, namedSite, pickedPoint]);

  const presets = presetsState.data?.presets ?? {};
  const requestedPresetId = searchParams.get("preset");
  const presetId = requestedPresetId in presets ? requestedPresetId : presetsState.data?.default_preset ?? Object.keys(presets)[0];
  const weights = customWeights ?? presets[presetId]?.weights;
  const requestedMode = searchParams.get("mode");
  const mode = MODES.includes(requestedMode) ? requestedMode : (MODES.includes(presetsState.data?.default_mode) ? presetsState.data.default_mode : "absolute");
  const search = useTileSearch(selection, targetBody, weights, mode);

  if (!BODIES.includes(body)) return <Navigate to="/explore/mars" replace />;
  const target = selection && search.tile ? describeSelection({ body, targetBody, namedSite, selection, tile: search.tile, meta: bodyMeta.data, sites: targetsState.data }) : null;

  function updateSearchParams(changes) {
    const nextParams = new URLSearchParams(searchParams);
    Object.entries(changes).forEach(([key, value]) => (value === null ? nextParams.delete(key) : nextParams.set(key, value)));
    setSearchParams(nextParams, { replace: true });
  }

  function handleSelectSite(site) {
    updateSearchParams({ site: site.target_id, at: null });
    setFocus({ lat: site.lat, lon: site.lon }); // flying to a named site helps; flying after a click would fight the user
  }

  return (
    <div className="explore-page">
      <section className={`explore-stage body-${body}`} aria-labelledby="explore-title">
        <PlanetGlobe
          body={body}
          isInteractive
          sites={shownSites}
          selectedTile={search.tile}
          focus={focus}
          onPick={(lat, lon) => updateSearchParams({ at: `${lat.toFixed(2)},${lon.toFixed(2)}`, site: null })}
          onSelectSite={handleSelectSite}
          label={`Globe of ${BODY_NAMES[body]}. Drag to turn it, scroll to zoom, click a spot to pick that tile.`}
        />
        <div className="explore-heading">
          <h1 id="explore-title" className="explore-title">Click anywhere on {ON_BODY[body]}</h1>
          <p className="explore-hint">Each click picks a tile about 27 km across. Drag to turn the globe and pick again any time.</p>
        </div>
        <nav className="body-switchers" aria-label="Switch globe">
          {BODIES.filter((other) => other !== body).map((other) => (
            <Link key={other} className="body-switcher" to={`/explore/${other}?to=${other === targetBody ? body : targetBody}`}>
              <span className="body-switcher-globe" style={{ backgroundImage: `url(${GLOBE_TEXTURES[other].url})` }} aria-hidden="true" />
              {BODY_NAMES[other]}
            </Link>
          ))}
        </nav>
        <div className="explore-sites" role="group" aria-label="Named sites">
          {shownSites.map((site) => (
            <button key={site.target_id} type="button" className="site-chip" aria-pressed={site.target_id === namedSite?.target_id} onClick={() => handleSelectSite(site)}>
              {site.name}
            </button>
          ))}
          {bodySites.some((site) => site.track === "cave") && (
            <label className="cave-toggle">
              <input type="checkbox" checked={isShowingCaves} onChange={(event) => setIsShowingCaves(event.target.checked)} />
              Show caves
            </label>
          )}
        </div>
      </section>

      <div className="explore-results">
        <ResultBodyTabs bodies={BODIES.filter((other) => other !== body)} selectedBody={targetBody} onSelect={(other) => updateSearchParams({ to: other })} />
        <div id={RESULTS_PANEL_ID} role="tabpanel" aria-labelledby={`result-tab-${targetBody}`} className="explore-results-panel">
          {!selection && <p className="page-message explore-empty">Pick a spot on the globe, or a named site, to rank every place on {ON_BODY[targetBody]} against it.</p>}
          {search.hasNoData && (
            <p className="page-message explore-empty" role="status">
              {body === "earth" ? "This spot has no score: only dry, open land is scored (forests, cities and water are left out). Try a desert, polar or volcanic area." : "This tile has no data yet. Try a spot nearby."}
            </p>
          )}
          {target && presetId && !search.hasNoData && (
            <FindResults
              key={`${target.target_id}-${targetBody}-${presetId}`}
              target={target}
              matchBodyName={BODY_NAMES[targetBody]}
              matches={search.data ?? []}
              matchesState={search}
              presets={presets}
              presetId={presetId}
              onSelectPreset={(nextPresetId) => { setCustomWeights(null); updateSearchParams({ preset: nextPresetId }); }}
              groups={presetsState.data?.groups}
              mode={mode}
              onChangeMode={(nextMode) => updateSearchParams({ mode: nextMode })}
              customWeights={customWeights}
              onChangeWeights={setCustomWeights}
            />
          )}
        </div>
      </div>
    </div>
  );
}
