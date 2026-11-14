# %% [markdown]
# # Job 1 part: albedo, ATI and ice probability
#
# Output: `analog-finder/raw/earth/part_albedo_ice.parquet`
# Columns: `cell_id, albedo, ati, ice_prob, ice_surface`. Missing = null. No 0-fill.
# `ice_prob` (permafrost, snow, ice sheets) is the scored ice factor. `ice_surface` (snow and ice sheets only, no permafrost) feeds the surface-type fractions, so buried ice is not counted twice.
#
# Inputs (exact products):
# 1. Albedo: MODIS **MCD43C3 v061** (0.05 deg CMG), layer `Albedo_WSA_shortwave` (scale 0.001, fill 32767).
# 2. Snow: MODIS/Terra **MOD10CM** monthly snow cover (0.05 deg CMG, CMR version string `61`), layer `Snow_Cover_Monthly_CMG` (percent 0-100, fill 255, checked on a real granule). One file per month, so a cloudy day does not count as no snow.
# 3. Permafrost: **ESA Permafrost CCI v5.0** (`fv05.0`) permafrost extent, NetCDF, variable `PFR` (percent, fill 255), from CEDA. Checked on the real 2023 files: a plain WGS 84 lat/lon grid at 0.01 deg (NH 25-85 N, Antarctica 85-60 S), no reprojection needed. The notebook downloads both files (12 MB and 0.5 MB).
# 4. Ice sheets: MODIS **MCD12C1 v061**, layer `Majority_Land_Cover_Type_1` (IGBP), class 15 = permanent snow and ice (layer name checked on a real granule).
# 5. `t_day_k`, `t_night_k` from `processed/earth_thin.parquet` (thin-slice notebook). Run that notebook first.
#
# Before you run:
# 1. You need a free NASA Earthdata login: https://urs.earthdata.nasa.gov/users/new
# 2. The login prompt appears in the albedo step. Do not save the login in the notebook.
# 3. The permafrost step downloads its two files from CEDA (free, no login).

# %%
%pip -q install earthaccess pyhdf pyarrow netCDF4 xarray requests

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

earth = pd.read_parquet(OUT / "earth_thin.parquet", columns=["cell_id", "t_day_k", "t_night_k"])
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
# ## 5. Snow fraction (MODIS MOD10CM monthly, layer `Snow_Cover_Monthly_CMG`)
# Valid 0-100 percent, fill 255 (checked on a real granule). Snow fraction = mean of the 12 monthly values / 100.

# %%
g_snow = earthaccess.search_data(short_name="MOD10CM", version="61", temporal=(f"{YEAR}-01-01", f"{YEAR}-12-31"))
assert len(g_snow) >= 12, f"Expected 12 monthly snow files, found {len(g_snow)}"
snow_files = earthaccess.download(g_snow, str(RAW / "mod10cm"))
sstack = []
for f in snow_files:
    raw, attr = read_sds(f, "Snow_Cover_Monthly_CMG")
    assert raw.shape == (3600, 7200), raw.shape
    s = raw.astype("float64")
    s[(s < 0) | (s > 100)] = np.nan               # codes above 100 are not snow percent
    sstack.append(s / 100.0)
snow_005 = np.nanmean(np.stack(sstack), axis=0)
snow = block_mean(snow_005).ravel()
print("snow valid cells:", np.isfinite(snow).sum())

# %% [markdown]
# ## 6. Permafrost (ESA Permafrost CCI v5.0, variable `PFR`)
# Two annual files for 2023 (MODISLST_CRYOGRID), free, no login. Both are WGS 84 lat/lon at 0.01 deg (checked).
# `PFR` is percent (0-100), fill 255. The 0.01 deg grid lines up with the 0.25 deg cells (25 rows and 25 columns each),
# so the notebook bins it in chunks of 500 rows to keep memory low.

# %%
import hashlib
import requests
import xarray as xr

PF_BASE = "https://data.ceda.ac.uk/neodc/esacci/permafrost/data/permafrost_extent/L4/area4/pp/v05.0/"
PF_FILES = {   # local name -> (url path, max bytes, SHA-256 of the file checked on 2026-11-14)
    "nh2023.nc": ("northern_hemisphere/2023/ESACCI-PERMAFROST-L4-PFR-MODISLST_CRYOGRID-AREA4_PP-2023-fv05.0.nc", 50_000_000,
                  "be024ac8fda10f124932122271d4c41ba2685a0bb1b3c4768866ad382dc50f36"),
    "ant2023.nc": ("Antarctica/2023/ESACCI-PERMAFROST-L4-PFR-MODISLST_CRYOGRID-AREA27_PP-2023-fv05.0.nc", 10_000_000,
                   "7d482e56dd6ef4fba10f197bb15b6e72dea611099078098c85a3a76c6f89554b"),
}
PF_DIR = RAW / "permafrost"
PF_DIR.mkdir(parents=True, exist_ok=True)
for local, (path, max_bytes, sha256) in PF_FILES.items():
    if not (PF_DIR / local).exists():
        r = requests.get(PF_BASE + path + "?download=1", timeout=300, stream=True)
        r.raise_for_status()
        buf = bytearray()
        for chunk in r.iter_content(1 << 20):          # stop at the size cap, do not read the whole body first
            buf += chunk
            assert len(buf) <= max_bytes, f"{local} is larger than {max_bytes} bytes"
        assert hashlib.sha256(buf).hexdigest() == sha256, f"{local} changed: check the download"
        (PF_DIR / local).write_bytes(bytes(buf))

perm = np.full((NROWS, NCOLS), np.nan)
for local in PF_FILES:
    ds = xr.open_dataset(PF_DIR / local)
    pfr = ds["PFR"].isel(time=0)
    assert pfr.dims == ("lat", "lon"), pfr.dims
    la, lo = ds["lat"].values, ds["lon"].values
    # The chunks only work when the pixel edges sit on the 0.25 deg cell edges (25 pixels per cell).
    for axis, offset in ((la, 90.0), (lo, 180.0)):
        edge = (axis[0] - (axis[1] - axis[0]) / 2 + offset) / CELL
        assert abs(edge - round(edge)) < 0.05, f"{local}: the grid does not start on a 0.25 deg cell edge"
    for r0 in range(0, la.size, 500):                  # 500 rows = 20 cells, so no cell is split
        v = pfr.isel(lat=slice(r0, r0 + 500)).values.astype("float64")
        v[(v < 0) | (v > 100)] = np.nan                # fill 255
        part = bin_to_cells(v / 100.0, la[r0:r0 + 500], lo)
        perm = np.where(np.isnan(perm), part, perm)
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
ice_surface = combine_ice(np.full_like(snow, np.nan), snow, ice_sheet)   # snow and ice sheets only, no permafrost
part = pd.DataFrame({
    "cell_id": np.arange(NROWS * NCOLS),
    "albedo": albedo,
    "ati": ati,
    "ice_prob": ice_prob,
    "ice_surface": ice_surface,
})
assert len(part) == NROWS * NCOLS
assert part["ice_prob"].dropna().between(0, 1).all() and part["ice_surface"].dropna().between(0, 1).all()
assert part["albedo"].dropna().between(0, 1).all()
part.to_parquet(RAW / "part_albedo_ice.parquet", index=False)
print(part.describe())
