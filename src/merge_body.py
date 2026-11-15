"""Merge the thin slice and the part files of the Moon or Mars into the 26-column contract table.

Pure functions, used by notebooks/moon/moon_merge.py and notebooks/mars/mars_merge.py.
Needs surface_fractions.py (Job 1, PR #3) next to this file or on the path.

Rules (same as the Earth merge):
- Missing = NaN, never 0.
- Surface type = surface_fractions(albedo, ati, ice_surface, cuts) with cuts taken from the body's own
  ATI ranks (ati_cuts), because ATI depends on day length and measuring time.
- A fraction group (surf_*, min_*) sums to 1 or is null. A partly null group counts as missing in the matcher, so
  every cell must have all six mineral classes or none (Mars: all six come from the TES cube).
- analog_ok is true for every cell on the Moon and Mars (contract).
"""
import numpy as np
import pandas as pd

from surface_fractions import ati_cuts, surface_fractions

NROWS, NCOLS = 360, 720
THIN = ["cell_id", "lat", "lon", "t_day_k", "t_night_k", "t_swing_k",
        "slope_deg", "rough_m", "elev_m", "elev_pct"]
SURF = ["surf_dust", "surf_sand", "surf_rock", "surf_ice"]
MIN = ["min_mafic", "min_feldspathic", "min_ironox", "min_sulfate", "min_clay", "min_carbonate"]
CONTRACT = ["cell_id", "lat", "lon", "t_day_k", "t_night_k", "t_swing_k", "sun_wm2",
            "slope_deg", "rough_m", "elev_m", "elev_pct", "albedo", "ati",
            *SURF, *MIN, "ice_prob", "analog_ok", "cave_km"]
HELPERS = ["ice_surface"]          # in a part file, not in the contract

SPECS = {
    "moon": {
        "parts": {
            "part_albedo_ice.parquet": ["albedo", "ati", "ice_prob", "ice_surface"],
            "part_minerals_sun_caves.parquet": ["sun_wm2", *MIN, "cave_km"],
        },
    },
    "mars": {
        "parts": {
            "part_sun_albedo_caves.parquet": ["sun_wm2", "albedo", "ati", "cave_km"],
            "part_ice.parquet": ["ice_prob", "ice_surface"],
            "part_minerals.parquet": MIN,
        },
    },
}


def merge_parts(body, thin, parts):
    """thin: DataFrame with THIN columns. parts: {part file name: DataFrame or None (missing)}."""
    spec = SPECS[body]
    assert len(thin) == NROWS * NCOLS, f"{len(thin)} rows, expected {NROWS * NCOLS}"
    df = thin[THIN].sort_values("cell_id").reset_index(drop=True)
    assert (df["cell_id"].to_numpy() == np.arange(NROWS * NCOLS)).all(), "cell_id must be 0..N-1"
    for name, cols in spec["parts"].items():
        part = parts.get(name)
        if part is None:
            for c in cols:
                df[c] = np.nan
            continue
        assert part["cell_id"].is_unique, f"{name}: duplicate cell_id"
        missing = [c for c in cols if c not in part.columns]
        assert not missing, f"{name}: missing columns {missing}"
        df = df.drop(columns=[c for c in cols if c in df.columns]).merge(
            part[["cell_id", *cols]], on="cell_id", how="left")
    df = df.sort_values("cell_id").reset_index(drop=True)
    if df["ati"].notna().any():
        cuts = ati_cuts(df["ati"])
        print(f"{body} ATI cuts (dust_full, sand_peak, rock_full):", cuts)
        surf = surface_fractions(df["albedo"], df["ati"], df["ice_surface"], cuts)
    else:
        surf = (np.full(len(df), np.nan),) * 4
    for c, v in zip(SURF, surf):
        df[c] = v
    # Fully ice-covered cells (ice_surface == 1, for example the Martian polar caps) are all ice even where
    # albedo or ATI is missing (the TES albedo has no data poleward of about 87 deg).
    full_ice = df["ice_surface"].eq(1.0).to_numpy()
    df.loc[full_ice, SURF] = [0.0, 0.0, 0.0, 1.0]
    df["analog_ok"] = True
    return df[CONTRACT]


def check_contract(body, df):
    assert list(df.columns) == CONTRACT
    assert df["cell_id"].is_unique
    for group in (SURF, MIN):
        n_null = df[group].isna().sum(axis=1)
        assert n_null.isin([0, len(group)]).all(), f"{group[0]}..: a row is only partly null"
        s = df[group].sum(axis=1, skipna=False).dropna()
        assert np.allclose(s, 1, atol=1e-6), f"{group[0]}..: fractions do not sum to 1"
    ice = df["ice_prob"].dropna()
    assert ice.between(0, 1).all(), "ice_prob must be 0-1"
