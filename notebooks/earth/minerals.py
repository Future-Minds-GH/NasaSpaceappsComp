# %% [markdown]
# # Job 1 part: minerals (EMIT global map + GLiM) -> six `min_*` fractions
#
# Output: `analog-finder/raw/earth/part_minerals.parquet` with
# `cell_id, min_mafic, min_feldspathic, min_ironox, min_sulfate, min_clay, min_carbonate`.
# The six fractions sum to 1 in a cell, or all six are null. No 0-fill for a missing cell.
#
# ## Sources
# * **EMIT L3 aggregated mineral spectral abundance, EMITL3ASA v002**: one ready-made file, 0.5 deg grid,
#   lat 55 to -54.5, lon -165 to 179.5, 11 baseline layers (fill -9999, about 9% of cells valid: arid regions).
#   It is built from the EMIT L2B mineral IDs, so no per-swath download is needed (about 22 MB).
# * **GLiM v1.0** (Hartmann and Moosdorf 2012), 0.5 deg first-level rock classes. **This is approximate**: a rock-type
#   map, not a mineral map.
#
# ## Classes
# | EMIT layer | Class |
# | --- | --- |
# | Hematite, Goethite | `min_ironox` |
# | Gypsum | `min_sulfate` |
# | Kaolinite, Montmorillonite, Illite+Muscovite, Chlorite, Vermiculite | `min_clay` |
# | Calcite, Dolomite | `min_carbonate` |
# | Quartz+Feldspar | not used (not one of the six classes) |
#
# | GLiM class | Class |
# | --- | --- |
# | `vb` basic volcanic, `pb` basic plutonic | `min_mafic` |
# | `pa` acid plutonic | `min_feldspathic` |
#
# ## How EMIT and GLiM combine
# * Cell with EMIT data (the four class abundances add up to more than 0): the four EMIT shares sum to 1. If GLiM says mafic or feldspathic there, that rock class gets `GLIM_WEIGHT` (0.5) and the EMIT shares share the rest.
# * Cell without EMIT data (outside the arid regions, for example Hawaii and Iceland): GLiM alone fills it. `vb` or `pb` gives `min_mafic` = 1, `pa` gives `min_feldspathic` = 1. Other rock types stay null.
# * The shares are relative within each cell. EMIT only maps arid regions, so most humid cells with other rock types stay null.
#
# Before you run: you need a free NASA Earthdata login: https://urs.earthdata.nasa.gov/users/new

# %%
%pip -q install earthaccess h5py pyarrow requests

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
GLIM_WEIGHT = 0.5                # share of the GLiM rock class in a cell that also has EMIT data
GLIM_DIR = RAW / "glim"

CLASSES = ["min_ironox", "min_sulfate", "min_clay", "min_carbonate"]
EMIT_LAYER_TO_CLASS = {          # EMITL3ASA baseline layer names (checked on the real file)
    "Hematite": "min_ironox", "Goethite": "min_ironox",
    "Gypsum": "min_sulfate",
    "Kaolinite": "min_clay", "Montmorillonite": "min_clay", "Illite+Muscovite": "min_clay",
    "Chlorite": "min_clay", "Vermiculite": "min_clay",
    "Calcite": "min_carbonate", "Dolomite": "min_carbonate",
}
GLIM_MAFIC = ("vb", "pb")
GLIM_FELSIC = ("pa",)
OUT_COLS = ["min_mafic", "min_feldspathic", "min_ironox", "min_sulfate", "min_clay", "min_carbonate"]

# %% [markdown]
# ## 1. Pure functions (no network, tested locally)

# %%
import numpy as np
import pandas as pd

EMIT_FILL = -9999


def cell_centres():
    ids = np.arange(NROWS * NCOLS)
    rows, cols = np.divmod(ids, NCOLS)
    return 90 - CELL / 2 - rows * CELL, -180 + CELL / 2 + cols * CELL


