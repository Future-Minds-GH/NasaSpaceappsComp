import numpy as np
import pandas as pd
import pytest

import build_vectors as bv

SCHEMA, FIELDS = bv.load_schema()
IDS_ = [f["id"] for f in FIELDS]
FIELD = {f["id"]: f for f in FIELDS}

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
    df["min_feldspathic"] = np.where(emit, 0.0, np.where(glim, 0.0, np.nan))
    df["surf_dust"], df["surf_sand"], df["surf_rock"], df["surf_ice"] = 0.1, 0.2, 0.7, 0.0
    return df


@pytest.fixture(scope="module")
def built():
    df = make_df()
    known = [{"lat": 25.0, "lon": 15.0}, {"lat": -50.0, "lon": 60.0, "role": "negative_control"}]
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
    assert vectors.shape == (tiles.size, 25) and vectors.dtype == np.uint8
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


def col(built, fid):
    return built[1][:, IDS_.index(fid)]


def test_field_order_is_the_schema(built):
    assert len(FIELDS) == 25     # 18 factor fields + 7 relative fields in data/schema.json
    assert IDS_[:18] == ["t_day_k", "t_night_k", "t_swing_k", "sun_wm2", "slope_deg", "rough_m", "elev_pct",
                         "surf_dust", "surf_sand", "surf_rock", "surf_ice", "min_mafic", "min_feldspathic",
                         "min_ironox", "min_sulfate", "min_clay", "min_carbonate", "ice_prob"]
    assert IDS_[18:] == [f["id"] for f in SCHEMA["relative_fields"]]


def test_value_encoding_round_trip(built):
    # decode within half a step; values outside min/max are clipped
    df, vectors, meta, tiles, summary = built
    r = row_of(built, 45.0, 60.0)
    for fid, x in (("t_day_k", 300 - 0.3 * 45), ("t_night_k", 280 - 0.3 * 45), ("sun_wm2", 205.0), ("slope_deg", 7.5)):
        f = FIELD[fid]
        back = f["min"] + col(built, fid)[r] / 254 * (f["max"] - f["min"])
        assert abs(back - x) <= (f["max"] - f["min"]) / 254 / 2 + 0.2, fid       # 0.2: the tile sits in a 0.25 deg cell
    assert col(built, "rough_m")[row_of(built, 1.0, 179.0)] == round(179.9 / 3 / 1016 * 254)
    assert col(built, "slope_deg").max() <= 254


def test_value_is_clipped():
    f = {"id": "x", "kind": "value", "min": 0, "max": 10}
    v = bv.field_values(pd.DataFrame({"x": [-5.0, 5.0, 50.0, np.nan]}), f)
    assert list(bv.to_byte(v)) == [0, 127, 254, bv.NULL]


def test_fraction_encoding(built):
    r = row_of(built, 45.0, 60.0)          # emit cell
    assert col(built, "min_mafic")[r] == round(0.2 * 254)
    assert col(built, "min_clay")[r] == round(0.4 * 254)
    assert col(built, "surf_rock")[r] == round(0.7 * 254)
    assert col(built, "ice_prob")[r] == 0
    r = row_of(built, -50.0, 60.0)         # glim-only cell, ice 0.5
    assert col(built, "min_mafic")[r] == 254 and col(built, "ice_prob")[r] == round(0.5 * 254)
    r = row_of(built, 45.0, -60.0)         # no minerals
    assert col(built, "min_mafic")[r] == bv.NULL and col(built, "min_ironox")[r] == bv.NULL


def test_percentile_rule(built):
    # elev_pct and the relative fields: (average rank - 0.5) / n among the scored tiles
    df, vectors, meta, tiles, summary = built
    assert (col(built, "elev_pct") != bv.NULL).all()
    for fid, src in (("elev_pct", "elev_m"), ("slope_pct", "slope_deg"), ("t_day_pct", "t_day_k")):
        want = bv.to_byte(bv.percentile_rank(df[src].to_numpy()[bv.tile_cell_ids()[0][tiles]]))
        assert (col(built, fid) == want).all(), fid
    lo, hi = row_of(built, 1.0, 0.0), row_of(built, 55.0, 0.0)
    assert col(built, "slope_pct")[hi] > col(built, "slope_pct")[lo]
    assert col(built, "t_day_pct")[lo] > col(built, "t_day_pct")[hi]
    assert col(built, "slope_pct").min() <= 2 and col(built, "slope_pct").max() >= 252
    assert len(set(col(built, "ice_pct")[col(built, "ice_prob") == 0])) == 1       # ties share one average rank


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


