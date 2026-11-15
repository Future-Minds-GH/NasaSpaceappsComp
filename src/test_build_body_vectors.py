import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))
pytest.importorskip("astropy_healpix")
import build_body_vectors as B  # noqa: E402
from build_vectors import BYTES, FIELDS, NULL, check_schema  # noqa: E402

COL = {f[1]: j for j, f in enumerate(FIELDS)}


def table(seed=0, ok=True):
    rng = np.random.default_rng(seed)
    n = B.NROWS * B.NCOLS
    ids = np.arange(n)
    lat = 90 - B.CELL / 2 - (ids // B.NCOLS) * B.CELL
    lon = -180 + B.CELL / 2 + (ids % B.NCOLS) * B.CELL
    df = pd.DataFrame({"cell_id": ids, "lat": lat, "lon": lon})
    for c in ["slope_deg", "rough_m", "elev_m", "t_day_k", "t_night_k", "t_swing_k", "sun_wm2"]:
        df[c] = rng.random(n)
    mins = rng.dirichlet(np.ones(6), n)
    for i, c in enumerate(["min_mafic", "min_feldspathic", "min_ironox", "min_sulfate", "min_clay", "min_carbonate"]):
        df[c] = mins[:, i]
    df["ice_prob"] = 0.0
    df["analog_ok"] = ok
    return df


def cell_id(lat, lon):
    return int(B.cell_of(np.array([lat]), np.array([lon]))[0])


def test_schema_matches_fields():
    s = B.schema()
    check_schema({**s, "nside": {**s["nside"], "earth": 256}})
    assert s["nside"] == {"earth": 256, "moon": 64, "mars": 128}
    assert sum(len(f["fields"]) for f in s["factors"]) == BYTES == 35


@pytest.mark.parametrize("body", ["moon", "mars"])
def test_every_tile_and_cell_lookup(body):
    nside = B.NSIDE[body]
    df = table()
    t = B.tile_of(nside, -5.4, 137.8)                    # the tile centre's cell gives the tile its value
    tlat, tlon = B.tile_centres(nside)
    df.loc[df.cell_id == cell_id(tlat[t], tlon[t]), "ice_prob"] = 1.0
    vec, summary = B.build_body(df, nside)
    assert vec.shape == (12 * nside * nside, BYTES)
    assert summary["scored_tiles"] == 12 * nside * nside
    assert vec[t, COL["ice_fraction"]] == 254
    assert (vec[:, COL["ice_fraction"]] == 254).sum() <= 4   # only tiles whose centre is in that cell
    assert (vec[:, COL["emb0"]] == NULL).all() and (vec[:, COL["pressure"]] == NULL).all()
    pct = vec[:, COL["slope"]].astype(float)
    assert pct.min() <= 1 and pct.max() >= 253           # ranks span 0..1 within the body


def test_unscored_tiles_are_all_null():
    df = table()
    df["analog_ok"] = df["lat"] > 0                      # southern half not scored
    vec, summary = B.build_body(df, 64)
    tlat, _ = B.tile_centres(64)
    south = tlat < -1
    assert (vec[south] == NULL).all()
    assert (vec[tlat > 1][:, COL["slope"]] != NULL).all()
    assert 0 < summary["scored_tiles"] < vec.shape[0]


def test_mars_shards_and_meta(tmp_path):
    vec, _ = B.build_body(table(1), 128)
    (tmp_path / "vectors").mkdir()
    B.write_body(tmp_path, "mars", vec)
    joined = b"".join((tmp_path / "vectors" / f"mars_{i}.bin").read_bytes() for i in range(12))
    assert joined == vec.tobytes()
    meta = B.body_meta("mars", [{"body": "mars", "name": "Jezero", "lat": 18.38, "lon": 77.58},
                                {"body": "moon", "name": "X", "lat": 0, "lon": 0}])
    assert len(meta["sites"]) == 1 and meta["sites"][0]["target_id"] == "jezero"
    idx = B.tile_of(128, 18.38, 77.58)
    assert meta["sites"][0]["tile_id"] == f"mars_128_{idx}" and meta["named"] == {str(idx): "Jezero"}
    assert meta["sample"] is False and meta["reality_gap"]


def test_cli(tmp_path):
    p = tmp_path / "moon.parquet"
    table(2).to_parquet(p)
    sys.argv = ["x", "--moon", str(p), "--out", str(tmp_path / "out")]
    B.main()
    assert (tmp_path / "out/vectors/moon.bin").stat().st_size == 12 * 64 * 64 * BYTES
    assert json.loads((tmp_path / "out/vectors/schema.json").read_text(encoding="utf-8"))["sample"] is False
    assert json.loads((tmp_path / "out/tiles/moon_meta.json").read_text(encoding="utf-8"))["body"] == "moon"
