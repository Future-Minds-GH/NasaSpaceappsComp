# %% [markdown]
# # Job 2 depth: Moon minerals, sunlight and caves
#
# Output: `analog-finder/raw/moon/part_minerals_sun_caves.parquet` (Google Drive).
# Columns: `cell_id, sun_wm2, min_mafic, min_feldspathic, min_ironox, min_sulfate, min_clay, min_carbonate, cave_km`.
# Grid: 0.5 deg, 360 x 720, `cell_id = row*720 + col`, row 0 = lat 89.75, lon -180..180 east positive. The merge notebook joins this part to `moon_thin.parquet` on `cell_id`.
#
# ## 1. Sunlight: `sun_wm2`
# `sun_wm2 = 1361 * cos(lat) / pi` (W/m2).
# - Assumption: flat surface, no atmosphere, no topographic shadowing, Sun on the equator plane (the 1.54 deg lunar axis tilt is ignored), Earth-Moon distance orbit eccentricity ignored (1361 W/m2 = solar constant at 1 AU).
# - The daily mean over one rotation of a flat surface is `S0 * cos(lat) / pi`. At the equator it gives 433 W/m2. Near the poles it gives about 0, which is too low for real polar peaks (grazing Sun), but the brief asks for this formula.
#
# ## 2. Minerals from Lunar Prospector GRS
# Product (NASA PDS Geosciences Node, PDS4 collection `lp-l-grs-5-elem-abundance-v1`, bundle `lp_9001`, Prettyman et al. 2006, JGR 111, E12007, doi 10.1029/2005JE002656):
# - File: `https://pds-geosciences.wustl.edu/lunar/lp-l-grs-5-elem-abundance-v1/lp_9001/data/lpgrs_high1_elem_abundance_2deg.tab` (9,949,280 bytes, label `.lbl` / `.xml` next to it). No login.
# - ASCII table: 11,306 rows (one per **2 deg equal-area pixel**; latitude bands 2 deg high, longitude width grows toward the poles; the two polar caps are 1 deg high), 61 columns, format `(i10,4(f7.1),57(1x,e14.4))`.
# - Columns used (0-based): 0 PIXEL_INDEX, 1 MIN_LAT, 2 MAX_LAT, 3 MIN_LON, 4 MAX_LON (deg, lon -180..180 east), 11 W_TIO2 (g/g), 12 W_FEO (g/g), 14 W_TH (ppm). Fe and Ti come as **oxides FeO and TiO2 weight fractions**, not elemental Fe and Ti.
# - Real resolution: the high-altitude (about 100 km) data have about 5 deg footprint. The 2 deg pixels are oversampled. Cells of 0.5 deg inside one pixel get the same value (nearest pixel, no smoothing).
# - Th (ppm) is not a mineral class. It is read and saved to the scratch table only for a sanity check (KREEP region).
#
# ### Rule: FeO and TiO2 to the six mineral fractions
# 1. Ilmenite (FeTiO3, an iron-titanium **oxide**) goes to `min_ironox`. If all Ti is in ilmenite, the ilmenite weight fraction is `TiO2 / 0.5265`, where 0.5265 = M(TiO2) / M(FeTiO3) = 79.866 / 151.71 (stoichiometry, not a measurement). `min_ironox = min(that, 0.5)` (cap keeps the other two classes alive).
# 2. The rest (`1 - min_ironox`) is split between mafic and feldspathic by FeO, linear between two anchors:
#    `s = clip((FeO - 5) / (22 - 5), 0, 1)`, `min_mafic = (1 - min_ironox) * s`, `min_feldspathic = (1 - min_ironox) * (1 - s)`.
# 3. Anchors, from Lawrence et al. (2002), JGR Planets 107(E12), "Iron abundances on the lunar surface as measured by the Lunar Prospector gamma-ray and neutron spectrometers" (doi 10.1029/2001JE001530; title and journal checked in Crossref; the numbers are from the abstract text seen in search snippets): highlands about 5 wt% FeO; western maria 22-23 wt% FeO. We take 5 and the low end 22 for "all mafic".
# 4. `min_sulfate = min_clay = min_carbonate = 0` (brief: none on the Moon). The six fractions sum to 1 in every cell with data.
# 5. No data (null in all six): pixel with `W_FEO <= 0` or `W_TIO2 < 0` or not finite. In the file one pixel (lat -1..1, lon 168..) has `W_FEO = 0`.
#
# Honest limits: this is a simple mixing rule, not a modal mineralogy. Mafic share means "Fe-rich basaltic material". Highland FeO also includes some pyroxene, so `min_mafic` is never exactly 0 in real highlands in the Moon, only near 0 here. The anchors are the only tunable numbers (`FEO_HIGHLAND`, `FEO_MARE`).
#
# ## 3. Caves: `cave_km`
# - Source: LROC Atlas of Lunar Pits (Wagner and Robinson), table at `https://lroc.im-ldi.com/pits/list` (the old address `lroc.sese.asu.edu/pits/list` answers 301 to it). The list is **plain HTML in the page** (columns: host feature, name, Lat, Long, funnel and inner diameters, azimuth, depth). No JSON or CSV export exists (there is only a PDF atlas). Longitude is 0-360 east (checked: Marius Hills Pit 303.23 -> -56.77, Mare Tranquillitatis Pit 33.222).
# - Scraping: one single GET of one public page. `robots.txt` has no Disallow line. The LROC Terms say website images are copyrighted but PDS data are public; the coordinates are scientific facts, not images. Terms ask for citation, so cite: Robinson et al. 2010 (SSR 150) and the Pits Atlas. We save the parsed table (name, lat, lon) to RAW as a cache and do not re-publish the HTML.
# - 278 pits at the check (14 Nov 2026). No coordinate is typed by hand in this notebook.
# - `cave_km` = great-circle distance (haversine, radius 1737.4 km) from the cell centre to the nearest pit. Never null. It is a distance to the nearest *known, imaged* pit: pits are only searched where LROC saw them, so it is a lower-bound-style badge, not a cave probability.

