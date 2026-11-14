# %% [markdown]
# # Job 1, unit minerals: EMIT + GLiM -> six `min_*` fractions
#
# Output: `analog-finder/raw/earth/part_minerals.parquet`
# Columns: `cell_id, min_mafic, min_feldspathic, min_ironox, min_sulfate, min_clay, min_carbonate`.
#
# Before you run:
# 1. Create a free NASA Earthdata login: https://urs.earthdata.nasa.gov/users/new
# 2. GLiM (Hartmann and Moosdorf 2012, https://doi.pangaea.de/10.1594/PANGAEA.788537) downloads by itself into `RAW/glim/` in section 3.
# 3. Run the cells in order. `earthaccess.login()` asks for your login. Do not save it in the notebook.
# 4. EMIT downloads are heavy. Set `GRANULES_PER_DESERT` in section 1. The loop saves progress to Drive. If the session stops, run the cells again.
#
# ## How GLiM and EMIT combine (the rule)
#
# * EMIT gives four of the six classes (`min_ironox`, `min_sulfate`, `min_clay`, `min_carbonate`). For each 0.25 deg cell we count the EMIT pixels in each class. We divide by the total of the four counts. These are the EMIT shares.
# * GLiM gives `min_mafic` and `min_feldspathic`. **This is approximate.** GLiM is a rock-type map (0.5 deg), not a mineral map. Basic volcanic rock (`vb`) is treated as mafic. Acid plutonic rock (`pa`) is treated as feldspathic. All other rock types give no rock share.
# * If the cell is `vb` or `pa`, the rock class gets the weight `GLIM_WEIGHT` (default 0.5). The EMIT shares share the rest (`1 - GLIM_WEIGHT`). If the cell is any other rock type, the EMIT shares sum to 1.
# * A cell is "covered" by EMIT when it has at least `MIN_COVER_PIXELS` EMIT pixels. A covered cell with no detected class has no EMIT shares. If it is `vb` or `pa`, it gets 100% of that rock class. Otherwise it is null.
# * A cell not covered by EMIT is null in **all six** columns, even if GLiM has a rock type there. We do not mix a rock map into cells with no measured minerals.
# * Pixels counted are EMIT group 1 and group 2 detections with band depth at least `MIN_BAND_DEPTH`. Overlapping granules count a pixel twice. This is accepted for a shares map.

# %%
%pip -q install earthaccess xarray h5netcdf rasterio pyarrow

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

# %% [markdown]
# ## 1. Settings

# %%
# Bounding boxes: (west, south, east, north), degrees. Rough boxes: our choice, not an official definition.
DESERTS = {
    "atacama":   (-72.0, -30.0, -67.0, -17.0),
    "sahara":    (-17.0,  15.0,  35.0,  32.0),
    "arabia":    ( 35.0,  12.0,  60.0,  32.0),
    "iran":      ( 51.0,  25.0,  63.0,  37.0),
    "australia": (115.0, -32.0, 142.0, -20.0),
    "sw_usa":    (-120.0, 31.0, -105.0, 38.0),
    "taklamakan_gobi": (77.0, 36.0, 112.0, 46.0),
    "namib":     ( 11.0, -29.0,  17.0, -17.0),
}
GRANULES_PER_DESERT = 3      # default small so a first run finishes. Raise it for more cover.
MIN_BAND_DEPTH = 0.0         # keep detections with band depth >= this. Raise to be stricter.
MIN_COVER_PIXELS = 1000      # n_total = group_1 + group_2 pixel records in the cell (any mineral, above the depth filter).
                             # A pixel can count twice, so 1000 is about 500 real pixels. 60 m pixels: ~200k fit in a cell.
GLIM_WEIGHT = 0.5            # share given to the GLiM rock class in vb / pa cells

EMIT_SHORT_NAME, EMIT_VERSION = "EMITL2BMIN", "002"
CHECKPOINT = RAW / "minerals_emit_counts.parquet"   # one row per (granule, cell)
EMIT_TMP = Path("/content/emit_tmp")                # local disk, deleted after each granule
GLIM_DIR = RAW / "glim"

