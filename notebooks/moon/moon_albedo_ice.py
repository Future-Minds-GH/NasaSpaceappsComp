# %% [markdown]
# # Job 2 depth: Moon albedo, ATI and ice
#
# Output: `analog-finder/raw/moon/part_albedo_ice.parquet` (Google Drive). Columns: `cell_id, albedo, ati, ice_prob, ice_surface`.
# Input from the thin slice: `analog-finder/processed/moon_thin.parquet` (`t_day_k`, `t_night_k`). Run `moon_thin_slice` first.
#
# Sources (all public on NASA PDS, no login):
# - **Albedo:** LROC WAC empirically normalized 643 nm mosaic, data set `LRO-L-LROC-5-RDR-V1.0`, folder https://pds.lroc.im-ldi.com/data/LRO-L-LROC-5-RDR-V1.0/LROLRC_2001/DATA/MDR/WAC_EMP/
#   - 8 equirectangular tiles `WAC_EMP_643NM_E300{N,S}{0450,1350,2250,3150}_064P.IMG` (64 pixels/degree, 88.5 MB each) for latitude -60 to 60.
#   - 2 polar stereographic tiles `WAC_EMP_643NM_P900{N,S}0000_152P.IMG` (152 pixels/degree, 200 m/pixel, 347 MB each) for 60 to 90 degrees.
# - **Cold traps:** LRO Diviner Polar Resource Product (PRP), data set `LRO-L-DLRE-5-PRP-V2.0`, `dlre_prp_{north,south}.tab` (605 MB each), folder https://pds-geosciences.wustl.edu/lro/urn-nasa-pds-lro_diviner_derived1/data_derived_prp/
# - **Hydrogen:** LRO LEND averaged counts (RDR ALD), data set `LRO-L-LEND-4/5-RDR-V1.0`, files `lend_rdr_{aldn,alds}_20090915.dat` (4.5 MB each), folder https://pds-geosciences.wustl.edu/lro/lro-l-lend-2-edr-v1/lrolen_0xxx/data/2009/20090915/
#
# Before you run: run the cells in order. About 1.5 GB of downloads go to Drive (`raw/moon`). If the session stops, run the cells again: finished files are skipped and part files resume.

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

CELL = 0.5
NROWS, NCOLS = 360, 720
R_MOON_M = 1_737_400.0           # Moon radius in metres (same sphere as the LROC and Diviner labels)

BOND_ALBEDO_MOON = 0.11          # global Bond albedo, NASA NSSDC Moon Fact Sheet (https://nssdc.gsfc.nasa.gov/planetary/factsheet/moonfact.html)
COLD_TRAP_K = 110.0              # annual maximum surface temperature below this: water ice is stable for about a billion years
CT_MIN_FRAC = 0.01               # ASSUMPTION: a 0.5 deg cell is a "cold trap cell" when at least 1 % of its area is below COLD_TRAP_K
LEND_MAX_PROB = 0.5              # ASSUMPTION: hydrogen alone (no thermal proof) never gives more than 0.5
LEND_SIGMA = 2.0                 # a suppression counts only above 2 x the statistical error of the count rate
LEND_SMOOTH_KM = 10.0            # Gaussian smoothing (sigma, km) of the LEND count rate; single 0.5 deg cells are pure noise (see section 6)
LEND_REF_PCT = 50                # reference count rate = median of the smoothed polar map
LEND_FULL_PCT = 99               # suppression at the 99th percentile maps to LEND_MAX_PROB

