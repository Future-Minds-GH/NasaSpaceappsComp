// Explore's selection helpers: reading a picked point from the URL, and describing the picked tile like a named site
// so the results header and the compare view show both the same way.
import { formatCoordinates } from "./format.js";
import { earthImageUrl } from "../content/earthImagery.js";
import { BODY_NAMES } from "../content/labels.js";

/** "-5.40,137.80" from the URL, or null. */
export function parsePoint(value) {
  const [lat, lon] = String(value ?? "").split(",").map(Number);
  if (!value || !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon };
}

/** The ?preset= id when it names a real preset (own key: "toString" must not match), else the default, else the first. */
export function pickPresetId(presets, requested, defaultId) {
  return requested && Object.hasOwn(presets, requested) ? requested : defaultId ?? Object.keys(presets)[0];
}

/** The picked tile described like a named site, so the results header and compare view show it the same way. */
export function describeSelection({ body, targetBody, namedSite, selection, tile, meta, sites }) {
  const tileLine = `Tile ${tile.id}, ${formatCoordinates(selection.lat, selection.lon)}.`;
  // "What Earth can't reproduce" belongs to whichever side is the Moon or Mars.
  const gapBody = body !== "earth" ? body : targetBody;
  const realityGap = (sites ?? []).find((site) => site.body === gapBody && site.reality_gap?.length)?.reality_gap ?? meta?.reality_gap ?? [];
  const base = {
    target_id: tile.id, body, lat: selection.lat, lon: selection.lon, reality_gap: realityGap,
    image_url: body === "earth" ? earthImageUrl(selection.lat, selection.lon) : null,
  };
  if (namedSite) return { ...namedSite, ...base, summary: `${namedSite.summary ?? ""} ${tileLine}`.trim() };
  return { ...base, track: "picked", name: meta?.named?.[tile.index] ?? `your tile on ${BODY_NAMES[body]}`, summary: tileLine };
}