def sample_to_cells(layer, lat, lon, fill=EMIT_FILL):
    """Value of a regular lat/lon raster (1D lat, 1D lon, any step) at each 0.25 deg cell centre.
    Nearest pixel. NaN where the pixel is fill or the cell is outside the raster."""
    layer = np.asarray(layer, dtype="float64")
    lat = np.asarray(lat, dtype="float64")
    lon = np.asarray(lon, dtype="float64")
    assert layer.shape == (lat.size, lon.size), (layer.shape, lat.size, lon.size)
    dlat, dlon = lat[1] - lat[0], lon[1] - lon[0]
    clat, clon = cell_centres()
    ri = np.rint((clat - lat[0]) / dlat).astype("int64")
    ci = np.rint((clon - lon[0]) / dlon).astype("int64")
    ok = (ri >= 0) & (ri < lat.size) & (ci >= 0) & (ci < lon.size)
    out = np.full(clat.shape, np.nan)
    v = layer[ri[ok], ci[ok]]
    v[v == fill] = np.nan
    out[ok] = v
    return out


def class_abundance(layer_values):
    """layer_values: {EMIT layer name: array of n cells, NaN = no data}.
    Returns a DataFrame (n x 4, columns CLASSES): the abundances of a class's layers added up.
    A class is NaN where all its layers are NaN."""
    n = len(next(iter(layer_values.values())))
    out = pd.DataFrame(np.nan, index=range(n), columns=CLASSES)
    for cls in CLASSES:
        stack = np.stack([layer_values[name] for name, c in EMIT_LAYER_TO_CLASS.items() if c == cls])
        out[cls] = np.where(np.isfinite(stack).any(axis=0), np.nansum(stack, axis=0), np.nan)
    return out


def emit_shares(abundance):
    """abundance: DataFrame (n x 4, CLASSES), NaN = no data. Returns an (n x 4) array of shares that
    sum to 1. All four are NaN when there is no data or the abundances add up to 0."""
    a = abundance[CLASSES].to_numpy(dtype="float64")
    total = np.nansum(a, axis=1)
    has = np.isfinite(a).any(axis=1) & (total > 0)
    out = np.full(a.shape, np.nan)
    out[has] = np.nan_to_num(a[has]) / total[has, None]
    return out


def combine(shares, glim_code, glim_weight=GLIM_WEIGHT):
    """shares: (n x 4) EMIT shares (NaN rows = no EMIT data). glim_code: n two-letter codes.
    Returns a DataFrame with OUT_COLS. See the rule at the top of the notebook."""
    n = shares.shape[0]
    code = np.asarray(glim_code)
    mafic = np.isin(code, GLIM_MAFIC)
    felsic = np.isin(code, GLIM_FELSIC)
    has_emit = np.isfinite(shares).all(axis=1)
    out = np.full((n, 6), np.nan)                       # mafic, feldspathic, then the four EMIT classes
    # EMIT cells: EMIT shares, scaled down when GLiM gives a rock class
    w = np.where(has_emit & (mafic | felsic), glim_weight, 0.0)
    out[has_emit, 2:] = shares[has_emit] * (1 - w[has_emit, None])
    out[has_emit, 0] = np.where(mafic[has_emit], w[has_emit], 0.0)
    out[has_emit, 1] = np.where(felsic[has_emit], w[has_emit], 0.0)
    # GLiM-only cells: the whole cell is the rock class, the other four are 0
    only = ~has_emit & (mafic | felsic)
    out[only, :] = 0.0
    out[only, 0] = np.where(mafic[only], 1.0, 0.0)
    out[only, 1] = np.where(felsic[only], 1.0, 0.0)
    return pd.DataFrame(out, columns=OUT_COLS)


def glim_to_cells(codes_05):
    """codes_05: 360 x 720 array of two-letter codes, north at the top. Returns a flat array
    (NROWS*NCOLS) at 0.25 deg: each 0.5 deg value is copied to its 2 x 2 cells."""
    assert codes_05.shape == (360, 720), codes_05.shape
    return np.repeat(np.repeat(codes_05, 2, axis=0), 2, axis=1).ravel()

# %% [markdown]
# ## 2. GLiM rock type (0.5 deg)
#
# The code downloads the zip and reads the legend from it. It stops if `vb` is not value 2, `pb` not 4 or `pa` not 9.

