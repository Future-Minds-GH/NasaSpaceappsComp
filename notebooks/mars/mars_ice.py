# %% [markdown]
# # Job 2 depth unit: Mars ice probability
#
# Output: `analog-finder/raw/mars/part_ice.parquet` (Google Drive). Columns: `cell_id, ice_prob, ice_surface`.
#
# Grid: 0.5 deg, 360 rows x 720 columns. `cell_id = row * 720 + col`. Row 0 is lat 89.75. Column 0 is lon -179.75 (east positive).
#
# ## Sources
# | Source | Use | Facts (verified unless marked) |
# |---|---|---|
# | SWIM ice-consistency maps, swim.psi.edu (Morgan et al. 2021, Nature Astronomy, doi:10.1038/s41550-020-01290-z) | northern mid-latitudes, `ice_prob = (x + 1) / 2` | Values -1..+1. GeoTIFF files on the SWIM site (page `https://swim.psi.edu/NorthHemisProducts.php`). The site returned HTTP 523 when this notebook was written. **UNVERIFIED:** exact file name, projection, pixel size (about 3 km per pixel is quoted for the later maps, Morgan et al. 2025, doi:10.3847/PSJ/ad9b24), nodata value, latitude coverage. |
# | Polar caps = 1 | residual north and south caps | Boundary shapefiles in the Mendeley Data sets of Xiao et al. 2021 (north: doi:10.17632/x953mzxxvv.1, folder `NP_topography_from_self_registration_of_MOLA_profiles`; south: doi:10.17632/z59b9nd6s9.2, folder `Shapefile_for_Residual_South_Polar_Cap`, boundary from Skinner et al. 2006). CC BY 4.0. The pages show no direct file URLs, so you download these by hand. **UNVERIFIED:** shapefile names and the coordinate system. |
# | Odyssey GRS hydrogen (H2O wt%) | elsewhere, low/mid latitudes | PDS data set `ODY-M-GRS-5-ELEMENTS-V1.0`, file `h2o_sr_5x5.tab` (186,624 bytes, SHA-256 pinned below). Boynton et al. 2007, JGR 112, E12S99, doi:10.1029/2007JE002887. 5 x 5 degree bins (2 deg data smoothed with a 10 deg boxcar), unit WEIGHT PERCENT H2O, bin centre lat -87.5..87.5 and lon 2.5..357.5 (east), `9999.999` = no data. Real file: 1508 of 2592 bins have data, all within lat -57.5..57.5, range 1.645..7.398 wt%. |
#
# **Deviation from the task text.** The task asks for the neutron-spectrometer water-equivalent-hydrogen (WEH) maps (Feldman et al. 2011; Pathare et al. 2018). I could not find a downloadable WEH table with a verified URL. The verified product here is the Odyssey GRS hydrogen concentration (gamma-ray H, same instrument suite as the neutron spectrometer). It has the same unit idea (wt% of water-equivalent). If you get the WEH map, replace `load_grs_h2o` only.
#
# ## How the sources combine
# 1. SWIM value `x` (-1..+1) becomes `(x + 1) / 2`. A value of -1 is an explicit "no ice" and gives 0.
# 2. GRS wt% becomes `min(wt% / ICE_WEH_FULL, 1)` (see the scaling cell). It is low in the tropics on purpose: hydrogen there is mostly hydrated minerals, not ice.
# 3. Polar-cap cells are 1.
# 4. Where sources overlap, SWIM wins where it has a value (it is the finest map and its -1 means "no ice", which a coarse hydrogen map must not override). Elsewhere GRS. Polar caps are always 1.
# 5. Poleward of about 60 deg (where GRS ends; the fill starts at 57.5 deg but GRS wins up to 60), a cell with no source value outside a cap gets `ICE_HIGHLAT_PROB` (0.8). This is an ASSUMPTION (see the constants): it keeps the Phoenix area and the high latitudes from dropping out. Any other cell with no source stays NaN, not 0.
# 6. A missing SWIM file or cap shapefile is skipped with a warning (the notebook still runs). Without the caps, `ice_surface` is 0 everywhere.
#
# `ice_surface` = 1 inside the polar-cap polygons, 0 everywhere else. Buried mid-latitude ice is not surface ice. Seasonal frost is not mapped.

# %%
%pip -q install pyarrow requests pyshp rasterio

# %%
from pathlib import Path
from google.colab import drive

