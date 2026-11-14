# %% [markdown]
# # Job 1: merge all Earth parts into `earth.parquet`
#
# Reads `earth_thin.parquet` and writes `earth.parquet`, so running the thin slice again does not wipe the merged columns.
# Run after the thin-slice notebook and the four part notebooks
# (`sun`, `albedo_ice`, `minerals`, `filter`). A missing part leaves its columns null.
#
# Before you run: copy `src/surface_fractions.py` to `analog-finder/code/` on Drive.

# %%
from pathlib import Path
import sys
import numpy as np
import pandas as pd
from google.colab import drive

drive.mount("/content/drive")
ROOT = Path("/content/drive/MyDrive/analog-finder")
RAW = ROOT / "raw" / "earth"
OUT = ROOT / "processed"
sys.path.insert(0, str(ROOT / "code"))
from surface_fractions import ati_cuts, surface_fractions

# %%
THIN = ["cell_id", "lat", "lon", "t_day_k", "t_night_k", "t_swing_k",
        "slope_deg", "rough_m", "elev_m", "elev_pct"]
PARTS = {   # part file -> columns it must give
    "part_sun.parquet": ["sun_wm2"],
    "part_albedo_ice.parquet": ["albedo", "ati", "ice_prob", "ice_surface"],   # ice_surface is a helper, not a contract column
    "part_minerals.parquet": ["min_mafic", "min_feldspathic", "min_ironox", "min_sulfate",
                              "min_clay", "min_carbonate"],
    "part_filter.parquet": ["analog_ok", "cave_km"],
}
SURF = ["surf_dust", "surf_sand", "surf_rock", "surf_ice"]
CONTRACT = ["cell_id", "lat", "lon", "t_day_k", "t_night_k", "t_swing_k", "sun_wm2",
            "slope_deg", "rough_m", "elev_m", "elev_pct", "albedo", "ati",
            *SURF, "min_mafic", "min_feldspathic", "min_ironox", "min_sulfate",
            "min_clay", "min_carbonate", "ice_prob", "analog_ok", "cave_km"]


def merge_parts(thin, parts):
    # thin: DataFrame with THIN columns. parts: {file name: DataFrame or None}.
    df = thin[THIN].copy()
    for name, cols in PARTS.items():
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
    # Earth cuts come from Earth's own ATI ranks (relative within the body, see surface_fractions.py)
    if df["ati"].notna().any():
        cuts = ati_cuts(df["ati"])
        print("Earth ATI cuts (dust_full, sand_peak, rock_full):", cuts)
        surf = surface_fractions(df["albedo"], df["ati"], df["ice_surface"], cuts)
    else:                                              # albedo/ATI part missing: surface type stays null
        surf = (np.full(len(df), np.nan),) * 4
    for c, v in zip(SURF, surf):
        df[c] = v
    return df[CONTRACT]


def check_contract(df):
    for group in (SURF, PARTS["part_minerals.parquet"][:]):
        n_null = df[group].isna().sum(axis=1)
        assert n_null.isin([0, len(group)]).all(), f"{group[0]}..: a row is only partly null"
        s = df[group].sum(axis=1, skipna=False)
        ok = s.dropna()
        assert np.allclose(ok, 1, atol=1e-6), f"{group[0]}..: fractions do not sum to 1"
    assert df["cell_id"].is_unique


# %%
thin = pd.read_parquet(OUT / "earth_thin.parquet")   # written by the thin-slice notebook, never overwritten here
parts = {n: (pd.read_parquet(RAW / n) if (RAW / n).exists() else None) for n in PARTS}
print({n: ("ok" if p is not None else "MISSING") for n, p in parts.items()})
df = merge_parts(thin, parts)
check_contract(df)
df.to_parquet(OUT / "earth.parquet", index=False)
df.notna().mean().round(3)   # share of cells with data, per column
