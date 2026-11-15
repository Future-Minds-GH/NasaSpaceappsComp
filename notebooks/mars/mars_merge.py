# %% [markdown]
# # Job 2: merge the Mars parts into `mars.parquet`
#
# Reads `processed/mars_thin.parquet` and the three part files (`part_sun_albedo_caves`, `part_ice`, `part_minerals`),
# writes `processed/mars.parquet` (the 26 contract columns). A missing part leaves its columns null. The thin slice is
# never overwritten, so running it again does not wipe the merged columns.
#
# Surface type uses Job 1's `surface_fractions()` with cuts from Mars's own ATI ranks (ATI depends on day length and
# measuring time, so one set of cuts does not fit all bodies). `analog_ok` is true everywhere (contract).
# All six mineral classes come from the TES cube, so a covered cell has all six (they sum to 1) and an uncovered cell has
# none. A partly null mix would count as missing in the matcher.
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
RAW = ROOT / "raw" / "mars"
OUT = ROOT / "processed"
sys.path.insert(0, str(ROOT / "code"))
import merge_body as mb

# %%
thin = pd.read_parquet(OUT / "mars_thin.parquet")
parts = {n: (pd.read_parquet(RAW / n) if (RAW / n).exists() else None) for n in mb.SPECS["mars"]["parts"]}
print({n: ("ok" if p is not None else "MISSING") for n, p in parts.items()})
df = mb.merge_parts("mars", thin, parts)
mb.check_contract("mars", df)
df.to_parquet(OUT / "mars.parquet", index=False)
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


check("Olympus Mons higher than the Hellas basin", at(18.6, -133.8, "elev_m"), at(-42.4, 70.5, "elev_m"), lambda a, b: a > b)
check("warm equator by day", at(0, 0, "t_day_k"), at(80, 0, "t_day_k"), lambda a, b: a > b)
polar_ice = df.loc[df["lat"] > 80, "ice_prob"].max()
equator_ice = df.loc[df["lat"].abs() < 20, "ice_prob"].mean()
check("ice at the Martian pole, less at the equator", polar_ice, equator_ice, lambda a, b: a > b)
check("polar cap is surface ice", df.loc[df["lat"] > 85, "surf_ice"].max(), 0.5, lambda a, b: a > b)

maps = {"t_day_k": "t_day_k", "elev_m": "elev_m", "ice_prob": "ice_prob", "sun_wm2": "sun_wm2"}
fig, axes = plt.subplots(2, 2, figsize=(16, 8))
for ax, (name, col) in zip(axes.ravel(), maps.items()):
    im = ax.imshow(df[col].to_numpy(dtype="float64").reshape(mb.NROWS, mb.NCOLS), extent=(-180, 180, -90, 90))
    ax.set_title(name)
    fig.colorbar(im, ax=ax, shrink=0.8)
fig.savefig(OUT / "quicklook_mars.png", dpi=100, bbox_inches="tight")
