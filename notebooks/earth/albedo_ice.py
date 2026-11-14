# %% [markdown]
# # Job 1 part: albedo, ATI and ice probability
#
# Output: `analog-finder/raw/earth/part_albedo_ice.parquet`
# Columns: `cell_id, albedo, ati, ice_prob`. Missing = null. No 0-fill.
#
# Inputs (exact products):
# 1. Albedo: MODIS **MCD43C3 v061** (0.05 deg CMG), layer `Albedo_WSA_shortwave` (scale 0.001, fill 32767).
# 2. Snow: MODIS/Terra **MOD10C1 v061** (daily, 0.05 deg CMG), layer `Day_CMG_Snow_Cover` (percent, fill 255, checked on a real granule). CMR version string is `61`.
# 3. Permafrost: **ESA Permafrost CCI v5.0** (`fv05.0`) permafrost extent, NetCDF, variable `PFR` (percent), 1 km, from CEDA.
# 4. Ice sheets: MODIS **MCD12C1 v061**, layer `Majority_Land_Cover_Type_1` (IGBP), class 15 = permanent snow and ice (layer name checked on a real granule).
# 5. `t_day_k`, `t_night_k` from `processed/earth.parquet` (thin-slice notebook). Run that notebook first.
#
# Before you run:
# 1. You need a free NASA Earthdata login: https://urs.earthdata.nasa.gov/users/new
# 2. The login prompt appears in the albedo step. Do not save the login in the notebook.
# 3. The permafrost step needs the CEDA files in `raw/earth/permafrost/` (see that step).

# %%
%pip -q install earthaccess pyhdf pyarrow netCDF4

# %%
from pathlib import Path
from google.colab import drive

drive.mount("/content/drive")
ROOT = Path("/content/drive/MyDrive/analog-finder")
RAW = ROOT / "raw" / "earth"
OUT = ROOT / "processed"
for p in (RAW, OUT):
    p.mkdir(parents=True, exist_ok=True)

CELL = 0.25                      # grid size in degrees (shared contract)
NROWS, NCOLS = 720, 1440
YEAR = 2023                      # same year as the thin-slice temperature
# One day per month: albedo and snow are sampled on these days.
DAYS = [f"{YEAR}-{m:02d}-15" for m in range(1, 13)]
LC_YEAR = 2023                   # MCD12C1 annual land cover (ice-sheet mask)

# %% [markdown]
# ## 1. Pure functions (no network)

# %%
import numpy as np


def block_mean(a, factor=5):
    """Mean of each factor x factor block, ignoring NaN. 0.05 deg -> 0.25 deg.
    Input shape (NROWS*factor, NCOLS*factor). Output shape (NROWS, NCOLS).
    A block with no valid pixel gives NaN."""
    a = np.asarray(a, dtype="float64")
    assert a.shape == (NROWS * factor, NCOLS * factor), a.shape
    blocks = a.reshape(NROWS, factor, NCOLS, factor)
    n = (~np.isnan(blocks)).sum(axis=(1, 3))
    s = np.nansum(blocks, axis=(1, 3))
    return np.where(n > 0, s / np.maximum(n, 1), np.nan)


def bin_to_cells(values, lat, lon):
    """Mean of a regular lat/lon raster (1D lat, 1D lon, any resolution)
    in each 0.25 deg cell, ignoring NaN. Returns (NROWS, NCOLS); NaN where empty."""
    values = np.asarray(values, dtype="float64")
    lat = np.asarray(lat, dtype="float64")
    lon = np.asarray(lon, dtype="float64")
    assert values.shape == (lat.size, lon.size), (values.shape, lat.size, lon.size)
    row = np.floor((90.0 - lat) / CELL).astype("int64")
    col = np.floor((lon + 180.0) / CELL).astype("int64")
    rok = (row >= 0) & (row < NROWS)
    cok = (col >= 0) & (col < NCOLS)
    sub = values[np.ix_(rok, cok)]
    flat = (row[rok][:, None] * NCOLS + col[cok][None, :]).ravel()
    ok = ~np.isnan(sub.ravel())
    flat = flat[ok]
    s = np.bincount(flat, weights=sub.ravel()[ok], minlength=NROWS * NCOLS)
    n = np.bincount(flat, minlength=NROWS * NCOLS)
    return np.where(n > 0, s / np.maximum(n, 1), np.nan).reshape(NROWS, NCOLS)


