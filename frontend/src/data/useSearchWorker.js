// Talks to the search worker for useTileSearch: starts it, sends the schema once and each body's tiles once, then a
// "score" message for each new search and a "rank" message for each new set of weights. Only the newest answer counts.
import { useEffect, useMemo, useRef, useState } from "react";
import { startSearchWorker } from "./startSearchWorker.js";

/** Owns the worker: sends the schema once, each body's tiles once, then "score" per new search or mode and "rank" per new weights. */
export function useSearchWorker(baseData) {
  const [worker, setWorker] = useState(null);
  const [isWorkerReady, setIsWorkerReady] = useState(false);
  const [workerError, setWorkerError] = useState(null);
  const [latestPicks, setLatestPicks] = useState(null);
  const requestRef = useRef({ id: 0, scoredKey: null, sentBodies: new Set(), pending: new Map() });

  useEffect(() => {
    if (!baseData) return undefined;
    // A fresh worker starts with a clean slate: an error from an earlier worker must not stick to every later search.
    setWorkerError(null);
    setIsWorkerReady(false);
    setLatestPicks(null);
    let searchWorker;
    try {
      searchWorker = startSearchWorker();
    } catch (error) {
      setWorkerError(error);
      return undefined;
    }
    requestRef.current.sentBodies = new Set();
    requestRef.current.scoredKey = null;
    searchWorker.onmessage = ({ data }) => {
      if (data.type === "ready") { setIsWorkerReady(true); return; }
      const request = requestRef.current.pending.get(data.requestId);
      requestRef.current.pending.delete(data.requestId);
      // Only the newest request counts: an older answer arriving late must not replace it.
      if (!request || data.requestId !== requestRef.current.id) return;
      if (data.type === "failed") setWorkerError(new Error(data.message));
      else setLatestPicks({ searchKey: request.searchKey, weights: request.weights, picks: data.picks });
    };
    searchWorker.onerror = (event) => setWorkerError(new Error(event.message || "The search could not start."));
    searchWorker.postMessage({ type: "init", schema: baseData.schema });
    setWorker(searchWorker);
    return () => searchWorker.terminate();
  }, [baseData]);

  const requestRanking = useMemo(() => (tileId, body, candidates, clickedVector, weights, mode, exclude = null) => {
    const state = requestRef.current;
    if (!state.sentBodies.has(body)) {
      worker.postMessage({
        type: "candidates", body, vectors: candidates.vectors,
        lats: Float32Array.from(candidates.tiles, (candidate) => candidate.lat),
        lons: Float32Array.from(candidates.tiles, (candidate) => candidate.lon),
      });
      state.sentBodies.add(body);
    }
    state.id += 1;
    // The mode changes the factor scores themselves, so a change re-scores rather than re-ranks.
    const searchKey = searchKeyOf(tileId, body, mode);
    const isNewSearch = state.scoredKey !== searchKey;
    state.scoredKey = searchKey;
    state.pending.set(state.id, { searchKey, weights });
    worker.postMessage(isNewSearch
      ? { type: "score", requestId: state.id, clickedVector: Uint8Array.from(clickedVector), body, weights, mode, exclude }
      : { type: "rank", requestId: state.id, weights, exclude });
  }, [worker]);

  return { isWorkerReady, workerError, latestPicks, requestRanking };
}

/** One key per (tile, body, mode): what the worker has scored. */
export function searchKeyOf(tileId, body, mode) {
  return `${tileId}>${body}|${mode}`;
}