# %% [markdown]
# ## What each column is
#
# **`albedo` (0-1).** The WAC mosaic is **normalized reflectance at 643 nm**: the radiance factor I/F of the surface, brought to one standard geometry (incidence 30 deg, emission 0 deg, phase 30 deg) with an empirical photometric function (Boyd et al. 2012), as the median of about 142 images per pixel. It is **not** a Bond albedo. The Bond albedo is the fraction of all sunlight, over all wavelengths and all directions, that the surface reflects. `ATI` needs `albedo = 1 - absorbed fraction`, which is the Bond albedo. We turn the reflectance into a Bond albedo with one constant factor:
#
# `albedo = reflectance_643 x (0.11 / area-weighted global mean of reflectance_643)`
#
# This keeps the real cell-to-cell contrast of the mosaic and sets the global mean to the Bond albedo 0.11 of the NASA Moon Fact Sheet. Approximation and limits:
# - One red band stands in for the whole solar spectrum. The true Bond albedo of the bright highlands and dark maria differs a little from this scaling.
# - One factor for the phase integral and the 30 deg phase geometry: it ignores that the phase function changes with terrain.
# - Values are clipped to 0..1. Very rough, steep or shadowed ground at high latitude is less reliable (the 30 deg incidence normalization is an extrapolation there).
#
# **`ati`** = (1 - albedo) / (t_day_k - t_night_k), NaN when the day-night swing is <= 0 or an input is NaN. It is the contract formula (unit 1/K). It is an apparent thermal inertia proxy, not a true thermal inertia.
#
# **`ice_prob` (0-1).**
# 1. **1** in a cold trap cell. Source: Diviner PRP `temp_max` = annual maximum surface temperature (K) from a thermal model fitted to Diviner data, on a triangle mesh of a polar DEM (Kaguya laser altimeter), 2,880,000 triangles per pole, up to 80 deg (the corners reach about 75.9 deg). A triangle is a cold trap when `temp_max` < 110 K. A cell is a cold trap cell when the **area** of its cold trap triangles is at least 1 % of the triangle area in the cell (`CT_MIN_FRAC`, an assumption).
# 2. **Else, poleward of 80 deg: scaled from LEND hydrogen.** LEND's four collimated epithermal neutron detectors (`CSETN`) count fewer epithermal neutrons where hydrogen is more abundant (Mitrofanov et al. 2010, Science 330, 483). For each pole, with `rate` = `CSETN_RATE` (counts/s) and `err` = `CSETN_ERR`:
#    - smooth `rate` with a Gaussian of sigma 10 km (inverse-variance weights, distances in the polar stereographic plane); `err` becomes the error of the smoothed value. Without this the 0.5 deg cells are pure noise (section 6),
#    - `ref` = median of the smoothed `rate` over the polar map,
#    - `s = max(0, ref - rate - 2 x err) / ref` (relative suppression, only the part above 2 sigma),
#    - `ice_prob = 0.5 x min(1, s / s99)`, where `s99` = 99th percentile of `s` of that pole.
#    This is a **relative** scale, not a calibrated hydrogen abundance. The 0.5 cap and the percentiles are assumptions. LEND's collimated field of view is several km wide and the 0.5 deg cell is 15 km.
# 3. **0 elsewhere** (no evidence). The LEND equatorial product (`ALDE`, 1 deg cells) is not used: its count-rate variation is not a hydrogen signal we can calibrate.
#
# **`ice_surface` = 0 everywhere (choice).** Exposed surface ice on the Moon is not established at the 15 km cell scale. Li et al. (2018, PNAS 115, 8907) found water-ice signatures in Moon Mineralogy Mapper spectra in a few thousand pixels of about 280 m inside permanently shadowed regions: patchy, low abundance, far below one cell. The cold trap and LEND ice is buried or inferred, so it stays in `ice_prob` only. This follows the rule that buried ice is not counted twice.

# %% [markdown]
# ## 0. Math functions (pure numpy, tested locally on synthetic data)

# %%
# PURE FUNCTIONS START
import numpy as np
import pandas as pd


def lon360_to_180(a, axis=-1):
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


def clean_reflectance(a):
    # WAC pixels are 32-bit floats. ISIS special values (NULL 0xFF7FFFFB and the saturation codes) are about -3.4e38.
    # Real reflectance is > 0 and well below 1.
    a = np.asarray(a, dtype="float64")
    return np.where(np.isfinite(a) & (a > 0) & (a < 5), a, np.nan)