# %%
import hashlib
import io
import zipfile
import requests

# Checked against the real download (37.8 kB zip from the PANGAEA handle):
#   Classnames.txt  = ";"-separated table, columns Value_ and xx (two-letter code)
#   glim_wgs84_0point5deg.txt.asc = ESRI ASCII grid, 720 x 360, 0.5 deg, nodata -9999, row 0 = north
GLIM_URL = "https://hdl.handle.net/10013/epic.39939.d001"
GLIM_SHA256 = "43b4ce3276b155d804db8ff9fb227d620b4c35015a4cf564eac4d06d2b69d88e"   # of the zip checked on 2026-11-14
GLIM_DIR.mkdir(parents=True, exist_ok=True)
GLIM_ZIP = GLIM_DIR / "glim.zip"
if not GLIM_ZIP.exists():
    r = requests.get(GLIM_URL, timeout=120)
    r.raise_for_status()
    assert len(r.content) < 1_000_000, f"GLiM zip too large: {len(r.content)} bytes"
    assert hashlib.sha256(r.content).hexdigest() == GLIM_SHA256, "GLiM zip changed: check the download"
    GLIM_ZIP.write_bytes(r.content)
assert hashlib.sha256(GLIM_ZIP.read_bytes()).hexdigest() == GLIM_SHA256, "Cached GLiM zip changed: delete it and rerun"

with zipfile.ZipFile(GLIM_ZIP) as z:
    legend = pd.read_csv(io.BytesIO(z.read("Classnames.txt")), sep=";")
    asc = z.read("glim_wgs84_0point5deg.txt.asc").decode().splitlines()
assert asc[0].split()[1] == "720" and asc[1].split()[1] == "360", asc[:2]
GLIM_INT_TO_CODE = dict(zip(legend["Value_"].astype(int), legend["xx"]))
assert GLIM_INT_TO_CODE[2] == "vb" and GLIM_INT_TO_CODE[4] == "pb" and GLIM_INT_TO_CODE[9] == "pa", GLIM_INT_TO_CODE
glim_int = np.loadtxt(asc[6:], dtype="int32")
codes_05 = np.full(glim_int.shape, "nd", dtype="<U2")
for k, v in GLIM_INT_TO_CODE.items():
    codes_05[glim_int == k] = v
glim_code = glim_to_cells(codes_05)
print({c: int((codes_05 == c).sum()) for c in ("vb", "pb", "pa")}, "0.5 deg cells (vb, pb, pa)")

# %% [markdown]
# ## 3. EMIT L3 global map (EMITL3ASA v002, one granule, about 22 MB)

# %%
import earthaccess
import h5py

earthaccess.login()   # asks for your Earthdata login. Do not save it in the notebook.
found = earthaccess.search_data(short_name="EMITL3ASA", version="002", count=1)
assert len(found) == 1, f"Expected one EMITL3ASA granule, found {len(found)}"
emit_files = earthaccess.download(found, str(RAW / "emitl3asa"))
with h5py.File(str(emit_files[0]), "r") as h:
    lat, lon = h["lat"][:], h["lon"][:]
    layer_values = {name: sample_to_cells(h[name][:], lat, lon) for name in EMIT_LAYER_TO_CLASS}
abundance = class_abundance(layer_values)
print("cells with EMIT data:", int(np.isfinite(abundance[CLASSES].to_numpy()).any(axis=1).sum()))

# %% [markdown]
# ## 4. Combine and save

# %%
shares = emit_shares(abundance)
minerals = combine(shares, glim_code)
part = pd.concat([pd.DataFrame({"cell_id": np.arange(NROWS * NCOLS)}), minerals], axis=1)
sums = minerals.sum(axis=1, skipna=False).dropna()
assert np.allclose(sums, 1, atol=1e-6), "mineral fractions must sum to 1"
part.to_parquet(RAW / "part_minerals.parquet", index=False)
print(len(sums), "cells with minerals;", int(np.isfinite(shares).all(axis=1).sum()), "from EMIT")
print(part[OUT_COLS].describe().T)