drive.mount("/content/drive")
ROOT = Path("/content/drive/MyDrive/analog-finder")
RAW = ROOT / "raw" / "mars"
OUT = ROOT / "processed"
SWIM_DIR = RAW / "swim"      # put the SWIM GeoTIFF(s) here
CAP_DIR = RAW / "polar_caps" # put both residual-cap shapefile sets here (.shp .shx .dbf)
GRS_DIR = RAW / "grs_h2o"
for p in (RAW, OUT, SWIM_DIR, CAP_DIR, GRS_DIR):
    p.mkdir(parents=True, exist_ok=True)

CELL = 0.5
NROWS, NCOLS = 360, 720
MARS_RADIUS_M = 3_396_190.0

GRS_URL = "https://pds-geosciences.wustl.edu/ody/ody-m-grs-5-elements-v1/odgm_xxxx/data/smoothed/h2o_sr_5x5.tab"
GRS_SHA256 = "5cec0d637755ddb7a451f58d7b24b6fb34f081e3391b40cdfca5410200da0236"
GRS_NODATA = 9999.999
GRS_BIN = 5.0

# Scaling of GRS H2O wt% to 0-1. ASSUMPTION (UNVERIFIED as a physical threshold): linear, and 30 wt% counts as
# "ice-rich" (probability 1). Basis: Feldman et al. 2004 (JGR 109, E09006) and Boynton et al. 2007 report ice-rich
# soil as tens of wt% at high latitude; pure ice is 100 wt%. All real values in this map are <= 7.4 wt%,
# so the equatorial probability stays below 0.25. Change one number to change the scale.
ICE_WEH_FULL = 30.0

# High latitudes with no source. The GRS hydrogen map has bins centred up to 57.5 deg (so it reaches about 60 deg) and SWIM covers only the northern mid-latitudes,
# so cells poleward of ICE_HIGHLAT_MIN that are not in a polar cap would have no value. Ground ice is known there: the
# Phoenix landing site (68 N) found shallow ground ice, and Odyssey sees high hydrogen poleward of about 60 deg.
# ASSUMPTION (UNVERIFIED as a number, and the citations were not checked): fill these cells with ICE_HIGHLAT_PROB.
# It is applied only where no source has a value, so SWIM, GRS and the caps always win.
ICE_HIGHLAT_MIN = 57.5
ICE_HIGHLAT_PROB = 0.8

# %% [markdown]
# ## 0. Pure functions (tested on synthetic data)

# %%
import numpy as np
import pandas as pd


def cell_centres():
    ids = np.arange(NROWS * NCOLS)
    rows, cols = np.divmod(ids, NCOLS)
    return pd.DataFrame({"cell_id": ids, "lat": 90 - CELL / 2 - rows * CELL, "lon": -180 + CELL / 2 + cols * CELL})


def swim_to_prob(x):
    # SWIM ice consistency -1..+1 -> probability 0..1. Out-of-range values are an error, NaN stays NaN.
    x = np.asarray(x, dtype="float64")
    assert not np.any(np.abs(x[np.isfinite(x)]) > 1 + 1e-6), "SWIM values outside -1..+1"
    return (np.clip(x, -1, 1) + 1) / 2


def weh_to_prob(wt_pct, full=ICE_WEH_FULL):
    # Linear scale of water-equivalent hydrogen (wt%) to 0..1. NaN stays NaN. Negative values clip to 0.
    return np.clip(np.asarray(wt_pct, dtype="float64") / full, 0.0, 1.0)


def parse_grs_table(path):
    # Columns: lat, lon (0..360 east), conc, sigma, sigma_cfs. Returns a (36, 72) array, row 0 = lat -87.5 (south first).
    d = np.loadtxt(path)
    assert d.shape == (2592, 5), d.shape
    lat, lon, conc = d[:, 0], d[:, 1], d[:, 2].copy()
    conc[conc >= GRS_NODATA - 1e-6] = np.nan
    r = np.rint((lat + 87.5) / GRS_BIN).astype(int)
    c = np.rint((lon - 2.5) / GRS_BIN).astype(int)
    assert r.min() == 0 and r.max() == 35 and c.min() == 0 and c.max() == 71
    grid = np.full((36, 72), np.nan)
    grid[r, c] = conc
    return grid