def compute_ati(albedo, t_day_k, t_night_k):
    """ati = (1 - albedo) / (t_day_k - t_night_k). NaN if any input is NaN
    or the swing is <= 0."""
    albedo = np.asarray(albedo, dtype="float64")
    swing = np.asarray(t_day_k, dtype="float64") - np.asarray(t_night_k, dtype="float64")
    good = np.isfinite(albedo) & np.isfinite(swing) & (swing > 0)
    out = np.full(swing.shape, np.nan)
    np.divide(1.0 - albedo, swing, out=out, where=good)
    return out


def combine_ice(permafrost, snow, ice_sheet):
    """ice_prob = max(permafrost, snow), ignoring a missing one.
    NaN only when both are missing. ice_sheet (bool) forces 1.
    permafrost and snow are fractions 0-1."""
    permafrost = np.asarray(permafrost, dtype="float64")
    snow = np.asarray(snow, dtype="float64")
    ice_sheet = np.asarray(ice_sheet, dtype=bool)
    both_nan = np.isnan(permafrost) & np.isnan(snow)
    m = np.fmax(permafrost, snow)          # fmax ignores a single NaN
    m = np.where(both_nan, np.nan, np.clip(m, 0.0, 1.0))
    return np.where(ice_sheet, 1.0, m)


# %% [markdown]
# ## 2. Grid and thin-slice temperature

# %%
import pandas as pd

earth = pd.read_parquet(OUT / "earth.parquet", columns=["cell_id", "t_day_k", "t_night_k"])
assert len(earth) == NROWS * NCOLS, len(earth)
earth = earth.sort_values("cell_id").reset_index(drop=True)
assert (earth["cell_id"].to_numpy() == np.arange(NROWS * NCOLS)).all()

# %% [markdown]
# ## 3. Albedo (MODIS MCD43C3 v061, layer `Albedo_WSA_shortwave`)
# White-sky shortwave albedo, 12 days (15th of each month), mean per 0.25 deg cell.

# %%
import earthaccess
from pyhdf.SD import SD, SDC

earthaccess.login()   # asks for your Earthdata login


def find_one_per_day(short_name, version, days):
    files = []
    for d in days:
        g = earthaccess.search_data(short_name=short_name, version=version, temporal=(d, d))
        assert len(g) >= 1, f"No {short_name} granule for {d}"
        files += earthaccess.download(g[:1], str(RAW / short_name.lower()))
    return files


def read_sds(path, layer):
    sds = SD(str(path), SDC.READ).select(layer)
    return sds[:], sds.attributes()


alb_files = find_one_per_day("MCD43C3", "061", DAYS)
stack = []
for f in alb_files:
    raw, attr = read_sds(f, "Albedo_WSA_shortwave")
    assert raw.shape == (3600, 7200), raw.shape
    a = raw.astype("float64") * 0.001            # scale 0.001
    a[(raw < 0) | (raw > 1000)] = np.nan   # fill 32767 and anything above albedo 1.0
    stack.append(a)
alb_005 = np.nanmean(np.stack(stack), axis=0)     # long-term mean at 0.05 deg
albedo = block_mean(alb_005).ravel()
print("albedo valid cells:", np.isfinite(albedo).sum(), "range:", np.nanmin(albedo), np.nanmax(albedo))
assert np.nanmin(albedo) >= 0 and np.nanmax(albedo) <= 1

# %% [markdown]
# ## 4. ATI

# %%
ati = compute_ati(albedo, earth["t_day_k"].to_numpy(), earth["t_night_k"].to_numpy())
print("ati valid cells:", np.isfinite(ati).sum())

# %% [markdown]
# ## 5. Snow fraction (MODIS MOD10C1 v061, layer `Day_CMG_Snow_Cover`)
# Layer `Day_CMG_Snow_Cover` checked on a real granule: valid 0-100 percent, fill 255.
# Check with `SD(file).datasets()` on the first file. Snow fraction = mean over the 12 days / 100.

