# %% [markdown]
# # Job 2 thin slice: Mars data
#
# Output: `analog-finder/processed/mars_thin.parquet` (Google Drive). The first time, the same table is also saved as `mars.parquet` (the first hand-off). The merge notebook reads `mars_thin.parquet` and later replaces `mars.parquet`.
# Columns: `cell_id, lat, lon, t_day_k, t_night_k, t_swing_k, slope_deg, rough_m, elev_m, elev_pct`.
#
# Grid: 0.5 deg, 360 rows x 720 columns. `cell_id = row * 720 + col`. Row 0 is lat 89.75 (planetocentric). Column 0 is lon -179.75 (east positive). `lat` and `lon` are cell centres.
#
# Before you run:
# 1. No login is needed. Both sources are public.
# 2. Run the cells in order. Downloads go to Drive. If the session stops, run the cells again. Existing files are not downloaded again.
# 3. Temperature needs 96 small requests to the Mars Climate Database web server (about 3 minutes). If the server is down, see the manual steps in section 2.

# %%
%pip -q install pyarrow requests

# %%
from pathlib import Path
from google.colab import drive

drive.mount("/content/drive")
ROOT = Path("/content/drive/MyDrive/analog-finder")
RAW = ROOT / "raw" / "mars"
OUT = ROOT / "processed"
MCD_DIR = RAW / "mcd_export"
MOLA_DIR = RAW / "mola"
for p in (RAW, OUT, MCD_DIR, MOLA_DIR):
    p.mkdir(parents=True, exist_ok=True)

CELL = 0.5                       # grid size in degrees (shared contract)
NROWS, NCOLS = 360, 720
MARS_RADIUS_M = 3_396_190.0      # IAU mean radius 3396.19 km, used for all metre-per-degree maths
M_PER_DEG = MARS_RADIUS_M * 3.141592653589793 / 180   # about 59,274 m (1 deg lat is about 59.3 km)
PPD = 64                         # MOLA MEGDR resolution: 64 pixels per degree (0.926 km at the equator)
BLOCK = int(CELL * PPD)          # 32 x 32 pixels per 0.5 deg cell

# %% [markdown]
# ## 0. Pure functions (tested on synthetic data)
#
# All maths is here. No file or network access. Missing values are NaN, never 0.

# %%
import numpy as np
import pandas as pd


def lon360_to_180(lon):
    # 0..360 east -> -180..180 east. 360 maps to 0; 180 maps to -180.
    return (np.asarray(lon, dtype="float64") + 180.0) % 360.0 - 180.0


