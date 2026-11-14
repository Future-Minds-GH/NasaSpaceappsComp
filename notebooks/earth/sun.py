# %% [markdown]
# # Earth unit: sunlight (NASA POWER)
#
# Output: `analog-finder/raw/earth/part_sun.parquet` with columns `cell_id`, `sun_wm2`.
#
# Source: NASA POWER climatology, regional endpoint, parameter `ALLSKY_SFC_SW_DWN`, annual mean (`ANN`), kWh/m2/day.
# Endpoint: https://power.larc.nasa.gov/api/temporal/climatology/regional
# Docs: https://power.larc.nasa.gov/docs/services/api/temporal/climatology/
# No API key. Convert: kWh/m2/day x 41.67 = W/m2 (daily mean). Missing stays null (never 0).
#
# Note: a test request returned points on a 1 degree grid (centres at x.5), not 0.5 degree.
# The code reads the grid from the response, so it works for either spacing.

# %%
from pathlib import Path

import numpy as np
import pandas as pd

try:
    from google.colab import drive
    drive.mount("/content/drive")
    ROOT = Path("/content/drive/MyDrive/analog-finder")
except ImportError:                      # local test run: no Drive
    ROOT = Path("analog-finder")
RAW = ROOT / "raw" / "earth"
OUT = ROOT / "processed"
CELL = 0.25
NROWS, NCOLS = 720, 1440
KWH_TO_WM2 = 41.67                       # 1 kWh/m2/day = 1000/24 W/m2
FILL = -999.0                            # POWER fill value (header fill_value)
BOX = 10                                 # degrees per request tile
# UNVERIFIED: the maximum regional box size. The docs do not state it. 10 deg is a cautious guess.
# A 1 x 1 deg box returned HTTP 422 (checked); a 2 x 2 deg box worked (checked).

# %%
# Pure functions (no network).

def kwh_to_wm2(a):
    """kWh/m2/day -> W/m2. POWER fill values (-999) and NaN become NaN."""
    a = np.asarray(a, dtype="float64")
    return np.where((a == FILL) | np.isnan(a), np.nan, a * KWH_TO_WM2)


def target_axes():
    """Cell-centre lat (north to south) and lon (west to east) of the 0.25 deg grid."""
    lat = 90 - CELL / 2 - np.arange(NROWS) * CELL
    lon = -180 + CELL / 2 + np.arange(NCOLS) * CELL
    return lat, lon


def _frac_index(axis, x):
    """Lower index and fraction of x on an ascending axis, clamped to the axis range."""
    i = np.interp(x, axis, np.arange(len(axis)))
    i0 = np.minimum(np.floor(i).astype(int), len(axis) - 2)
    return i0, i - i0


def interp_to_grid(vals, lats, lons, t_lats, t_lons, min_weight=0.5):
    """Bilinear interpolation of a coarse grid onto target axes. NaN-aware.

    vals: (len(lats), len(lons)); lats, lons ascending, cell centres.
    Returns (len(t_lats), len(t_lons)). NaN corners are skipped and the weights
    renormalised. If the valid weight is below min_weight, the result is NaN.
    Targets outside the coarse range are clamped to its edge (nearest value).
    """
    vals = np.asarray(vals, dtype="float64")
    assert vals.shape == (len(lats), len(lons)), "vals shape must match axes"
    assert len(lats) >= 2 and len(lons) >= 2, "need at least 2 points per axis"
    assert np.all(np.diff(lats) > 0) and np.all(np.diff(lons) > 0), "axes must ascend"
    i0, fy = _frac_index(lats, t_lats)
    j0, fx = _frac_index(lons, t_lons)
    num = np.zeros((len(t_lats), len(t_lons)))
    den = np.zeros_like(num)
    for di, wy in ((0, 1 - fy), (1, fy)):
        for dj, wx in ((0, 1 - fx), (1, fx)):
            v = vals[(i0 + di)[:, None], (j0 + dj)[None, :]]
            w = wy[:, None] * wx[None, :]
            ok = ~np.isnan(v)
            num += np.where(ok, v * w, 0.0)
            den += np.where(ok, w, 0.0)
    return np.where(den >= min_weight, num / np.where(den > 0, den, 1), np.nan)


def parse_power_json(js, key="ANN", param="ALLSKY_SFC_SW_DWN"):
    """POWER regional GeoJSON -> (lat, lon, value) arrays. Coordinates are [lon, lat, elev]."""
    feats = js["features"]
    assert feats, "no features in POWER response"
    lon = np.array([f["geometry"]["coordinates"][0] for f in feats])
    lat = np.array([f["geometry"]["coordinates"][1] for f in feats])
    val = np.array([f["properties"]["parameter"][param][key] for f in feats], dtype="float64")
    return lat, lon, val


