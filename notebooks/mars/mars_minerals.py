# %% [markdown]
# # Job 2 depth: Mars minerals from TES
#
# Output: `analog-finder/raw/mars/part_minerals.parquet` (Google Drive). Columns: `cell_id, min_mafic, min_feldspathic, min_ironox, min_sulfate, min_clay, min_carbonate`.
#
# Source: the Mars Global Surveyor TES global mineral maps (Bandfield 2002, JGR 107(E6), "Global mineral distributions on Mars"), 13 bands at 4 pixels per degree, from the TES data node at ASU.
#
# **Important: rows are partly null by design.**
# - `min_sulfate`, `min_clay` and `min_carbonate` are ALWAYS null in this file. The task keeps them for OMEGA/CRISM, which is a stretch goal. (The TES cube has sulfate, carbonate and sheet-silicate bands, but they are near the detection limit and are not used here.)
# - Cells with no TES data are null in all six columns. TES pixels cover about 72 percent of the grid (none poleward of about 82 N and 87 S, plus gaps). After the 0.02 total cut, 58 percent of cells (150,008) have shares.
# - The three measured classes (`min_mafic`, `min_feldspathic`, `min_ironox`) are shares of the three measured classes only. They sum to 1 inside each covered cell. They are NOT shares of the whole surface.
#
# How TES abundances become shares:
# 1. Bands used (fraction of the surface-spectrum fit): plagioclase, low-Ca pyroxene, high-Ca pyroxene, olivine, hematite.
# 2. `feldspathic = plagioclase`, `mafic = low-Ca pyroxene + high-Ca pyroxene + olivine`, `ironox = hematite`.
# 3. Other fitted components (quartz, K-feldspar, amphibole, sulfate, carbonate, sheet silicate / high-Si glass, surface dust) are dropped. They are not in the three classes.
# 4. Share = class / (feldspathic + mafic + ironox). Example: plagioclase 0.3, pyroxene 0.1, olivine 0.1, hematite 0.0 gives feldspathic 0.6, mafic 0.4, ironox 0.0.
# 5. If the three classes add up to less than `MIN_TOTAL` (0.02), the shares are noise and the cell is null.
# 6. Regrid: the 0.25 deg map is block-averaged 2 x 2 into each 0.5 deg cell (the blocks line up exactly with the grid). A band value is the mean of the valid pixels. A cell needs at least 2 of 4 valid pixels. Normalisation happens AFTER the averaging.
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


def class_shares(plag, lowpx, highpx, oliv, hem, min_total=MIN_TOTAL):
    # Arrays of the same shape (fractions, NaN = no data). Returns (mafic, feldspathic, ironox).
    # Shares of the three measured classes; rows sum to 1 or all NaN.
    feld = np.asarray(plag, dtype="float64")
    mafic = np.asarray(lowpx, dtype="float64") + highpx + oliv
    iron = np.asarray(hem, dtype="float64")
    assert not (np.nanmin(np.stack([feld, mafic, iron])) < 0), "negative abundance"
    tot = feld + mafic + iron                          # NaN if any input is NaN
    ok = np.isfinite(tot) & (tot >= min_total)
    with np.errstate(invalid="ignore", divide="ignore"):
        res = [np.where(ok, x / tot, np.nan) for x in (mafic, feld, iron)]
    return tuple(res)


def cell_table(mafic, feld, iron):
    # Arrays (NROWS, NCOLS) -> DataFrame with cell_id = row * NCOLS + col, row 0 = lat 89.75, col 0 = lon -179.75.
    assert mafic.shape == (NROWS, NCOLS)
    n = NROWS * NCOLS
    nan = np.full(n, np.nan)
    return pd.DataFrame({
        "cell_id": np.arange(n),
        "min_mafic": mafic.ravel(),
        "min_feldspathic": feld.ravel(),
        "min_ironox": iron.ravel(),
        "min_sulfate": nan,
        "min_clay": nan,
        "min_carbonate": nan,
    })


def minerals_from_cube(cube):
    # cube (13, 720, 1440) -> DataFrame. Rows of the cube run north to south (row 0 = lat 89.875);
    # columns run lon -180..180 east (column 0 = lon -179.875). Checked on hematite at Sinus Meridiani.
    assert cube.shape == (13, 2 * NROWS, 2 * NCOLS)
    m = block_mean(mask_fill(cube))
    g = lambda name: m[BANDS.index(name)]
    mafic, feld, iron = class_shares(g("plagioclase"), g("low_ca_px"), g("high_ca_px"), g("olivine"), g("hematite"))
    return cell_table(mafic, feld, iron)

# %% [markdown]
# ## 1. Synthetic tests

# %%
# shares: example from the text
mf, fe, ir = class_shares(np.array([0.3]), np.array([0.05]), np.array([0.05]), np.array([0.1]), np.array([0.0]))
assert np.allclose([mf[0], fe[0], ir[0]], [0.4, 0.6, 0.0]), (mf, fe, ir)
# sum 1, too small -> NaN, NaN input -> NaN
mf, fe, ir = class_shares(np.array([0.0, 0.1, np.nan]), np.zeros(3), np.zeros(3), np.array([0.0, 0.1, 0.1]), np.array([0.0, 0.0, 0.1]))
assert np.isnan([mf[0], fe[0], ir[0]]).all() and np.isclose(mf[1] + fe[1] + ir[1], 1) and np.isnan(mf[2])
# block mean: one NaN of 4 is kept (3 valid); two NaN is dropped to NaN? (2 valid = kept); three NaN = NaN
a = np.array([[1, 3, np.nan, np.nan], [np.nan, 5, np.nan, np.nan]], dtype=float)
bm = block_mean(a)
assert np.isclose(bm[0, 0], 3.0) and np.isnan(bm[0, 1])
# fill mask and a full synthetic cube
syn = np.zeros((13, 720, 1440))
syn[2] = 0.1
syn[7, 360:362, 720:722] = 0.1          # hematite in one cell at lat ~0, lon ~0
syn[:, :40, :] = FILL                   # no data in the north
df = minerals_from_cube(syn)
assert len(df) == NROWS * NCOLS and df["cell_id"].iloc[-1] == NROWS * NCOLS - 1
r, c = 180, 360
row = df.iloc[r * NCOLS + c]
assert np.isclose(row.min_ironox, 0.5) and np.isclose(row.min_feldspathic, 0.5) and row.min_mafic == 0
assert df.loc[:NCOLS * 20 - 1, ["min_mafic", "min_feldspathic", "min_ironox"]].isna().all().all()
assert df[["min_sulfate", "min_clay", "min_carbonate"]].isna().all().all()
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
shares = df[["min_mafic", "min_feldspathic", "min_ironox"]]
ok = shares.notna().all(axis=1)
assert np.allclose(shares[ok].sum(axis=1), 1.0)
assert (shares[ok] >= 0).all().all() and (shares[ok] <= 1).all().all()
print(f"cells with shares: {ok.sum()} of {len(df)} ({cov:.1%})")
print(shares[ok].describe())
df.to_parquet(RAW / "part_minerals.parquet", index=False)
print("saved", RAW / "part_minerals.parquet")
