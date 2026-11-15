# %% [markdown]
# # Job 2 depth: Mars minerals from TES
#
# Output: `analog-finder/raw/mars/part_minerals.parquet` (Google Drive). Columns: `cell_id, min_mafic, min_feldspathic, min_ironox, min_sulfate, min_clay, min_carbonate`. The six fractions sum to 1 in a covered cell; a cell with no TES data is null in all six.
#
# Source: the Mars Global Surveyor TES global mineral maps (Bandfield 2002, JGR 107(E6), "Global mineral distributions on Mars"), 13 bands at 4 pixels per degree, from the TES data node at ASU.
#
# All six classes come from the TES cube, so a covered cell has a full mineral mix (the six fractions sum to 1). A mix with a null in it counts as missing in the matcher, so a Mars cell must never be partly null.
#
# How TES abundances become the six classes:
# 1. Bands used (fraction of the surface-spectrum fit): plagioclase, low-Ca pyroxene, high-Ca pyroxene, olivine, hematite, sulfate, carbonate, sheet silicate / high-Si glass.
# 2. `min_feldspathic = plagioclase`, `min_mafic = low-Ca pyroxene + high-Ca pyroxene + olivine`, `min_ironox = hematite`, `min_sulfate = sulfate`, `min_carbonate = carbonate`, `min_clay = sheet silicate / high-Si glass`.
# 3. Other fitted components (quartz, K-feldspar, amphibole, surface dust) are dropped. They are not in the six classes.
# 4. Share = class / (sum of the six classes). Example: plagioclase 0.3, pyroxene 0.1, olivine 0.1, hematite 0.0, sulfate 0.0, carbonate 0.0, sheet silicate 0.0 gives feldspathic 0.6, mafic 0.4.
# 5. If the six classes add up to less than `MIN_TOTAL` (0.02), the shares are noise and the cell is null.
# 6. Regrid: the 0.25 deg map is block-averaged 2 x 2 into each 0.5 deg cell (the blocks line up exactly with the grid). A band value is the mean of the valid pixels. A cell needs at least 2 of 4 valid pixels. Normalisation happens AFTER the averaging.
#
# **Caveats (not verified):**
# - In the TES maps, sulfate, carbonate and sheet silicate are low-abundance components, close to the detection limit (Bandfield 2002). Treat small values as uncertain. The detection limits are not applied here.
# - The band "sheet silicate / high-Si glass" is not pure clay. It is used for `min_clay` because it is the nearest TES class. Treat `min_clay` as an upper bound for clays.
# - Cells with no TES data are null in all six columns. TES pixels cover about 72 percent of the grid (none poleward of about 82 N and 87 S, plus gaps).
#
# Before you run: no login needed. The download is 54 MB. Run cells in order. Existing files are not downloaded again.

# %%
%pip -q install pyarrow requests

# %%
from pathlib import Path
from google.colab import drive

drive.mount("/content/drive")
ROOT = Path("/content/drive/MyDrive/analog-finder")
RAW = ROOT / "raw" / "mars"
RAW.mkdir(parents=True, exist_ok=True)

CELL = 0.5
NROWS, NCOLS = 360, 720

BASE = "http://tes.asu.edu/mineral_map/"            # page: http://tes.mars.asu.edu/products/
FNAME = "TES_mineral_maps_4_ppd.envi"
HDR = FNAME + ".hdr"
CUBE_BYTES = 53_913_600                              # 1440 x 720 x 13 x 4 bytes (checked)
# SHA-256 of the files as downloaded on 2026-11-14
SHA = {
    FNAME: "707d16a3628fe0947c279e3375e4db826efc751744ecc6629cae4e422aacab4e",
    HDR: "977306a970503a263b26401ad0547998078e3e62673590e41bf97af2ec4fe710",
}
MAX_BYTES = 80_000_000                               # download cap

# Band order (0-based) = the order of the list on http://tes.mars.asu.edu/products/ (1-based there).
# Checked on the data: hematite (band 8) peaks at lat -2.6, lon -3 (Sinus Meridiani); high-Ca pyroxene (band 6)
# peaks at lat 8.7, lon 67 (Syrtis Major).
BANDS = ["quartz", "k_feldspar", "plagioclase", "amphibole", "low_ca_px", "high_ca_px",
         "olivine", "hematite", "sulfate", "carbonate", "sheet_hi_si_glass", "dust", "rms_error"]
FILL = -1.0                                          # no-data value in every band (checked: same pixels in all 13 bands)
MIN_TOTAL = 0.02                                     # judgement: below this the class shares are noise
MIN_VALID = 2                                        # of 4 pixels per cell

# %% [markdown]
# ## 0. Pure functions (tested on synthetic and real data)

# %%
import numpy as np
import pandas as pd


