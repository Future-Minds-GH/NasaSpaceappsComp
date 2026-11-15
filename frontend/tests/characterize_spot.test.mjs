// characterizeSpot.js (the page's live scoring) must give the same numbers as the precomputed characterize/sites.json
// (written by scripts/make-characterize.mjs) for the same Earth tile. Read only. api.js needs Vite's import.meta.env and
// fetch, so a loader hook stubs BASE_URL and fetch reads public/data from disk. No network, no Python.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = (path) => fileURLToPath(new URL(path, import.meta.url));
const DATA = here("../public/data/");

register("data:text/javascript," + encodeURIComponent(`
export async function load(url, context, next) {
  const result = await next(url, context);
  if (url.endsWith("/src/data/api.js")) {
    result.source = String(result.source).replace("import.meta.env.BASE_URL", JSON.stringify("/"));
  }
  return result;
}`), import.meta.url);

globalThis.fetch = async (path) => {
  try {
    const bytes = readFileSync(DATA + String(path).replace(/^\/data\//, ""));
    return new Response(bytes, { status: 200, headers: { "content-type": String(path).endsWith(".json") ? "application/json" : "application/octet-stream" } });
  } catch { return new Response("", { status: 404 }); }
};

const { scoreSpot } = await import("../src/data/characterizeSpot.js");
const sitesFile = JSON.parse(readFileSync(DATA + "characterize/sites.json", "utf8"));

test("scoreSpot gives the same targets, scores, breakdowns and factors as sites.json for a famous site's tile", async () => {
  let compared = 0;
  for (const entry of sitesFile.sites) {
    const live = await scoreSpot(entry.site.lat, entry.site.lon);
    if (!live) continue;                       // the script used the nearest tile for this site: no direct tile at its coordinates
    compared++;
    assert.deepEqual(live.site.factors, entry.site.factors, `${entry.site_id} factors`);
    assert.equal(live.site.nearest_km, entry.site.nearest_km, `${entry.site_id} nearest_km`);
    assert.deepEqual(live.targets, entry.targets, `${entry.site_id} targets`);
  }
  assert.ok(compared >= 5, `only ${compared} sites compared`);
});

test("a site with no tile at its coordinates uses the nearest scored tile within max(radius, 100 km), like the script", async () => {
  const known = JSON.parse(readFileSync(here("../../known_analogs.json"), "utf8"));
  let fallbacks = 0;
  for (const entry of sitesFile.sites) {
    if (await scoreSpot(entry.site.lat, entry.site.lon)) continue;    // a direct tile exists
    const radius = known.sites.find((site) => site.id === entry.site_id).radius_km;
    const live = await scoreSpot(entry.site.lat, entry.site.lon, radius);
    assert.ok(live, `${entry.site_id} has a tile within max(${radius}, 100) km`);
    assert.ok(live.site.nearest_km > 0 && live.site.nearest_km <= Math.max(radius, 100), `${entry.site_id} nearest_km`);
    assert.deepEqual(live.site.factors, entry.site.factors, `${entry.site_id} factors`);
    assert.deepEqual(live.targets, entry.targets, `${entry.site_id} targets`);
    fallbacks++;
  }
  console.log(`fallback sites compared: ${fallbacks}`);
});

test("a spot next to scored land (no tile of its own) is scored from the nearest tile and says how far it is", async () => {
  // Walk out from each famous site until a spot has no tile of its own but has land within 100 km.
  let found = null;
  for (const entry of sitesFile.sites) {
    for (let step = 1; step <= 40 && !found; step++) {
      for (const [dLat, dLon] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const lat = entry.site.lat + dLat * step * 0.25;
        const lon = entry.site.lon + dLon * step * 0.25;
        if (Math.abs(lat) > 89) continue;
        const live = await scoreSpot(lat, lon);
        if (live?.site.nearest_km > 0) { found = { lat, lon, live }; break; }
      }
    }
    if (found) break;
  }
  assert.ok(found, "no spot with a nearest-tile fallback was found near any famous site");
  assert.ok(found.live.site.nearest_km <= 100, `nearest_km ${found.live.site.nearest_km}`);
  assert.ok(found.live.targets.length > 0);
  assert.ok(found.live.targets.every((match) => Array.isArray(match.typical_factors)));
  console.log(`fallback example: ${found.lat},${found.lon} scored from a tile ${found.live.site.nearest_km} km away`);
});

test("scoreSpot returns null for a spot in the ocean", async () => {
  assert.equal(await scoreSpot(0, -140), null);
});