def polar_stereo_lonlat(rows, cols, south, c0, scale_m, radius_m=R_MOON_M):
    # Inverse of the LROC polar stereographic tiles (spherical, true scale at the pole):
    #   rho = 2 R tan(45 deg - |lat| / 2),  distance from the pole in metres, scale_m metres per pixel.
    # Pixel to map: col - c0 = rho sin(lon) / scale ; row - c0 = +rho cos(lon) / scale (north) or -rho cos(lon) / scale (south).
    # The sign rule was found by matching the tile edge (60 deg) to the equirectangular tiles (see write-up).
    # rows, cols: 0-based pixel indices (arrays that broadcast). c0 = 0-based pixel index of the pole (label offset).
    u = (np.asarray(cols, dtype="float64") - c0) * scale_m          # rho sin(lon)
    v = (np.asarray(rows, dtype="float64") - c0) * scale_m * (-1.0 if south else 1.0)   # rho cos(lon)
    rho = np.hypot(u, v)
    lat_abs = 90.0 - 2.0 * np.degrees(np.arctan(rho / (2.0 * radius_m)))
    lat = -lat_abs if south else lat_abs
    lon = np.degrees(np.arctan2(u, v))                                # -180..180, east positive
    return lat, lon


def cell_index(lat, lon):
    # Cell id of lat/lon (planetocentric degrees, lon -180..180). Edge values are clipped into the grid.
    r = np.clip(np.floor((90.0 - np.asarray(lat)) / CELL).astype(np.int64), 0, NROWS - 1)
    c = np.clip(np.floor((np.asarray(lon) + 180.0) / CELL).astype(np.int64), 0, NCOLS - 1)
    return r * NCOLS + c


def bin_sum_count(idx, val, total, count):
    # Add val (finite only) to per-cell sum and count arrays (length NROWS * NCOLS), in place.
    ok = np.isfinite(val)
    total += np.bincount(idx[ok], weights=val[ok], minlength=total.size)
    count += np.bincount(idx[ok], minlength=count.size)


def scale_to_bond(refl, lat, target):
    # Constant factor so that the cos(lat)-weighted global mean equals target.
    w = np.cos(np.radians(lat)) * np.isfinite(refl)
    mean = np.nansum(np.where(np.isfinite(refl), refl, 0.0) * w) / w.sum()
    return np.clip(refl * (target / mean), 0.0, 1.0), target / mean


def ati(albedo, t_day, t_night):
    # Contract formula. NaN when the swing is <= 0 or an input is NaN.
    swing = np.asarray(t_day, dtype="float64") - np.asarray(t_night, dtype="float64")
    a = np.asarray(albedo, dtype="float64")
    ok = np.isfinite(swing) & np.isfinite(a) & (swing > 0)
    return np.where(ok, (1.0 - a) / np.where(ok, swing, 1.0), np.nan)


def triangle_area_km2(v1, v2, v3):
    # v1, v2, v3: (n, 3) vertex coordinates in km. Flat triangle area.
    return 0.5 * np.linalg.norm(np.cross(v2 - v1, v3 - v1), axis=1)


def cold_trap_cells(lat, lon, tmax, area, thresh_k=COLD_TRAP_K, min_frac=CT_MIN_FRAC):
    # Area fraction of triangles with tmax < thresh_k per cell. Returns (fraction[cells] with NaN where no triangle, flag[cells]).
    ok = np.isfinite(tmax) & (tmax > 0) & np.isfinite(area)
    idx = cell_index(lat[ok], lon[ok])
    tot = np.bincount(idx, weights=area[ok], minlength=NROWS * NCOLS)
    cold = np.bincount(idx, weights=np.where(tmax[ok] < thresh_k, area[ok], 0.0), minlength=NROWS * NCOLS)
    frac = np.where(tot > 0, cold / np.where(tot > 0, tot, 1.0), np.nan)
    return frac, np.where(np.isfinite(frac), frac >= min_frac, False)


