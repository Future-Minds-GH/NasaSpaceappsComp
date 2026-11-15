# Project summary

Terrestrial Analog Finder. NASA Space Apps Challenge 2026: *Identify Earth Locations that Analog the Permanent Moon Base Locations and Mars*. Status as of 15 Nov 2026.

## What it is

A website. You pick a place on Earth, the Moon or Mars, and it finds the most similar places on any of the three bodies. Each result gets a % score with one bar per factor, and a list of what Earth cannot reproduce: gravity, vacuum or thin air, radiation.

## How it works

1. **One grid per body.** Colab notebooks download open data. Earth uses a 0.25° grid; the Moon and Mars use 0.5°. Every cell gets the same columns: day and night temperature, day–night swing, sunlight, slope, roughness, elevation, surface type, six mineral classes and ice likelihood (`contract.md`).
2. **Equal-area tiles.** `build_vectors.py` (Earth) and `build_body_vectors.py` (Moon, Mars) convert the tables into HEALPix tiles, about 27 km across on all three bodies. Each tile is a 35-byte vector, stored as percentiles within its own body.
3. **Search in the browser.** The front end scores every tile of the target body against the clicked tile, in a Web Worker, with preset weights and sliders. There is no server; the site is static on GitHub Pages.
4. **Validation.** `matcher/validate.py` measures hit@10 (do known Earth analogs rank in the top 10?), negative controls (cities and rainforest must score low) and symmetry.

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

## What is not done (blocks the publish)

1. **Front-end data code:** `frontend/src/data/` is not in git, so the site cannot build and the Pages deploy fails. **Owner: Migue.**
2. **Full data runs:** the notebooks have not run on full data. They need Ncush's Earthdata login, in this order: thin slices, part notebooks, merge notebooks. **Owner: Ncush.**
3. **Site files from real data:** run `build_vectors.py` and `build_body_vectors.py`, then commit `frontend/public/data/`.
4. **Site files from Job 3:** `weights.json`, `validation.json`, `test_pairs.json` and `showcase.json`. These need `similarity.js` from item 1. **Owner: Jeron.**
5. **Validation numbers for the pitch:** these come after item 2.

## Known limits

- Every factor is a percentile within its own body. "Hot for Mars" is compared with "hot for Earth". The absolute engineering comparison is not on the site.
- Earth has no data for the geology and atmosphere factors, so those factors are not compared for Earth tiles.
- The surface-type fractions have no field in the site's schema (v0.2 added `feldspathic`).
- Mars minerals apply the TES detection limits (Christensen et al. 2001): sulfate and carbonate fall to 0 almost everywhere.
- Surface-type cut-offs are set per body (`ati_cuts`). Check them against the real histograms.
- The known-analog pairs for validation are body-level. No source pairs an Earth site with a named Moon or Mars site.
- Results are 27 km tiles. A zoom pass down to a single crater or valley is a later feature.