CLASSES = ["min_ironox", "min_sulfate", "min_clay", "min_carbonate"]
# EMIT names are long USGS library names, e.g. "fe3+_hematite.fine.gr.gds76", "carbonate_dolomite"
# (312 names, checked on a real granule). So we match by keyword, not by exact name.
KEYWORD_TO_CLASS = (
    ("hematite", "min_ironox"), ("goethite", "min_ironox"),
    ("gypsum", "min_sulfate"),
    ("kaolinite", "min_clay"), ("montmorillonite", "min_clay"), ("illite", "min_clay"),
    ("muscovite", "min_clay"), ("chlorite", "min_clay"), ("vermiculite", "min_clay"),
    ("calcite", "min_carbonate"), ("dolomite", "min_carbonate"),
)
GLIM_CLASS = {"vb": "min_mafic", "pa": "min_feldspathic"}   # basic volcanic, acid plutonic

# %% [markdown]
# ## 2. Pure functions (no network, tested locally on synthetic data)

# %%
# PURE
import numpy as np
import pandas as pd


def class_of_name(name):
    """Shared class for one EMIT library name, or None. Mixtures (a '+' left after removing the
    iron charge tokens fe2+/fe3+, or 'mix' in the name) and the WTC dust samples are skipped."""
    n = str(name).strip().lower().replace("fe2+", "fe2").replace("fe3+", "fe3")
    if "+" in n or "mix" in n or "wtc" in n:
        return None
    for key, cls in KEYWORD_TO_CLASS:
        if key in n:
            return cls
    return None


def class_index_from_names(names):
    """names: list of mineral names, position = mineral_id. Returns int array:
    -1 = not a core mineral, 0..3 = index in CLASSES."""
    out = np.full(len(names), -1, dtype="int8")
    for i, n in enumerate(names):
        cls = class_of_name(n)
        if cls is not None:
            out[i] = CLASSES.index(cls)
    return out


def map_pixels_to_classes(mineral_id, band_depth, id_to_class, min_depth):
    """Per-pixel class index (0..3) or -1. NaN or fill band depth, out-of-range id: -1."""
    mineral_id = np.asarray(mineral_id)
    ok = np.isfinite(band_depth) & (band_depth >= min_depth) & (mineral_id >= 0) & (mineral_id < len(id_to_class))
    out = np.full(mineral_id.shape, -1, dtype="int8")
    out[ok] = id_to_class[mineral_id[ok]]
    return out


def place_with_glt(sensor_values, glt_x, glt_y, fill=-1):
    """Put sensor-geometry pixels on the orthorectified grid. GLT values are 1-based
    sensor column (x) and row (y); 0 or negative = no data."""
    glt_x = np.asarray(glt_x)
    glt_y = np.asarray(glt_y)
    ok = (glt_x > 0) & (glt_y > 0)
    assert glt_x.shape == glt_y.shape
    assert glt_x[ok].max(initial=0) <= sensor_values.shape[1] and glt_y[ok].max(initial=0) <= sensor_values.shape[0]
    out = np.full(glt_x.shape, fill, dtype=sensor_values.dtype)
    out[ok] = sensor_values[glt_y[ok] - 1, glt_x[ok] - 1]
    return out, ok


def ortho_cell_ids(geotransform, shape):
    """cell_id of each pixel of an orthorectified grid. geotransform = (ulx, xres, 0, uly, 0, yres), yres < 0.
    Returns an int array; -1 for pixels outside the global grid."""
    ulx, xres, _, uly, _, yres = geotransform
    nrow, ncol = shape
    lon = ulx + (np.arange(ncol) + 0.5) * xres
    lat = uly + (np.arange(nrow) + 0.5) * yres
    col = np.floor((lon + 180.0) / CELL).astype("int64")
    row = np.floor((90.0 - lat) / CELL).astype("int64")
    ok_c = (col >= 0) & (col < NCOLS)
    ok_r = (row >= 0) & (row < NROWS)
    ids = row[:, None] * NCOLS + col[None, :]
    ids = np.where(ok_r[:, None] & ok_c[None, :], ids, -1)
    return ids


