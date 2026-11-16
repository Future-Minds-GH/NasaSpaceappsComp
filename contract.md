# Contract: tables, files

> **Scoring and the site's file format:** the site scores with `frontend/src/data/similarity.js` on the byte vectors described in `data/schema.json` (tolerances included). The v0 matcher (`match()`, `matcher/`, `web/src/match.js`, `tolerances.json`) and its JSON web tables were removed, so their sections are gone.

Owner: Job 3. Status: DRAFT. The team must confirm it in hour 1.
Changes after hour 1 need Job 3's approval. Items marked **[Decision]** close gaps in the original brief.

## 1. Files and paths

| What | Path | Made by |
| --- | --- | --- |
| Colab output | `analog-finder/processed/{earth,moon,mars}.parquet` (shared Drive) | Jobs 1, 2 |
| Presets | `web/src/presets.json` | Job 3 |
| Known analog sites | `known_analogs.json` | Job 3 |

## 2. Table columns (parquet)

One table per body. Identical columns. One row per grid cell. `lat`/`lon` = cell centre.
Longitude −180..180, east positive. Latitude planetocentric. Missing value = null (NaN in pandas). Never fill with 0.

| Column | Type | Unit / range | Scored |
| --- | --- | --- | --- |
| `cell_id` | int | — | no |
| `lat`, `lon` | float | degrees | no |
| `t_day_k`, `t_night_k` | float | K, surface (skin) temperature, long-term mean | yes |
| `t_swing_k` | float | K, day − night | yes |
| `sun_wm2` | float | W/m², daily mean at the surface | yes |
| `slope_deg` | float | degrees, DEM at ~1 km | yes |
| `rough_m` | float | m, std. dev. of ~1 km elevations in the cell | yes |
| `elev_m` | float | m, display only | no |
| `elev_pct` | float | 0–100, percentile within its own body | yes |
| `albedo` | float | 0–1, helper | no |
| `ati` | float | `(1 − albedo) / (t_day_k − t_night_k)`, helper | no |
| `surf_dust`, `surf_sand`, `surf_rock`, `surf_ice` | float | fractions, sum 1 | yes (vector) |
| `min_mafic`, `min_feldspathic`, `min_ironox`, `min_sulfate`, `min_clay`, `min_carbonate` | float | fractions, sum 1 | yes (vector) |
| `ice_prob` | float | 0–1 | yes |
| `analog_ok` | bool | Earth: land, NDVI < 0.3, not urban. Moon/Mars: always true | filter |
| `cave_km` | float | km to nearest cave or pit candidate. Null on Earth | badge |
| `image_url` | string, optional | picture of the cell. If absent, Job 4 builds a tile URL from lat/lon | no |

Rules:
- A vector group is present only if ALL its columns are present. One null makes the whole vector "no data".
- **[Decision] Earth table holds land cells only.** Ocean cells have no surface-temperature meaning. This also cuts file size.
- Surface fractions come from `surface_fractions()` (section 4). All three bodies use it.

## 3. Percentiles (relative mode and `elev_pct`)

- Percentile of value v = `(L + E/2) / n`. L = reference values < v. E = reference values equal to v. n = count of non-null reference values.
- This equals `(average_rank − 0.5) / n`, with average ranks for ties, nulls excluded.
- Reference set = rows with `analog_ok = true`, per table.

## 4. `surface_fractions(albedo, ati, ice_prob) -> (dust, sand, rock, ice)`

One copy only: `src/surface_fractions.py` (PR #3, Job 1). All three bodies import it.

- `surf_ice = ice_prob`. The other three are scaled by `(1 - ice_prob)`. The four sum to 1.
- Any null input makes all four outputs null.
- **Open risk:** the thresholds are starting values. ATI = (1 - albedo) / swing is about 0.003 on the Moon (swing ~300 K), ~0.01 on Mars and ~0.03 on a hot Earth desert. Check with real data that the thresholds do not put a whole body in one class. Print the per-body histogram, then retune once for all bodies.

## 5. Open points for the team to confirm

1. Earth table = land only (section 2).
2. `image_url` optional (section 2).
3. `cave_km` null on Earth.