def polar_xy_km(lat, lon, south, radius_km=R_MOON_M / 1000.0):
    # Polar stereographic plane (true scale at the pole), km. Same sign rule as polar_stereo_lonlat.
    rho = 2.0 * radius_km * np.tan(np.radians(45.0 - np.abs(lat) / 2.0))
    l = np.radians(lon)
    return rho * np.sin(l), rho * np.cos(l) * (-1.0 if south else 1.0)


def smooth_inverse_variance(x, y, rate, err, sigma_km, block=500):
    # Gaussian-weighted mean of rate with weights k / err^2. Returns (smoothed rate, error of the smoothed rate).
    n = len(rate)
    iv = 1.0 / err ** 2
    out = np.empty(n)
    oe = np.empty(n)
    for a in range(0, n, block):
        d2 = (x[a:a + block, None] - x[None, :]) ** 2 + (y[a:a + block, None] - y[None, :]) ** 2
        k = np.exp(-d2 / (2.0 * sigma_km ** 2))
        w = k * iv[None, :]
        out[a:a + block] = (w * rate[None, :]).sum(1) / w.sum(1)
        oe[a:a + block] = np.sqrt((k ** 2 * iv[None, :]).sum(1)) / w.sum(1)
    return out, oe


def lend_to_cells(lat, lon360, rate, err):
    # LEND ALD rows -> arrays on the 0.5 deg grid (NaN where no row). lat/lon are cell centres (checked).
    lon = np.where(lon360 > 180, lon360 - 360, lon360)
    k = (90 - CELL / 2 - np.abs(lat)) / CELL if lat.mean() > 0 else (90 - CELL / 2 + lat) / CELL
    assert np.abs(k - np.round(k)).max() < 1e-3, "LEND latitudes are not 0.5 deg cell centres"
    assert np.abs((lon + 180 - CELL / 2) / CELL - np.round((lon + 180 - CELL / 2) / CELL)).max() < 1e-3, "LEND longitudes are not cell centres"
    idx = cell_index(lat, lon)
    assert np.unique(idx).size == idx.size, "two LEND rows in one cell"
    r = np.full(NROWS * NCOLS, np.nan)
    e = np.full(NROWS * NCOLS, np.nan)
    ok = np.isfinite(rate) & (rate > 0)
    r[idx[ok]] = rate[ok]
    e[idx[ok]] = err[ok]
    return r, e


def lend_prob(rate, err, ref_pct=LEND_REF_PCT, full_pct=LEND_FULL_PCT, sigma=LEND_SIGMA, max_prob=LEND_MAX_PROB):
    # One polar map (1-D arrays, NaN = no data). Returns ice probability from the relative epithermal suppression.
    ok = np.isfinite(rate)
    ref = np.percentile(rate[ok], ref_pct)
    s = np.where(ok, np.maximum(0.0, ref - rate - sigma * np.where(np.isfinite(err), err, 0.0)) / ref, np.nan)
    s_full = np.percentile(s[ok], full_pct)
    assert s_full > 0, "no significant suppression in this map"
    return np.where(ok, max_prob * np.minimum(1.0, s / s_full), np.nan)


def combine_ice(cold_flag, lend_p):
    # 1 in cold trap cells; else LEND value; else 0.
    p = np.where(np.isfinite(lend_p), lend_p, 0.0)
    return np.where(cold_flag, 1.0, np.clip(p, 0.0, 1.0))
# PURE FUNCTIONS END

# %% [markdown]
# ## 1. Download helper (resumable, size checked)

# %%
import hashlib
import requests

MAX_BYTES = 650_000_000            # size cap per file (largest: PRP 604,800,210)


def download(url, dest, expected_bytes):
    # Streams to dest + ".part" and resumes with a Range request. Fails fast on a wrong size.
    # UNVERIFIED: PDS gives no per-file checksum we could check, so we check the size (HTTP header, listing) and
    # write a sha256 next to the file the first time (compared on later runs).
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