def count_pixels_per_cell(cell_ids, ortho_class, placed):
    """cell_ids, ortho_class, placed: same-shape arrays. Returns DataFrame
    cell_id, n_total (placed pixels), and one count per class in CLASSES."""
    cid = cell_ids[placed & (cell_ids >= 0)]
    cls = ortho_class[placed & (cell_ids >= 0)]
    df = pd.DataFrame({"cell_id": cid, "cls": cls})
    total = df.groupby("cell_id").size().rename("n_total")
    out = total.to_frame()
    for k, name in enumerate(CLASSES):
        out[name] = df[df["cls"] == k].groupby("cell_id").size()
    return out.fillna(0).astype("int64").reset_index()


def normalise_cells(counts, glim_code, min_cover=MIN_COVER_PIXELS, glim_weight=GLIM_WEIGHT):
    """counts: DataFrame with cell_id, n_total and CLASSES counts (one row per cell, summed over granules).
    glim_code: array of length NROWS*NCOLS with two-letter GLiM codes ('' or 'nd' = unknown).
    Returns DataFrame cell_id + six min_* columns. Rows with all six NaN are dropped (covered rule:
    uncovered cells are absent from the result, so the caller fills them with null)."""
    cols = ["min_mafic", "min_feldspathic"] + CLASSES
    covered = counts[counts["n_total"] >= min_cover].reset_index(drop=True)
    c = covered[CLASSES].to_numpy(dtype="float64")
    det = c.sum(axis=1)
    emit = np.full(c.shape, np.nan)
    has = det > 0
    emit[has] = c[has] / det[has, None]
    code = np.asarray(glim_code)[covered["cell_id"].to_numpy()]
    mafic = (code == "vb")
    felds = (code == "pa")
    rock = mafic | felds
    w = np.where(rock, glim_weight, 0.0)
    res = np.full((len(covered), 6), np.nan)
    # EMIT shares scaled to the rest of the budget.
    res[has, 2:] = emit[has] * (1.0 - w[has, None])
    res[has & mafic, 0] = glim_weight
    res[has & felds, 1] = glim_weight
    # covered, nothing detected: only a rock class can fill the cell (100%)
    only_rock = ~has & rock
    res[only_rock, 0] = np.where(mafic[only_rock], 1.0, np.nan)
    res[only_rock, 1] = np.where(felds[only_rock], 1.0, np.nan)
    res[only_rock, 2:] = 0.0
    # Cells with a rock class: the other rock column is 0 (known, not missing).
    known = has | only_rock
    res[known & np.isnan(res[:, 0]), 0] = 0.0
    res[known & np.isnan(res[:, 1]), 1] = 0.0
    out = pd.DataFrame(res, columns=cols)
    out.insert(0, "cell_id", covered["cell_id"].to_numpy())
    return out[known].reset_index(drop=True)


def glim_to_cells(codes_05):
    """codes_05: 360 x 720 array of two-letter codes, north at the top. Returns a flat array
    (NROWS*NCOLS) at 0.25 deg: each 0.5 deg value is copied to its 2 x 2 cells."""
    assert codes_05.shape == (360, 720), codes_05.shape
    return np.repeat(np.repeat(codes_05, 2, axis=0), 2, axis=1).ravel()

# %% [markdown]
# ## 3. GLiM rock type (0.5 deg)
#
# GLiM (Hartmann and Moosdorf 2012) has 16 first-level rock classes. We only use basic volcanic (`vb`) and acid plutonic (`pa`). The code below downloads the zip and reads the legend from it. It stops if `vb` is not value 2 or `pa` is not value 9.

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
assert GLIM_INT_TO_CODE[2] == "vb" and GLIM_INT_TO_CODE[9] == "pa", GLIM_INT_TO_CODE
glim_int = np.loadtxt(asc[6:], dtype="int32")
codes_05 = np.full(glim_int.shape, "nd", dtype="<U2")
for k, v in GLIM_INT_TO_CODE.items():
    codes_05[glim_int == k] = v
glim_code = glim_to_cells(codes_05)
print({c: int((codes_05 == c).sum()) for c in ("vb", "pa")}, "0.5 deg cells (vb, pa)")

