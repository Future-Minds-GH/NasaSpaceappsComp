# %% [markdown]
# # Job 1 thin slice: Earth data
#
# Output: `analog-finder/processed/earth_thin.parquet` (Google Drive). The first time, the same table is also saved as `earth.parquet` (the first hand-off). The merge notebook reads `earth_thin.parquet` and later replaces `earth.parquet`.
# Columns: `cell_id, lat, lon, t_day_k, t_night_k, t_swing_k, slope_deg, rough_m, elev_m, elev_pct`.
#
# Before you run:
# 1. Create a free NASA Earthdata login: https://urs.earthdata.nasa.gov/users/new
# 2. Run the cells in order. The temperature step asks for the login. Do not save it in the notebook.
# 3. The DEM step is long. It saves progress to Drive. If the session stops, run the cells again.

# %%
%pip -q install earthaccess pyhdf rasterio pyarrow

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
PERIOD = ("2023-01-01", "2023-12-31")   # 12 monthly MOD11C3 files

# %% [markdown]
# ## 1. Grid

# %%
import numpy as np
import pandas as pd

ids = np.arange(NROWS * NCOLS)
rows, cols = np.divmod(ids, NCOLS)
grid = pd.DataFrame({
    "cell_id": ids,
    "lat": 90 - CELL / 2 - rows * CELL,      # cell centre, north to south
    "lon": -180 + CELL / 2 + cols * CELL,    # cell centre, west to east
})
grid.shape

# %% [markdown]
# ## 2. Temperature (MODIS MOD11C3 v061, 0.05 deg)

# %%
import earthaccess

earthaccess.login()   # asks for your Earthdata login
granules = earthaccess.search_data(short_name="MOD11C3", version="061", temporal=PERIOD)
assert len(granules) >= 12, f"Expected 12 monthly files, found {len(granules)}"
mod_files = earthaccess.download(granules, str(RAW / "mod11c3"))
len(mod_files)

# %%
from pyhdf.SD import SD, SDC

def read_lst(path, layer):
    # Returns Kelvin (3600 x 7200). Fill value 0 becomes NaN.
    sds = SD(str(path), SDC.READ).select(layer)
    scale = sds.attributes()["scale_factor"]
    raw = sds[:].astype("float64")
    return np.where(raw == 0, np.nan, raw * scale)

def long_term_mean(files, layer):
    total = np.zeros((3600, 7200))
    count = np.zeros((3600, 7200), dtype="int16")
    for f in files:
        a = read_lst(f, layer)
        ok = ~np.isnan(a)
        total[ok] += a[ok]
        count += ok
    return np.where(count > 0, total / np.maximum(count, 1), np.nan)

def to_cells(a):
    # 0.05 deg -> 0.25 deg: mean of each 5x5 block, ignoring NaN
    blocks = a.reshape(NROWS, 5, NCOLS, 5)
    n = (~np.isnan(blocks)).sum(axis=(1, 3))
    s = np.nansum(blocks, axis=(1, 3))
    return np.where(n > 0, s / np.maximum(n, 1), np.nan).ravel()

grid["t_day_k"] = to_cells(long_term_mean(mod_files, "LST_Day_CMG"))
grid["t_night_k"] = to_cells(long_term_mean(mod_files, "LST_Night_CMG"))
grid["t_swing_k"] = grid["t_day_k"] - grid["t_night_k"]
grid[["t_day_k", "t_night_k", "t_swing_k"]].describe()

# %% [markdown]
# ## 3. Terrain (Copernicus DEM GLO-90)
#
# Source: the public AWS Open Data copy of Copernicus DEM GLO-90 (same ESA product as the Copernicus Data Space Ecosystem, no login). Each 1 deg tile is resampled to ~1 km (30 arcsec, 120 x 120 pixels). Slope comes from that 1 km grid. Then 4 x 4 blocks of 30 x 30 pixels give the 0.25 deg cells.

# %%
def dem_block_stats(z, lat0):
    # z: 120 x 120 elevations (m) at 30 arcsec, top row = north. lat0 = south edge of the tile.
    # Returns 4 x 4 arrays (rows north to south) of slope_deg, rough_m, elev_m.
    lat_c = lat0 + 1 - (np.arange(120) + 0.5) / 120
    dy = 110_574 / 120                                    # metres per pixel, north-south
    dx = 111_320 * np.cos(np.radians(lat_c)) / 120        # metres per pixel, east-west
    gy = np.gradient(z, dy, axis=0)
    gx = np.gradient(z, axis=1) / dx[:, None]
    slope = np.degrees(np.arctan(np.hypot(gx, gy)))
    def blocks(a):                                        # 4 x 4 blocks of 30 x 30 pixels
        return a.reshape(4, 30, 4, 30).transpose(0, 2, 1, 3)
    zb = blocks(z)
    mean = zb.mean(axis=(2, 3), keepdims=True)
    dz = zb - mean
    # Roughness = std of the elevation left after removing the best-fit plane of each block,
    # so a smooth tilted surface scores about 0 (large-scale tilt is slope, not roughness).
    # The pixel grid is full and centred, so the plane fit has a closed form.
    idx = np.arange(30) - 14.5
    bx = (dz * idx[None, None, None, :]).sum(axis=(2, 3), keepdims=True) / (30 * (idx ** 2).sum())
    by = (dz * idx[None, None, :, None]).sum(axis=(2, 3), keepdims=True) / (30 * (idx ** 2).sum())
    resid = dz - bx * idx[None, None, None, :] - by * idx[None, None, :, None]
    return blocks(slope).mean(axis=(2, 3)), resid.std(axis=(2, 3)), mean[:, :, 0, 0]