def parse_envi_header(text):
    # Minimal ENVI header reader: returns dict of key -> string for the keys we need.
    out = {}
    for line in text.splitlines():
        if "=" in line:
            k, v = line.split("=", 1)
            out[k.strip().lower()] = v.strip()
    return out


def read_cube(path, hdr):
    # ENVI band-sequential cube. data type 4 = float32; byte order 1 = big-endian. Returns (bands, lines, samples).
    assert hdr["data type"] == "4" and hdr["byte order"] == "1" and hdr["interleave"] == "bsq"
    assert int(hdr["header offset"]) == 0
    nb, nl, ns = int(hdr["bands"]), int(hdr["lines"]), int(hdr["samples"])
    cube = np.fromfile(path, dtype=">f4")
    assert cube.size == nb * nl * ns, "file size does not match header"
    return cube.reshape(nb, nl, ns).astype("float64")


def mask_fill(cube, fill=FILL):
    # No-data pixels (all bands = fill) -> NaN. Assert the fill is the same in every band.
    bad = cube[0] == fill
    assert all(((b == fill) == bad).all() for b in cube), "fill pixels differ between bands"
    out = cube.copy()
    out[:, bad] = np.nan
    return out


def block_mean(a, f=2, min_valid=MIN_VALID):
    # a: (..., H, W) with NaN for missing. Mean of valid pixels in each f x f block; NaN if fewer than min_valid.
    *lead, H, W = a.shape
    assert H % f == 0 and W % f == 0
    b = a.reshape(*lead, H // f, f, W // f, f)
    n = np.sum(~np.isnan(b), axis=(-3, -1))
    s = np.nansum(b, axis=(-3, -1))
    with np.errstate(invalid="ignore", divide="ignore"):
        m = s / n
    m[n < min_valid] = np.nan
    return m


def class_shares(plag, lowpx, highpx, oliv, hem, sulf, carb, sheet, min_total=MIN_TOTAL):
    # Arrays of the same shape (fractions, NaN = no data).
    # Returns (mafic, feldspathic, ironox, sulfate, clay, carbonate): shares of the six classes; rows sum to 1 or all NaN.
    feld = np.asarray(plag, dtype="float64")
    mafic = np.asarray(lowpx, dtype="float64") + highpx + oliv
    classes = [mafic, feld, np.asarray(hem, dtype="float64"), np.asarray(sulf, dtype="float64"),
               np.asarray(sheet, dtype="float64"), np.asarray(carb, dtype="float64")]
    assert not (np.nanmin(np.stack(classes)) < 0), "negative abundance"
    tot = sum(classes)                                   # NaN if any input is NaN
    ok = np.isfinite(tot) & (tot >= min_total)
    with np.errstate(invalid="ignore", divide="ignore"):
        return tuple(np.where(ok, x / tot, np.nan) for x in classes)


def cell_table(mafic, feld, iron, sulf, clay, carb):
    # Arrays (NROWS, NCOLS) -> DataFrame with cell_id = row * NCOLS + col, row 0 = lat 89.75, col 0 = lon -179.75.
    assert mafic.shape == (NROWS, NCOLS)
    n = NROWS * NCOLS
    return pd.DataFrame({
        "cell_id": np.arange(n),
        "min_mafic": mafic.ravel(),
        "min_feldspathic": feld.ravel(),
        "min_ironox": iron.ravel(),
        "min_sulfate": sulf.ravel(),
        "min_clay": clay.ravel(),
        "min_carbonate": carb.ravel(),
    })


def minerals_from_cube(cube):
    # cube (13, 720, 1440) -> DataFrame. Rows of the cube run north to south (row 0 = lat 89.875);
    # columns run lon -180..180 east (column 0 = lon -179.875). Checked on hematite at Sinus Meridiani.
    assert cube.shape == (13, 2 * NROWS, 2 * NCOLS)
    m = block_mean(mask_fill(cube))
    g = lambda name: m[BANDS.index(name)]
    shares = class_shares(g("plagioclase"), g("low_ca_px"), g("high_ca_px"), g("olivine"), g("hematite"),
                          g("sulfate"), g("carbonate"), g("sheet_hi_si_glass"))
    return cell_table(*shares)

# %% [markdown]
# ## 1. Synthetic tests

# %%
# shares: example from the text (mafic, feldspathic, ironox, sulfate, clay, carbonate)
z = np.array([0.0])
mf, fe, ir, su, cl, ca = class_shares(np.array([0.3]), np.array([0.05]), np.array([0.05]), np.array([0.1]), z, z, z, z)
assert np.allclose([mf[0], fe[0], ir[0], su[0], cl[0], ca[0]], [0.4, 0.6, 0, 0, 0, 0]), (mf, fe, ir)
# all six classes: sulfate, clay and carbonate take their share
res = class_shares(np.array([0.2]), np.array([0.1]), z, z, np.array([0.1]), np.array([0.1]), np.array([0.1]), np.array([0.2]))
assert np.isclose(sum(r[0] for r in res), 1) and np.isclose(res[3][0], 0.1 / 0.8) and np.isclose(res[4][0], 0.2 / 0.8) and np.isclose(res[5][0], 0.1 / 0.8)
# too small -> NaN, NaN input -> NaN, sum 1 otherwise
res = class_shares(np.array([0.0, 0.1, np.nan]), np.zeros(3), np.zeros(3), np.array([0.0, 0.1, 0.1]), np.array([0.0, 0.0, 0.1]),
                   np.zeros(3), np.zeros(3), np.zeros(3))
assert np.isnan([r[0] for r in res]).all() and np.isclose(sum(r[1] for r in res), 1) and np.isnan([r[2] for r in res]).all()
# block mean: one NaN of 4 is kept (3 valid); a block with fewer than 2 valid pixels is NaN
a = np.array([[1, 3, np.nan, np.nan], [np.nan, 5, np.nan, np.nan]], dtype=float)
bm = block_mean(a)
assert np.isclose(bm[0, 0], 3.0) and np.isnan(bm[0, 1])
# fill mask and a full synthetic cube
syn = np.zeros((13, 720, 1440))
syn[2] = 0.1
syn[7, 360:362, 720:722] = 0.1          # hematite in one cell at lat ~0, lon ~0
syn[8] = 0.02                           # a little sulfate everywhere
syn[:, :40, :] = FILL                   # no data in the north
df = minerals_from_cube(syn)
assert len(df) == NROWS * NCOLS and df["cell_id"].iloc[-1] == NROWS * NCOLS - 1
r, c = 180, 360
row = df.iloc[r * NCOLS + c]
assert np.isclose(row.min_ironox, 0.1 / 0.22) and np.isclose(row.min_feldspathic, 0.1 / 0.22) and row.min_mafic == 0
assert np.isclose(row.min_sulfate, 0.02 / 0.22) and row.min_clay == 0 and row.min_carbonate == 0
assert df.loc[:NCOLS * 20 - 1, ["min_mafic", "min_feldspathic", "min_ironox", "min_sulfate", "min_clay", "min_carbonate"]].isna().all().all()
print("synthetic tests passed")

# %% [markdown]
# ## 2. Download (resumable, capped, checksum)

# %%
import hashlib
import requests


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def fetch(name, expected_size=None):
    dest = RAW / name
    part = RAW / (name + ".part")
    if dest.exists() and (expected_size is None or dest.stat().st_size == expected_size):
        return dest
    done = part.stat().st_size if part.exists() else 0
    headers = {**{"User-Agent": "analog-finder-hackathon/1.0 (research use)"}, **({"Range": f"bytes={done}-"} if done else {})}
    with requests.get(BASE + name, headers=headers, stream=True, timeout=60) as r:
        if done and r.status_code == 200:      # server ignored Range: start again
            done = 0
        r.raise_for_status()
        total = done + int(r.headers.get("Content-Length", 0))
        assert total <= MAX_BYTES, f"file too large: {total}"
        got = done
        with open(part, "ab" if done else "wb") as f:
            for chunk in r.iter_content(1 << 20):
                got += len(chunk)
                assert got <= MAX_BYTES, f"download larger than the cap: {got}"      # count the bytes, not the header
                f.write(chunk)
    part.rename(dest)
    return dest


hdr_path = fetch(HDR)
cube_path = fetch(FNAME, CUBE_BYTES)
for p in (hdr_path, cube_path):
    assert sha256(p) == SHA[p.name], f"checksum changed for {p.name}: check the source before you go on"
print("files ok")

# %% [markdown]
# ## 3. Build and save

# %%
hdr = parse_envi_header(hdr_path.read_text())
cube = read_cube(cube_path, hdr)
df = minerals_from_cube(cube)
cov = df["min_mafic"].notna().mean()
MIN_COLS = ["min_mafic", "min_feldspathic", "min_ironox", "min_sulfate", "min_clay", "min_carbonate"]
shares = df[MIN_COLS]
ok = shares.notna().all(axis=1)
assert (shares.notna().sum(axis=1).isin([0, 6])).all(), "a row is only partly null"
assert np.allclose(shares[ok].sum(axis=1), 1.0)
assert (shares[ok] >= 0).all().all() and (shares[ok] <= 1).all().all()
print(f"cells with shares: {ok.sum()} of {len(df)} ({cov:.1%})")
print(shares[ok].describe())
df.to_parquet(RAW / "part_minerals.parquet", index=False)
print("saved", RAW / "part_minerals.parquet")
