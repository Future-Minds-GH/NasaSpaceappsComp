# Moon and Mars data: sources and processing

Grid: 0.5° (360 × 720), `cell_id = row × 720 + col`, row 0 = 89.75° latitude (planetocentric), `lat`/`lon` = cell centre, lon −180 to 180 east positive (0–360 data converted). Missing = null, never 0 (except the Moon's sulfate, clay and carbonate, which are 0 by the brief). Radii: Moon 1737.4 km, Mars 3396.19 km.

Status key: **Checked** = the source and the processing were tested on real downloaded data (a file, a strip or a sample). **Written** = code written and tested on synthetic data only. No full run in Colab has happened yet.

`analog_ok` is true everywhere. `moon_thin.parquet` / `mars_thin.parquet` hold the thin slice; the merge notebooks write `moon.parquet` / `mars.parquet` and never overwrite the thin files.

## Moon

| Column | Source | Processing | Notebook | Status |
| --- | --- | --- | --- | --- |
| `t_day_k`, `t_night_k` | LRO Diviner Global Cumulative Product (GCP), `LRO-L-DLRE-5-GCP-V1.0`, 18 files, 2.8 GB | `tbol` (bolometric brightness temperature, not kinetic), mean 2009–2015; noon = mean of the 11.875 h and 12.125 h bins, midnight = 23.875 h and 0.125 h | `moon_thin_slice` | Checked on one band (noon about 390 K, midnight about 102 K) |
| `t_swing_k` | Derived | `t_day_k − t_night_k` | `moon_thin_slice` | Written |
| `slope_deg`, `rough_m`, `elev_m` | LOLA `LDEM_64` (V3.1, 530 MB) | 2 × 2 block-average to 32 ppd (0.97 km). Slope on a sphere (R 1737.4 km). `rough_m` = std of the 1 km elevations in a 1° window (about 30 km) after removing the best-fit plane, to match Earth | `moon_thin_slice` | Checked on strips (highest and deepest points match) |
| `elev_pct` | Derived | Percentile among valid Moon cells | `moon_thin_slice` | Written |
| `sun_wm2` | Computed | `1361 × cos(lat) / π`. Flat surface, no shadowing, no axis tilt | `moon_minerals_sun_caves` | Checked |
| `albedo` | LROC WAC 643 nm empirically normalised mosaic | Reflectance (not Bond albedo) × (0.11 / cos(lat)-weighted global mean); 0.11 = Bond albedo, NSSDC Moon Fact Sheet. One polar seam factor per pole | `moon_albedo_ice` | Checked on tiles and polar strips |
| `ati` | Derived | `(1 − albedo) / (t_day_k − t_night_k)` | `moon_albedo_ice` | Written |
| `ice_prob` | Diviner PRP (cold traps, `temp_max` < 110 K in at least 1% of the cell area); LRO LEND hydrogen (poleward of 80°, 10 km smoothing, relative scale) | 1 in cold traps; LEND gives at most 0.5; 0 elsewhere. The 1% share and the LEND scale are assumptions | `moon_albedo_ice` | Checked on parts of the files |
| `surf_dust`, `surf_sand`, `surf_rock`, `surf_ice` | `surface_fractions()` (Job 1) | Cuts from the Moon's own ATI ranks (20/50/80th percentile). `surf_ice` = `ice_surface`, which is 0 on the Moon (surface ice is only seen at sub-pixel scale) | `moon_merge` | Written, tested |
| `min_mafic`, `min_feldspathic`, `min_ironox` | Lunar Prospector GRS, 2° table (FeO, TiO₂) | `min_ironox = min(TiO₂ / 0.5264, 0.5)`; the rest split by FeO: `s = clip((FeO − 5) / (22 − 5), 0, 1)`, mafic = (1 − ironox) × s. Anchors 5 and 22 wt% FeO from Lawrence et al. 2002 (abstract only) | `moon_minerals_sun_caves` | Checked on the real table |
| `min_sulfate`, `min_clay`, `min_carbonate` | — | 0 on the Moon (brief) | `moon_minerals_sun_caves` | — |
| `cave_km` | LROC Atlas of Lunar Pits (278 pits, one HTML page) | Haversine to the nearest known pit. Known pits only | `moon_minerals_sun_caves` | Checked |
| `analog_ok` | — | True everywhere | `moon_merge` | — |

## Mars

| Column | Source | Processing | Notebook | Status |
| --- | --- | --- | --- | --- |
| `t_day_k`, `t_night_k` | Mars Climate Database web interface, `tsurf`, dust 1 (climatology, average solar) | 24 hourly maps × 4 seasons (Ls 0, 90, 180, 270): daily max and min per season, regridded to 0.5°, averaged over the seasons. The interface has no daily max/min variable, so the extremes come from hourly values (approximate) | `mars_thin_slice` | Checked on one real file |
| `t_swing_k` | Derived | `t_day_k − t_night_k` | `mars_thin_slice` | Written |
| `slope_deg`, `rough_m`, `elev_m` | MOLA MEGDR, 64 ppd, 4 tiles of 133 MB | Already about 0.93 km. Slope on a sphere (R 3396.19 km). `rough_m` = std after removing the best-fit plane over a 0.5° (about 30 km) window | `mars_thin_slice` | Checked on one tile (Olympus 4.0° slope, Acidalia 1.45°) |
| `elev_pct` | Derived | Percentile among valid Mars cells | `mars_thin_slice` | Written |
| `sun_wm2` | MCD `fluxsurf_dn_sw`, diurnal mean | 12 seasons (Ls step 30), time-weighted (Kepler r²), bilinear to 0.5°. 50–163 W/m² | `mars_sun_albedo_caves` | Checked on 12 real files |
| `albedo` | TES bolometric albedo mosaic (USGS, 7410 m, 8 ppd) | Mean of 4 × 4 pixels, null if fewer than 8 valid. Polar fill rows are null | `mars_sun_albedo_caves` | Checked on the real file |
| `ati` | Derived | `(1 − albedo) / (t_day_k − t_night_k)`. The TES thermal-inertia cross-check was not done | `mars_sun_albedo_caves` | Written |
| `ice_prob` | SWIM ice-consistency maps ((x + 1) / 2, northern mid-latitudes); polar caps = 1 (Xiao et al. 2021 shapefiles); Odyssey GRS hydrogen (`h2o_sr_5x5`, wt% H₂O ÷ 30, capped at 1) | SWIM wins where it has a value, then GRS; caps are 1. Cells poleward of about 60° with no value get 0.8 (an assumption: ground ice is known there, for example at the Phoenix site). A missing SWIM or cap file is skipped with a warning. The 30 wt% scale is an assumption. The brief asked for neutron WEH maps; no verified table was found | `mars_ice` | Hydrogen file checked; SWIM and cap files need a manual download (optional) |
| `surf_dust`, `surf_sand`, `surf_rock`, `surf_ice` | `surface_fractions()` (Job 1) | Cuts from Mars's own ATI ranks. `surf_ice` = `ice_surface` (polar caps only; buried mid-latitude ice is not surface ice) | `mars_merge` | Written, tested |
| `min_mafic`, `min_feldspathic`, `min_ironox`, `min_sulfate`, `min_clay`, `min_carbonate` | TES mineral maps (Bandfield 2002, ASU, 4 ppd cube) | mafic = low-Ca + high-Ca pyroxene + olivine; feldspathic = plagioclase; iron oxide = hematite (the cube's band, not the separate Christensen map); sulfate = sulfate; carbonate = carbonate; clay = sheet silicate / high-Si glass (nearest TES class, an upper bound for clays). The six are normalised to sum 1; null if they add up to less than 0.02. A covered cell has all six, so the matcher does not drop the factor | `mars_minerals` | Checked on the real cube (76% of cells) |
| `cave_km` | Mars Global Cave Candidate Catalog (1062 candidates) | Haversine to the nearest candidate. Covers only surveyed areas; most candidates are unconfirmed | `mars_sun_albedo_caves` | Checked |
| `analog_ok` | — | True everywhere | `mars_merge` | — |

## Targets

`data/targets.json` has 8 of 13 sites with coordinates quoted from pages that were read: Moon Malapert Massif, Mons Mouton Plateau, Mons Mouton, Nobile Rim 2; Mars Jezero, Gale, Arcadia Planitia, Deuteronilus Mensae. Peak near Cabeus B, Haworth, Nobile Rim 1, de Gerlache Rim 2 and Slater Plain have no citable longitude yet. The USGS data release `A3_9regions-lonlat-simplified.zip` (https://doi.org/10.5066/P1MEQ6UK) has the polygons; it needs a manual browser download.

## Known limits
- Moon albedo is a scaled red-band reflectance, not Bond albedo. Moon `ice_prob` from LEND is a relative scale. Surface type is relative within each body.
- Mars sulfate, carbonate and clay come from low-abundance TES bands near the detection limit (not applied here), and "clay" is the sheet-silicate / high-Si glass band. Normalising them into shares can make small, noisy abundances look large. Treat the Mars mineral shares as rough.
- Mars ice works without the SWIM files and the polar-cap shapefiles (they are skipped with a warning), but then the mid-latitude SWIM values are missing and `ice_surface` is 0 everywhere. Download them by hand into `raw/mars/swim/` and `raw/mars/polar_caps/` for the full result.
- Unverified items are marked `# UNVERIFIED:` in the notebooks and listed in the hand-back notes.
