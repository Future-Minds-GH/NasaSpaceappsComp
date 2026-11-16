// Turns the search's raw numbers into result cards for any body: reads each body's tile list, picks the clicked
// tile's vector, and builds each card (rank, novelty and tags on Earth, plain reasons, false-friend check).
import { FACTORS, combineScore, heaviestFactor, isFalseFriend, scoreBand } from "./scoring.js";
import { rankTopRows } from "./ranking.js";
import { baseCellOf, tileCenter, tileCount } from "./healpix.js";
import { NULL_CODE } from "./similarity.js";
import { describeFactorValue, halfTempNote } from "./fieldValues.js";
import { earthImageUrl } from "../content/earthImagery.js";
import { FACTOR_REASONS } from "../content/labels.js";

const META_RECORD_BYTES = 12;
const NO_NAME = 65535;
const REASON_COUNT = 3;
// A factor counts as a reason from this score up.
const DEFAULT_REASON_MIN = 0.6;

// Parsed tiles per earth_meta.bin bytes: api.js caches the bytes, so every search hook and Characterize share one parse.
const earthTilesByMeta = new WeakMap();

/** One entry per Earth tile, in the same order as vectors/earth.bin. Shared and cached: callers must not mutate it. */
export function readEarthTiles({ meta, lists }, nside) {
  const cached = earthTilesByMeta.get(meta);
  if (cached?.nside === nside && cached.lists === lists) return cached.tiles;
  const view = new DataView(meta.buffer, meta.byteOffset, meta.byteLength);
  const tileTotal = meta.byteLength / META_RECORD_BYTES;
  const tiles = new Array(tileTotal);
  for (let row = 0; row < tileTotal; row++) {
    const base = row * META_RECORD_BYTES;
    const index = view.getUint32(base, true);
    const tagBits = view.getUint16(base + 6, true);
    const nameIndex = view.getUint16(base + 8, true);
    const { lat, lon } = tileCenter(nside, index);
    tiles[row] = {
      index,
      lat,
      lon,
      noveltyKm: view.getUint16(base + 4, true),
      tags: lists.tags.filter((tag, bit) => tagBits & (1 << bit)),
      name: nameIndex === NO_NAME ? null : lists.names[nameIndex] ?? null,
      envType: lists.environments[view.getUint8(base + 10)] ?? null,
      // Bit 0 of the flags byte: this tile's mineralogy is estimated, not measured.
      minEstimated: Boolean(view.getUint8(base + 11) & 1),
    };
  }
  earthTilesByMeta.set(meta, { nside, lists, tiles });
  return tiles;
}

/** Every Moon or Mars tile in nested order (their vector files hold all of them), named where meta names one. */
export function readBodyTiles(nside, meta) {
  const estimated = new Set(meta?.min_estimated ?? []);
  return Array.from({ length: tileCount(nside) }, (_, index) => {
    const { lat, lon } = tileCenter(nside, index);   // no object spread: it was most of the time for 196k Mars tiles
    return { index, lat, lon, name: meta?.named?.[index] ?? null, tags: [], noveltyKm: null, envType: null, minEstimated: estimated.has(index) };
  });
}

/** Tile centres as two typed arrays in row order (what the ranking reads). A plain loop: TypedArray.from with a map function is ~10x slower. */
export function tileCentres(tiles, ArrayType = Float32Array) {
  const lats = new ArrayType(tiles.length);
  const lons = new ArrayType(tiles.length);
  for (let row = 0; row < tiles.length; row++) { lats[row] = tiles[row].lat; lons[row] = tiles[row].lon; }
  return { lats, lons };
}

/**
 * The clicked tile's bytes, or null when it has no data. Moon vectors hold every tile, a Mars shard one base cell,
 * and Earth holds only scored land tiles (found by tile index through earthRowByIndex).
 */
export function clickedTileVector(body, nside, tileIndex, vectorBytes, bytesPerTile, earthRowByIndex = null) {
  let localIndex = tileIndex;
  if (body === "mars") localIndex = tileIndex - baseCellOf(nside, tileIndex) * nside * nside;
  if (body === "earth") localIndex = earthRowByIndex?.get(tileIndex) ?? -1;
  if (localIndex < 0) return null;
  const vector = vectorBytes.subarray(localIndex * bytesPerTile, (localIndex + 1) * bytesPerTile);
  return vector.length && !vector.every((byte) => byte === NULL_CODE) ? vector : null;
}

/**
 * Result cards from the worker's picks ({ row, total, earthRankPct, factorScores }), best first. With `clicked`,
 * `vectors` and `layout`, each card also carries `values`: the real values of the two tiles side by side per factor.
 */
