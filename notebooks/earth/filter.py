# %% [markdown]
# # Job 1, task 10: `analog_ok` filter and `cave_km`
#
# Output: `analog-finder/raw/earth/part_filter.parquet` with `cell_id, analog_ok, cave_km`.
#
# Inputs (all MODIS Collection 6.1, 0.05 deg Climate Modeling Grid, 3600 x 7200, HDF4):
#
# | Input | Product, version | Layer | Missing / notes |
# | --- | --- | --- | --- |
# | Land fraction | MOD11C3 v061 | `Percent_land_in_grid` (uint8, 0-100) | fill 0, valid 1-100 (checked on a real granule); 0 = ocean/fill, counted as not land |
# | NDVI | MOD13C2 v061 (12 months of 2023) | `CMG 0.05 Deg Monthly NDVI` (int16, scale 0.0001) | fill -3000, valid -2000..10000 |
# | Land cover | MCD12C1 v061 (year 2023) | `Majority_Land_Cover_Type_1` (uint8, IGBP) | fill 255; urban class = 13 (IGBP), snow/ice = 15, barren = 16 |
#
# Rule: `analog_ok = land_pct > 50 and ndvi_mean < 0.3 and not urban`.
# - NDVI: mean of the 12 monthly values per 0.05 deg pixel (ignoring fill), then mean of each 5 x 5 block.
# - Land fraction: mean of each 5 x 5 block of `Percent_land_in_grid`.
# - Urban (finer grid to 0.25 deg cell): the cell is urban if at least 20% of its valid 0.05 deg pixels (5 x 5 block) have class 13. One small town in a 28 km cell does not remove it (for example Calama in the Atacama). If all 25 pixels are fill (255), urban is missing.
# - Snow/ice (class 15) and barren (class 16) cells skip the NDVI test: MODIS NDVI is often missing over ice, and polar sites would otherwise drop out. A cell counts as snow/ice or barren when at least 50% of its valid pixels are class 15 or 16.
# - False when a known input already fails (ocean, too green, urban). Null when nothing known fails but an input is missing.
# - `cave_km` is null on Earth.

# %%
%pip -q install earthaccess pyhdf pyarrow

# %%
from pathlib import Path
from google.colab import drive

drive.mount("/content/drive")
ROOT = Path("/content/drive/MyDrive/analog-finder")
RAW = ROOT / "raw" / "earth"
OUT = ROOT / "processed"
for p in (RAW, OUT):
    p.mkdir(parents=True, exist_ok=True)

CELL = 0.25
NROWS, NCOLS = 720, 1440
PERIOD = ("2023-01-01", "2023-12-31")
URBAN_CLASS = 13        # IGBP "Urban and Built-up Lands" in Majority_Land_Cover_Type_1
URBAN_MIN_FRAC = 0.2    # share of valid pixels in the cell that must be urban
BARE_CLASSES = (15, 16) # IGBP snow/ice and barren
BARE_MIN_FRAC = 0.5
LAND_MIN_PCT = 50
NDVI_MAX = 0.3

# %% [markdown]
# ## 1. Pure rule functions (tested locally on synthetic data)

# %%
import numpy as np
import pandas as pd


def block_mean(a):
    # 3600 x 7200 (0.05 deg) -> 720 x 1440 (0.25 deg), mean of 5x5 blocks ignoring NaN.
    assert a.shape == (NROWS * 5, NCOLS * 5), a.shape
    b = a.reshape(NROWS, 5, NCOLS, 5)
    n = (~np.isnan(b)).sum(axis=(1, 3))
    s = np.nansum(b, axis=(1, 3))
    return np.where(n > 0, s / np.maximum(n, 1), np.nan)


def block_class_frac(lc, classes, min_frac, fill=255):
    # Share of the valid 0.05 deg pixels of each 5x5 block that are in `classes`.
    # Returns 1.0 when the share >= min_frac, else 0.0; NaN when all 25 pixels are fill.
    assert lc.shape == (NROWS * 5, NCOLS * 5), lc.shape
    b = lc.reshape(NROWS, 5, NCOLS, 5)
    n_valid = (b != fill).sum(axis=(1, 3))
    n_in = np.isin(b, classes).sum(axis=(1, 3))
    frac = n_in / np.maximum(n_valid, 1)
    return np.where(n_valid > 0, (frac >= min_frac).astype("float64"), np.nan)