# %%
import re
import requests
import rasterio
from rasterio.enums import Resampling

BASE = "https://copernicus-dem-90m.s3.amazonaws.com"

resp = requests.get(f"{BASE}/tileList.txt", timeout=60)
resp.raise_for_status()
TILES = []
for name in resp.text.split():
    m = re.search(r"_([NS])(\d+)_00_([EW])(\d+)_00_DEM", name)
    assert m, f"Unexpected tile name: {name}"
    lat0 = int(m[2]) * (1 if m[1] == "N" else -1)
    lon0 = int(m[4]) * (1 if m[3] == "E" else -1)
    TILES.append((name, lat0, lon0))
len(TILES)

# %%
from concurrent.futures import ThreadPoolExecutor

DEM_FILE = RAW / "dem_cells_v2.parquet"   # v2: detrended roughness
done = pd.read_parquet(DEM_FILE) if DEM_FILE.exists() else pd.DataFrame()
done_ids = set(done["tile"]) if len(done) else set()

def tile_cells(tile):
    # Returns a DataFrame, or None when the tile fails 3 times (the run goes on; see the check below).
    name, lat0, lon0 = tile
    for attempt in range(3):
        try:
            with rasterio.open(f"{BASE}/{name}/{name}.tif") as src:
                z = src.read(1, out_shape=(120, 120), resampling=Resampling.average).astype("float64")
            break
        except rasterio.errors.RasterioIOError:
            z = None
    if z is None:
        return None
    slope, rough, elev = dem_block_stats(z, lat0)
    i, j = np.meshgrid(np.arange(4), np.arange(4), indexing="ij")
    row = (89 - lat0) * 4 + i
    col = (lon0 + 180) * 4 + j
    return pd.DataFrame({
        "tile": name,
        "cell_id": (row * NCOLS + col).ravel(),
        "slope_deg": slope.ravel(), "rough_m": rough.ravel(), "elev_m": elev.ravel(),
    })

todo = [t for t in TILES if t[0] not in done_ids]
parts = [done] if len(done) else []
failed = []
for start in range(0, len(todo), 200):
    batch = todo[start:start + 200]
    with ThreadPoolExecutor(8) as pool:
        results = list(pool.map(tile_cells, batch))
    parts += [r for r in results if r is not None]
    failed += [t[0] for t, r in zip(batch, results) if r is None]
    pd.concat(parts, ignore_index=True).to_parquet(DEM_FILE, index=False)   # checkpoint
    print(f"{min(start + 200, len(todo))} / {len(todo)} tiles")
assert not failed, f"{len(failed)} tiles failed 3 times (first: {failed[:3]}). Progress is saved: run this cell again."
dem = pd.concat(parts, ignore_index=True).drop(columns="tile")
dem.shape

# %% [markdown]
# ## 4. Merge, percentile, save
#
# Land cells for `elev_pct` = cells that have both a temperature and an elevation. Ocean cells stay null. Coastal DEM cells may include sea level as 0 m. The temperature null mask removes most open ocean.

# %%
df = grid.merge(dem, on="cell_id", how="left")
land = df["t_day_k"].notna() & df["elev_m"].notna()
df["elev_pct"] = np.nan
df.loc[land, "elev_pct"] = df.loc[land, "elev_m"].rank(pct=True) * 100
for col in ("slope_deg", "rough_m", "elev_m"):
    df.loc[~land, col] = np.nan

COLS = ["cell_id", "lat", "lon", "t_day_k", "t_night_k", "t_swing_k",
        "slope_deg", "rough_m", "elev_m", "elev_pct"]
df = df[COLS]
df.to_parquet(OUT / "earth_thin.parquet", index=False)   # input of the later notebooks
if not (OUT / "earth.parquet").exists():                 # first hand-off; the merge notebook replaces it later
    df.to_parquet(OUT / "earth.parquet", index=False)
print(land.sum(), "land cells")
df.describe().T

# %% [markdown]
# ## 5. Checks and quick-look maps

# %%
import matplotlib.pyplot as plt

def at(lat, lon, col):
    return df.loc[(df.lat - lat).abs().add((df.lon - lon).abs()).idxmin(), col]

assert at(25, 15, "t_day_k") > at(-80, 0, "t_day_k"), "Sahara should be hotter than Antarctica"
assert at(28, 86, "slope_deg") > at(25, 15, "slope_deg"), "Himalaya should be steeper than Sahara"

fig, axes = plt.subplots(2, 1, figsize=(12, 10))
for ax, col in zip(axes, ("t_day_k", "slope_deg")):
    im = ax.imshow(df[col].to_numpy().reshape(NROWS, NCOLS), extent=(-180, 180, -90, 90))
    ax.set_title(col)
    fig.colorbar(im, ax=ax, shrink=0.7)
fig.savefig(OUT / "quicklook_thin_slice.png", dpi=100, bbox_inches="tight")
