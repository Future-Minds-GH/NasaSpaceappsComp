// The live tile search as a React hook, for any pair of bodies. A click picks a HEALPix tile on the shown body; the
// hook loads that tile's vector and the other body's tiles, and asks the search worker to score them. Slider moves only
// ask for a re-rank. If the search fails or is slow, it falls back to the tile's pool shortlist (pools/), then to
// Role 2's precomputed showcase.json; those results are flagged approximate.
import { useEffect, useMemo, useState } from "react";
import { loadBodyMeta, loadBodyVectors, loadEarthTiles, loadPool, loadShowcase, loadVectorSchema } from "./api.js";
import { baseCellOf, latLonToTile } from "./healpix.js";
import { decideEarthSnap } from "./earthSnap.js";
import { readLayout } from "./similarity.js";
import { SAME_BODY_MIN_KM } from "./ranking.js";
import { rescoreMatches } from "./scoring.js";
import { buildMatches, buildPoolMatches, clickedTileVector, readBodyTiles, readEarthTiles, tileCentres } from "./tileSearch.js";
import { searchKeyOf, useSearchWorker } from "./useSearchWorker.js";
import { useLoaded } from "./useLoaded.js";

const MARS_SHARDS = 12;
// After this long without live results (a slow phone), show the pool shortlist while the full search finishes.
const SLOW_SEARCH_MS = 4000;
// Pool files are split by HEALPix parent cell at this nside.
const POOL_PARENT_NSIDE = 8;

/**
 * @param {{ body: "earth"|"moon"|"mars", lat: number, lon: number } | null} selection  the clicked spot
 * @param {"earth"|"moon"|"mars"} targetBody  the body whose tiles are ranked against it
 * @param {Record<string, number> | undefined} weights
 * @param {"absolute" | "relative"} mode  how the factors are scored; pools and showcase.json serve only "absolute"
 * @param {number} [attempt]  bump to retry after a failure: reloads the files and starts a fresh search worker
 */