def block_urban(lc, urban_class=URBAN_CLASS, min_frac=URBAN_MIN_FRAC, fill=255):
    return block_class_frac(lc, [urban_class], min_frac, fill)


def analog_rule(land_pct, ndvi, urban, bare):
    # Inputs: float arrays (same shape), NaN = missing. urban and bare are 1.0 / 0.0 / NaN.
    # Returns object array of True / False / None.
    # False: some known input already fails (ocean, too green, urban), even if another is missing.
    # None: nothing known fails, but an input is missing. True: all inputs known and pass.
    # Snow/ice and barren cells (bare == 1) skip the NDVI test, so a missing NDVI over ice is not a gap.
    land_pct, ndvi, urban, bare = (np.asarray(x, dtype="float64") for x in (land_pct, ndvi, urban, bare))
    skip_ndvi = bare == 1
    with np.errstate(invalid="ignore"):
        fail = (land_pct <= LAND_MIN_PCT) | ((ndvi >= NDVI_MAX) & ~skip_ndvi) | (urban == 1)
    missing = np.isnan(land_pct) | (np.isnan(ndvi) & ~skip_ndvi) | np.isnan(urban)
    out = np.full(land_pct.shape, True, dtype=object)
    out[missing] = None
    out[fail] = False
    return out


# %% [markdown]
# ## 2. Download and read (needs Earthdata login; not tested locally)

# %%
import earthaccess
from pyhdf.SD import SD, SDC

earthaccess.login()   # asks for your Earthdata login; never save it here


def search(short_name, temporal):
    g = earthaccess.search_data(short_name=short_name, version="061", temporal=temporal)
    return g


def read_sds(path, layer):
    return SD(str(path), SDC.READ).select(layer)[:]


# %%
g_lst = search("MOD11C3", PERIOD)
g_ndvi = search("MOD13C2", PERIOD)
g_lc = search("MCD12C1", PERIOD)
assert len(g_lst) >= 1 and len(g_ndvi) >= 12 and len(g_lc) >= 1, (len(g_lst), len(g_ndvi), len(g_lc))
f_lst = earthaccess.download(g_lst, str(RAW / "mod11c3"))
f_ndvi = earthaccess.download(g_ndvi, str(RAW / "mod13c2"))
f_lc = earthaccess.download(g_lc, str(RAW / "mcd12c1"))

# %%
# Land fraction: read from the first MOD11C3 file only (it is a static layer, the same in every month).
land = read_sds(f_lst[0], "Percent_land_in_grid").astype("float64")
land[land > 100] = np.nan
land_pct = block_mean(land)

# NDVI: long-term mean of 12 months, fill -3000 and out-of-range -> NaN.
tot = np.zeros((3600, 7200))
cnt = np.zeros((3600, 7200), dtype="int16")
for f in f_ndvi:
    a = read_sds(f, "CMG 0.05 Deg Monthly NDVI").astype("float64")
    ok = (a >= -2000) & (a <= 10000)
    tot[ok] += a[ok] * 0.0001
    cnt += ok
ndvi = block_mean(np.where(cnt > 0, tot / np.maximum(cnt, 1), np.nan))

# Land cover (IGBP majority class).
lc = read_sds(f_lc[0], "Majority_Land_Cover_Type_1")
urban = block_urban(lc)
bare = block_class_frac(lc, BARE_CLASSES, BARE_MIN_FRAC)

# %% [markdown]
# ## 3. Save

# %%
ok = analog_rule(land_pct.ravel(), ndvi.ravel(), urban.ravel(), bare.ravel())
part = pd.DataFrame({
    "cell_id": np.arange(NROWS * NCOLS),
    "analog_ok": pd.array(ok, dtype="boolean"),
    "cave_km": np.full(NROWS * NCOLS, np.nan),
})
part.to_parquet(RAW / "part_filter.parquet", index=False)
print(part["analog_ok"].value_counts(dropna=False))
