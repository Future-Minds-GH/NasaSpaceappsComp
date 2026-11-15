# Terrestrial Analog Finder

NASA Space Apps Challenge 2026: *Identify Earth Locations that Analog the Permanent Moon Base Locations and Mars*.

Pick a place on Earth, the Moon or Mars. The app finds the most similar places on any of the three bodies. It gives a % score per factor and says where the analogy breaks down.

**Live site:** https://future-minds-gh.github.io/NasaSpaceappsComp/ (after GitHub Pages is turned on).

> **Data status:** the site shows **sample data** until the real data files are committed to `frontend/public/data/`. The site shows a "sample data" note while it uses them. Do not quote numbers from the sample data.

## How it works

1. **Data prep (Colab):** notebooks download open NASA, ESA and JAXA data. They resample it to one grid per body and write `earth.parquet`, `moon.parquet` and `mars.parquet`. All three files have the same columns (see `contract.md`).
2. **Site files:** `src/build_vectors.py` converts each table into HEALPix tiles. The tiles are equal-area and about 27 km across on all three bodies. Each tile becomes a 34-byte vector in `frontend/public/data/vectors/`.
3. **Search in the browser:** the front end scores every target tile against the clicked tile, in a Web Worker. There is no server.

Factors: terrain (slope, roughness), elevation, geology, mineralogy, climate (temperature, day-night swing, sunlight), atmosphere, water and ice.

## Repository layout

| Path | What |
| --- | --- |
| `notebooks/earth/`, `notebooks/moon/`, `notebooks/mars/` | Colab data prep. Each `.py` file is the source of the `.ipynb` next to it |
| `src/surface_fractions.py`, `src/merge_body.py` | Shared data-prep helpers |
| `src/build_vectors.py` | parquet to site files (Earth today; Moon and Mars to do) |
| `frontend/` | The site (React + Vite, static) |
| `matcher/` | Python matcher, fake tables and validation harness (hit@10, negative controls) |
| `known_analogs.json` | Known Earth analog sites with sources, for validation |
| `data/targets.json` | Moon and Mars target sites |
| `earth_sources.md`, `moon_mars_sources.md` | Data sources and known limits |
| `docs/DEMO.md` | Demo script |

## Run the site locally

Requires Node 20 or later.

```bash
cd frontend
npm install
npm run sample-data   # only if public/data/ has no real data
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
   python src/build_vectors.py earth.parquet --out frontend/public/data --known-analogs known_analogs.json
   ```
4. Commit `frontend/public/data/`. A push to `main` redeploys the site.

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
