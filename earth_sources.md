# Earth data: sources and processing

Grid: 0.25° (720 × 1440), `cell_id = row × 1440 + col`, row 0 = 89.875°N, `lat`/`lon` = cell centre, lon −180 to 180. Missing = null, never 0.

Status key: **Checked** = the source, layer names and the processing math were tested on real downloaded data (one granule or tile, not the full run). **Written** = code written and tested on synthetic data only. No full-size run has happened yet.

| Column | Source | Processing | Notebook | Status |
| --- | --- | --- | --- | --- |
| `t_day_k`, `t_night_k` | MODIS MYD11C3 v061 (Aqua: about 1:30 pm and 1:30 am local time, close to the daily high and low; Mars uses daily max/min, the Moon noon/midnight), `LST_Day_CMG`, `LST_Night_CMG` | Scale 0.02 → K, 0 = fill → null. Mean of 12 months of 2023. Mean of each 5×5 block of 0.05° pixels | `earth_thin_slice` | Checked (Jan 2023: Sahara 297.5 K day, Antarctica 248 K, ocean null) |
| `t_swing_k` | Derived | `t_day_k − t_night_k` | `earth_thin_slice` | Written |
| `slope_deg`, `rough_m`, `elev_m` | Copernicus DEM GLO-90 (public AWS Open Data copy; same ESA product as Copernicus Data Space) | Each 1° tile resampled to 30″ (~1 km). Slope from the 1 km grid (metres per degree from latitude), mean per cell. `rough_m` = std of the 1 km elevations in the cell after removing each 30 × 30 block's best-fit plane (a smooth tilted surface scores about 0; tilt is in `slope_deg`). The window is one 0.25° cell, about 28 km: the Moon and Mars need the same physical distance. `elev_m` = mean. 26,475 tiles in the list | `earth_thin_slice` | Checked (Himalaya tile 8.9° mean slope and 297 m roughness, Sahara tile 0.4° and 16 m) |
| `elev_pct` | Derived | Percentile rank of `elev_m` among cells with both a temperature and an elevation | `earth_thin_slice` | Written |
| `sun_wm2` | NASA POWER climatology, `ALLSKY_SFC_SW_DWN`, `ANN` | × 41.67 → W/m². Regional requests in 10° tiles. NaN-aware bilinear interpolation to 0.25°. POWER returns points 1° apart (not 0.5°); 10° boxes work (100 points) | `sun` | Checked (live request) |
| `albedo` | MODIS MCD43C3 v061, `Albedo_WSA_shortwave` | Scale 0.001. Mean of the 15th of each month of 2023. 5×5 block mean | `albedo_ice` | Layer checked on a real granule |
| `ati` | Derived | `(1 − albedo) / (t_day_k − t_night_k)`; null when swing ≤ 0 | `albedo_ice` | Written |
| `ice_prob` | ESA Permafrost CCI v5.0 (`PFR`, from CEDA); MODIS MOD10CM monthly snow (CMR version string `61`) `Snow_Cover_Monthly_CMG`; MCD12C1 (2023) class 15 for ice sheets | `ice_prob = max(permafrost fraction, snow fraction)`; ice sheets = 1. Permafrost files are plain WGS 84 lat/lon at 0.01° (checked; no reprojection), downloaded by the notebook (NH 2023 and Antarctica 2023). A second helper column `ice_surface` (snow and ice sheets only) feeds surface type | `albedo_ice` | Permafrost binning checked on the real files; the rest written |
| `surf_dust`, `surf_sand`, `surf_rock`, `surf_ice` | `src/surface_fractions.py` (shared with the Moon and Mars) | `surf_ice = ice_surface` (snow and ice sheets only, so buried permafrost ice is not counted twice). The rest is split by `ati` with triangular memberships. **ATI depends on day length and measuring time, so the cut-offs are per body:** Earth's come from its own ATI ranks (20th, 50th and 80th percentile). Surface type is therefore relative within a body. For the Moon and Mars, use the same function with their own cuts or the measured Diviner/TES thermal inertia | `merge` | Written, tested |
| `min_ironox`, `min_sulfate`, `min_clay`, `min_carbonate` | EMIT L3 aggregated mineral spectral abundance (EMITL3ASA v002): one 22 MB file, 0.5° grid, 10 minerals | Layers summed into four classes, sampled to the 0.25° cells, normalised to shares. The earlier per-swath loop (EMIT L2B) is gone | `minerals` | Checked on the real file (55,020 cells with EMIT data) |
| `min_mafic`, `min_feldspathic` | GLiM v1.0, 0.5° (`vb` basic volcanic and `pb` basic plutonic = mafic, `pa` acid plutonic = feldspathic) | **Approximate.** A rock-type map, not minerals. In cells with EMIT data the rock class has weight 0.5. Where EMIT has no data (for example Hawaii, Iceland), a `vb`/`pb` cell is 100% mafic and a `pa` cell 100% feldspathic. Other rock types stay null | `minerals` | Checked on the real file |
| `analog_ok` | MOD11C3 `Percent_land_in_grid`; MOD13C2 v061 NDVI; MCD12C1 v061 `Majority_Land_Cover_Type_1` | True when land > 50%, long-term NDVI < 0.3, and urban (class 13) covers under 20% of the cell. Snow/ice (15) and barren (16) cells (at least 50% of the cell) skip the NDVI test, so polar cells stay in. False when a known input already fails (for example ocean). Null when nothing known fails but an input is missing | `filter` | Layers checked on real granules |
| `cave_km` | — | Null on Earth | `filter` | Written |

## Known limits
- Coastal DEM cells may include 0 m ocean elevation.
- `elev_pct` counts only cells with both a temperature and an elevation.
- Not verified: the full-size runs, and the 0.5 weight of GLiM against EMIT. Urban class 13 is the standard IGBP code.
- `earth_thin.parquet` is written by the thin-slice notebook; the merge notebook reads it and writes `earth.parquet`.
- The ATI percentile cuts (20/50/80) and the GLiM weight are starting values.
- `ice_prob` includes permafrost (a scored factor); it is not the same as `surf_ice`.
