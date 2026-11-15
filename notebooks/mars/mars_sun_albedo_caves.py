# %% [markdown]
# # Job 2 depth: Mars sunlight, albedo, ATI and caves
#
# Output: `analog-finder/raw/mars/part_sun_albedo_caves.parquet` (Google Drive).
# Columns: `cell_id, sun_wm2, albedo, ati, cave_km`. The merge notebook joins this part file to the table.
#
# Grid: 0.5 deg, 360 rows x 720 columns. `cell_id = row * 720 + col`. Row 0 is lat 89.75 (planetocentric). Column 0 is lon -179.75 (east positive). `lat` and `lon` are cell centres.
#
# | Column | Meaning | Source |
# |---|---|---|
# | `sun_wm2` | Annual mean solar flux on a horizontal surface, all local times, all seasons (W/m2) | Mars Climate Database (MCD) web interface |
# | `albedo` | Bolometric Lambert albedo, 0 to 1 | TES albedo map (USGS Astropedia, 8 pixels/degree) |
# | `ati` | (1 - albedo) / (t_day_k - t_night_k) | albedo above, temperatures from `processed/mars_thin.parquet` |
# | `cave_km` | Great-circle km from the cell centre to the nearest cave candidate | Mars Global Cave Candidate Catalog v1 (Cushing) |
#
# Before you run:
# 1. No login is needed. All sources are public.
# 2. Run `mars_thin_slice` first. This notebook reads `processed/mars_thin.parquet`.
# 3. Run the cells in order. Downloads go to Drive. Existing files are not downloaded again.
# 4. Sunlight needs 12 small requests to the MCD web server (about 1 minute).

# %%
%pip -q install pyarrow requests rasterio

# %%
from pathlib import Path
from google.colab import drive

drive.mount("/content/drive")
ROOT = Path("/content/drive/MyDrive/analog-finder")
RAW = ROOT / "raw" / "mars"
OUT = ROOT / "processed"
MCD_DIR = RAW / "mcd_flux"
ALB_DIR = RAW / "tes_albedo"
CAVE_DIR = RAW / "cave_catalog"
for p in (RAW, OUT, MCD_DIR, ALB_DIR, CAVE_DIR):
    p.mkdir(parents=True, exist_ok=True)

CELL = 0.5                       # grid size in degrees (shared contract)
NROWS, NCOLS = 360, 720
MARS_RADIUS_KM = 3396.19         # IAU mean radius (shared contract)

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
    # Same function as the thin slice. vals[lat, lon] on a coarse regular grid (lat ascending,
    # lon -180..180 east, may repeat the first column at lon+360). Bilinear to the cell centres.
    lons = np.asarray(lons, dtype="float64")
    if np.isclose(lons[-1] - lons[0], 360.0):          # drop the repeated seam column
        lons, vals = lons[:-1], vals[:, :-1]
    lons_ext = np.append(lons, lons[0] + 360.0)
    vals_ext = np.concatenate([vals, vals[:, :1]], axis=1)
    cl = np.asarray(cell_lons, dtype="float64")
    assert cl.min() >= lons_ext[0] and cl.max() <= lons_ext[-1]
    tmp = _interp_axis(vals_ext, lons_ext, cl, axis=1)
    return _interp_axis(tmp, np.asarray(lats, dtype="float64"), np.asarray(cell_lats, dtype="float64"), axis=0)


def parse_mcd_flux(text, expect_ls=None):
    # Parses the MCD web interface ASCII export (layout verified on MCD_v6.2, same as the thin slice).
    # Header lines start with "###"; one line "---- ||  lat1 lat2 ..." (north latitudes);
    # then one line per longitude: "lon ||  v1 v2 ...", one value per latitude.
    # Returns lats (ascending), lons (ascending), vals[lat, lon] in W/m2.
    lines = text.splitlines()
    head = "\n".join(l for l in lines if l.startswith("###"))
    assert "Incident solar flux on horizontal surface (W/m2)" in head, "file is not fluxsurf_dn_sw"
    assert "climatology average solar" in head, "wrong dust scenario (need climatology average solar)"
    assert "Diurnal mean over all local times" in head, "file is not a diurnal mean"
    if expect_ls is not None:
        assert f"Ls {expect_ls:.1f}deg" in head, f"file is not Ls {expect_ls}"
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
    assert np.isfinite(vals).all() and vals.min() >= 0, "flux must be finite and not negative"
    return lats, lons, vals


