# Project summary

Common Ground. NASA Space Apps Challenge 2026: *Identify Earth Locations that Analog the Permanent Moon Base Locations and Mars*. Status as of 15 Nov 2026.

## What it is

A website. You pick a place on Earth, the Moon or Mars, and it finds the most similar places on any of the three bodies. Each result gets a % score with one bar per factor, and a list of what Earth cannot reproduce: gravity, vacuum or thin air, radiation.

## How it works

1. **One grid per body.** Colab notebooks download open data. Earth uses a 0.25° grid; the Moon and Mars use 0.5°. Every cell gets the same columns: day and night temperature, day–night swing, sunlight, slope, roughness, elevation, surface type, six mineral classes and ice likelihood (`contract.md`).
2. **Equal-area tiles.** `build_vectors.py` (Earth) and `build_body_vectors.py` (Moon, Mars) convert the tables into HEALPix tiles, about 27 km across on all three bodies. Each tile is a 25-byte vector (`data/schema.json` v0.3): real values for Absolute mode, plus ranks within its own body for Relative mode.
3. **Search in the browser.** The front end scores every tile of the target body against the clicked tile, in a Web Worker, with preset weights and sliders. There is no server; the site is static on GitHub Pages.
4. **Validation.** `frontend/scripts/make-validation.mjs` uses the site's own scoring: do known Earth analogs rank in Earth's top 10%, are the top matches new places, and do wrong places (cities, rainforest) score red?

## Data sources

- **Earth:** MODIS land surface temperature, NASA POWER sunlight, Copernicus DEM (ESA), MODIS albedo and snow, ESA Permafrost CCI, EMIT minerals, GLiM lithology. See `earth_sources.md`.
- **Moon:** LRO Diviner temperature, LOLA terrain, LROC albedo and pits, Lunar Prospector, LEND hydrogen.
- **Mars:** Mars Climate Database, MOLA terrain, TES albedo, dust and minerals, SWIM ice, cave catalog.

The Moon and Mars sources are listed in `moon_mars_sources.md`.

## What is done (merged PRs)

| PRs | What |
| --- | --- |
| #1–#4 | Earth data notebooks: temperature, terrain, sunlight, `analog_ok` filter, albedo, ATI, ice, minerals, merge |
| #5–#7 | Matcher contract, Python and JS matcher with parity tests, fake tables, validation harness |
| #8 | Front end: Explore, Discover, Findings, Characterize and About pages, globes, maps, sliders |
| #9 | `build_vectors.py`, from the Earth table to the site's vector files |
| #10–#16 | Moon and Mars data notebooks, merge notebooks, sources doc, `targets.json` |
| #18 | GitHub Pages deploy, README, demo script, `.gitignore` fix |

## Since then (PRs #19–#29)

- Real data for all three bodies is on the site. Earth temperatures come from MODIS Aqua (about 1:30 pm and 1:30 am).
- Matcher v0.3 (`data/schema.json`): 25-byte tiles, nine factors, Absolute mode (real values with tolerances, the default) and Relative mode (ranks within each planet).
- Accuracy check from the real data (`validation.json`, About page).
- Missing data: the site says when a spot has no data for a factor. A match that lacks a factor gets that factor's typical (median) score, and its card says so.
- Discover and Characterize use real scores. Characterize scores any clicked Earth tile live. Earth tiles have place names (Natural Earth).

## Accuracy check (absolute mode)

- For 5 of 5 Moon and Mars targets, a known Earth analog ranks in Earth's top 10%. Relative mode: 3 of 5.
- 48 of the 50 top-10 matches are new places (more than 300 km from every known analog).
- 20 of 20 wrong-place checks (Amazon, Congo, Paris, Singapore) score red; the highest is 43.7.
- Hit@10 (a known analog in the top 10 itself): 0 of 5. The team chose to judge the tool on new places, so this is reported but is not a pass test.

## Still open

1. The demo recording (`docs/DEMO.md`).
2. Role 3's model-check text was never written; the placeholder and its About-page section were removed.
3. The full data run is not reproducible from the repo alone: it needs an Earthdata login and the Colab notebooks in order.

## Known limits

- Tolerances (`data/schema.json`) and weights are set by hand, not learned from data.
- In Absolute mode, Moon and Mars scores are often low: in our data the warmest Mars night (197 K) is colder than the coldest Earth night (210 K).
- `min_feldspathic` (the main lunar mineral class) has no field in the schema, so Moon mineral scores are weak.
- Earth has no geology or atmosphere factor. Gravity, air and radiation are listed on each result as what Earth cannot reproduce.
- Surface-type cut-offs are set per body (`ati_cuts`).
- The known-analog pairs for validation are body-level. No source pairs an Earth site with a named Moon or Mars site.
- Results are 27 km tiles. A zoom pass down to a single crater or valley is a later feature.