# %% [markdown]
# ## 4. EMIT L2B mineral identification (EMITL2BMIN v002)
#
# Each granule is a 75 km swath in sensor geometry. We place pixels with the GLT layers (`glt_x`, `glt_y`) onto the granule's own orthorectified grid. Then we count pixels per 0.25 deg cell.
# Progress is saved after each granule in `RAW/minerals_emit_counts.parquet`. Run the cell again after a stop: finished granules are skipped.

# %%
import earthaccess
import xarray as xr

earthaccess.login()   # asks for your login. Do not save it in the notebook.

done = pd.read_parquet(CHECKPOINT) if CHECKPOINT.exists() else pd.DataFrame(columns=["granule", "cell_id", "n_total"] + CLASSES)
done_ids = set(done["granule"])


def read_emit_counts(nc_path):
    """Counts per cell for one EMIT L2B mineral file. Returns a DataFrame or None for the
    uncertainty file (no mineral id layer)."""
    # Variable and group names below were checked on a real granule (fill value is -9999 for ids and band depth).
    ds = xr.open_dataset(nc_path, engine="h5netcdf")
    if "group_1_mineral_id" not in ds:
        return None
    loc = xr.open_dataset(nc_path, engine="h5netcdf", group="location")
    meta = xr.open_dataset(nc_path, engine="h5netcdf", group="mineral_metadata")
    names = [n.decode() if isinstance(n, bytes) else str(n) for n in meta["name"].values]
    id_to_class = class_index_from_names(names)
    assert (id_to_class >= 0).any(), "No core mineral names found. Print `names` and fix KEYWORD_TO_CLASS."
    gt = ds.attrs["geotransform"]
    glt_x, glt_y = loc["glt_x"].values, loc["glt_y"].values
    cell_ids = ortho_cell_ids(gt, glt_x.shape)
    parts = []
    for g in ("group_1", "group_2"):
        cls = map_pixels_to_classes(ds[f"{g}_mineral_id"].values, ds[f"{g}_band_depth"].values, id_to_class, MIN_BAND_DEPTH)
        ortho, placed = place_with_glt(cls, glt_x, glt_y, fill=-1)
        parts.append(count_pixels_per_cell(cell_ids, ortho, placed))
    both = pd.concat(parts)
    return both.groupby("cell_id", as_index=False).sum()


new_rows = []
for name, bbox in DESERTS.items():
    found = earthaccess.search_data(short_name=EMIT_SHORT_NAME, version=EMIT_VERSION,
                                    bounding_box=bbox, count=GRANULES_PER_DESERT)
    print(name, len(found), "granules found")
    for gr in found:
        gid = gr["umm"]["GranuleUR"]
        if gid in done_ids:
            continue
        EMIT_TMP.mkdir(exist_ok=True)
        links = [l for l in gr.data_links() if "_MIN_" in l and "UNCERT" not in l]   # skip the MINUNCERT file
        files = earthaccess.download(links, str(EMIT_TMP))
        pieces = [read_emit_counts(f) for f in files if str(f).endswith(".nc")]
        pieces = [p for p in pieces if p is not None]
        assert len(pieces) == 1, f"Expected one mineral file in {gid}, found {len(pieces)}"
        df = pieces[0]
        df.insert(0, "granule", gid)
        done = pd.concat([done, df], ignore_index=True)
        done.to_parquet(CHECKPOINT, index=False)     # checkpoint after every granule
        done_ids.add(gid)
        for f in files:
            Path(f).unlink()
print(len(done_ids), "granules done")

# %% [markdown]
# ## 5. Combine and save
# Cells EMIT does not cover are all null in the six `min_*` columns.

# %%
counts = done.drop(columns="granule").groupby("cell_id", as_index=False).sum()
part = normalise_cells(counts, glim_code)
full = pd.DataFrame({"cell_id": np.arange(NROWS * NCOLS)})
COLS = ["cell_id", "min_mafic", "min_feldspathic"] + CLASSES
full = full.merge(part, on="cell_id", how="left")[COLS]
sums = full[COLS[1:]].sum(axis=1, min_count=1).dropna()
assert np.allclose(sums, 1.0), "Fractions must sum to 1"
full.to_parquet(RAW / "part_minerals.parquet", index=False)
print(len(part), "cells with minerals,", len(full) - len(part), "null")
full.dropna().describe().T