# %%
%pip -q install pyarrow requests

# %%
from pathlib import Path
from google.colab import drive

drive.mount("/content/drive")
ROOT = Path("/content/drive/MyDrive/analog-finder")
RAW = ROOT / "raw" / "moon"
RAW.mkdir(parents=True, exist_ok=True)

CELL = 0.5
NROWS, NCOLS = 360, 720
R_MOON_KM = 1737.4
S0 = 1361.0                      # W/m2, solar constant at 1 AU
FEO_HIGHLAND = 0.05              # g/g, Lawrence et al. 2002 (about 5 wt% FeO)
FEO_MARE = 0.22                  # g/g, Lawrence et al. 2002 (22-23 wt% FeO in western maria; low end)
TIO2_IN_ILMENITE = 79.866 / 151.71   # M(TiO2)/M(FeTiO3) = 0.5264
IRONOX_CAP = 0.5

GRS_URL = "https://pds-geosciences.wustl.edu/lunar/lp-l-grs-5-elem-abundance-v1/lp_9001/data/lpgrs_high1_elem_abundance_2deg.tab"
GRS_BYTES = 9_949_280
GRS_SHA256 = "e866953499813ec089067f1985dfb92fe7adc8957a2121bb115a3b27ea14e946"   # checked on the file of 14 Nov 2026
PITS_URL = "https://lroc.im-ldi.com/pits/list"
PITS_MAX_BYTES = 5_000_000
PITS_MIN_COUNT = 200             # sanity: the list had 278 pits

# %% [markdown]
# ## 0. Pure functions (tested locally on synthetic data)

# %%
# PURE FUNCTIONS START
import re
import numpy as np
import pandas as pd


def sun_wm2(lat_deg):
    # Daily mean flat-surface insolation, no shadowing: S0 * cos(lat) / pi.
    return S0 * np.cos(np.radians(lat_deg)) / np.pi


def mafic_share(feo, lo=FEO_HIGHLAND, hi=FEO_MARE):
    # Linear in FeO (g/g) between the highland anchor (0) and the mare anchor (1); NaN stays NaN.
    assert hi > lo
    return np.clip((np.asarray(feo, dtype="float64") - lo) / (hi - lo), 0.0, 1.0)


def mineral_fractions(feo, tio2):
    # feo, tio2: weight fractions (g/g). Returns six arrays that sum to 1 where the inputs are valid, else NaN.
    feo = np.asarray(feo, dtype="float64")
    tio2 = np.asarray(tio2, dtype="float64")
    ok = np.isfinite(feo) & np.isfinite(tio2) & (feo > 0) & (tio2 >= 0)
    ironox = np.minimum(tio2 / TIO2_IN_ILMENITE, IRONOX_CAP)
    s = mafic_share(feo)
    out = {
        "min_mafic": (1 - ironox) * s,
        "min_feldspathic": (1 - ironox) * (1 - s),
        "min_ironox": ironox,
        "min_sulfate": np.zeros_like(feo),
        "min_clay": np.zeros_like(feo),
        "min_carbonate": np.zeros_like(feo),
    }
    return {k: np.where(ok, v, np.nan) for k, v in out.items()}