export function useTileSearch(selection, targetBody, weights, mode, attempt = 0) {
  const base = useLoaded(loadSearchBase, [attempt]);
  const candidates = useLoaded(() => (selection ? loadCandidates(targetBody) : null), [targetBody, Boolean(selection), attempt]);
  // useLoaded keeps the previous body's tiles on screen while the next body loads. Using them would send one body's
  // tiles to the worker under another body's name, so only tiles of the body being compared count.
  const targetCandidates = candidates.data?.body === targetBody ? candidates.data : null;
  const { isWorkerReady, workerError, latestPicks, requestRanking } = useSearchWorker(base.data);

  const tile = useMemo(() => {
    if (!selection || !base.data) return null;
    const nside = base.data.schema.nside[selection.body];
    const index = latLonToTile(nside, selection.lat, selection.lon);
    return { id: `${selection.body}_${nside}_${index}`, index, nside, body: selection.body };
  }, [selection, base.data]);

  // An Earth pin on unscored land: search from the nearest scored tile within EARTH_SNAP_KM (earthSnap.js). The pin and
  // its outline stay where the person put them; `tile` is the pin, `searchTile` is the tile the search really uses.
  const earthPick = useMemo(() => {
    if (!tile || tile.body !== "earth" || !base.data) return null;
    const { vectors, tiles, rowByIndex, lats, lons } = base.data.earth;
    const isOwnScored = Boolean(clickedTileVector("earth", tile.nside, tile.index, vectors, base.data.layout.bytesPerTile, rowByIndex));
    const decision = decideEarthSnap(isOwnScored ? rowByIndex.get(tile.index) : -1, selection.lat, selection.lon, lats, lons);
    const nearest = decision.row === null ? decision.nearest : null;
    const row = decision.row;
    const snapped = row !== null && !isOwnScored;
    const snapTile = snapped ? tiles[row] : null;
    return {
      searchTile: row === null ? null : snapped ? { id: `earth_${tile.nside}_${snapTile.index}`, index: snapTile.index, nside: tile.nside, body: "earth" } : tile,
      snapKm: snapped ? decision.km : null,
      // The same-planet exclusion circle is centred on the snapped tile (what is scored); an unsnapped pin keeps its own point.
      // The Explore link keeps the pin: Explore snaps it again by the same rule, to the same tile.
      searchPoint: snapped ? { lat: snapTile.lat, lon: snapTile.lon } : null,
      nearestScored: nearest ? { km: nearest.km, lat: tiles[nearest.row].lat, lon: tiles[nearest.row].lon } : null,
    };
  }, [tile, base.data, selection]);
  const searchTile = tile?.body === "earth" ? earthPick?.searchTile ?? null : tile;
  const searchPoint = earthPick?.searchPoint ?? selection;

  // Same planet: leave out the area around the searched spot (the tile is part of the search key, so this is too).
  const exclude = useMemo(
    () => (searchPoint && selection.body === targetBody ? { lat: searchPoint.lat, lon: searchPoint.lon, km: SAME_BODY_MIN_KM } : null),
    [searchPoint, selection, targetBody],
  );

  const shard = tile?.body === "mars" ? baseCellOf(tile.nside, tile.index) : null;
  const sourceKey = tile && tile.body !== "earth" ? `${tile.body}/${shard}` : null;
  const sourceVectors = useLoaded(
    () => (sourceKey ? loadBodyVectors(tile.body, shard).then((bytes) => ({ key: sourceKey, bytes })) : null),
    [sourceKey, attempt],
  );
  // As above: while another body or Mars shard loads, the previous one's bytes must not be read as this tile's.
  const sourceBytes = sourceVectors.data?.key === sourceKey ? sourceVectors.data.bytes : null;
  const clickedVector = useMemo(() => {
    if (!searchTile || !base.data) return null;
    const bytes = searchTile.body === "earth" ? base.data.earth.vectors : sourceBytes;
    if (!bytes) return null;
    return clickedTileVector(searchTile.body, searchTile.nside, searchTile.index, bytes, base.data.layout.bytesPerTile, base.data.earth.rowByIndex);
  }, [searchTile, base.data, sourceBytes]);

  useEffect(() => {
    if (isWorkerReady && clickedVector && targetCandidates && weights) requestRanking(searchTile.id, targetBody, targetCandidates, clickedVector, weights, mode, exclude);
  }, [isWorkerReady, clickedVector, targetCandidates, weights, mode, exclude, searchTile?.id, targetBody, requestRanking]);

  const searchKey = searchTile ? searchKeyOf(searchTile.id, targetBody, mode) : null;
  const liveMatches = useMemo(() => {
    if (!latestPicks || latestPicks.searchKey !== searchKey || !targetCandidates || !base.data) return null;
    return buildMatches(latestPicks.picks, {
      tiles: targetCandidates.tiles, body: targetBody, nside: base.data.schema.nside[targetBody], weights: latestPicks.weights,
      mode, clicked: clickedVector, vectors: targetCandidates.vectors, layout: base.data.layout,
    });
  }, [latestPicks, searchKey, targetCandidates, base.data, targetBody, mode, clickedVector]);

  const searchError = base.error ?? candidates.error ?? sourceVectors.error ?? workerError;
  const isSlow = useIsSlow(searchKey, Boolean(liveMatches));

  // Fallback 1 (plan v2.1): the tile's pool shortlist, when the live search failed or is slow (a phone).
  const canUsePool = Boolean(mode === "absolute" && tile && tile.body !== "earth" && targetBody === "earth" && base.data);
  const poolParent = canUsePool ? Math.floor(tile.index / (tile.nside / POOL_PARENT_NSIDE) ** 2) : null;
  const pool = useLoaded(
    () => (canUsePool && !liveMatches && (searchError || isSlow) ? loadPool(tile.body, poolParent) : null),
    [canUsePool, tile?.body, poolParent, Boolean(searchError || isSlow), Boolean(liveMatches)],
  );
  const poolMatches = useMemo(() => {
    if (liveMatches || !pool.data || !tile || !weights) return null;
    return buildPoolMatches(pool.data, tile.index, {
      earthTiles: base.data.earth.tiles, rowByIndex: base.data.earth.rowByIndex, weights, earthNside: base.data.schema.nside.earth,
    });
  }, [liveMatches, pool.data, tile, weights, base.data]);

  // Fallback 2: Role 2's precomputed showcase.json, for the demo's showcase clicks.
  const showcaseMatches = mode === "absolute" && searchError && !poolMatches && searchTile && targetBody === "earth" ? base.data?.showcase?.results?.[searchTile.id]?.matches : null;
  const isSourceLoaded = tile?.body === "earth" ? Boolean(base.data) : Boolean(sourceBytes);
  const hasNoData = Boolean(tile && isSourceLoaded && !clickedVector);
  const fallbackMatches = poolMatches ?? (showcaseMatches && weights ? rescoreMatches(showcaseMatches, weights) : null);
  return {
    tile,
    searchPoint,
    snapKm: earthPick?.snapKm ?? null,                 // km from the pin to the scored tile used, when the pin was moved
    nearestScored: earthPick?.nearestScored ?? null,   // { km, lat, lon } of the nearest scored tile, when the pin is too far from one
    clickedVector,
    layout: base.data?.layout ?? null,
    data: liveMatches ?? fallbackMatches,
    isApproximate: !liveMatches && Boolean(fallbackMatches),
    error: fallbackMatches ? null : searchError,
    hasNoData,
    isLoading: Boolean(selection) && !liveMatches && !fallbackMatches && !searchError && !hasNoData,
  };
}

