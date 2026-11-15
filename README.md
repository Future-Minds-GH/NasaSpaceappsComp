# Terrestrial Analog Finder

NASA Space Apps Challenge 2026: *Identify Earth Locations that Analog the Permanent Moon Base Locations and Mars*.

Pick a place on Earth, the Moon or Mars. The app finds the most similar places on any of the three bodies. It gives a % score per factor and says where the analogy breaks down.

**Live site:** https://future-minds-gh.github.io/NasaSpaceappsComp/

> **Data status:** every file in `frontend/public/data/` is built from the real Earth, Moon and Mars tables. Accuracy check (absolute mode, About page): for 5 of 5 Moon and Mars targets a known Earth analog ranks in Earth's top 10%; 48 of the 50 top-10 matches are new places; 20 of 20 wrong-place checks (Amazon, Congo, Paris, Singapore) score red.

## How it works

1. **Data prep (Colab):** notebooks download open NASA, ESA and JAXA data. They resample it to one grid per body and write `earth.parquet`, `moon.parquet` and `mars.parquet`. All three files have the same columns (see `contract.md`).
2. **Site files:** `src/build_vectors.py` converts each table into HEALPix tiles. The tiles are equal-area and about 27 km across on all three bodies. Each tile becomes a 25-byte vector in `frontend/public/data/vectors/` (format: `data/schema.json`).
3. **Search in the browser:** the front end scores every target tile against the clicked tile, in a Web Worker. There is no server.
4. **Scoring:** Absolute mode (default) compares real values with fixed tolerances, for example 40 K for temperature. Relative mode compares ranks within each planet. The total is a weighted mean of the factor scores; the weights come from the mission presets.

Nine factors: day and night temperature, day-night swing, sunlight, slope, roughness, elevation within its planet, surface type, minerals and ice.

Limits:
- Tolerances and weights are set by hand from the contract, not learned from data.
- A tile is about 27 km across. A result names a region, not one exact site.
- Earth has no geology or atmosphere factor. Gravity, air and radiation are listed on each result as things Earth cannot reproduce.
- The Moon's main mineral class (feldspar-rich highland rock) has no field, so Moon mineral scores are weak.
- Where a spot has no data for a factor, the site says so. A match that lacks a factor the clicked spot has gets that factor's typical (median) score, and its card says so.

## Repository layout

| Path | What |
| --- | --- |
| `notebooks/earth/`, `notebooks/moon/`, `notebooks/mars/` | Colab data prep. Each `.py` file is the source of the `.ipynb` next to it |
| `src/surface_fractions.py`, `src/merge_body.py` | Shared data-prep helpers |
| `src/build_vectors.py`, `src/build_body_vectors.py` | parquet to site files: Earth; Moon and Mars plus `vectors/schema.json` |
| `frontend/` | The site (React + Vite, static) |
| `matcher/` | Python matcher, fake tables and validation harness (hit@10, negative controls) |
| `known_analogs.json` | Known Earth analog sites with sources, for validation |
| `data/targets.json` | Moon and Mars target sites |
| `earth_sources.md`, `moon_mars_sources.md` | Data sources and known limits |
| `docs/DEMO.md` | Demo script (3 minutes) |
| `docs/PROJECT_SUMMARY.md` | Project summary and status |
| `web/src/presets.json` | Mission preset weights |

## Demo

The 3-minute demo script is in [docs/DEMO.md](docs/DEMO.md).

## Run the site locally

Requires Node 20 or later.

```bash
cd frontend
npm install
npm test
npm run dev           # open the URL it prints
```

## Rebuild the data

Requires a free NASA Earthdata login, entered in Colab only. Never commit credentials.

1. Run the Earth notebooks in order: `earth_thin_slice`, `sun`, `filter`, `albedo_ice`, `minerals`, `merge`. Output: `earth.parquet`.
2. Run the Moon and Mars notebooks in order: thin slice, the depth notebooks, then `*_merge`. Output: `moon.parquet`, `mars.parquet`.
3. Make the site files:
   ```bash
   pip install astropy-healpix pandas pyarrow numpy
   python src/build_vectors.py earth.parquet --out frontend/public/data --known-analogs known_analogs.json   # place names: Natural Earth admin-0/1 GeoJSON in --natural-earth <folder>
   python src/build_body_vectors.py --moon moon.parquet --mars mars.parquet --out frontend/public/data
   ```
4. Make the derived files from the site files (same scoring code as the site):
   ```bash
   python src/make_weights.py --out frontend/public/data/weights.json
   cd frontend
   node scripts/make-sample-search-files.mjs   # test pairs, showcase, pools; computed from the real files, but it writes "sample": true, so set it to false in these files
   node scripts/make-validation.mjs            # accuracy check
   node scripts/make-discoveries.mjs           # Discover list
   node scripts/make-characterize.mjs          # Characterize famous sites
   ```
5. Commit `frontend/public/data/`. A push to `main` redeploys the site.

## Tests

```bash
python -m pytest -q src matcher/tests
cd frontend && npm test
```

## Deploy

`.github/workflows/pages.yml` builds `frontend/` and publishes it to GitHub Pages on every push to `main`. Turn it on once: **Settings → Pages → Source: GitHub Actions**.

## Team

| Job | Owner |
| --- | --- |
| 1. Earth data | Ncush |
| 2. Moon and Mars data | Ncush |
| 3. Matcher and validation | Jeron |
| 4. Front end | Migue |
