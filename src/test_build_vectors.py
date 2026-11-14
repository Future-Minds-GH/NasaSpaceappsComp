import numpy as np
import pandas as pd
import pytest

import build_vectors as bv

N = bv.NROWS * bv.NCOLS
IDS = np.arange(N)
ROW, COL = np.divmod(IDS, bv.NCOLS)
LAT = 90 - bv.CELL / 2 - ROW * bv.CELL
LON = -180 + bv.CELL / 2 + COL * bv.CELL


def make_df():
    df = pd.DataFrame({"cell_id": IDS, "lat": LAT, "lon": LON})
    df["analog_ok"] = pd.array(np.where(np.abs(LAT) < 60, True, False), dtype="boolean")
    df.loc[(np.abs(LAT - 10) < 5) & (np.abs(LON - 100) < 5), "analog_ok"] = pd.NA     # unknown: not scored
    df["slope_deg"] = np.abs(LAT) / 6.0
    df["rough_m"] = np.abs(LON) / 3.0
    df["elev_m"] = 1000.0 + LAT
    df["t_day_k"] = 300.0 - 0.3 * np.abs(LAT)
    df["t_night_k"] = 280.0 - 0.3 * np.abs(LAT)
    df["t_swing_k"] = df["t_day_k"] - df["t_night_k"] + (LON / 180.0)
    df["sun_wm2"] = 250.0 - np.abs(LAT)
    df["ice_prob"] = np.where(LAT < -45, 0.5, 0.0)
    # minerals: EMIT-like cells in the north-east, GLiM-only cells in the south-east, null elsewhere
    emit = (LAT > 0) & (LON > 0)
    glim = (LAT < 0) & (LON > 0)
    df["min_mafic"] = np.where(emit, 0.2, np.where(glim, 1.0, np.nan))
    df["min_ironox"] = np.where(emit, 0.2, np.where(glim, 0.0, np.nan))
    df["min_sulfate"] = np.where(emit, 0.1, np.where(glim, 0.0, np.nan))
    df["min_clay"] = np.where(emit, 0.4, np.where(glim, 0.0, np.nan))
    df["min_carbonate"] = np.where(emit, 0.1, np.where(glim, 0.0, np.nan))
    return df


@pytest.fixture(scope="module")
def built():
    df = make_df()
    known = [{"lat": 25.0, "lon": 15.0}]
    vectors, meta, tiles, summary = bv.build(df, known)
    return df, vectors, np.frombuffer(meta, dtype=[("tile", "<u4"), ("km", "<u2"), ("tags", "<u2"), ("name", "<u2"), ("env", "u1"), ("flags", "u1")]), tiles, summary


def row_of(built, lat, lon):
    from astropy import units as u
    from astropy_healpix import HEALPix
    idx = int(HEALPix(nside=bv.NSIDE, order="nested").lonlat_to_healpix(lon * u.deg, lat * u.deg))
    tiles = built[3]
    r = int(np.searchsorted(tiles, idx))
    assert r < tiles.size and tiles[r] == idx, "tile not scored"
    return r


def test_sizes_and_order(built):
    df, vectors, meta, tiles, summary = built
    assert vectors.shape == (tiles.size, 34) and vectors.dtype == np.uint8
    assert len(meta) == tiles.size and meta.dtype.itemsize == 12
    assert np.all(np.diff(tiles) > 0) and np.all(meta["tile"] == tiles)


def test_only_scored_tiles(built):
    # no tile centre at |lat| >= 60 and none in the 'unknown' box
    from astropy import units as u
    from astropy_healpix import HEALPix
    hp = HEALPix(nside=bv.NSIDE, order="nested")
    lon, lat = hp.healpix_to_lonlat(built[3])
    assert np.all(np.abs(lat.to_value(u.deg)) < 60.2)
    inbox = (np.abs(lat.to_value(u.deg) - 10) < 4.8) & (np.abs(((lon.to_value(u.deg) + 180) % 360) - 180 - 100) < 4.8)
    assert not inbox.any()