def grs_to_cells(grid, lat_c, lon_c):
    # Nearest 5-degree bin for each 0.5-degree cell centre (the data are smoothed over 10 deg, so no interpolation).
    r = np.clip(np.floor((np.asarray(lat_c) + 90) / GRS_BIN).astype(int), 0, 35)
    c = np.floor((np.asarray(lon_c) % 360.0) / GRS_BIN).astype(int) % 72
    return grid[r, c]


def polar_xy(lat, lon):
    # Azimuthal equidistant projection about the nearest pole: radius = angular distance (deg) from the pole.
    lat = np.asarray(lat, dtype="float64")
    lon = np.radians(np.asarray(lon, dtype="float64"))
    rad = 90.0 - np.abs(lat)
    return rad * np.cos(lon), rad * np.sin(lon)


def ring_mask(ring_lonlat, lat_c, lon_c):
    # True for cell centres inside one ring (list of (lon, lat)), tested in polar projection. Ring and cells must
    # be in one hemisphere (the sign of the mean ring latitude picks it).
    from matplotlib.path import Path as MPath
    ring = np.asarray(ring_lonlat, dtype="float64")
    assert ring.ndim == 2 and ring.shape[1] >= 2
    assert np.abs(ring[:, 0]).max() <= 360 and np.abs(ring[:, 1]).max() <= 90, "shapefile is not in lon/lat degrees"
    north = ring[:, 1].mean() > 0
    sel = (np.asarray(lat_c) > 0) if north else (np.asarray(lat_c) < 0)
    px, py = polar_xy(ring[:, 1], ring[:, 0])
    cx, cy = polar_xy(np.asarray(lat_c)[sel], np.asarray(lon_c)[sel])
    inside = MPath(np.column_stack([px, py])).contains_points(np.column_stack([cx, cy]))
    out = np.zeros(len(lat_c), dtype=bool)
    out[sel] = inside
    return out


def polygon_mask(rings, lat_c, lon_c):
    # Even-odd union of rings (a ring inside another ring is a hole).
    m = np.zeros(len(lat_c), dtype=bool)
    for ring in rings:
        m ^= ring_mask(ring, lat_c, lon_c)
    return m


def combine_sources(swim_p, grs_p, cap_mask):
    # SWIM wins where it has a value (so a SWIM -1, "no ice", gives 0 and is not overridden by the coarse GRS map).
    # Elsewhere GRS. Polar-cap cells are 1. No source -> NaN.
    swim_p, grs_p = np.asarray(swim_p, dtype="float64"), np.asarray(grs_p, dtype="float64")
    out = np.where(np.isfinite(swim_p), swim_p, grs_p)
    return np.where(cap_mask, 1.0, out)


def fill_high_latitude(ice, lat, min_lat=ICE_HIGHLAT_MIN, value=ICE_HIGHLAT_PROB):
    # Cells at or poleward of min_lat with no value from any source get `value` (an assumption, see the constants).
    ice = np.asarray(ice, dtype="float64")
    return np.where(np.isnan(ice) & (np.abs(np.asarray(lat, dtype="float64")) >= min_lat), value, ice)


def ice_surface_from_caps(cap_mask):
    return np.where(cap_mask, 1.0, 0.0)


# %%
# SWIM raster -> 0.5 deg cells (area average of the source pixels, so a 3 km raster becomes a cell mean).
MARS_GEOG_WKT = (
    'GEOGCS["Mars sphere",DATUM["Mars_sphere",SPHEROID["Mars",3396190,0]],'
    'PRIMEM["Reference_Meridian",0],UNIT["degree",0.0174532925199433]]'
)


def swim_tif_to_cells(path):
    import rasterio
    from rasterio.crs import CRS
    from rasterio.transform import from_origin
    from rasterio.warp import Resampling, reproject
    dst = np.full((NROWS, NCOLS), np.nan, dtype="float32")
    with rasterio.open(path) as src:
        assert src.crs is not None, "SWIM GeoTIFF has no CRS"
        a = src.read(1).astype("float32")
        nod = src.nodata
        if nod is not None:
            a[a == nod] = np.nan
        a[(a < -1.0001) | (a > 1.0001)] = np.nan   # anything outside -1..+1 is not data
        reproject(a, dst, src_transform=src.transform, src_crs=src.crs, src_nodata=np.nan,
                  dst_transform=from_origin(-180, 90, CELL, CELL), dst_crs=CRS.from_wkt(MARS_GEOG_WKT),
                  dst_nodata=np.nan, resampling=Resampling.average)
    return dst.ravel().astype("float64")


