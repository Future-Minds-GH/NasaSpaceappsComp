// The search, run in a Web Worker so the globe never freezes. It keeps each body's candidate tiles once sent, and for
// the current search the factor scores and their logs: a click scores every candidate once (plan v2.1 step 1), and
// each slider move only recombines the stored logs and re-ranks (step 2, under 20 ms for 120k tiles).
// Messages in:  { type: "init", schema }
//               { type: "candidates", body, vectors, lats, lons }      (a body's tiles, sent once)
//               { type: "score", requestId, clickedVector, body, weights } (a new tile, or a new body to compare with)
//               { type: "rank", requestId, weights }                   (new weights, same tile and body)
// Messages out: { type: "ready" } | { type: "ranked", requestId, picks: [{ row, total, earthRankPct, factorScores }] }
//               | { type: "failed", requestId, message }
import { FACTORS } from "./scoring.js";
import { combineLogs, readLayout, scoreAllEarthTiles, toLogScores } from "./similarity.js";
import { BODY_RADIUS_KM, rankTopRows } from "./ranking.js";

let layout = null;
const candidatesByBody = {};
let current = null; // { body, scores, logs }

self.onmessage = ({ data }) => {
  try {
    if (data.type === "init") {
      layout = readLayout(data.schema);
      self.postMessage({ type: "ready" });
      return;
    }
    if (data.type === "candidates") {
      candidatesByBody[data.body] = { vectors: data.vectors, lats: data.lats, lons: data.lons };
      return;
    }
    if (data.type === "score") {
      const candidates = candidatesByBody[data.body];
      if (!candidates) throw new Error(`No ${data.body} tiles have been loaded.`);
      const scores = scoreAllEarthTiles(data.clickedVector, candidates.vectors, layout);
      current = { body: data.body, scores, logs: toLogScores(scores) };
    }
    if (!current) throw new Error("No tile has been scored yet.");
    const { lats, lons } = candidatesByBody[current.body];
    const picks = rankTopRows(combineLogs(current.logs, data.weights), lats, lons, { radiusKm: BODY_RADIUS_KM[current.body] }).map((pick) => ({
      ...pick,
      factorScores: Array.from(current.scores.subarray(pick.row * FACTORS.length, (pick.row + 1) * FACTORS.length)),
    }));
    self.postMessage({ type: "ranked", requestId: data.requestId, picks });
  } catch (error) {
    self.postMessage({ type: "failed", requestId: data.requestId, message: error.message });
  }
};