MARS_ECC = 0.0934          # UNVERIFIED: orbital eccentricity, standard value from memory
MARS_LS_PERIHELION = 251.0 # UNVERIFIED: Ls of perihelion (deg), standard value from memory


def time_weights(ls_deg, ecc=MARS_ECC, ls_peri=MARS_LS_PERIHELION):
    # Weights of equally spaced Ls samples for a mean over TIME (not over Ls).
    # Kepler: time spent per degree of Ls is proportional to r^2, with r = (1 - e^2) / (1 + e cos(nu)),
    # nu = Ls - Ls_perihelion. Mars moves slowly near aphelion, so those seasons last longer.
    ls = np.asarray(ls_deg, dtype="float64")
    assert len(np.unique(np.round(np.diff(np.sort(ls)), 6))) == 1, "samples must be equally spaced"
    nu = np.radians(ls - ls_peri)
    r = (1 - ecc ** 2) / (1 + ecc * np.cos(nu))
    w = r ** 2
    return w / w.sum()


def annual_mean(maps, weights):
    # maps: list of 2-D arrays (one per Ls sample). Weighted mean; NaN if any map is NaN.
    weights = np.asarray(weights, dtype="float64")
    assert len(maps) == len(weights) and abs(weights.sum() - 1) < 1e-9
    return np.tensordot(weights, np.stack(maps), axes=1)