# %% [markdown]
# ## 2. Grid and thin-slice input

# %%
ids = np.arange(NROWS * NCOLS)
rows, cols = np.divmod(ids, NCOLS)
lat_c = 90 - CELL / 2 - rows * CELL
lon_c = -180 + CELL / 2 + cols * CELL

thin = pd.read_parquet(OUT / "moon_thin.parquet", columns=["cell_id", "lat", "lon", "t_day_k", "t_night_k"])
assert len(thin) == NROWS * NCOLS and (thin.cell_id.to_numpy() == ids).all(), "moon_thin.parquet has a different grid"
assert np.allclose(thin.lat.to_numpy(), lat_c) and np.allclose(thin.lon.to_numpy(), lon_c)

# %% [markdown]
# ## 3. Albedo (LROC WAC 643 nm)
#
# Label facts (read from the files, PDS3 label in the first record):
# - Equirectangular tile: 5760 samples x 3840 lines, 32-bit little-endian float (`PC_REAL`), label = 1 record of 23040 bytes. Planetocentric, east positive. Tile `N` covers latitude 0 to 60, `S` covers -60 to 0; `0450 1350 2250 3150` are the centre longitudes (x10) of 0-90, 90-180, 180-270, 270-360 E.
# - Polar tile: 9312 x 9312 float32, label = 1 record of 37248 bytes, polar stereographic, `MAP_SCALE` 200 m/pixel, pole at `LINE_PROJECTION_OFFSET` = `SAMPLE_PROJECTION_OFFSET` = 4654.5 pixels from pixel (1,1) (0-based index 4654.5). Covers 60 deg to the pole (valid pixels lie inside a circle of 60 deg).
# - Pixel values: median of about 142 normalized observations. Null/saturation = 0xFF7FFFFB.. (about -3.4e38).
# - The two kinds of tile do not match exactly at 60 deg. One factor per pole removes the step (section 3c).
# - Overlap rule: cells with centre latitude between -60 and 60 come from the equirectangular tiles, others from the polar tiles. 60 is a multiple of 0.5 so no cell is split.

# %%
WAC_URL = "https://pds.lroc.im-ldi.com/data/LRO-L-LROC-5-RDR-V1.0/LROLRC_2001/DATA/MDR/WAC_EMP/"
EQ_BYTES = 23040 * 3841            # 88,496,640
POL_BYTES = 37248 * 9313           # 346,890,624
WAC_DIR = RAW / "wac_emp_643"
WAC_DIR.mkdir(exist_ok=True)

refl_sum = np.zeros(NROWS * NCOLS)
refl_cnt = np.zeros(NROWS * NCOLS)

# 3a. equirectangular tiles: 32 x 32 pixels per 0.5 deg cell
cells_eq = np.full((NROWS, NCOLS), np.nan)
for hemi, row0 in (("N", 60), ("S", 180)):            # cell row of latitude 60 / 0 (row = (90 - lat) / 0.5)
    for k, code in enumerate(("0450", "1350", "2250", "3150")):
        name = f"WAC_EMP_643NM_E300{hemi}{code}_064P.IMG"
        path = download(WAC_URL + name, WAC_DIR / name, EQ_BYTES)
        tile = np.memmap(path, dtype="<f4", mode="r", offset=23040, shape=(3840, 5760))
        cm = block_mean(clean_reflectance(tile), 32)                      # (120, 180)
        cells_eq[row0:row0 + 120, 180 * k:180 * k + 180] = cm
cells_eq = lon360_to_180(cells_eq, axis=1)                                # tiles run 0..360 E
print("equirect cells with data:", int(np.isfinite(cells_eq).sum()), "of", 240 * NCOLS)