export function buildMatches(picks, { tiles, body = "earth", nside, weights, mode = null, clicked = null, vectors = null, layout = null }) {
  return picks.map((pick, position) => {
    const tile = tiles[pick.row];
    const breakdown = Object.fromEntries(FACTORS.map((factor, index) => {
      const value = pick.factorScores[index];
      return [factor, value === null || Number.isNaN(value) ? null : Math.round(value * 100) / 100];
    }));
    return {
      rank: position + 1,
      body,
      tile_id: `${body}_${nside}_${tile.index}`,
      name: tile.name,
      lat: tile.lat,
      lon: tile.lon,
      env_type: tile.envType,
      tags: tile.tags,
      // Earth tiles get a satellite photo; Moon and Mars cards crop the globe texture instead.
      image_url: body === "earth" ? earthImageUrl(tile.lat, tile.lon) : null,
      score: pick.total,
      band: scoreBand(pick.total),
      mode,
      earth_rank_pct: pick.earthRankPct,
      breakdown,
      km_to_nearest_known_analog: tile.noveltyKm,
      mineralogy_estimated: tile.minEstimated,
      typical_factors: pick.typicalFactors ?? [],   // no data on this tile: the factor uses a typical score
      false_friend: isFalseFriend(breakdown, weights),
      false_friend_factor: heaviestFactor(breakdown, weights),
      why: plainReasons(breakdown, pick.typicalFactors ?? []),
      temp_note: clicked && vectors && layout ? halfTempNote(layout, clicked, vectors.subarray(pick.row * layout.bytesPerTile, (pick.row + 1) * layout.bytesPerTile)) : null,
      values: clicked && vectors && layout ? realValues(layout, clicked, vectors.subarray(pick.row * layout.bytesPerTile, (pick.row + 1) * layout.bytesPerTile)) : null,
    };
  });
}

/**
 * Approximate result cards from a pool shortlist (pools/ file) for one Moon/Mars tile: its 30 Earth candidates are
 * re-scored with the current weights and the top 10 kept. Earth rank is left out: the pool is not the whole planet.
 */
export function buildPoolMatches(pool, tileIndex, { earthTiles, rowByIndex, weights, earthNside }) {
  // Pools are scored in absolute mode (the default); the caller never asks for them in another mode.
  const entries = (pool?.tiles?.[tileIndex] ?? []).filter(([earthIndex]) => rowByIndex.has(earthIndex));
  if (entries.length === 0) return null;
  const breakdownOf = (scores) => Object.fromEntries(FACTORS.map((factor, index) => [factor, scores[index] ?? null]));
  const totals = Float32Array.from(entries, ([, ...scores]) => combineScore(breakdownOf(scores), weights));
  const rows = entries.map(([earthIndex]) => rowByIndex.get(earthIndex));
  const lats = Float32Array.from(rows, (row) => earthTiles[row].lat);
  const lons = Float32Array.from(rows, (row) => earthTiles[row].lon);
  const picks = rankTopRows(totals, lats, lons).map((pick) => ({
    row: rows[pick.row],
    total: pick.total,
    earthRankPct: null,
    factorScores: entries[pick.row].slice(1, 1 + FACTORS.length).map((value) => value ?? NaN),
    // Optional last item of a pool row: bit flags of the factors that hold a typical score (no data on that tile).
    typicalFactors: FACTORS.filter((_, factor) => ((entries[pick.row][1 + FACTORS.length] ?? 0) >> factor) & 1),
  }));
  return buildMatches(picks, { tiles: earthTiles, body: "earth", nside: earthNside, weights, mode: "absolute" });
}

/** Per factor, the clicked tile's and the match's real values as one phrase ("Night 170 K vs 215 K"), or null. */
function realValues(layout, clicked, matchVector) {
  return Object.fromEntries(FACTORS.map((factor) => [factor, describeFactorValue(layout, factor, clicked, matchVector)]));
}

/** Two or three plain reasons, strongest factor first. */
function plainReasons(breakdown, typicalFactors = []) {
  return FACTORS
    // A factor with only a typical score (no data on the match) is never a reason.
    .filter((factor) => !typicalFactors.includes(factor))
    .filter((factor) => typeof breakdown[factor] === "number" && breakdown[factor] >= DEFAULT_REASON_MIN)
    .sort((first, second) => breakdown[second] - breakdown[first])
    .slice(0, REASON_COUNT)
    .map((factor) => FACTOR_REASONS[factor]);
}