def cell_centres():
    lat = 90 - CELL / 2 - CELL * np.arange(NROWS)
    lon = -180 + CELL / 2 + CELL * np.arange(NCOLS)
    return lat, lon


def pixels_to_grid(minlat, maxlat, minlon, maxlon, values):
    # Copy each pixel value to the 0.5 deg cells whose centre lies inside it (lower edge in, upper edge out;
    # the last band and column close at 90 and 180). Asserts every cell is covered exactly once.
    lat, lon = cell_centres()
    grid = np.full((NROWS, NCOLS), np.nan)
    count = np.zeros((NROWS, NCOLS), dtype=int)
    for a, b, c, d, v in zip(minlat, maxlat, minlon, maxlon, values):
        rows = (lat >= a) & ((lat < b) | (b >= 90))
        cols = (lon >= c) & ((lon < d) | (d >= 180))
        grid[np.ix_(rows, cols)] = v
        count[np.ix_(rows, cols)] += 1
    assert (count == 1).all(), "pixels do not cover the grid exactly once"
    return grid


def haversine_km(lat1, lon1, lat2, lon2, radius=R_MOON_KM):
    la1, lo1, la2, lo2 = map(np.radians, (lat1, lon1, lat2, lon2))
    a = np.sin((la2 - la1) / 2) ** 2 + np.cos(la1) * np.cos(la2) * np.sin((lo2 - lo1) / 2) ** 2
    return 2 * radius * np.arcsin(np.sqrt(np.clip(a, 0, 1)))


def nearest_km(lat, lon, plat, plon, chunk=2000):
    # lat, lon: 1-D cell centres. plat, plon: points. Returns the great-circle km to the nearest point.
    plat, plon = np.asarray(plat, dtype="float64"), np.asarray(plon, dtype="float64")
    assert len(plat) > 0 and len(plat) == len(plon)
    out = np.empty(len(lat))
    for i in range(0, len(lat), chunk):
        d = haversine_km(lat[i:i + chunk, None], lon[i:i + chunk, None], plat[None, :], plon[None, :])
        out[i:i + chunk] = d.min(axis=1)
    return out


def lon360_to_180(lon):
    return ((np.asarray(lon, dtype="float64") + 180) % 360) - 180


def parse_pits_html(html):
    # Rows of the LROC pits table: 13 <td> cells: host, name, lat, lon, ... Returns a DataFrame name, lat, lon (lon -180..180).
    rows = []
    for tr in re.findall(r"<tr>(.*?)</tr>", html, flags=re.S):
        c = [re.sub(r"<[^>]+>", "", x).strip() for x in re.findall(r"<td>(.*?)</td>", tr, flags=re.S)]
        if len(c) >= 4:
            rows.append((c[1], float(c[2]), float(c[3])))
    df = pd.DataFrame(rows, columns=["name", "lat", "lon360"])
    assert df.lat.between(-90, 90).all() and df.lon360.between(0, 360).all()
    df["lon"] = lon360_to_180(df.lon360)
    return df
# PURE FUNCTIONS END

# %% [markdown]
# ## 1. Download (resumable, size-capped)

# %%
import hashlib
import requests


def download(url, dest, max_bytes, expect_bytes=None):
    # Skip when finished. Resume a partial file with an HTTP Range request. Stop above max_bytes.
    dest = Path(dest)
    if expect_bytes and dest.exists() and dest.stat().st_size == expect_bytes:
        return dest
    part = dest.with_suffix(dest.suffix + ".part")
    have = part.stat().st_size if part.exists() else 0
    headers = {**{"User-Agent": "analog-finder-hackathon/1.0 (research use)"}, **({"Range": f"bytes={have}-"} if have else {})}
    with requests.get(url, headers=headers, stream=True, timeout=60) as r:
        assert r.status_code in (200, 206), f"HTTP {r.status_code} for {url}"
        if r.status_code == 200:
            have = 0
        with open(part, "ab" if have else "wb") as f:
            for chunk in r.iter_content(1 << 20):
                have += len(chunk)
                assert have <= max_bytes, "download larger than the cap"
                f.write(chunk)
    part.replace(dest)
    return dest


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()


grs_path = download(GRS_URL, RAW / "lpgrs_high1_elem_abundance_2deg.tab", 20_000_000, GRS_BYTES)
assert grs_path.stat().st_size == GRS_BYTES and sha256(grs_path) == GRS_SHA256, "GRS file changed: check the label"

