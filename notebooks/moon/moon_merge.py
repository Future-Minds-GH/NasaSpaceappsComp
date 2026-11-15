# %% [markdown]
# # Job 2: merge the Moon parts into `moon.parquet`
#
# Reads `processed/moon_thin.parquet` and the two part files (`part_albedo_ice`, `part_minerals_sun_caves`), writes
# `processed/moon.parquet` (the 26 contract columns). A missing part leaves its columns null. The thin slice is never
# overwritten, so running it again does not wipe the merged columns.
#
# Surface type uses Job 1's `surface_fractions()` with cuts from the Moon's own ATI ranks (ATI depends on day length
# and measuring time, so one set of cuts does not fit all bodies). `analog_ok` is true everywhere (contract).
#
# Before you run: copy `src/merge_body.py` and `src/surface_fractions.py` (Job 1, PR #3) to `analog-finder/code/` on Drive.

# %%
from pathlib import Path
import sys
import numpy as np
import pandas as pd
from google.colab import drive

drive.mount("/content/drive")
ROOT = Path("/content/drive/MyDrive/analog-finder")
RAW = ROOT / "raw" / "moon"
OUT = ROOT / "processed"
sys.path.insert(0, str(ROOT / "code"))
import merge_body as mb

# %%
thin = pd.read_parquet(OUT / "moon_thin.parquet")
parts = {n: (pd.read_parquet(RAW / n) if (RAW / n).exists() else None) for n in mb.SPECS["moon"]["parts"]}
print({n: ("ok" if p is not None else "MISSING") for n, p in parts.items()})
df = mb.merge_parts("moon", thin, parts)
mb.check_contract("moon", df)
df.to_parquet(OUT / "moon.parquet", index=False)
df.notna().mean().round(3)     # share of cells with data, per column

# %% [markdown]
# ## Quick-look maps and sanity checks
# A check is skipped, with a message, if a value there is null.

# %%
import matplotlib.pyplot as plt


def at(lat, lon, col):
    i = (df["lat"] - lat).abs().add((df["lon"] - lon).abs()).idxmin()
    return df.loc[i, col]


def check(label, a, b, ok):
    if pd.isna(a) or pd.isna(b):
        print("SKIPPED (null value):", label)
        return
    assert ok(a, b), f"{label}: {a} vs {b}"
    print("ok:", label)


check("hot lunar equator by day", at(0, 0, "t_day_k"), at(85, 0, "t_day_k"), lambda a, b: a > b)
check("cold lunar poles at night", at(85, 0, "t_night_k"), at(0, 0, "t_night_k"), lambda a, b: a < b + 0.1)
check("more sunlight at the equator than the pole", at(0, 0, "sun_wm2"), at(85, 0, "sun_wm2"), lambda a, b: a > b)
polar_ice = df.loc[df["lat"] < -80, "ice_prob"].max()
equator_ice = df.loc[df["lat"].abs() < 30, "ice_prob"].max()
check("ice near the south pole, none at the equator", polar_ice, equator_ice, lambda a, b: a > b)

maps = {"t_day_k": "t_day_k", "t_night_k": "t_night_k", "ice_prob": "ice_prob", "sun_wm2": "sun_wm2"}
fig, axes = plt.subplots(2, 2, figsize=(16, 8))
for ax, (name, col) in zip(axes.ravel(), maps.items()):
    im = ax.imshow(df[col].to_numpy(dtype="float64").reshape(mb.NROWS, mb.NCOLS), extent=(-180, 180, -90, 90))
    ax.set_title(name)
    fig.colorbar(im, ax=ax, shrink=0.8)
fig.savefig(OUT / "quicklook_moon.png", dpi=100, bbox_inches="tight")
