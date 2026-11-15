# %% [markdown]
# # Job 2 thin slice: Moon data
#
# Output: `analog-finder/processed/moon_thin.parquet` (Google Drive). The first time, the same table is also saved as `moon.parquet` (the first hand-off). The merge notebook reads `moon_thin.parquet` and later replaces `moon.parquet`.
# Columns: `cell_id, lat, lon, t_day_k, t_night_k, t_swing_k, slope_deg, rough_m, elev_m, elev_pct`.
#
# Sources (both public on the NASA PDS Geosciences node, no login):
# - **Temperature:** LRO Diviner Global Cumulative Product (GCP), dataset `LRO-L-DLRE-5-GCP-V1.0`, 18 files of about 156 MB. Folder: https://pds-geosciences.wustl.edu/lro/urn-nasa-pds-lro_diviner_derived1/data_derived_gcp/
# - **Terrain:** LRO LOLA global DEM `LDEM_64` (V3.1, 64 pixels/degree, 474 m/pixel, 531 MB). File: https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/cylindrical/img/ldem_64.img
#
# Before you run:
# 1. Run the cells in order. About 3.4 GB of downloads go to Drive (`raw/moon`). If the session stops, run the cells again. Finished downloads are skipped and part files resume.
# 2. No login or key is needed.

# %%
%pip -q install pyarrow requests

# %%
from pathlib import Path
from google.colab import drive

drive.mount("/content/drive")
ROOT = Path("/content/drive/MyDrive/analog-finder")
RAW = ROOT / "raw" / "moon"
OUT = ROOT / "processed"
for p in (RAW, OUT):
    p.mkdir(parents=True, exist_ok=True)

CELL = 0.5                       # grid size in degrees (shared contract)
NROWS, NCOLS = 360, 720
R_MOON_M = 1_737_400.0           # Moon radius in metres (1 deg lat = 30.3 km)
PPD = 32                         # DEM working resolution: 32 pixels/degree = 0.97 km (~1 km)
ROUGH_WIN_DEG = 1.0              # roughness window (see section 3)

# %% [markdown]
# ## What the temperature numbers are
#
# The Diviner GCP bins every nadir observation from 5 July 2009 to 1 April 2015 by **latitude, longitude and local solar time**: 0.5 deg x 0.5 deg x 0.25 hour (96 local-time bins). It is already on our grid (cell centres at 0.25, 0.75, ... deg), so no regridding is needed. Each bin has the mean brightness temperature of 7 infrared channels (`t3`..`t9`) and `tbol`, the **bolometric brightness temperature**.
#
# - `t_day_k` = mean of `tbol` in the two local-time bins that touch 12:00: centred 11.875 h and 12.125 h (11.75 to 12.25 h). This is "lunar noon".
# - `t_night_k` = mean of `tbol` in the two bins centred 23.875 h and 0.125 h (23.75 to 00.25 h). This is "lunar midnight".
# - `t_swing_k = t_day_k - t_night_k`.
#
# Honest limits:
# - `tbol` is a **brightness temperature** (the blackbody temperature that gives the same radiated power, built from the Diviner channel radiances after Paige et al. 2010 and Williams et al. 2017). It is **not** a kinetic (physical) temperature. Rough ground and shadows inside a cell make it lower than the mean kinetic temperature at noon.
# - It is a **long-term mean over about 6 years** of all lunar days and seasons for that local time, not one day.
# - Cells are 0.5 deg (15 km). The value is the mean over everything seen in the cell, including slopes that face the Sun or away from it.
# - Bins with no data are -9999 in the file. They become NaN. A cell is NaN when both of its bins are empty.
# - The GDR L2 products on the ODE page (`DGDR_*_D/N`) are **12-hour** day and night maps for a single 27-day cycle. They are not noon and midnight, so we do not use them.

# %% [markdown]
# ## 0. Math functions (pure numpy, tested locally on synthetic data)

# %%
# PURE FUNCTIONS START
import numpy as np
import pandas as pd
from numpy.lib.stride_tricks import sliding_window_view


