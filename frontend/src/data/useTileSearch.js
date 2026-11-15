// The live tile search as a React hook, for any pair of bodies. A click picks a HEALPix tile on the shown body; the
// hook loads that tile's vector and the other body's tiles, and asks the search worker to score them. Slider moves only
// ask for a re-rank. If the search fails or is slow, it falls back to the tile's pool shortlist (pools/), then to
// Role 2's precomputed showcase.json; those results are flagged approximate.
import { useEffect, useMemo, useState } from "react";
import { loadBodyMeta, loadBodyVectors, loadEarthTiles, loadPool, loadShowcase, loadVectorSchema, loadWhyRules } from "./api.js";
import { baseCellOf, latLonToTile } from "./healpix.js";
import { readLayout } from "./similarity.js";
import { rescoreMatches } from "./scoring.js";
import { buildMatches, buildPoolMatches, clickedTileVector, readBodyTiles, readEarthTiles } from "./tileSearch.js";
import { useSearchWorker } from "./useSearchWorker.js";
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
 */
export function useTileSearch(selection, targetBody, weights) {
  const base = useLoaded(loadSearchBase, []);
  const candidates = useLoaded(() => (selection ? loadCandidates(targetBody) : null), [targetBody, Boolean(selection)]);
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

  const shard = tile?.body === "mars" ? baseCellOf(tile.nside, tile.index) : null;
  const sourceKey = tile && tile.body !== "earth" ? `${tile.body}/${shard}` : null;
  const sourceVectors = useLoaded(
    () => (sourceKey ? loadBodyVectors(tile.body, shard).then((bytes) => ({ key: sourceKey, bytes })) : null),
    [sourceKey],
  );
  // As above: while another body or Mars shard loads, the previous one's bytes must not be read as this tile's.
  const sourceBytes = sourceVectors.data?.key === sourceKey ? sourceVectors.data.bytes : null;
  const clickedVector = useMemo(() => {
    if (!tile || !base.data) return null;
    const bytes = tile.body === "earth" ? base.data.earth.vectors : sourceBytes;
    if (!bytes) return null;
    return clickedTileVector(tile.body, tile.nside, tile.index, bytes, base.data.layout.bytesPerTile, base.data.earth.rowByIndex);
  }, [tile, base.data, sourceBytes]);

  useEffect(() => {
    if (isWorkerReady && clickedVector && targetCandidates && weights) requestRanking(tile.id, targetBody, targetCandidates, clickedVector, weights);
  }, [isWorkerReady, clickedVector, targetCandidates, weights, tile?.id, targetBody, requestRanking]);

  const searchKey = tile ? `${tile.id}>${targetBody}` : null;
  const liveMatches = useMemo(() => {
    if (!latestPicks || latestPicks.searchKey !== searchKey || !targetCandidates || !base.data) return null;
    return buildMatches(latestPicks.picks, {
      tiles: targetCandidates.tiles, body: targetBody, nside: base.data.schema.nside[targetBody], weights: latestPicks.weights, whyRules: base.data.whyRules,
    });
  }, [latestPicks, searchKey, targetCandidates, base.data, targetBody]);

  const searchError = base.error ?? candidates.error ?? sourceVectors.error ?? workerError;
  const isSlow = useIsSlow(searchKey, Boolean(liveMatches));

  // Fallback 1 (plan v2.1): the tile's pool shortlist, when the live search failed or is slow (a phone).
  const canUsePool = Boolean(tile && tile.body !== "earth" && targetBody === "earth" && base.data);
  const poolParent = canUsePool ? Math.floor(tile.index / (tile.nside / POOL_PARENT_NSIDE) ** 2) : null;
  const pool = useLoaded(
    () => (canUsePool && !liveMatches && (searchError || isSlow) ? loadPool(tile.body, poolParent) : null),
    [canUsePool, tile?.body, poolParent, Boolean(searchError || isSlow), Boolean(liveMatches)],
  );
  const poolMatches = useMemo(() => {
    if (liveMatches || !pool.data || !tile || !weights) return null;
    return buildPoolMatches(pool.data, tile.index, {
      earthTiles: base.data.earth.tiles, rowByIndex: base.data.earth.rowByIndex, weights, earthNside: base.data.schema.nside.earth, whyRules: base.data.whyRules,
    });
  }, [liveMatches, pool.data, tile, weights, base.data]);

  // Fallback 2: Role 2's precomputed showcase.json, for the demo's showcase clicks.
  const showcaseMatches = searchError && !poolMatches && tile && targetBody === "earth" ? base.data?.showcase?.results?.[tile.id]?.matches : null;
  const isSourceLoaded = tile?.body === "earth" ? Boolean(base.data) : Boolean(sourceBytes);
  const hasNoData = Boolean(tile && isSourceLoaded && !clickedVector);
  const fallbackMatches = poolMatches ?? (showcaseMatches && weights ? rescoreMatches(showcaseMatches, weights) : null);
  return {
    tile,
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
  const [schema, earthFiles, whyRules, showcase] = await Promise.all([loadVectorSchema(), loadEarthTiles(), loadWhyRules(), loadShowcase()]);
  const earthTiles = readEarthTiles(earthFiles, schema.nside.earth);
  return {
    schema,
    layout: readLayout(schema),
    earth: { vectors: earthFiles.vectors, tiles: earthTiles, rowByIndex: new Map(earthTiles.map((earthTile, row) => [earthTile.index, row])) },
    whyRules,
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
        return { body, vectors: earthFiles.vectors, tiles: readEarthTiles(earthFiles, schema.nside.earth) };
      }
      const parts = await Promise.all(body === "mars" ? Array.from({ length: MARS_SHARDS }, (_, shard) => loadBodyVectors("mars", shard)) : [loadBodyVectors("moon")]);
      const vectors = new Uint8Array(parts.reduce((length, part) => length + part.length, 0));
      parts.reduce((offset, part) => { vectors.set(part, offset); return offset + part.length; }, 0);
      return { body, vectors, tiles: readBodyTiles(schema.nside[body], await loadBodyMeta(body)) };
    })();
    request.catch(() => candidateCache.delete(body));
    candidateCache.set(body, request);
  }
  return candidateCache.get(body);
}