# %%
# 3b. polar tiles: bin each pixel into its 0.5 deg cell (lat/lon from the stereographic inverse)
POL_C0 = 4654.5
for hemi in ("N", "S"):
    name = f"WAC_EMP_643NM_P900{hemi}0000_152P.IMG"
    path = download(WAC_URL + name, WAC_DIR / name, POL_BYTES)
    tile = np.memmap(path, dtype="<f4", mode="r", offset=37248, shape=(9312, 9312))
    cc = np.arange(9312)[None, :]
    for r0 in range(0, 9312, 400):
        rr = np.arange(r0, min(r0 + 400, 9312))[:, None]
        lat, lon = polar_stereo_lonlat(rr, cc, hemi == "S", POL_C0, 200.0)
        v = clean_reflectance(tile[r0:r0 + 400])
        v = np.where(np.abs(lat) >= 60.0, v, np.nan)                      # keep only the polar cap
        m = np.isfinite(v)
        bin_sum_count(cell_index(lat[m], lon[m]), v[m], refl_sum, refl_cnt)
cells_pol = np.where(refl_cnt > 0, refl_sum / np.maximum(refl_cnt, 1), np.nan).reshape(NROWS, NCOLS)

# 3c. The polar tiles (152 ppd, made on their own) are a few percent darker than the equirectangular tiles at 60 deg
# (about 10 to 19 % in a test strip). Remove the step with one factor per pole: ratio of the mean of the 2 cell rows on
# each side of the 60 deg line (rows 58-59 / 60-61 north, 298-299 / 300-301 south). This is an approximation.
cells_pol = cells_pol.copy()
for rows_pol, rows_eq, rows_cap in (((58, 60), (60, 62), slice(0, 60)), ((300, 302), (298, 300), slice(300, 360))):
    f_seam = np.nanmean(cells_eq[rows_eq[0]:rows_eq[1]]) / np.nanmean(cells_pol[rows_pol[0]:rows_pol[1]])
    assert 0.7 < f_seam < 1.4, f"unexpected seam factor {f_seam}"
    print("polar seam factor", rows_cap, f_seam)
    cells_pol[rows_cap] *= f_seam

refl = np.where(np.abs(lat_c).reshape(NROWS, NCOLS)[:, :1] < 60, cells_eq, cells_pol).ravel()
print("cells with reflectance:", int(np.isfinite(refl).sum()), "of", refl.size)

# %%
albedo, factor = scale_to_bond(refl, lat_c, BOND_ALBEDO_MOON)
print("scale factor reflectance -> Bond albedo:", factor)
print(pd.Series(refl).describe())
print(pd.Series(albedo).describe())

# %% [markdown]
# ## 4. ATI

# %%
ati_v = ati(albedo, thin.t_day_k.to_numpy(), thin.t_night_k.to_numpy())
print(pd.Series(ati_v).describe())

# %% [markdown]
# ## 5. Cold traps (Diviner PRP)
#
# Label facts (`dlre_prp_south.xml`): ASCII table, header line of 210 bytes + 2,880,000 records of 210 bytes, 15 columns: `tri1_x..tri3_z` (triangle vertices, km, Moon-centred x, y, z), `tri_clon` (planetocentric east longitude of the triangle centre, degrees), `tri_clat` (planetocentric latitude, degrees), `tri_calt` (km), `temp_avg` (K, 2 cm depth), `temp_max` (K, annual maximum **at the surface**), `ice_depth` (m, -999 = none within 2.87 m). The triangles come from a polar DEM. Each table already has the centre of each triangle as latitude and longitude, so **no map projection is needed**: we bin the centres into the 0.5 deg cells. Each triangle is weighted by its area (from the vertices).

# %%
PRP_URL = "https://pds-geosciences.wustl.edu/lro/urn-nasa-pds-lro_diviner_derived1/data_derived_prp/"
PRP_BYTES = 210 * 2_880_001         # 604,800,210 (label: 210-byte header + 2,880,000 records)
PRP_COLS = ["tri1_x", "tri1_y", "tri1_z", "tri2_x", "tri2_y", "tri2_z", "tri3_x", "tri3_y", "tri3_z",
            "tri_clon", "tri_clat", "temp_max"]