/** True once a search has run longer than SLOW_SEARCH_MS without results; resets for every new search. */
function useIsSlow(searchKey, hasResults) {
  const [slowKey, setSlowKey] = useState(null);
  useEffect(() => {
    if (!searchKey || hasResults) return undefined;
    const timer = setTimeout(() => setSlowKey(searchKey), SLOW_SEARCH_MS);
    return () => clearTimeout(timer);
  }, [searchKey, hasResults]);
  return slowKey === searchKey && !hasResults;
}

// Schema, Earth tiles (always needed: Earth is a source or a target in most comparisons) and the optional files.
async function loadSearchBase() {
  const [schema, earthFiles, showcase] = await Promise.all([loadVectorSchema(), loadEarthTiles(), loadShowcase()]);
  const earthTiles = readEarthTiles(earthFiles, schema.nside.earth);
  return {
    schema,
    layout: readLayout(schema),
    earth: { vectors: earthFiles.vectors, tiles: earthTiles, ...tileCentres(earthTiles), rowByIndex: new Map(earthTiles.map((earthTile, row) => [earthTile.index, row])) },
    showcase,
  };
}

// The tiles a search ranks: Earth's scored land, every Moon tile, or every Mars tile (all 12 shards joined).
const candidateCache = new Map();
function loadCandidates(body) {
  if (!candidateCache.has(body)) {
    const request = (async () => {
      const schema = await loadVectorSchema();
      if (body === "earth") {
        const earthFiles = await loadEarthTiles();
        const tiles = readEarthTiles(earthFiles, schema.nside.earth);
        return { body, vectors: earthFiles.vectors, tiles, ...tileCentres(tiles) };
      }
      const parts = await Promise.all(body === "mars" ? Array.from({ length: MARS_SHARDS }, (_, shard) => loadBodyVectors("mars", shard)) : [loadBodyVectors("moon")]);
      const vectors = new Uint8Array(parts.reduce((length, part) => length + part.length, 0));
      parts.reduce((offset, part) => { vectors.set(part, offset); return offset + part.length; }, 0);
      const tiles = readBodyTiles(schema.nside[body], await loadBodyMeta(body));
      return { body, vectors, tiles, ...tileCentres(tiles) };
    })();
    request.catch(() => candidateCache.delete(body));
    candidateCache.set(body, request);
  }
  return candidateCache.get(body);
}