def read_cap_rings(shp_paths):
    import shapefile  # pyshp
    rings = []
    for p in shp_paths:
        for shp in shapefile.Reader(str(p)).shapes():
            pts = np.asarray(shp.points, dtype="float64")
            parts = list(shp.parts) + [len(pts)]
            rings += [pts[parts[i]:parts[i + 1]] for i in range(len(parts) - 1)]
    return rings


# %% [markdown]
# ## 1. Tests on synthetic data (run before the real data)

# %%
def run_tests():
    assert np.allclose(swim_to_prob([-1, 0, 1, np.nan])[:3], [0, 0.5, 1]) and np.isnan(swim_to_prob([np.nan])[0])
    assert np.allclose(weh_to_prob([0, 15, 30, 60, -2]), [0, 0.5, 1, 1, 0]) and np.isnan(weh_to_prob([np.nan])[0])
    # GRS grid: bin lookup incl. longitude wrap and -180..180 cells
    g = np.arange(36 * 72, dtype=float).reshape(36, 72)
    assert grs_to_cells(g, [-87.5], [2.5])[0] == g[0, 0]
    assert grs_to_cells(g, [87.4], [-0.25])[0] == g[35, 71]        # lon -0.25 = 359.75 -> last column
    assert grs_to_cells(g, [0.25], [-179.75])[0] == g[18, 36]      # lon -179.75 = 180.25 -> column 36
    # polar ring around the north pole at 80 N (a line in lon/lat, a disc in the polar view)
    c = cell_centres()
    ring = [(lo, 80.0) for lo in np.linspace(-180, 180, 73)]
    m = ring_mask(ring, c.lat.values, c.lon.values)
    assert m[(c.lat > 80.5)].all() and not m[(c.lat < 79.5)].any()
    # hole: inner ring at 88 N is excluded
    inner = [(lo, 88.0) for lo in np.linspace(-180, 180, 73)]
    pm = polygon_mask([ring, inner], c.lat.values, c.lon.values)
    assert not pm[c.lat > 88.5].any() and pm[(c.lat > 80.5) & (c.lat < 87.5)].all()
    # south ring does not leak north
    sring = [(lo, -75.0) for lo in np.linspace(-180, 180, 73)]
    sm = ring_mask(sring, c.lat.values, c.lon.values)
    assert sm[c.lat < -75.5].all() and not sm[c.lat > 0].any()
    # combine: max, NaN kept, caps win
    out = combine_sources(np.array([0.2, np.nan, np.nan, 0.0]), np.array([0.1, 0.3, np.nan, np.nan]),
                          np.array([False, False, False, True]))
    assert np.allclose(out[:2], [0.2, 0.3]) and np.isnan(out[2]) and out[3] == 1.0
    assert list(ice_surface_from_caps(np.array([True, False]))) == [1.0, 0.0]
    # high latitudes: filled only where nothing else has a value, both hemispheres
    f = fill_high_latitude(np.array([np.nan, np.nan, 0.1, np.nan, np.nan]), np.array([70.0, -65.0, 70.0, 30.0, -57.4]))
    assert np.allclose(f[:3], [ICE_HIGHLAT_PROB, ICE_HIGHLAT_PROB, 0.1]) and np.isnan(f[3]) and np.isnan(f[4])
    # SWIM GeoTIFF path on a synthetic geographic raster (value 0.5 north of 40 N, -1 elsewhere in the north, NaN south)
    import tempfile, rasterio
    from rasterio.transform import from_origin
    with tempfile.TemporaryDirectory() as d:
        a = np.full((180, 360), np.nan, dtype="float32")   # 1 deg raster
        a[:50, :] = 0.5
        a[50:90, :] = -1.0
        crs = rasterio.crs.CRS.from_wkt(MARS_GEOG_WKT)
        with rasterio.open(Path(d) / "t.tif", "w", driver="GTiff", height=180, width=360, count=1, dtype="float32",
                           crs=crs, transform=from_origin(-180, 90, 1, 1), nodata=-9999.0) as w:
            w.write(a, 1)
        r = swim_tif_to_cells(Path(d) / "t.tif").reshape(NROWS, NCOLS)
        assert np.allclose(r[10, 100], 0.5) and np.allclose(r[150, 100], -1.0) and np.isnan(r[300, 100])
    print("all tests passed")