def read_prp(path_or_buf):
    d = pd.concat(pd.read_csv(path_or_buf, skipinitialspace=True, usecols=PRP_COLS, chunksize=250_000), ignore_index=True)   # chunks keep the peak memory low
    d.columns = [c.strip() for c in d.columns]
    return d


def prp_cells(d):
    area = triangle_area_km2(d[["tri1_x", "tri1_y", "tri1_z"]].to_numpy(), d[["tri2_x", "tri2_y", "tri2_z"]].to_numpy(),
                             d[["tri3_x", "tri3_y", "tri3_z"]].to_numpy())
    lon = d.tri_clon.to_numpy()
    lon = np.where(lon > 180, lon - 360, lon)                              # file is -180..180; this guards 0..360
    return cold_trap_cells(d.tri_clat.to_numpy(), lon, d.temp_max.to_numpy(), area)


ct_frac = np.full(NROWS * NCOLS, np.nan)
ct_flag = np.zeros(NROWS * NCOLS, dtype=bool)
for pole in ("north", "south"):
    path = download(PRP_URL + f"dlre_prp_{pole}.tab", RAW / f"dlre_prp_{pole}.tab", PRP_BYTES)
    d = read_prp(path)
    assert len(d) == 2_880_000, f"{pole}: {len(d)} rows"
    assert (d.tri_clat > 0).all() if pole == "north" else (d.tri_clat < 0).all(), "wrong hemisphere"
    fr, fl = prp_cells(d)
    ct_frac = np.where(np.isfinite(fr), fr, ct_frac)
    ct_flag |= fl
    del d
print("cold trap cells:", int(ct_flag.sum()), "| cells with PRP coverage:", int(np.isfinite(ct_frac).sum()))

# %% [markdown]
# ## 6. LEND hydrogen (poleward of 80 deg)
#
# Label facts (`lend_rdr_aldn_20090915.lbl`, `lend_rdr_ald.fmt`): binary table, 14,400 rows x 310 bytes = 4,464,000 bytes, big-endian IEEE floats. One row per 0.5 deg cell above 80 deg (20 latitude bands x 720 longitudes). Row order: band centred 89.75 first, longitude 0.25 to 359.75 E inside a band (`lunarcentric` latitude, east longitude). Column byte offsets (1-based start): `LUNARCENTRIC_LATITUDE` 47, `LUNARCENTIC_EAST_LONGITUDE` 51, `CSETN_EXPOSURE` 107 (s), `CSETN_RATE` 111 (counts/s), `CSETN_ERR` 115 (statistical error of the rate). `CSETN` = sum of the four collimated epithermal detectors.
#
# **Noise.** On the raw 0.5 deg cells the count rate is almost pure noise: its standard deviation (0.24 counts/s) is about the median statistical error (0.22), and neighbouring cells are not correlated (lag-1 autocorrelation about 0). So we smooth with a Gaussian of sigma `LEND_SMOOTH_KM` before we look for suppression. After smoothing, the rate is lowest at the large south polar cold trap craters (Shoemaker, Faustini, Haworth, Shackleton: 8 to 13 sigma below the median).
#
# We use the file with the date 20090915 (data from 2009-09-15 to 2011-12-11, the low circular mapping orbit). The second file (`20111211`, 2011-12-11 to 2016-09-14) has exposure -1 and rate -1 in about 7 % of the cells and a different orbit height, so it is not mixed in.