def block_mean_albedo(a, fill_value=0.06, block=4):
    # a: (H, W) TES albedo at 8 pixels/degree, row 0 = north, columns lon -180..180.
    # Rows where every pixel equals the fill value are the polar rows with no data -> NaN.
    # Cell value = mean of the block x block pixels. NaN if fewer than half the pixels are valid.
    a = np.asarray(a, dtype="float64").copy()
    a[np.isclose(a, fill_value).all(axis=1)] = np.nan
    a[a <= 0] = np.nan
    H, W = a.shape
    assert H % block == 0 and W % block == 0
    b = a.reshape(H // block, block, W // block, block).transpose(0, 2, 1, 3).reshape(H // block, W // block, -1)
    valid = np.isfinite(b)
    n = valid.sum(axis=2)
    s = np.where(valid, b, 0.0).sum(axis=2)
    return np.where(n >= block * block / 2, s / np.maximum(n, 1), np.nan)


def compute_ati(albedo, t_day, t_night):
    # Contract: ATI = (1 - albedo) / (t_day - t_night). NaN when the swing is <= 0 or an input is NaN.
    albedo, t_day, t_night = (np.asarray(x, dtype="float64") for x in (albedo, t_day, t_night))
    swing = t_day - t_night
    ok = np.isfinite(albedo) & np.isfinite(swing) & (swing > 0)
    out = np.full(swing.shape, np.nan)
    out[ok] = (1 - albedo[ok]) / swing[ok]
    return out


def haversine_km(lat1, lon1, lat2, lon2, radius_km=MARS_RADIUS_KM):
    # Great-circle distance in km. Inputs in degrees; arrays broadcast.
    p1, p2 = np.radians(lat1), np.radians(lat2)
    dphi = p2 - p1
    dlam = np.radians(lon2) - np.radians(lon1)
    h = np.sin(dphi / 2) ** 2 + np.cos(p1) * np.cos(p2) * np.sin(dlam / 2) ** 2
    return 2 * radius_km * np.arcsin(np.sqrt(np.clip(h, 0, 1)))


def nearest_km(lat, lon, pts_lat, pts_lon, chunk=20000):
    # Distance in km from each (lat, lon) to the nearest of the points. Chunked to limit memory.
    lat, lon = np.asarray(lat, dtype="float64"), np.asarray(lon, dtype="float64")
    pts_lat, pts_lon = np.asarray(pts_lat, dtype="float64"), np.asarray(pts_lon, dtype="float64")
    assert len(pts_lat) > 0 and len(pts_lat) == len(pts_lon)
    out = np.empty(len(lat))
    for i in range(0, len(lat), chunk):
        d = haversine_km(lat[i:i + chunk, None], lon[i:i + chunk, None], pts_lat[None, :], pts_lon[None, :])
        out[i:i + chunk] = d.min(axis=1)
    return out


def parse_cave_csv(path):
    # The CSV header line of the archive is wrong (it names 8 columns that do not match the data).
    # Column order comes from the PDS4 label Mars_Cave_Catalog.xml: ID_Tag, Longitude, Latitude,
    # Type_Code, Priority, APC_Diameter, APC_Depth, Comment. Longitude is 0..360 (checked below).
    d = pd.read_csv(path, header=None, skiprows=1,
                    names=["id", "lon", "lat", "type", "priority", "apc_diameter_m", "apc_depth_m", "comment"])
    assert len(d) == 1062 and d["id"].is_unique, "unexpected catalog size (expected 1062 records)"
    assert d["lon"].between(0, 360).all() and d["lat"].between(-90, 90).all()
    d["lon180"] = lon360_to_180(d["lon"])
    return d


# %% [markdown]
# ## 1. Grid

# %%
grid = cell_centres()
grid.shape

# %% [markdown]
# ## 2. Sunlight (Mars Climate Database, MCD)
#
# **Variable (verified in the web form).** `fluxsurf_dn_sw` = "Incident solar flux on horizontal surface (W/m2)". The variable list is in https://www-mars.lmd.jussieu.fr/mcd_python/listvar.js. Related names in the same list: `fluxtop_dn_sw` (top of the atmosphere), `fluxsurf_up_sw` (reflected), `fluxsurf_dn_sw_hr` (local slope, high resolution mode only; not used). The export header confirms the label: "Columns 2+ are Incident solar flux on horizontal surface (W/m2)".
#
# **Diurnal mean (verified by request).** The setting `averaging=loct` with `isfixedlt=off` returns a map that is already the mean over all local times. The header says "Diurnal mean over all local times". So one request replaces 24. The form has no visible control for this. The `diumean=on` field in the HTML is commented out and has no effect (tested: it still returns local time 12). `averaging=loct` together with `isfixedlt=on` fails on the server (UnboundLocalError), so keep `isfixedlt=off`.
#
# **Annual mean.** The notebook asks for 12 Ls values (0, 30, ..., 330), 12 requests in total. The mean is weighted by the time Mars spends near each Ls (Kepler second law, see `time_weights`), because the seasons have unequal length. A plain mean over Ls would over-count the short southern summer. The weights use eccentricity 0.0934 and perihelion at Ls 251 (UNVERIFIED, standard values from memory; the effect of a small error is small).
#
# - Dust scenario: `climatology average solar` (`dust=1`), the same as the thin slice.
# - Altitude: 10 m above the surface (form default). The solar flux on a horizontal surface should not depend on it. UNVERIFIED.
# - Resolution: native MCD grid, 64 longitudes (the last repeats the first) x 48 latitudes (about 5.6 x 3.8 deg). The notebook interpolates it to the 0.5 deg cells (bilinear). So the map is smooth and does not follow local slope or shadows. Dust-storm years are not included.
# - Polar night gives 0 W/m2 in the diurnal mean for that season. This is a true value, not missing.
#
# **Manual steps (if the server is down).** For each Ls in 0, 30, ..., 330:
# 1. Open https://www-mars.lmd.jussieu.fr/mcd_python/
# 2. Variable 1: `Incident solar flux on horizontal surface (W/m2)`. Variables 2 to 4: `(None)`.
# 3. Mars date: "Solar longitude (Ls)" and the Ls value. Latitude `all`, Longitude `all`, Altitude `10` m above surface.
# 4. Customize data request: "Same localtime everywhere" = off. "Averaging" = `local time` if offered (the web form may only offer it in the Python request). Dust scenario `climatology ave solar`.
# 5. Save the ASCII file as `mcd_fluxsurf_dn_sw_diumean_Ls000.txt` (pattern `Ls{Ls:03d}`) in `analog-finder/raw/mars/mcd_flux/`.

# %%
import re
import time
import requests

MCD_CGI = "https://www-mars.lmd.jussieu.fr/mcd_python/cgi-bin/mcdcgi.py"
MCD_TXT = "https://www-mars.lmd.jussieu.fr/mcd_python/txt/"
LS_SAMPLES = tuple(range(0, 360, 30))
MAX_TXT_BYTES = 1_000_000       # one export is about 50 kB


def mcd_name(ls):
    return MCD_DIR / f"mcd_fluxsurf_dn_sw_diumean_Ls{ls:03d}.txt"


def fetch_mcd(ls):
    # Same request pattern as the thin slice, verified for all 12 Ls values (header check in parse_mcd_flux).
    params = {
        "var1": "fluxsurf_dn_sw", "var2": "none", "var3": "none", "var4": "none",
        "datekeyhtml": "1", "ls": str(ls), "localtime": "12",     # localtime is ignored in the diurnal mean
        "latitude": "all", "longitude": "all", "altitude": "10", "zkey": "3",
        "spacecraft": "none", "betatest": "on", "isfixedlt": "off", "dust": "1", "hrkey": "0",
        "averaging": "loct", "zonmean": "off", "diumean": "off", "animation": "off", "animframes": "12",
        "dpi": "80", "islog": "off", "colorm": "jet", "proj": "cyl", "trans": "", "iswind": "off",
    }
    for attempt in range(4):                       # back off on 429 and 5xx: the server is small
        r = requests.get(MCD_CGI, params=params, timeout=120, headers={"User-Agent": "analog-finder-hackathon/1.0 (research use)"})
        if r.status_code not in (429, 500, 502, 503, 504):
            break
        time.sleep(5 * 2 ** attempt)
    r.raise_for_status()
    m = re.search(r"href='\.\./txt/([0-9a-f]+\.txt)'", r.text)
    assert m, f"No ASCII link in the MCD answer for Ls {ls}. Use the manual steps."
    with requests.get(MCD_TXT + m[1], timeout=120, stream=True, headers={"User-Agent": "analog-finder-hackathon/1.0 (research use)"}) as t:
        t.raise_for_status()
        data = b""
        for chunk in t.iter_content(65536):
            data += chunk
            assert len(data) <= MAX_TXT_BYTES, "MCD file larger than the size cap"
    mcd_name(ls).write_bytes(data)


todo = [ls for ls in LS_SAMPLES if not mcd_name(ls).exists()]
print(len(todo), "files to download")
for ls in todo:
    fetch_mcd(ls)
    time.sleep(1.0)     # be polite: the server is for moderate use
missing = [mcd_name(ls).name for ls in LS_SAMPLES if not mcd_name(ls).exists()]
assert not missing, f"MCD export files missing in {MCD_DIR}: {missing}. Use the manual steps in the text above."

# %%
cell_lats_asc = np.unique(grid["lat"])
cell_lons = np.unique(grid["lon"])
maps = []
for ls in LS_SAMPLES:
    lats, lons, vals = parse_mcd_flux(mcd_name(ls).read_text(), expect_ls=ls)
    maps.append(regrid_to_cells(vals, lats, lons, cell_lats_asc, cell_lons))
w = time_weights(LS_SAMPLES)
sun = annual_mean(maps, w)[::-1, :]                      # grid rows run north to south
grid["sun_wm2"] = sun.ravel()
print("weights:", np.round(w, 4))
grid["sun_wm2"].describe()

# %% [markdown]
# ## 3. Albedo (TES) and ATI
#
# **Product.** Mars Global Surveyor TES bolometric albedo, global mosaic, USGS Astropedia page https://astrogeology.usgs.gov/search/map/mars_mgs_tes_global_bolometric_albedo_map_7410m (Christensen et al., 2001, JGR 106 E10, 23823). Source of the map: ASU, PDS product `GLOBAL_ALBEDO_8PPD`.
# - File: https://planetarymaps.usgs.gov/mosaic/Mars_MGS_TES_Albedo_mosaic_global_7410m.tif (redirects to an S3 copy), 16,600,981 bytes, GeoTIFF, float32, 2880 columns x 1440 rows, one band.
# - Resolution: 8 pixels per degree = 0.125 deg (7,410 m per pixel). So one 0.5 deg cell = 4 x 4 pixels. No resampling beyond a block mean.
# - Unit: dimensionless Lambert albedo (broadband visible/near-IR, 0.3 to 2.9 micrometre). Range in the file: 0.06 to 0.32. Typical global median 0.19.
# - Coordinates: simple cylindrical, planetocentric, east positive, longitude -180 to 180 (pixel 0 is lon -180, row 0 is the north edge). Label radius 3396.0 km. Same orientation as our grid, so no roll is needed.
# - Missing data: the label has no NoData value in use. The 22 rows at each pole (|lat| above about 87.3 deg) hold the constant 0.06, which is a fill value (no TES coverage), not a measurement. The notebook sets those rows to NaN. Cells need at least 8 of 16 valid pixels, so the polar cell rows with |lat| above about 87 are NaN.
# - Limit: the map is a global mosaic with some brightness seams between orbit swaths. It is a regional-scale albedo only.
#
# **ATI.** Contract formula: `ati = (1 - albedo) / (t_day_k - t_night_k)`. NaN when the swing is 0 or less, or an input is NaN. The temperatures come from `processed/mars_thin.parquet` (MCD modelled, from the thin slice). The unit is 1/K.
#
# **Cross-check (not computed).** The TES thermal inertia map (Putzig and Mellon 2007; PDS file `global_ti_60n_50s_8ppd.img` is named on the PDS Geosciences TES special products page, covering 60N to 50S) could be compared with ATI. It is not added here: the product file was not verified in this session (UNVERIFIED) and the task rules say not to add it to the part file.

# %%
ALB_URL = "https://planetarymaps.usgs.gov/mosaic/Mars_MGS_TES_Albedo_mosaic_global_7410m.tif"
ALB_BYTES = 16_600_981
ALB_SHA256 = "c91dfcaa1834b96db383beddec537d85e8e82b782682744ee723907ed9e58178"   # pinned after checking the file
import hashlib


def sha256_of(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def download(url, dest, nbytes, sha):
    # Streams to a .part file, caps the size, checks length and SHA-256, then renames. Skips if dest is good.
    if dest.exists() and dest.stat().st_size == nbytes and sha256_of(dest) == sha:
        return dest
    part = dest.with_suffix(dest.suffix + ".part")
    got = 0
    with requests.get(url, stream=True, timeout=120, headers={"User-Agent": "analog-finder-hackathon/1.0 (research use)"}) as r:
        r.raise_for_status()
        with open(part, "wb") as f:
            for chunk in r.iter_content(1 << 20):
                got += len(chunk)
                assert got <= nbytes, "download larger than expected"
                f.write(chunk)
    assert got == nbytes, f"{dest.name}: got {got} bytes, expected {nbytes}"
    assert sha256_of(part) == sha, f"{dest.name}: SHA-256 differs from the pinned value"
    part.replace(dest)
    return dest


alb_path = download(ALB_URL, ALB_DIR / "Mars_MGS_TES_Albedo_mosaic_global_7410m.tif", ALB_BYTES, ALB_SHA256)

# %%
import rasterio

with rasterio.open(alb_path) as src:
    assert (src.width, src.height, src.count) == (2880, 1440, 1) and src.dtypes[0] == "float32"
    assert abs(src.transform.a - 7410.0) < 1e-6 and abs(src.bounds.top - 5335200.0) < 1e-6   # north-up, lon -180 at left
    tes = src.read(1)
alb = block_mean_albedo(tes)
assert alb.shape == (NROWS, NCOLS)
grid["albedo"] = alb.ravel()

thin = pd.read_parquet(OUT / "mars_thin.parquet", columns=["cell_id", "t_day_k", "t_night_k"])
assert len(thin) == NROWS * NCOLS and thin["cell_id"].is_unique
grid = grid.merge(thin, on="cell_id", how="left")
grid["ati"] = compute_ati(grid["albedo"], grid["t_day_k"], grid["t_night_k"])
grid[["albedo", "ati"]].describe()

# %% [markdown]
# ## 4. Caves (Mars Global Cave Candidate Catalog v1, Cushing)
#
# **Product.** USGS Astropedia https://astrogeology.usgs.gov/search/map/mars_global_cave_candidate_catalog_v1_cushing (MGC3, G. Cushing, published 2017-06-01, PDS4 archive `mars_mro.odyssey_multi_cavecatalog_cushing_2016`).
# - Download: https://astrogeology.usgs.gov/ckan/dataset/c2960f77-ee20-4cc6-ac85-abbecc0fc7f6/resource/ccd54fb2-9a50-46bf-8971-80c241bb2f40/download/mars_cave_catalog.zip (1,770,313 bytes).
# - File used: `data/Mars_Cave_Catalog.csv` in the zip. 1062 records, comma separated. The first line is a header that does not match the data. The columns follow the PDS4 label (`Mars_Cave_Catalog.xml`): `ID_Tag, Longitude (deg), Latitude (deg), Type_Code, Priority, APC_Diameter (m), APC_Depth (m), Comment`.
# - Coordinates: longitude 0 to 360 (min 2.0, max 349.7), latitude -71.9 to 85.1. The label does not state the longitude direction or the latitude type. East-positive is inferred: the candidates cluster at lon 235 to 250 with lat near 0, which is the Tharsis volcano region (Arsia, Pavonis, Ascraeus). UNVERIFIED: planetocentric latitude (a planetographic latitude would shift a point by under 0.3 deg, about 18 km at most; the effect on `cave_km` is of that size).
# - All 1062 candidates are used (all type codes and priorities). The catalog says most are only candidates; many are false positives. So `cave_km` means distance to a candidate, not to a real cave. The catalog covers only surveyed areas, so a large `cave_km` can mean "not surveyed".
# - Distance: great circle (haversine), radius 3396.19 km, from the cell centre to the point.

# %%
CAVE_URL = ("https://astrogeology.usgs.gov/ckan/dataset/c2960f77-ee20-4cc6-ac85-abbecc0fc7f6/"
            "resource/ccd54fb2-9a50-46bf-8971-80c241bb2f40/download/mars_cave_catalog.zip")
CAVE_BYTES = 1_770_313
CAVE_SHA256 = "d2703c128b29f47d44bd482344887156bae82831a636844d1418d75661726097"   # pinned after checking the file
import zipfile

zip_path = download(CAVE_URL, CAVE_DIR / "mars_cave_catalog.zip", CAVE_BYTES, CAVE_SHA256)
csv_path = CAVE_DIR / "Mars_Cave_Catalog.csv"
if not csv_path.exists():
    with zipfile.ZipFile(zip_path) as z:
        member = z.getinfo("data/Mars_Cave_Catalog.csv")
        assert member.file_size <= 20_000_000, f"cave catalog expands to {member.file_size} bytes"
        csv_path.write_bytes(z.read(member))
caves = parse_cave_csv(csv_path)
grid["cave_km"] = nearest_km(grid["lat"], grid["lon"], caves["lat"], caves["lon180"])
grid["cave_km"].describe()

# %% [markdown]
# ## 5. Checks and save

# %%
def at(lat, lon, col):
    return grid.loc[(grid.lat - lat).abs().add((grid.lon - lon).abs()).idxmin(), col]


assert at(0, 0, "sun_wm2") > at(85, 0, "sun_wm2"), "equator should get more annual sun than the pole"
assert at(8, 69, "albedo") < at(20, 0, "albedo") - 0.05, "Syrtis Major should be darker than Arabia Terra"
assert at(-1, -119.5, "cave_km") < 40, "the Tharsis volcano area (near -1 N, -119.5 E) should be near a cave candidate"
assert (grid["cave_km"] >= 0).all() and grid["cave_km"].notna().all()
assert grid["sun_wm2"].notna().all() and (grid["sun_wm2"] >= 0).all()

COLS = ["cell_id", "sun_wm2", "albedo", "ati", "cave_km"]
part = grid[COLS]
assert len(part) == NROWS * NCOLS and part["cell_id"].is_unique
part.to_parquet(RAW / "part_sun_albedo_caves.parquet", index=False)
part.describe().T

# %%
import matplotlib.pyplot as plt

fig, axes = plt.subplots(2, 2, figsize=(14, 8))
for ax, col in zip(axes.ravel(), ("sun_wm2", "albedo", "ati", "cave_km")):
    im = ax.imshow(part[col].to_numpy().reshape(NROWS, NCOLS), extent=(-180, 180, -90, 90))
    ax.set_title(col)
    fig.colorbar(im, ax=ax, shrink=0.7)
fig.savefig(OUT / "quicklook_mars_sun_albedo_caves.png", dpi=100, bbox_inches="tight")
