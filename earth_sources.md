# Earth data: sources and processing

Grid: 0.25° (720 × 1440), `cell_id = row × 1440 + col`, row 0 = 89.875°N, `lat`/`lon` = cell centre, lon −180 to 180. Missing = null, never 0.

Status key: **Checked** = the source, layer names and the processing math were tested on real downloaded data (one granule or tile, not the full run). **Written** = code written and tested on synthetic data only. No full-size run has happened yet.

| Column | Source | Processing | Notebook | Status |
| --- | --- | --- | --- | --- |
| `t_day_k`, `t_night_k` | MODIS MOD11C3 v061, `LST_Day_CMG`, `LST_Night_CMG` | Scale 0.02 → K, 0 = fill → null. Mean of 12 months of 2023. Mean of each 5×5 block of 0.05° pixels | `earth_thin_slice` | Checked (Jan 2023: Sahara 297.5 K day, Antarctica 248 K, ocean null) |
| `t_swing_k` | Derived | `t_day_k − t_night_k` | `earth_thin_slice` | Written |
| `slope_deg`, `rough_m`, `elev_m` | Copernicus DEM GLO-90 (public AWS Open Data copy; same ESA product as Copernicus Data Space) | Each 1° tile resampled to 30″ (~1 km). Slope from the 1 km grid (metres per degree from latitude), mean per cell. `rough_m` = std of 1 km elevations in the cell. `elev_m` = mean. 26,475 tiles in the list | `earth_thin_slice` | Checked (Himalaya tile 8.9° mean slope, Sahara tile 0.4°) |
| `elev_pct` | Derived | Percentile rank of `elev_m` among cells with both a temperature and an elevation | `earth_thin_slice` | Written |
| `sun_wm2` | NASA POWER climatology, `ALLSKY_SFC_SW_DWN`, `ANN` | × 41.67 → W/m². Regional requests in 10° tiles. NaN-aware bilinear interpolation to 0.25°. POWER returns points 1° apart (not 0.5°); 10° boxes work (100 points) | `sun` | Checked (live request) |
| `albedo` | MODIS MCD43C3 v061, `Albedo_WSA_shortwave` | Scale 0.001. Mean of the 15th of each month of 2023. 5×5 block mean | `albedo_ice` | Layer checked on a real granule |
| `ati` | Derived | `(1 − albedo) / (t_day_k − t_night_k)`; null when swing ≤ 0 | `albedo_ice` | Written |
| `ice_prob` | ESA Permafrost CCI v5.0 (`PFR`, manual download from CEDA); MODIS MOD10C1 (CMR version string `61`) `Day_CMG_Snow_Cover`; MCD12C1 (2023) class 15 for ice sheets | `max(permafrost fraction, snow fraction)`; ice sheets = 1 | `albedo_ice` | Written |
| `surf_dust`, `surf_sand`, `surf_rock`, `surf_ice` | `src/surface_fractions.py` (shared with the Moon and Mars) | `surf_ice = ice_prob`. The rest is split by `ati` with triangular memberships (dust ≤ 0.02, rock ≥ 0.06). **These two thresholds are starting values, not measured; tune them with the validation numbers.** | `merge` | Written, tested |
| `min_ironox`, `min_sulfate`, `min_clay`, `min_carbonate` | EMIT L2B mineral identification (EMITL2BMIN v002), main deserts only | EMIT names are long USGS library names, so a keyword rule maps them (mixtures and WTC dust samples skipped). Pixels placed with the GLT layers, counted per cell, normalised | `minerals` | Checked on one real granule |
| `min_mafic`, `min_feldspathic` | GLiM v1.0, 0.5° (`vb` = basic volcanic, `pa` = acid plutonic) | **Approximate.** A rock-type map, not minerals. Shares weight 0.5 in `vb`/`pa` cells. Cells EMIT does not cover are null in all six `min_*` columns | `minerals` | Written; GLiM reading tested on the real file |
| `analog_ok` | MOD11C3 `Percent_land_in_grid`; MOD13C2 v061 NDVI; MCD12C1 v061 `Majority_Land_Cover_Type_1` | True when land > 50%, long-term NDVI < 0.3, and no urban pixel (class 13). False when a known input already fails (for example ocean). Null when nothing known fails but an input is missing | `filter` | Layers checked on real granules |
| `cave_km` | — | Null on Earth | `filter` | Written |

## Known limits
- Coastal DEM cells may include 0 m ocean elevation.
- `elev_pct` counts only cells with both a temperature and an elevation.
- Still unverified: IGBP urban class 13, the Permafrost CCI file name (year), the Antarctica permafrost file, and the 0.5 weight of GLiM against EMIT.
- Surface-type thresholds and the GLiM weight are starting values.