# %%
LEND_URL = "https://pds-geosciences.wustl.edu/lro/lro-l-lend-2-edr-v1/lrolen_0xxx/data/2009/20090915/"
LEND_DIR = RAW / "lend_ald"
LEND_DIR.mkdir(exist_ok=True)
LEND_ROW, LEND_ROWS = 310, 14400
lend_p = np.full(NROWS * NCOLS, np.nan)
for pole in ("n", "s"):
    name = f"lend_rdr_ald{pole}_20090915.dat"
    path = download(LEND_URL + name, LEND_DIR / name, LEND_ROW * LEND_ROWS)
    raw = np.fromfile(path, dtype=np.uint8).reshape(LEND_ROWS, LEND_ROW)

    def col(first_byte_1based):
        o = first_byte_1based - 1
        return raw[:, o:o + 4].copy().view(">f4").ravel().astype("float64")

    lat, lon360, expo, rate, err = col(47), col(51), col(107), col(111), col(115)
    assert (lat > 80).all() if pole == "n" else (lat < -80).all(), "wrong hemisphere"
    assert expo.min() > 0 and 0 < rate.min() and rate.max() < 100 and err.min() > 0, "unexpected LEND values"
    lon180 = np.where(lon360 > 180, lon360 - 360, lon360)
    px, py = polar_xy_km(lat, lon180, pole == "s")
    rate_s, err_s = smooth_inverse_variance(px, py, rate, err, LEND_SMOOTH_KM)
    r, e = lend_to_cells(lat, lon360, rate_s, err_s)
    p = lend_prob(r, e)
    lend_p = np.where(np.isfinite(p), p, lend_p)
    print(pole, "rate min/median/max:", rate.min(), np.median(rate), rate.max(), "| prob max:", np.nanmax(p), "| cells > 0.25:", int((p > 0.25).sum()))

# %% [markdown]
# ## 7. Combine, save

# %%
ice_prob = combine_ice(ct_flag, lend_p)
ice_surface = np.zeros(NROWS * NCOLS)          # exposed surface ice not established at 15 km: see "What each column is"

part = pd.DataFrame({"cell_id": ids, "albedo": albedo, "ati": ati_v, "ice_prob": ice_prob, "ice_surface": ice_surface})
part.to_parquet(RAW / "part_albedo_ice.parquet", index=False)
part.describe().T

# %% [markdown]
# ## 8. Checks and quick-look maps

# %%
import matplotlib.pyplot as plt


def at(lat, lon, arr):
    return arr[np.argmin(np.abs(lat_c - lat) + np.abs(lon_c - lon))]


assert len(part) == NROWS * NCOLS and part.cell_id.is_unique
assert part.ice_prob.between(0, 1).all() and part.albedo.dropna().between(0, 1).all()
assert part.ice_surface.eq(0).all()
# Mare Tranquillitatis (dark) must be darker than the nearby highlands (bright); Tycho region bright.
assert at(8, 30, albedo) < at(-20, 20, albedo), "maria should be darker than highlands"
# no seam where the polar tiles meet the equirectangular tiles
seam = np.nanmedian(albedo.reshape(NROWS, NCOLS)[58:62], axis=1)
print("median albedo by row around 60 N:", seam)
assert np.nanmax(np.abs(np.diff(seam))) < 0.04, "seam between WAC tiles"
# Known cold traps: Cabeus (-84.9, -35.5), Shackleton (-89.9). Look at the values; both poles must have cold trap cells.
print("ice_prob at Cabeus / Shackleton / Shoemaker (-88.1, 44.9):", at(-84.9, -35.5, ice_prob), at(-89.75, 0.25, ice_prob), at(-88.1, 44.9, ice_prob))
n_ct = int(ct_flag.reshape(NROWS, NCOLS)[:90].sum()), int(ct_flag.reshape(NROWS, NCOLS)[270:].sum())
print("cold trap cells N / S:", n_ct)
assert min(n_ct) > 0, "no cold trap cells at one pole"
print("NaN share:", part[["albedo", "ati", "ice_prob"]].isna().mean().to_dict())

fig, axes = plt.subplots(3, 1, figsize=(12, 13))
for ax, col_ in zip(axes, ("albedo", "ati", "ice_prob")):
    im = ax.imshow(part[col_].to_numpy().reshape(NROWS, NCOLS), extent=(-180, 180, -90, 90))
    ax.set_title(col_)
    fig.colorbar(im, ax=ax, shrink=0.7)
fig.savefig(OUT / "quicklook_moon_albedo_ice.png", dpi=100, bbox_inches="tight")