# %%
snow_files = find_one_per_day("MOD10C1", "61", DAYS)   # CMR version string is "61", not "061" (checked)
sstack = []
for f in snow_files:
    raw, attr = read_sds(f, "Day_CMG_Snow_Cover")
    assert raw.shape == (3600, 7200), raw.shape
    s = raw.astype("float64")
    s[(s < 0) | (s > 100)] = np.nan               # codes above 100 are not snow percent
    sstack.append(s / 100.0)
snow_005 = np.nanmean(np.stack(sstack), axis=0)
snow = block_mean(snow_005).ravel()
print("snow valid cells:", np.isfinite(snow).sum())

# %% [markdown]
# ## 6. Permafrost (ESA Permafrost CCI v5.0, variable `PFR`)
# Download these files by hand (free, no login) into `raw/earth/permafrost/`. One annual file is enough.
# Use the Case A file of 2023 (MODISLST_CRYOGRID):
# 1. Northern Hemisphere: `ESACCI-PERMAFROST-L4-PFR-MODISLST_CRYOGRID-AREA4_PP-2023-fv05.0.nc`
#    from https://data.ceda.ac.uk/neodc/esacci/permafrost/data/permafrost_extent/L4/area4/pp/v05.0/northern_hemisphere/
#    (the year in the file name is UNVERIFIED; the page shows `****`).
# 2. Antarctica: same pattern under `.../v05.0/antarctica/` (UNVERIFIED folder and file name).
#    Antarctica is optional here: the ice-sheet mask sets the ice sheet to 1.
# `PFR` is percent (0-100). The notebook does not guess the grid: it asserts 1D `lat` and `lon`.

# %%
import xarray as xr

PF_DIR = RAW / "permafrost"
pf_files = sorted(PF_DIR.glob("ESACCI-PERMAFROST-L4-PFR-*.nc"))
assert pf_files, f"Put the CEDA PFR files in {PF_DIR}"

perm = np.full((NROWS, NCOLS), np.nan)
for f in pf_files:
    ds = xr.open_dataset(f)
    assert "PFR" in ds, list(ds.variables)
    pfr = ds["PFR"]
    if "time" in pfr.dims:
        pfr = pfr.isel(time=0)
    assert pfr.dims == ("lat", "lon") or pfr.dims == ("latitude", "longitude"), pfr.dims
    v = pfr.values.astype("float64")
    v[(v < 0) | (v > 100)] = np.nan
    la = ds[pfr.dims[0]].values
    lo = ds[pfr.dims[1]].values
    part = bin_to_cells(v / 100.0, la, lo)
    perm = np.where(np.isnan(perm), part, perm)   # first file wins where both have data
permafrost = perm.ravel()
print("permafrost valid cells:", np.isfinite(permafrost).sum())

# %% [markdown]
# ## 7. Ice-sheet mask (MODIS MCD12C1 v061, layer `Majority_Land_Cover_Type_1`)
# Layer name checked on a real granule (valid range 0-16). IGBP class 15 = permanent snow and ice. A cell is ice sheet when
# more than half of its 25 pixels are class 15. This covers Antarctica and Greenland.

# %%
lc_files = find_one_per_day("MCD12C1", "061", [f"{LC_YEAR}-01-01"])
raw, attr = read_sds(lc_files[0], "Majority_Land_Cover_Type_1")
assert raw.shape == (3600, 7200), raw.shape
is_ice_005 = np.where(raw == 15, 1.0, 0.0)
ice_sheet = (block_mean(is_ice_005) > 0.5).ravel()
print("ice-sheet cells:", ice_sheet.sum())

# %% [markdown]
# ## 8. Combine and save

# %%
ice_prob = combine_ice(permafrost, snow, ice_sheet)
part = pd.DataFrame({
    "cell_id": np.arange(NROWS * NCOLS),
    "albedo": albedo,
    "ati": ati,
    "ice_prob": ice_prob,
})
assert len(part) == NROWS * NCOLS
assert part["ice_prob"].dropna().between(0, 1).all()
assert part["albedo"].dropna().between(0, 1).all()
part.to_parquet(RAW / "part_albedo_ice.parquet", index=False)
print(part.describe())