def test_always_null_fields(built):
    vectors = built[1]
    ids = [f[1] for f in bv.FIELDS]
    for fid in ("emb0", "emb7", "topo_position", "rock_class", "volcanic", "impact", "salts", "aridity",
                "cold_extreme", "pressure", "wind", "dust", "dust_storms", "ice_depth", "ice_form", "liquid_water"):
        assert (vectors[:, ids.index(fid)] == bv.NULL).all(), fid


def test_fraction_encoding(built):
    df, vectors, meta, tiles, summary = built
    ids = [f[1] for f in bv.FIELDS]
    r = row_of(built, 45.0, 60.0)          # emit cell
    assert vectors[r, ids.index("mafic")] == round(0.2 * 254)
    assert vectors[r, ids.index("clays")] == round(0.4 * 254)
    assert vectors[r, ids.index("ice_fraction")] == 0
    r = row_of(built, -50.0, 60.0)         # glim-only cell, ice 0.5
    assert vectors[r, ids.index("mafic")] == 254
    assert vectors[r, ids.index("ice_fraction")] == round(0.5 * 254)
    r = row_of(built, 45.0, -60.0)         # no minerals
    assert vectors[r, ids.index("mafic")] == bv.NULL and vectors[r, ids.index("iron_oxides")] == bv.NULL


def test_percentiles_are_ranks(built):
    vectors = built[1]
    ids = [f[1] for f in bv.FIELDS]
    slope = vectors[:, ids.index("slope")]
    assert slope.min() >= 0 and slope.max() == 254 and (slope != bv.NULL).all()
    lo, hi = row_of(built, 1.0, 0.0), row_of(built, 55.0, 0.0)
    assert slope[hi] > slope[lo]
    mean_t = vectors[:, ids.index("mean_temp")]
    assert mean_t[lo] > mean_t[hi]          # warmer near the equator in the synthetic data


def test_flags_and_km(built):
    df, vectors, meta, tiles, summary = built
    assert meta["flags"][row_of(built, -50.0, 60.0)] == 1      # GLiM-only: estimated
    assert meta["flags"][row_of(built, 45.0, 60.0)] == 0       # EMIT: measured
    assert meta["flags"][row_of(built, 45.0, -60.0)] == 0      # no minerals: nothing to flag
    near = row_of(built, 25.1, 15.1)
    assert meta["km"][near] < 30 and meta["km"][row_of(built, -50.0, 60.0)] > 1000
    assert (meta["name"] == bv.NO_NAME).all() and (meta["env"] == bv.NO_ENV).all() and (meta["tags"] == 0).all()


def test_no_known_sites_gives_unknown_km():
    df = make_df()
    _, meta, _, _ = bv.build(df, [])
    km = np.frombuffer(meta, dtype=[("tile", "<u4"), ("km", "<u2"), ("tags", "<u2"), ("name", "<u2"), ("env", "u1"), ("flags", "u1")])["km"]
    assert (km == bv.NO_KM).all()


def schema_from_fields():
    factors = []
    for factor, fid, kind, _ in bv.FIELDS:
        if not factors or factors[-1]["id"] != factor:
            factors.append({"id": factor, "fields": []})
        factors[-1]["fields"].append({"id": fid, "kind": kind})
    return {"factors": factors, "nside": {"earth": bv.NSIDE}, "scheme": "nested", "null_code": bv.NULL}


def test_schema_check():
    bv.check_schema(schema_from_fields())
    bad = schema_from_fields()
    bad["factors"][0]["fields"].reverse()
    with pytest.raises(AssertionError):
        bv.check_schema(bad)


def test_missing_column_fails_fast():
    df = make_df().drop(columns=["ice_prob"])
    with pytest.raises(AssertionError):
        bv.build(df, [])