def points_to_grid(lat, lon, val):
    """Scattered regular points -> 2D array plus ascending axes. Missing points = NaN."""
    lats, lons = np.unique(lat), np.unique(lon)
    out = np.full((len(lats), len(lons)), np.nan)
    out[np.searchsorted(lats, lat), np.searchsorted(lons, lon)] = val
    return out, lats, lons

# %% [markdown]
# ## Local test on synthetic data (no network)

# %%
def _selftest():
    t_lat, t_lon = target_axes()
    # linear field on a 1 deg grid: bilinear must reproduce it exactly inside the range
    lats = np.arange(-89.5, 90, 1.0)
    lons = np.arange(-179.5, 180, 1.0)
    f = 2 * lats[:, None] + 3 * lons[None, :]
    g = interp_to_grid(f, lats, lons, t_lat, t_lon)
    inside = (np.abs(t_lat) <= 89.5)[:, None] & (np.abs(t_lon) <= 179.5)[None, :]
    exact = 2 * t_lat[:, None] + 3 * t_lon[None, :]
    assert g.shape == (NROWS, NCOLS)
    assert np.allclose(g[inside], exact[inside]), "linear field not reproduced"
    assert not np.isnan(g).any(), "edges should be clamped, not NaN"
    # a hole stays null, never 0
    f2 = f.copy()
    f2[100:110, 100:110] = np.nan
    g2 = interp_to_grid(f2, lats, lons, t_lat, t_lon)
    assert np.isnan(g2).any() and not (g2 == 0).any()
    # unit and fill handling
    assert np.isnan(kwh_to_wm2([-999.0, np.nan])).all()
    assert np.isclose(kwh_to_wm2([6.0])[0], 250.02)
    # parse + grid round trip
    js = {"features": [{"geometry": {"coordinates": [x + .5, y + .5, 0.0]},
                        "properties": {"parameter": {"ALLSKY_SFC_SW_DWN": {"ANN": 1.0 * (y * 10 + x)}}}}
                       for y in (0, 1) for x in (0, 1)]}
    la, lo, va = parse_power_json(js)
    arr, ax_lat, ax_lon = points_to_grid(la, lo, va)
    assert arr.tolist() == [[0.0, 1.0], [10.0, 11.0]] and ax_lat[0] == 0.5
    print("selftest ok")

_selftest()

# %% [markdown]
# ## Download (network). Cached per tile in Drive, so a restart resumes.

# %%
import json
import time

import requests

URL = "https://power.larc.nasa.gov/api/temporal/climatology/regional"
cache_dir = RAW / "power_sun"
cache_dir.mkdir(parents=True, exist_ok=True)


def fetch_tile(lat0, lon0):
    f = cache_dir / f"sw_{lat0}_{lon0}.json"
    if f.exists():
        return json.loads(f.read_text())
    params = {"latitude-min": lat0, "latitude-max": lat0 + BOX,
              "longitude-min": lon0, "longitude-max": lon0 + BOX,
              "parameters": "ALLSKY_SFC_SW_DWN", "community": "RE", "format": "JSON"}
    r = requests.get(URL, params=params, timeout=300)
    r.raise_for_status()
    js = r.json()
    f.write_text(json.dumps(js))
    time.sleep(1)                        # the API returns 429 on too many requests
    return js


lat_p, lon_p, val_p = [], [], []
for lat0 in range(-90, 90, BOX):
    for lon0 in range(-180, 180, BOX):
        a, b, c = parse_power_json(fetch_tile(lat0, lon0))
        lat_p.append(a); lon_p.append(b); val_p.append(c)
lat_p, lon_p, val_p = map(np.concatenate, (lat_p, lon_p, val_p))
print(len(val_p), "native points; fill count:", int((val_p == FILL).sum()))

# %% [markdown]
# ## Convert, interpolate, save

# %%
sun_native = kwh_to_wm2(val_p)
grid2d, nat_lats, nat_lons = points_to_grid(lat_p, lon_p, sun_native)
t_lat, t_lon = target_axes()
sun = interp_to_grid(grid2d, nat_lats, nat_lons, t_lat, t_lon)
assert sun.shape == (NROWS, NCOLS)

part = pd.DataFrame({"cell_id": np.arange(NROWS * NCOLS), "sun_wm2": sun.ravel()})
RAW.mkdir(parents=True, exist_ok=True)
part.to_parquet(RAW / "part_sun.parquet", index=False)
print(part["sun_wm2"].describe(), "null:", int(part["sun_wm2"].isna().sum()))

# %%
def at(lat, lon):
    r = int((89.875 - lat) / CELL + 0.5)
    c = int((lon + 179.875) / CELL + 0.5)
    return sun[r, c]

assert at(25, 15) > at(60, 15), "Sahara should get more sun than northern Europe"
assert at(25, 15) > 200, "Sahara daily mean should be above 200 W/m2"