def test_negative_controls_are_skipped():
    lat, lon = np.array([-50.0]), np.array([60.0])
    ctrl = [{"lat": -50.0, "lon": 60.0, "role": "negative_control"}]
    assert bv.nearest_analog_km(lat, lon, ctrl)[0] == bv.NO_KM
    both = ctrl + [{"lat": -50.0, "lon": 61.0, "role": "site"}]
    assert 60 < bv.nearest_analog_km(lat, lon, both)[0] < 80       # the real site, not the control


def test_load_schema_rejects_old_format(tmp_path):
    bad = tmp_path / "s.json"
    bad.write_text('{"version": "0.1", "scheme": "nested", "null_code": 255, "byte_scale": 254, "factors": [], "relative_fields": []}')
    with pytest.raises(AssertionError):
        bv.load_schema(bad)


def test_table_without_ocean_rows():
    # a table that holds only some cells (no ocean rows) must still work
    part = make_df()
    part = part[np.abs(part["lat"]) < 30].copy()
    vectors, _, tiles, _ = bv.build(part, [])
    assert vectors.shape[0] == tiles.size and tiles.size > 0
    assert (vectors[:, IDS_.index("slope_deg")] != bv.NULL).all()


def test_half_rounds_up_like_js():
    assert bv.to_byte(np.array([0.75]))[0] == 191          # 190.5 -> 191 (Python rint would give 190)
    assert bv.to_byte(np.array([np.nan]))[0] == bv.NULL
    assert bv.to_byte(np.array([1.0000001]))[0] == 254     # tiny overshoot is clipped, not a crash
    with pytest.raises(AssertionError):
        bv.to_byte(np.array([1.5]))


def test_percentile_uses_contract_definition():
    p = bv.percentile_rank(np.array([10.0, 20.0, 30.0, 40.0, np.nan]))
    assert np.allclose(p[:4], [0.125, 0.375, 0.625, 0.875]) and np.isnan(p[4])


def test_emit_cell_with_glim_share_is_not_estimated(built):
    # EMIT classes (0.4 + 0.1 + 0.1 + 0.2) are not all zero, so the flag stays 0
    df, vectors, meta, tiles, summary = built
    assert meta["flags"][row_of(built, 45.0, 60.0)] == 0


def test_missing_column_fails_fast():
    df = make_df().drop(columns=["ice_prob"])
    with pytest.raises(AssertionError):
        bv.build(df, [])


def test_percentile_rank_formula():
    # fixed case: ties share the average rank, NaN stays NaN and is left out of n
    got = bv.percentile_rank([10.0, 20.0, 20.0, np.nan])
    want = [(1 - 0.5) / 3, (2.5 - 0.5) / 3, (2.5 - 0.5) / 3]
    assert np.allclose(got[:3], want) and np.isnan(got[3])


def test_control_rows_encode_the_cell_and_rank_among_scored_tiles(built):
    df, vectors, meta, tiles, summary = built
    controls = [{"lat": 75.1, "lon": 20.1}, {"lat": 10.1, "lon": 100.1}, {"lat": 25.1, "lon": 15.1}]   # unscored, unscored, scored
    rows = bv.control_rows(df, controls)
    assert rows.shape == (3, 25) and rows.dtype == np.uint8
    scored = df["slope_deg"].to_numpy()[bv.tile_cell_ids()[0][tiles]]
    for i, c in enumerate(controls):
        cell = int((90 - c["lat"]) // bv.CELL) * bv.NCOLS + int((c["lon"] + 180) // bv.CELL)
        x = df["slope_deg"].to_numpy()[cell]
        below, equal = (scored < x).sum(), (scored == x).sum()
        assert rows[i, IDS_.index("slope_pct")] == bv.to_byte([(below + equal / 2) / scored.size])[0]
        f = FIELD["slope_deg"]
        assert rows[i, IDS_.index("slope_deg")] == bv.to_byte([np.clip((x - f["min"]) / (f["max"] - f["min"]), 0, 1)])[0]
    assert rows[0, IDS_.index("slope_pct")] == 254        # steeper than every scored tile
    assert rows[1, IDS_.index("slope_pct")] < 60          # gentler than most (about a fifth of scored tiles are gentler)
    # a scored cell gives the same bytes as the scored tile of that cell
    assert (rows[2] == vectors[row_of(built, 25.125, 15.125)]).all()