run_tests()

# %% [markdown]
# ## 2. Download and check the GRS hydrogen table (resumable, size capped)

# %%
import hashlib
import requests

grs_path = GRS_DIR / "h2o_sr_5x5.tab"
if not grs_path.exists():
    with requests.get(GRS_URL, stream=True, timeout=60, headers={"User-Agent": "analog-finder-hackathon/1.0 (research use)"}) as r:
        r.raise_for_status()
        tmp = grs_path.with_suffix(".part")
        got = 0
        with open(tmp, "wb") as f:
            for chunk in r.iter_content(65536):
                got += len(chunk)
                assert got <= 1_000_000, "GRS file is larger than the 1 MB cap"     # count the bytes, not the header
                f.write(chunk)
        tmp.rename(grs_path)
assert hashlib.sha256(grs_path.read_bytes()).hexdigest() == GRS_SHA256, "GRS file changed: re-check it"
grs_grid = parse_grs_table(grs_path)
print("GRS bins with data:", int(np.isfinite(grs_grid).sum()), "of", grs_grid.size)

# %% [markdown]
# ## 3. Manual inputs (SWIM and polar caps)
#
# 1. Open `https://swim.psi.edu/NorthHemisProducts.php`. Download the northern-hemisphere ice-consistency (composite) GeoTIFF(s). Put them in `analog-finder/raw/mars/swim/`. Pick the product for the shallowest depth range you want to represent (the 0-1 m layer if there are depth layers). Write the file name in the report.
# 2. Open `https://data.mendeley.com/datasets/x953mzxxvv/1` (north) and `https://data.mendeley.com/datasets/z59b9nd6s9` (south). Download the residual-cap shapefiles (the south one is in `Shapefile_for_Residual_South_Polar_Cap`). Put all `.shp/.shx/.dbf` files in `analog-finder/raw/mars/polar_caps/`. The shapefile coordinates must be lon/lat degrees. The cell asserts this.

# %%
swim_files = sorted(SWIM_DIR.glob("*.tif*"))
cap_files = sorted(CAP_DIR.glob("*.shp"))
import warnings

if not swim_files:
    warnings.warn(f"No SWIM GeoTIFF in {SWIM_DIR}: SWIM is skipped. Northern mid-latitudes then use the GRS map only. See section 3.")
if not cap_files:
    warnings.warn(f"No cap shapefile in {CAP_DIR}: the polar caps are skipped. ice_surface will be 0 everywhere, so the caps are "
                  "missing from the surface type (surf_ice), and the cap cells get no ice_prob of 1. See section 3.")

# %% [markdown]
# ## 4. Build ice_prob and ice_surface

# %%
cells = cell_centres()
lat_c, lon_c = cells.lat.values, cells.lon.values

swim_prob = np.full(len(cells), np.nan)
for f in swim_files:                                   # several tiles/layers: maximum (no files: swim_prob stays all NaN)
    swim_prob = np.fmax(swim_prob, swim_to_prob(swim_tif_to_cells(f)))

grs_prob = weh_to_prob(grs_to_cells(grs_grid, lat_c, lon_c))

if cap_files:
    cap = polygon_mask(read_cap_rings(cap_files), lat_c, lon_c)
    assert (cap & (lat_c > 0)).any() and (cap & (lat_c < 0)).any(), "need one cap in each hemisphere"
else:
    cap = np.zeros(len(cells), dtype=bool)

ice_prob = fill_high_latitude(combine_sources(swim_prob, grs_prob, cap), lat_c)
ice_surface = ice_surface_from_caps(cap)

part = pd.DataFrame({"cell_id": cells.cell_id.astype("int64"), "ice_prob": ice_prob, "ice_surface": ice_surface})
assert len(part) == NROWS * NCOLS and part.cell_id.is_unique
assert part.ice_prob.dropna().between(0, 1).all()
part.to_parquet(RAW / "part_ice.parquet", index=False)
print(part.describe())
print("cells: swim", int(np.isfinite(swim_prob).sum()), "grs", int(np.isfinite(grs_prob).sum()),
      "cap", int(cap.sum()), "NaN ice_prob", int(np.isnan(ice_prob).sum()))
print("SOURCES USED: SWIM" if swim_files else "SOURCES SKIPPED: SWIM", "|", "caps" if cap_files else "caps SKIPPED", "| GRS | high-latitude assumption")
