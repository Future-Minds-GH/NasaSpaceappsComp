import numpy as np
import pandas as pd
import pytest

pytest.importorskip("surface_fractions")          # Job 1 PR #3: put surface_fractions.py next to this file
import merge_body as mb

SURF_COLS = ["surf_dust", "surf_sand", "surf_rock", "surf_ice"]
N = mb.NROWS * mb.NCOLS
IDS = np.arange(N)
ROW, COL = np.divmod(IDS, mb.NCOLS)
LAT = 90 - 0.25 - ROW * 0.5
LON = -180 + 0.25 + COL * 0.5


def thin():
    return pd.DataFrame({"cell_id": IDS, "lat": LAT, "lon": LON, "t_day_k": 300.0, "t_night_k": 100.0, "t_swing_k": 200.0,
                         "slope_deg": 2.0, "rough_m": 10.0, "elev_m": 0.0, "elev_pct": 50.0})


def moon_parts(ice_surface=0.0):
    rng = np.random.default_rng(0)
    ati = rng.uniform(0.001, 0.01, N)
    mafic = np.where(LAT > 0, 0.7, np.nan)
    rest = np.where(LAT > 0, 0.3, np.nan)
    return {
        "part_albedo_ice.parquet": pd.DataFrame({"cell_id": IDS, "albedo": 0.1, "ati": ati, "ice_prob": 0.0, "ice_surface": ice_surface}),
        "part_minerals_sun_caves.parquet": pd.DataFrame({
            "cell_id": IDS, "sun_wm2": 400.0, "min_mafic": mafic, "min_feldspathic": rest, "min_ironox": np.where(LAT > 0, 0.0, np.nan),
            "min_sulfate": np.where(LAT > 0, 0.0, np.nan), "min_clay": np.where(LAT > 0, 0.0, np.nan),
            "min_carbonate": np.where(LAT > 0, 0.0, np.nan), "cave_km": 50.0}),
    }


def mars_parts():
    rng = np.random.default_rng(1)
    sixth = np.where(LAT > 0, 1 / 6, np.nan)
    return {
        "part_sun_albedo_caves.parquet": pd.DataFrame({"cell_id": IDS, "sun_wm2": 100.0, "albedo": 0.2, "ati": rng.uniform(0.01, 0.06, N), "cave_km": 300.0}),
        "part_ice.parquet": pd.DataFrame({"cell_id": IDS, "ice_prob": 0.1, "ice_surface": np.where(LAT > 85, 1.0, 0.0)}),
        "part_minerals.parquet": pd.DataFrame({"cell_id": IDS, "min_mafic": sixth, "min_feldspathic": sixth, "min_ironox": sixth,
                                               "min_sulfate": sixth, "min_clay": sixth, "min_carbonate": sixth}),
    }


def test_moon_merge_has_contract_columns_and_valid_groups():
    df = mb.merge_parts("moon", thin(), moon_parts())
    mb.check_contract("moon", df)
    assert df["analog_ok"].all()
    assert df["min_clay"].dropna().eq(0).all()                  # 0 on the Moon, by the brief
    assert df["min_mafic"].isna().sum() == (LAT <= 0).sum()


def test_mars_merge_has_full_six_class_minerals():
    df = mb.merge_parts("mars", thin(), mars_parts())
    mb.check_contract("mars", df)
    assert np.allclose(df.loc[LAT > 0, mb.MIN].sum(axis=1), 1)
    assert df.loc[LAT > 0, mb.MIN].notna().all().all()          # no partly null row: the matcher would drop the factor


def test_surface_ice_only_from_ice_surface():
    df = mb.merge_parts("mars", thin(), mars_parts())
    cap = df["lat"] > 85
    assert (df.loc[cap, "surf_ice"] == 1).all() and (df.loc[~cap, "surf_ice"] == 0).all()
    assert (df["ice_prob"] == 0.1).all()                         # buried ice stays in ice_prob


def test_full_ice_cell_is_all_ice_without_albedo():
    parts = mars_parts()
    a = parts["part_sun_albedo_caves.parquet"]
    a.loc[LAT > 87, ["albedo", "ati"]] = np.nan          # no TES albedo near the pole
    df = mb.merge_parts("mars", thin(), parts)
    cap = df["lat"] > 87
    assert (df.loc[cap, SURF_COLS].to_numpy() == [0, 0, 0, 1]).all()
    mb.check_contract("mars", df)


def test_missing_part_leaves_columns_null():
    parts = moon_parts()
    parts["part_albedo_ice.parquet"] = None
    df = mb.merge_parts("moon", thin(), parts)
    assert df["albedo"].isna().all() and df["surf_dust"].isna().all()
    mb.check_contract("moon", df)


def test_partly_null_mineral_row_fails_check():
    df = mb.merge_parts("mars", thin(), mars_parts())
    row = int(np.flatnonzero(LAT > 0)[0])
    df.loc[row, "min_clay"] = np.nan                           # one null makes the whole mix "no data"
    with pytest.raises(AssertionError):
        mb.check_contract("mars", df)


def test_wrong_row_count_fails_fast():
    with pytest.raises(AssertionError):
        mb.merge_parts("moon", thin().iloc[:-1], moon_parts())