def roll_360_to_180(a):
    # a: array whose columns run lon 0..360 (east). Returns columns for lon -180..180.
    # Column j covers lon j/PPD, so the roll by half the width puts lon 180 first.
    assert a.shape[1] % 2 == 0
    return np.roll(a, a.shape[1] // 2, axis=1)


def cell_centres():
    ids = np.arange(NROWS * NCOLS)
    rows, cols = np.divmod(ids, NCOLS)
    return pd.DataFrame({
        "cell_id": ids,
        "lat": 90 - CELL / 2 - rows * CELL,
        "lon": -180 + CELL / 2 + cols * CELL,
    })


def _interp_axis(a, x, xnew, axis):
    # Linear interpolation along one axis. x is increasing. xnew must lie inside x.
    assert np.all(np.diff(x) > 0)
    assert xnew.min() >= x[0] - 1e-9 and xnew.max() <= x[-1] + 1e-9, "target outside source range"
    i = np.clip(np.searchsorted(x, xnew, side="right") - 1, 0, len(x) - 2)
    w = (xnew - x[i]) / (x[i + 1] - x[i])
    a = np.moveaxis(a, axis, 0)
    shape = (-1,) + (1,) * (a.ndim - 1)
    out = a[i] * (1 - w).reshape(shape) + a[i + 1] * w.reshape(shape)
    return np.moveaxis(out, 0, axis)


def regrid_to_cells(vals, lats, lons, cell_lats, cell_lons):
    # vals[lat, lon] on a coarse regular grid (lat ascending, lon -180..180 east, may repeat the
    # first column at lon+360). Returns bilinear values at the cell centres, shape (len(cell_lats), len(cell_lons)).
    # Longitude is periodic. NaN in the input spreads to the neighbouring cells (no fill).
    lons = np.asarray(lons, dtype="float64")
    if np.isclose(lons[-1] - lons[0], 360.0):          # drop the repeated seam column
        lons, vals = lons[:-1], vals[:, :-1]
    lons_ext = np.append(lons, lons[0] + 360.0)
    vals_ext = np.concatenate([vals, vals[:, :1]], axis=1)
    cl = np.asarray(cell_lons, dtype="float64")
    assert cl.min() >= lons_ext[0] and cl.max() <= lons_ext[-1]
    tmp = _interp_axis(vals_ext, lons_ext, cl, axis=1)
    return _interp_axis(tmp, np.asarray(lats, dtype="float64"), np.asarray(cell_lats, dtype="float64"), axis=0)


def daily_extremes(stack):
    # stack[hour, lat, lon]: surface temperature at fixed local times. Returns (max, min) over the hours.
    assert stack.ndim == 3 and stack.shape[0] >= 12, "need at least 12 local times per day"
    return stack.max(axis=0), stack.min(axis=0)


def season_average(maps):
    # maps: list of 2-D arrays (one per season). Plain mean; NaN if any season is NaN.
    assert len(maps) == 4, "expected 4 seasons (Ls 0, 90, 180, 270)"
    return np.mean(np.stack(maps), axis=0)


def terrain_stats(z, lat_c, halo_top=0, halo_bottom=0, ppd=PPD, radius_m=MARS_RADIUS_M):
    # z: elevations in metres, shape (H, W), top row = north, regular lat/lon pixels of 1/ppd deg.
    # lat_c: latitude of each pixel row (degrees), length H.
    # halo_*: extra rows at the top/bottom used for the gradient only (cropped from the result).
    # The inner height and the width must be multiples of BLOCK (one block = one 0.5 deg cell).
    # Returns slope_deg, rough_m, elev_m, each (inner_H / BLOCK, W / BLOCK).
    # Slope: central differences on the sphere. 1 px north-south = radius * dlat; east-west = radius * cos(lat) * dlon.
    # Roughness: std of the elevations left after removing the best-fit plane of each block,
    # so a smooth tilted surface scores about 0. The pixel grid of a block is full and centred, so the fit has a closed form.
    z = np.asarray(z, dtype="float64")
    H, W = z.shape
    inner = H - halo_top - halo_bottom
    assert inner % BLOCK == 0 and W % BLOCK == 0, "block size must divide the array"
    step = np.radians(1.0 / ppd)
    dy = radius_m * step
    dx = radius_m * np.cos(np.radians(lat_c)) * step
    assert np.all(dx > 0), "pixel centre at the pole"
    gy = np.gradient(z, dy, axis=0)
    gx = np.gradient(z, axis=1) / dx[:, None]
    slope = np.degrees(np.arctan(np.hypot(gx, gy)))[halo_top:H - halo_bottom]
    zc = z[halo_top:H - halo_bottom]
    nb_r, nb_c = inner // BLOCK, W // BLOCK

    def blocks(a):
        return a.reshape(nb_r, BLOCK, nb_c, BLOCK).transpose(0, 2, 1, 3)

    zb = blocks(zc)
    mean = zb.mean(axis=(2, 3), keepdims=True)
    dz = zb - mean
    idx = np.arange(BLOCK) - (BLOCK - 1) / 2
    denom = BLOCK * (idx ** 2).sum()
    bx = (dz * idx[None, None, None, :]).sum(axis=(2, 3), keepdims=True) / denom
    by = (dz * idx[None, None, :, None]).sum(axis=(2, 3), keepdims=True) / denom
    resid = dz - bx * idx[None, None, None, :] - by * idx[None, None, :, None]
    return blocks(slope).mean(axis=(2, 3)), resid.std(axis=(2, 3)), mean[:, :, 0, 0]


def percentile_0_100(values):
    # Percentile rank (0-100) among the non-NaN values. NaN stays NaN.
    s = pd.Series(np.asarray(values, dtype="float64"))
    return (s.rank(pct=True) * 100).to_numpy()


def parse_mcd_ascii(text, expect_ls=None, expect_lt=None):
    # Parses the MCD web interface ASCII export (verified layout, MCD_v6.2):
    #   header lines start with "###"; one line "---- ||  lat1 lat2 ..." (north latitudes);
    #   then one line per longitude: "lon ||  v1 v2 ...", one value per latitude.
    # Returns lats (ascending), lons (ascending), vals[lat, lon] in K.
    lines = text.splitlines()
    head = "\n".join(l for l in lines if l.startswith("###"))
    assert "Surface temperature (K)" in head, "file is not a surface temperature export"
    assert "climatology average solar" in head, "wrong dust scenario (need climatology average solar)"
    if expect_ls is not None:
        assert f"Ls {expect_ls:.1f}deg" in head, f"file is not Ls {expect_ls}"
    if expect_lt is not None:
        assert f"Local time {expect_lt:.1f}h (fixed at all longitudes)" in head, f"file is not local time {expect_lt}"
    body = [l for l in lines if "||" in l and not l.startswith("#")]
    assert body and body[0].startswith("----"), "latitude line not found"
    lats = np.array(body[0].split("||")[1].split(), dtype="float64")
    lons, rows = [], []
    for l in body[1:]:
        a, b = l.split("||")
        lons.append(float(a))
        v = np.array(b.split(), dtype="float64")
        assert len(v) == len(lats), "row length differs from the latitude line"
        rows.append(v)
    lons = np.array(lons)
    vals = np.array(rows).T                              # [lat, lon]
    assert np.all(np.diff(lats) > 0) and np.all(np.diff(lons) > 0)
    return lats, lons, vals


# %% [markdown]
# ## 1. Grid

# %%
grid = cell_centres()
grid.shape

# %% [markdown]
# ## 2. Temperature (Mars Climate Database, MCD)
#
# **What the data is.** The MCD gives modelled surface temperature `tsurf` (K). The web interface (https://www-mars.lmd.jussieu.fr/mcd_python/, shows MCD 6.2 in its output) has **no** daily maximum or daily minimum surface temperature variable. Its variable list only has `Surface temperature (K)` and `Surface temperature RMS day to day variations (K)`. So the notebook builds the daily maximum and minimum itself: it asks for one `tsurf` map at each of the 24 local solar hours (0 to 23), for 4 seasons (Ls 0, 90, 180, 270), and takes the maximum and the minimum over the 24 hours. Then it averages the 4 seasons with equal weight (the 4 seasons are not equal in length on Mars; this is a simple approximation).
#
# - Dust scenario: `climatology average solar` (form value `dust=1`).
# - Local time is fixed at all longitudes (form value `isfixedlt=on`), so each map is a true same-local-time map.
# - Altitude: 10 m above the surface (the form default), used as the surface value. Check this: `tsurf` should not depend on the altitude. UNVERIFIED.
# - Resolution: the export is on the native MCD grid: 64 longitudes from -180 to 180 (the last repeats the first; about 5.7 deg apart) and 48 latitudes from -90 to 90 (about 3.83 deg apart). The notebook interpolates it to the 0.5 deg cells (bilinear). So the temperature is smooth. It does not follow local topography.
# - Format: the server answers a GET request with a small HTML page. The page has a link to an ASCII file (`../txt/<id>.txt`). The notebook downloads that file. The file has `###` header lines, one latitude line and one line per longitude.
#
# **Manual steps (use these if the server is down or blocks the requests).** The server asks for moderate use. For each of the 96 combinations (Ls 0, 90, 180, 270 x local time 0 to 23):
# 1. Open https://www-mars.lmd.jussieu.fr/mcd_python/
# 2. Variable 1: `Surface temperature (K)`. Variables 2 to 4: `(None)`.
# 3. Mars date: select "Solar longitude (Ls)" and type the Ls value (0, 90, 180 or 270).
# 4. Local Time: type the hour (0 to 23).
# 5. Latitude: `all`. Longitude: `all`. Altitude: `10` with `m above surface`.
# 6. Customize data request: "Same localtime everywhere" = on. "Dust/EUV scenario" = `climatology ave solar`. "Averaging" = off. "Animation" = off.
# 7. Press SUBMIT. On the result page press "Click here to download an ASCII file containing data".
# 8. Save the file as `mcd_tsurf_Ls000_LT00.txt` (pattern `mcd_tsurf_Ls{Ls:03d}_LT{hour:02d}.txt`) in `analog-finder/raw/mars/mcd_export/` on Drive.
#
# The code below reads every file in that folder. It downloads only the files that are missing. If a file is still missing after the download step, it stops with the list of the missing file names.
# If you have the full MCD (request form at http://www-mars.lmd.jussieu.fr), you can instead put your own daily max and min maps here. That path is not coded.

# %%
import re
import time
import requests

MCD_CGI = "https://www-mars.lmd.jussieu.fr/mcd_python/cgi-bin/mcdcgi.py"
MCD_TXT = "https://www-mars.lmd.jussieu.fr/mcd_python/txt/"
SEASONS = (0, 90, 180, 270)     # Ls in degrees
HOURS = tuple(range(24))        # local solar hours
MAX_TXT_BYTES = 1_000_000       # one export is about 50 kB

def mcd_name(ls, hour):
    return MCD_DIR / f"mcd_tsurf_Ls{ls:03d}_LT{hour:02d}.txt"

def fetch_mcd(ls, hour):
    # Parameters: names and values come from the form at /mcd_python/. The request was tested for Ls 0, local time 12.
    # UNVERIFIED: the other (Ls, hour) pairs use the same parameters; the header check in parse_mcd_ascii catches a mismatch.
    params = {
        "var1": "tsurf", "var2": "none", "var3": "none", "var4": "none",
        "datekeyhtml": "1", "ls": str(ls), "localtime": str(hour),
        "latitude": "all", "longitude": "all", "altitude": "10", "zkey": "3",
        "spacecraft": "none", "betatest": "on", "isfixedlt": "on", "dust": "1", "hrkey": "0",
        "averaging": "off", "zonmean": "off", "diumean": "off", "animation": "off", "animframes": "12",
        "dpi": "80", "islog": "off", "colorm": "jet", "proj": "cyl", "trans": "", "iswind": "off",
    }
    for attempt in range(4):                       # back off on 429 and 5xx: the server is small
        r = requests.get(MCD_CGI, params=params, timeout=120, headers={"User-Agent": "analog-finder-hackathon/1.0 (research use)"})
        if r.status_code not in (429, 500, 502, 503, 504):
            break
        time.sleep(5 * 2 ** attempt)
    r.raise_for_status()
    m = re.search(r"href='\.\./txt/([0-9a-f]+\.txt)'", r.text)
    assert m, f"No ASCII link in the MCD answer for Ls {ls}, hour {hour}. Use the manual steps."
    with requests.get(MCD_TXT + m[1], timeout=120, stream=True, headers={"User-Agent": "analog-finder-hackathon/1.0 (research use)"}) as t:
        t.raise_for_status()
        data = b""
        for chunk in t.iter_content(65536):
            data += chunk
            assert len(data) <= MAX_TXT_BYTES, "MCD file larger than the size cap"
    mcd_name(ls, hour).write_bytes(data)

todo = [(ls, h) for ls in SEASONS for h in HOURS if not mcd_name(ls, h).exists()]
print(len(todo), "files to download")
for ls, h in todo:
    fetch_mcd(ls, h)
    time.sleep(1.0)     # be polite: the server is for moderate use

missing = [mcd_name(ls, h).name for ls in SEASONS for h in HOURS if not mcd_name(ls, h).exists()]
assert not missing, (
    f"{len(missing)} MCD export files are missing in {MCD_DIR} (first: {missing[:3]}). "
    "Create them with the manual steps in the text above."
)

# %%
season_day, season_night = [], []
for ls in SEASONS:
    maps = []
    for h in HOURS:
        lats, lons, vals = parse_mcd_ascii(mcd_name(ls, h).read_text(), expect_ls=ls, expect_lt=h)
        maps.append(regrid_to_cells(vals, lats, lons, np.unique(grid["lat"]), np.unique(grid["lon"])))
    # Cell latitudes run north to south in the grid, so regrid on ascending latitudes and flip.
    stack = np.stack(maps)[:, ::-1, :]                      # [hour, north->south, west->east]
    mx, mn = daily_extremes(stack)
    season_day.append(mx)
    season_night.append(mn)

grid["t_day_k"] = season_average(season_day).ravel()
grid["t_night_k"] = season_average(season_night).ravel()
grid["t_swing_k"] = grid["t_day_k"] - grid["t_night_k"]
grid[["t_day_k", "t_night_k", "t_swing_k"]].describe()

# %% [markdown]
# ## 3. Terrain (MOLA MEGDR topography, 64 pixels per degree)
#
# **Product.** Mars Global Surveyor MOLA MEGDR, PDS data set `MGS-M-MOLA-5-MEGDR-L3-V1.0`, product version 2.0, topography files `megt??n?00gb.img` in
# https://pds-geosciences.wustl.edu/mgs/urn-nasa-pds-mgs_mola_topography_derived/meg064/ (4 tiles, one per hemisphere half, 90 deg x 180 deg each).
# - Each tile: 5760 rows x 11520 columns, 132,710,400 bytes, signed 16-bit integers, big-endian (`MSB_INTEGER`), no scale factor, no offset, unit metre.
# - Values: topography = radius minus the areoid (GMM-3 geoid) at that point. Not the radius. Minimum and maximum in the data set: -8199 m and 21218 m.
# - Pixel size: 1/64 deg = 0.926 km at the equator. So the native grid is the "about 1 km" grid. No resampling is needed.
# - Longitude: 0 to 360 east. The tile names give the upper-left corner: `megt90n000gb` is lat 90 to 0, lon 0 to 180; `megt90n180gb` is lat 90 to 0, lon 180 to 360; `megt00n000gb` is lat 0 to -90, lon 0 to 180; `megt00n180gb` is lat 0 to -90, lon 180 to 360. Latitude is planetocentric. The notebook converts to lon -180..180.
# - No missing data: bins without a MOLA shot hold an interpolated value (about 55 percent of bins near the equator have a shot).
# - Radius used here: 3396.19 km (IAU mean radius), so 1 deg of latitude is 59.27 km. The MOLA label uses 3396.0 km for its map scale (0.926 km per pixel). The difference is 0.006 percent.
# - MOLA alone is used. The MOLA+HRSC blend is not used (stretch goal).
#
# **Slope.** Central differences on the 0.926 km grid, on the sphere (east-west pixel size = radius x cos(lat) x dlon). The cell value is the mean of the slope over the 32 x 32 pixels of the cell. Near the poles the east-west pixels get very short, so slope in the top and bottom cell rows (|lat| above 89) is not reliable.
#
# **Roughness (same rule as Earth).** The window is computed per cell: the 32 x 32 pixels of the 0.5 deg cell, about 30 km north-south (29.6 km). East-west the window is 30 km x cos(lat), so it is shorter at high latitude. For each window the notebook removes the best-fit plane (closed form, see `terrain_stats`), then takes the standard deviation of what is left. A smooth tilted surface scores about 0 m.
#
# **Elevation.** `elev_m` is the mean of the cell. `elev_pct` is the percentile (0 to 100) of `elev_m` over all cells that have a value (all 259,200 cells).

# %%
MOLA_URL = "https://pds-geosciences.wustl.edu/mgs/urn-nasa-pds-mgs_mola_topography_derived/meg064/"
TILE_BYTES = 132_710_400
TILES = [   # (file stem, latitude of the top edge, longitude of the west edge, 0..360 east)
    ("megt90n000gb", 90, 0), ("megt90n180gb", 90, 180),
    ("megt00n000gb", 0, 0), ("megt00n180gb", 0, 180),
]

def download_tile(stem):
    dest = MOLA_DIR / f"{stem}.img"
    if dest.exists() and dest.stat().st_size == TILE_BYTES:
        return dest
    part = dest.with_suffix(".part")
    got = 0
    with requests.get(f"{MOLA_URL}{stem}.img", stream=True, timeout=120, headers={"User-Agent": "analog-finder-hackathon/1.0 (research use)"}) as r:
        r.raise_for_status()
        assert int(r.headers["Content-Length"]) == TILE_BYTES, "unexpected tile size"
        with open(part, "wb") as f:
            for chunk in r.iter_content(1 << 20):
                got += len(chunk)
                assert got <= TILE_BYTES, "download larger than expected"
                f.write(chunk)
    assert got == TILE_BYTES, f"{stem}: got {got} bytes"
    part.replace(dest)
    return dest

def tile_cells(path, lat_top, lon_west):
    # Processes one tile in strips of 10 cell rows (320 pixel rows) with a 1-row halo for the gradient.
    z = np.memmap(path, dtype=">i2", mode="r", shape=(90 * PPD, 180 * PPD))
    out = []
    strip = 10 * BLOCK
    for r0 in range(0, z.shape[0], strip):
        a, b = max(r0 - 1, 0), min(r0 + strip + 1, z.shape[0])
        lat_c = lat_top - (np.arange(a, b) + 0.5) / PPD
        s, rg, e = terrain_stats(np.asarray(z[a:b], dtype="float64"), lat_c,
                                 halo_top=r0 - a, halo_bottom=b - r0 - strip)
        out.append((s, rg, e))
    slope, rough, elev = (np.concatenate([o[i] for o in out], axis=0) for i in range(3))
    lon_w = lon_west - 360 if lon_west >= 180 else lon_west        # 0..360 -> -180..180
    row0 = int(round((90 - lat_top) / CELL))
    col0 = int(round((lon_w + 180) / CELL))
    i, j = np.meshgrid(np.arange(slope.shape[0]), np.arange(slope.shape[1]), indexing="ij")
    return pd.DataFrame({
        "cell_id": ((row0 + i) * NCOLS + col0 + j).ravel(),
        "slope_deg": slope.ravel(), "rough_m": rough.ravel(), "elev_m": elev.ravel(),
    })

DEM_FILE = RAW / "dem_cells_v1.parquet"
if DEM_FILE.exists():
    dem = pd.read_parquet(DEM_FILE)
else:
    parts = []
    for stem, lat_top, lon_west in TILES:
        parts.append(tile_cells(download_tile(stem), lat_top, lon_west))
        print(stem, "done")
    dem = pd.concat(parts, ignore_index=True)
    dem.to_parquet(DEM_FILE, index=False)
assert len(dem) == NROWS * NCOLS and dem["cell_id"].is_unique, "tiles do not cover the grid exactly once"
dem.describe().T

# %% [markdown]
# ## 4. Merge, percentile, save

# %%
df = grid.merge(dem, on="cell_id", how="left")
df["elev_pct"] = percentile_0_100(df["elev_m"])

COLS = ["cell_id", "lat", "lon", "t_day_k", "t_night_k", "t_swing_k",
        "slope_deg", "rough_m", "elev_m", "elev_pct"]
df = df[COLS]
assert len(df) == NROWS * NCOLS
df.to_parquet(OUT / "mars_thin.parquet", index=False)    # input of the later notebooks
if not (OUT / "mars.parquet").exists():                  # first hand-off; the merge notebook replaces it later
    df.to_parquet(OUT / "mars.parquet", index=False)
df.describe().T

# %% [markdown]
# ## 5. Checks and quick-look maps

# %%
import matplotlib.pyplot as plt

def at(lat, lon, col):
    return df.loc[(df.lat - lat).abs().add((df.lon - lon).abs()).idxmin(), col]

assert at(18.65, -133.8, "elev_m") > at(-42.7, 70.0, "elev_m") + 15000, "Olympus Mons should be far above Hellas"
assert at(0, 0, "t_day_k") > at(85, 0, "t_day_k"), "equator should be warmer than the pole by day"
assert (df["t_day_k"] > df["t_night_k"]).mean() > 0.99, "day should be warmer than night"
assert at(18.65, -133.8, "slope_deg") > at(25, -60, "slope_deg"), "Olympus Mons flank should be steeper than Acidalia plain"

fig, axes = plt.subplots(3, 2, figsize=(14, 12))
for ax, col in zip(axes.ravel(), ("t_day_k", "t_night_k", "t_swing_k", "slope_deg", "rough_m", "elev_m")):
    im = ax.imshow(df[col].to_numpy().reshape(NROWS, NCOLS), extent=(-180, 180, -90, 90))
    ax.set_title(col)
    fig.colorbar(im, ax=ax, shrink=0.7)
fig.savefig(OUT / "quicklook_mars_thin_slice.png", dpi=100, bbox_inches="tight")