def lon360_to_180(a, axis=-1):
    # a: columns start at lon 0 and go east to 360 (pixel centres). Returns columns for lon -180..180.
    n = a.shape[axis]
    assert n % 2 == 0, "need an even number of longitude columns"
    return np.roll(a, -n // 2, axis=axis)


def block_mean(a, f):
    # Mean of f x f blocks, ignoring NaN. NaN when a block has no value.
    h, w = a.shape
    assert h % f == 0 and w % f == 0, f"shape {a.shape} not divisible by {f}"
    b = a.reshape(h // f, f, w // f, f)
    n = np.isfinite(b).sum(axis=(1, 3))
    s = np.nansum(b, axis=(1, 3))
    return np.where(n > 0, s / np.maximum(n, 1), np.nan)


def sphere_slope_deg(z, ppd, radius_m=R_MOON_M):
    # z: (H, W) elevations in m, row 0 = north, lon columns wrap around (periodic).
    # One pixel is 1/ppd degree: north-south size dy = R dphi, east-west size dx = R cos(lat) dphi.
    # Poleward of about 60 deg, dx is much smaller than dy, so the east-west difference spans k
    # pixels (k = round(dy / dx)) to keep a baseline of about 1 km. Without this, noise at the pole is
    # divided by a tiny dx and the slope blows up.
    h, w = z.shape
    dphi = np.radians(1.0 / ppd)
    lat = np.radians(90 - (np.arange(h) + 0.5) / ppd)
    dy = radius_m * dphi
    dx = radius_m * np.cos(lat) * dphi
    k = np.clip(np.rint(dy / dx), 1, w // 4).astype(int)
    gy = np.gradient(z, dy, axis=0)
    gx = np.empty(z.shape, dtype=np.result_type(z.dtype, np.float32))
    for i in range(h):
        gx[i] = (np.roll(z[i], -k[i]) - np.roll(z[i], k[i])) / (2 * k[i] * dx[i])
    return np.degrees(np.arctan(np.hypot(gx, gy)))


def detrended_std(win):
    # win: (..., n, n) windows. Std of the elevation left after removing the best-fit plane of each
    # window (smooth tilted surface -> 0; tilt belongs in slope). Same rule as dem_block_stats in
    # the Earth notebook. The pixel grid is full and centred, so the plane fit has a closed form.
    n = win.shape[-1]
    assert win.shape[-2] == n
    dz = win - win.mean(axis=(-2, -1), keepdims=True)
    idx = np.arange(n) - (n - 1) / 2
    denom = n * (idx ** 2).sum()
    bx = (dz * idx[..., None, :]).sum(axis=(-2, -1), keepdims=True) / denom
    by = (dz * idx[..., :, None]).sum(axis=(-2, -1), keepdims=True) / denom
    resid = dz - bx * idx[..., None, :] - by * idx[..., :, None]
    return resid.std(axis=(-2, -1))   # NaN in a window gives NaN


def pad_sphere(z, pad):
    # Pad `pad` rows over each pole (continue on the far side: same distance, lon + 180 deg)
    # and `pad` columns on each side (lon wraps around).
    h, w = z.shape
    assert w % 2 == 0 and pad <= h
    top = np.roll(z[:pad][::-1], w // 2, axis=1)
    bot = np.roll(z[h - pad:][::-1], w // 2, axis=1)
    zp = np.concatenate([top, z, bot], axis=0)
    return np.concatenate([zp[:, w - pad:], zp, zp[:, :pad]], axis=1)


def cell_roughness(z, ppd, cell_deg=CELL, win_deg=ROUGH_WIN_DEG):
    # Detrended std (m) in a win_deg window centred on each cell_deg cell. Output (180/cell_deg, 360/cell_deg).
    step = round(cell_deg * ppd)
    win = round(win_deg * ppd)
    assert (win - step) % 2 == 0 and win >= step
    pad = (win - step) // 2
    zp = pad_sphere(z.astype("float64"), pad)
    nr, nc = z.shape[0] // step, z.shape[1] // step
    out = np.empty((nr, nc))
    for r in range(nr):
        strip = zp[r * step: r * step + win, :]
        w = sliding_window_view(strip, win, axis=1)[:, ::step][:, :nc]   # (win, nc, win)
        out[r] = detrended_std(np.moveaxis(w, 0, 1))
    return out


def pct_rank(x):
    # 0-100 percentile of each value among all finite values. NaN stays NaN.
    s = pd.Series(np.asarray(x, dtype="float64"))
    return (s.rank(pct=True) * 100).to_numpy()


def gcp_to_cube(clon, clat, ltim, tbol, cube, lat_lo, lat_hi):
    # Put table rows (Diviner GCP) into cube[row, col, tbin] (360 x 720 x 96). The row order in the
    # file is not assumed: each row goes to the bin its own coordinates name.
    col = np.rint((clon + 180 - CELL / 2) / CELL)
    row = np.rint((90 - CELL / 2 - clat) / CELL)
    tb = np.rint((ltim - 0.125) / 0.25)
    assert np.abs(col * CELL + CELL / 2 - 180 - clon).max() < 0.01, "longitude not on the 0.5 deg grid"
    assert np.abs(90 - CELL / 2 - row * CELL - clat).max() < 0.01, "latitude not on the 0.5 deg grid"
    assert np.abs(tb * 0.25 + 0.125 - ltim).max() < 0.02, "local time not on the 0.25 h grid"
    assert clat.min() > lat_lo and clat.max() < lat_hi, "rows outside the file's latitude band"
    assert 0 <= col.min() and col.max() < NCOLS and 0 <= row.min() and row.max() < NROWS
    assert 0 <= tb.min() and tb.max() < 96
    t = np.where((tbol == -9999) | (tbol <= 0), np.nan, tbol)    # -9999 = no data
    cube[row.astype(int), col.astype(int), tb.astype(int)] = t


def noon_midnight(cube):
    # Local-time bins 47, 48 (11.875 h, 12.125 h) -> noon. Bins 95, 0 (23.875 h, 0.125 h) -> midnight.
    def m(ix):
        v = cube[:, :, ix]
        n = np.isfinite(v).sum(axis=2)
        return np.where(n > 0, np.nansum(v, axis=2) / np.maximum(n, 1), np.nan)
    return m([47, 48]), m([95, 0])
# PURE FUNCTIONS END

# %% [markdown]
# ## 1. Grid

# %%
ids = np.arange(NROWS * NCOLS)
rows, cols = np.divmod(ids, NCOLS)
grid = pd.DataFrame({
    "cell_id": ids,
    "lat": 90 - CELL / 2 - rows * CELL,      # cell centre, north (89.75) to south, planetocentric
    "lon": -180 + CELL / 2 + cols * CELL,    # cell centre, west to east, east positive
})
grid.shape

# %% [markdown]
# ## 2. Temperature (Diviner GCP)
#
# Each file is 1 header line + 1,382,400 data lines of 113 bytes: 720 longitudes x 20 latitudes x 96 local-time bins for a 10 deg latitude band. We stream each file to Drive (resumable), check its size against the label, then keep only the 4 local-time bins we need.

# %%
import hashlib
import requests

PDS_GCP = "https://pds-geosciences.wustl.edu/lro/urn-nasa-pds-lro_diviner_derived1/data_derived_gcp/"
PDS_LDEM = "https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/cylindrical/img/ldem_64.img"
GCP_BYTES = 113 * 1_382_401        # label: RECORD_BYTES 113, 1 header + 1,382,400 rows (= 156,211,313 listed)
LDEM_BYTES = 23040 * 11520 * 2     # label: 11520 lines x 23040 samples x 16 bit (= 530,841,600 listed)
MAX_BYTES = 600_000_000            # size cap per file


def download(url, dest, expected_bytes):
    # Streams to dest + ".part" and resumes with a Range request. Fails fast on a wrong size.
    # UNVERIFIED: PDS gives no per-file MD5 that we could check, so we check the size against
    # the label and write a sha256 next to the file the first time (compared on later runs).
    dest = Path(dest)
    sha_file = Path(str(dest) + ".sha256")
    if not dest.exists():
        head = requests.head(url, allow_redirects=True, timeout=60, headers={"User-Agent": "analog-finder-hackathon/1.0 (research use)"})
        head.raise_for_status()
        size = int(head.headers["Content-Length"])
        assert size == expected_bytes <= MAX_BYTES, f"{url}: size {size}, expected {expected_bytes}"
        part = Path(str(dest) + ".part")
        have = part.stat().st_size if part.exists() else 0
        assert have <= size
        if have < size:
            with requests.get(url, headers={**{"User-Agent": "analog-finder-hackathon/1.0 (research use)"}, "Range": f"bytes={have}-"}, stream=True, timeout=120) as r:
                assert r.status_code == 206 or (have == 0 and r.status_code == 200), f"unexpected HTTP {r.status_code}"
                got = have if r.status_code == 206 else 0
                with open(part, "ab" if r.status_code == 206 else "wb") as f:
                    for chunk in r.iter_content(1 << 20):
                        got += len(chunk)
                        assert got <= size, "download is larger than the size from the header"     # count the bytes
                        f.write(chunk)
        assert part.stat().st_size == size, "download is incomplete: run the cell again"
        part.rename(dest)
    assert dest.stat().st_size == expected_bytes, f"{dest} has the wrong size"
    h = hashlib.sha256()
    with open(dest, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 24), b""):
            h.update(chunk)
    if sha_file.exists():
        assert sha_file.read_text().strip() == h.hexdigest(), f"{dest} changed since the first download"
    else:
        sha_file.write_text(h.hexdigest())
    return dest

# %%
BANDS = ([(f"{10*k:02d}n{10*k+10:02d}n", 10 * k, 10 * k + 10) for k in range(9)]
         + [(f"{10*k+10:02d}s{10*k:02d}s", -10 * k - 10, -10 * k) for k in range(9)])
assert len(BANDS) == 18
TEMP_DIR = RAW / "diviner_gcp"
TEMP_DIR.mkdir(exist_ok=True)

noon = np.full((NROWS, NCOLS), np.nan)
midnight = np.full((NROWS, NCOLS), np.nan)
for name, lo, hi in BANDS:
    cache = TEMP_DIR / f"noon_midnight_{name}.npz"          # small result per band: a rerun skips the work
    if not cache.exists():
        tab = download(f"{PDS_GCP}global_cumul_avg_cyl_{name}_002.tab",
                       TEMP_DIR / f"global_cumul_avg_cyl_{name}_002.tab", GCP_BYTES)
        d = pd.read_csv(tab, skipinitialspace=True, usecols=["clon", "clat", "ltim", "tbol"])
        assert len(d) == 1_382_400, f"{name}: {len(d)} rows"
        cube = np.full((NROWS, NCOLS, 96), np.nan, dtype="float32")
        gcp_to_cube(d.clon.to_numpy(), d.clat.to_numpy(), d.ltim.to_numpy(), d.tbol.to_numpy(), cube, lo, hi)
        n, m = noon_midnight(cube)
        np.savez_compressed(cache, noon=n, midnight=m)
    z = np.load(cache)
    r0, r1 = round((90 - hi) / CELL), round((90 - lo) / CELL)    # cell rows of this band
    noon[r0:r1] = z["noon"][r0:r1]
    midnight[r0:r1] = z["midnight"][r0:r1]
    print(name, "done")

grid["t_day_k"] = noon.ravel()
grid["t_night_k"] = midnight.ravel()
grid["t_swing_k"] = grid["t_day_k"] - grid["t_night_k"]
grid[["t_day_k", "t_night_k", "t_swing_k"]].describe()

# %% [markdown]
# ## 3. Terrain (LOLA LDEM_64)
#
# - File: `LDEM_64.IMG`, 23040 x 11520 samples, 16-bit little-endian signed integers, pixel registered, row 0 = north, columns = longitude 0 to 360 east. Height in metres = DN x 0.5 (relative to the 1737.4 km reference sphere). Read from the label `ldem_64.lbl`.
# - Resample: 2 x 2 block mean gives 32 pixels/degree = 0.97 km (the "~1 km" grid). Longitude is converted from 0..360 to -180..180.
# - `slope_deg`: slope of that 1 km grid on a sphere of radius 1737.4 km (1 deg = 30.32 km), central differences, then the mean over the 16 x 16 pixels of each 0.5 deg cell.
# - `elev_m`: mean elevation of the cell (relative to the reference sphere, not a geoid).
# - `rough_m`: **same rule as Earth**: std of the ~1 km elevations in a ~28 km window **after removing the window's best-fit plane**. A 0.5 deg Moon cell is only 15 km wide, so the window is **1 deg x 1 deg (about 30 km in latitude)** centred on each 0.5 deg cell. Neighbouring windows overlap. At high latitudes 1 deg of longitude is narrower than 30 km (cos(lat)), the same as for the Earth blocks. Over the poles the window continues on the far side.
# - Near the poles the east-west pixel size goes to 0. Poleward of about 60 deg the east-west difference spans several pixels (about 1 km baseline) so noise is not blown up. Slope in the first cell row at each pole is less reliable.
# - `elev_pct`: percentile (0 to 100) of `elev_m` over all valid Moon cells.

# %%
LDEM = download(PDS_LDEM, RAW / "ldem_64.img", LDEM_BYTES)
dn = np.memmap(LDEM, dtype="<i2", mode="r", shape=(11520, 23040))

z64 = np.empty((11520 // 2, 23040 // 2), dtype="float32")   # 2 x 2 block mean, in strips of rows
for r in range(0, 11520, 576):
    z64[r // 2: (r + 576) // 2] = block_mean(dn[r:r + 576].astype("float32") * 0.5, 2)
z = lon360_to_180(z64, axis=1)
del z64
assert z.shape == (180 * PPD, 360 * PPD)
print("elevation range m:", float(z.min()), float(z.max()))   # label (64 ppd): about -9125 to 10773

# %%
slope_1km = sphere_slope_deg(z, PPD)
f = round(CELL * PPD)
dem = pd.DataFrame({
    "cell_id": ids,
    "slope_deg": block_mean(slope_1km, f).ravel(),
    "rough_m": cell_roughness(z, PPD).ravel(),
    "elev_m": block_mean(z, f).ravel(),
})
del slope_1km
dem.describe().T

# %% [markdown]
# ## 4. Merge, percentile, save

# %%
df = grid.merge(dem, on="cell_id", how="left")
df["elev_pct"] = pct_rank(df["elev_m"])

COLS = ["cell_id", "lat", "lon", "t_day_k", "t_night_k", "t_swing_k",
        "slope_deg", "rough_m", "elev_m", "elev_pct"]
df = df[COLS]
df.to_parquet(OUT / "moon_thin.parquet", index=False)   # input of the later notebooks
if not (OUT / "moon.parquet").exists():                 # first hand-off; the merge notebook replaces it later
    df.to_parquet(OUT / "moon.parquet", index=False)
df.describe().T

# %% [markdown]
# ## 5. Checks and quick-look maps

# %%
import matplotlib.pyplot as plt

def at(lat, lon, col):
    return df.loc[(df.lat - lat).abs().add((df.lon - lon).abs()).idxmin(), col]

assert len(df) == NROWS * NCOLS and df.cell_id.is_unique
assert at(0, 0, "t_day_k") > at(85, 0, "t_day_k"), "Equator should be hotter than the pole at noon"
assert 350 < at(0, 0, "t_day_k") < 420, "noon at the equator should be near 390 K"
assert 80 < at(0, 0, "t_night_k") < 130, "midnight at the equator should be near 100 K"
assert at(0, 0, "t_swing_k") > at(85, 0, "t_swing_k")
# LOLA extremes: highest point 5.4 N, 201.4 E (= -158.6); deepest 70.4 S, 187.5 E (= -172.5)
assert at(5.4, -158.6, "elev_m") > 9000 and at(-70.4, -172.5, "elev_m") < -8000, "DEM orientation or longitude is wrong"
print("NaN share:", df[["t_day_k", "t_night_k"]].isna().mean().to_dict())

fig, axes = plt.subplots(3, 1, figsize=(12, 13))
for ax, col in zip(axes, ("t_day_k", "t_night_k", "slope_deg")):
    im = ax.imshow(df[col].to_numpy().reshape(NROWS, NCOLS), extent=(-180, 180, -90, 90))
    ax.set_title(col)
    fig.colorbar(im, ax=ax, shrink=0.7)
fig.savefig(OUT / "quicklook_moon_thin_slice.png", dpi=100, bbox_inches="tight")
