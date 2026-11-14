# Contract: tables, `match()`, files

Owner: Job 3. Status: DRAFT. The team must confirm it in hour 1.
Changes after hour 1 need Job 3's approval. Items marked **[Decision]** close gaps in the original brief.

## 1. Files and paths

| What | Path | Made by |
| --- | --- | --- |
| Colab output | `analog-finder/processed/{earth,moon,mars}.parquet` (shared Drive) | Jobs 1, 2 |
| Fake tables (until real ones arrive) | `data/fake/{earth,moon,mars}.parquet` | Job 3 |
| Web tables | `web/public/data/{earth,moon,mars}.json` | Job 3 (`matcher/export_web.py`) |
| Matcher (Python) | `matcher/match.py` | Job 3 |
| Matcher (JS) | `web/src/match.js` | Job 3 |
| Presets, tolerances | `web/src/presets.json`, `web/src/tolerances.json` | Job 3 |
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
- Surface fractions come from `surface_fractions()` (section 5). All three bodies use it.

## 3. Web table format **[Decision]**

```json
{ "meta": { "body": "mars", "radius_km": 3389.5, "grid_deg": 0.5, "fake": false },
  "cols": { "lat": [..], "lon": [..], "t_day_k": [.., null, ..], "analog_ok": [true, ..] } }
```

- Columnar. `null` = missing. Numbers rounded to 2 decimals (4 for `lat`/`lon`).
- `meta.body` is one of `earth`, `moon`, `mars`. `meta.radius_km`: Earth 6371, Moon 1737.4, Mars 3389.5.
- `meta.fake = true` on fake tables. Never quote numbers made from fake tables.
- `match()` reads the body only from `meta`. Same-body pair = `input.meta.body === target.meta.body`. No code branches on a body name.
- **Size [Decision]:** the web export may be coarser than the Colab grid. Web default: Earth 0.5° (land only), Moon and Mars 1°. Set by `export_web.py --decimate`. `meta.grid_deg` always states the web grid.

## 4. `match()` **[Decision: fields added to the original signature]**

```
match({ inputTable, inputLat, inputLon, targetTable, weights, include, mode,
        k = 5, minSepKm = 200, excludeKm = 300, knownSites, newKm = 300 })
→ [ { index, lat, lon, score, band, breakdown, worst, isNew, caveKm } ]   // top k
```

Inputs:
- `weights`: `{ temp, swing, sun, slope, rough, elev, surface, minerals, ice }`, numbers ≥ 0. Presets sum to 100. Other sums are allowed.
- `include`: `{ key: boolean }`. A missing key means true. False sets that weight to 0.
- `mode`: `"absolute"` or `"relative"`.
- `knownSites`: optional `[{ body, lat, lon }]`. If absent, `isNew` is `null`.
- `excludeKm` applies only to same-body pairs. Distance is measured from the clicked point (`inputLat`, `inputLon`).

Outputs:
- `score`: 0–100, not rounded. `band`: `"green"` if score ≥ 90, `"yellow"` if ≥ 60, else `"red"`. Exactly 90.0 is green. Exactly 60.0 is yellow.
- `breakdown`: one key per weight group with weight > 0 (`temp, swing, sun, slope, rough, elev, surface, minerals, ice`). Value 0–1, or `null` if the pair has no data for it. `temp` is the mean of the day and night scores. The UI shows null as "no data".
- `worst`: the 2 breakdown keys with the lowest non-null score (ties: key order above). The UI adds the fixed Earth limits.
- `isNew`: true if the match is more than `newKm` from every `knownSites` entry on the target body.
- `caveKm`: the cell's `cave_km`, or `null`.
- `index`: row index in the target table.

Scoring (full spec in the brief; these are the exact edge rules):
- Scalar: `s = max(0, 1 − |a − b| / τ)`. Vector: `s = 1 − 0.5 × Σ|p − q|`.
- `S = 100 × Σ(w·s) / Σ(w)` over features that are non-null in BOTH cells and have w > 0.
- If Σw = 0 after dropping nulls, the score is null and the cell is skipped.
- `w_t_day = w_t_night = w_temp / 2`.
- Search: only target cells with `analog_ok = true`. Greedy pick by score descending (ties: lower index). Skip a cell closer than `minSepKm` to a cell already picked. Haversine with the target body radius.
- Input cell = nearest cell in the input table to the clicked point (haversine). Any cell, `analog_ok` or not.

**Relative mode [Decision]:**
- Each scalar feature is replaced by its percentile within its own body.
- Percentile of value v = `100 × (L + E/2) / n`. L = reference values < v. E = reference values equal to v. n = count of non-null reference values.
- This equals `(average_rank − 0.5) / n × 100`, with average ranks for ties, nulls excluded.
- Reference set = rows with `analog_ok = true`, per table.
- `elev_pct` is already a percentile and is used as is. Vector features are unchanged.
- τ comes from `tolerances.json → relative` (percentile points).

## 5. `surface_fractions(albedo, ati, ice_prob) -> (dust, sand, rock, ice)`

One copy only: `src/surface_fractions.py` (PR #3, Job 1). All three bodies import it.

- `surf_ice = ice_prob`. The other three are scaled by `(1 - ice_prob)`. The four sum to 1.
- Any null input makes all four outputs null.
- **Open risk:** the thresholds are starting values. ATI = (1 - albedo) / swing is about 0.003 on the Moon (swing ~300 K), ~0.01 on Mars and ~0.03 on a hot Earth desert. Check with real data that the thresholds do not put a whole body in one class. Print the per-body histogram, then retune once for all bodies.

## 6. Open points for the team to confirm

1. Earth table = land only (section 2).
2. Web export grid sizes (section 3).
3. `image_url` optional (section 2).
4. `cave_km` null on Earth.
5. Job 4 reads the JSON wrapper `{ meta, cols }`, not bare columns.