pits_cache = RAW / "lroc_pits_list.csv"
if not pits_cache.exists():
    # One GET of one public page (see the scraping note above). The site answers 301 from the old address.
    with requests.get(PITS_URL, timeout=60, stream=True, headers={"User-Agent": "analog-finder-hackathon/1.0 (research use)"}) as r:
        assert r.status_code == 200, f"HTTP {r.status_code}"
        body = bytearray()
        for chunk in r.iter_content(1 << 16):
            body += chunk
            assert len(body) <= PITS_MAX_BYTES, "pits page is larger than the cap"      # count the bytes
        encoding = r.encoding or "utf-8"
    parse_pits_html(bytes(body).decode(encoding))[["name", "lat", "lon360", "lon"]].to_csv(pits_cache, index=False)
pits = pd.read_csv(pits_cache)
assert len(pits) >= PITS_MIN_COUNT, f"only {len(pits)} pits"
print(len(pits), "pits")

# %% [markdown]
# ## 2. Build the table

# %%
grs = pd.read_csv(grs_path, sep=r"\s+", header=None, usecols=[0, 1, 2, 3, 4, 11, 12, 14],
                  names=["pix", "minlat", "maxlat", "minlon", "maxlon", "tio2", "feo", "th"])
assert len(grs) == 11306

feo_g = pixels_to_grid(grs.minlat, grs.maxlat, grs.minlon, grs.maxlon, grs.feo).ravel()
tio2_g = pixels_to_grid(grs.minlat, grs.maxlat, grs.minlon, grs.maxlon, grs.tio2).ravel()
mins = mineral_fractions(feo_g, tio2_g)

lat1, lon1 = cell_centres()
LAT, LON = np.meshgrid(lat1, lon1, indexing="ij")
cell_id = np.arange(NROWS * NCOLS)
lat, lon = LAT.ravel(), LON.ravel()

part = pd.DataFrame({"cell_id": cell_id, "sun_wm2": sun_wm2(lat), **mins,
                     "cave_km": nearest_km(lat, lon, pits.lat.to_numpy(), pits.lon.to_numpy())})
COLS = ["cell_id", "sun_wm2", "min_mafic", "min_feldspathic", "min_ironox",
        "min_sulfate", "min_clay", "min_carbonate", "cave_km"]
part = part[COLS]
part.to_parquet(RAW / "part_minerals_sun_caves.parquet", index=False)
part.describe().T

# %% [markdown]
# ## 3. Checks

# %%
M = ["min_mafic", "min_feldspathic", "min_ironox", "min_sulfate", "min_clay", "min_carbonate"]
has = part[M].notna().all(axis=1)
assert (part[M].isna().all(axis=1) | has).all(), "a row is half null"
assert np.allclose(part.loc[has, M].sum(axis=1), 1.0)
print("rows with minerals:", has.sum(), "of", len(part), "| null rows:", (~has).sum())

def at(a, b, col):
    return part.loc[np.argmin(np.abs(lat - a) + np.abs(lon - b)), col]

assert abs(at(0, 0, "sun_wm2") - 433.2) < 1 and at(89.75, 0, "sun_wm2") < 3
# Mare Tranquillitatis (about 8N, 31E): mafic and Ti-rich. Central farside highlands (about 0N, 180E): feldspathic.
assert at(8, 31, "min_mafic") > at(0, 179.9, "min_mafic")
assert at(8, 31, "min_ironox") > at(0, 179.9, "min_ironox")
# Pit cells: the Mare Tranquillitatis Pit (8.3355 N, 33.222 E) is within about 1 cell (a few km) of cave_km 0.
assert at(8.3355, 33.222, "cave_km") < 25
assert part.cave_km.notna().all() and part.cave_km.max() < np.pi * R_MOON_KM

import matplotlib.pyplot as plt
fig, axes = plt.subplots(3, 1, figsize=(12, 13))
for ax, col in zip(axes, ("min_mafic", "min_ironox", "cave_km")):
    im = ax.imshow(part[col].to_numpy().reshape(NROWS, NCOLS), extent=(-180, 180, -90, 90))
    ax.set_title(col)
    fig.colorbar(im, ax=ax, shrink=0.7)
(ROOT / "processed").mkdir(parents=True, exist_ok=True)
fig.savefig(ROOT / "processed" / "quicklook_moon_minerals_caves.png", dpi=100, bbox_inches="tight")
