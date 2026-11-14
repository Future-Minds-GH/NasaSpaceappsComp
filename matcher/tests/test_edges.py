"""Edge-case tests: export_web helpers, validate.py plumbing, match() corner cases (Python and JS)."""
import json
import subprocess
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "matcher"))
import export_web as EW  # noqa: E402
import match as M  # noqa: E402

DATA = ROOT / "web/public/data"
FAKE = ROOT / "data/fake"
need_data = pytest.mark.skipif(not (DATA / "earth.json").exists(), reason="run make_fake_tables + export_web")


def tiny(body="earth", n=6, ok=None, radius=2000.0):
    """Small synthetic table on a line of lon, 10 deg apart (>> min_sep at this radius)."""
    cols = {"lat": np.zeros(n), "lon": np.arange(n) * 10.0,
            "slope_deg": np.arange(n, dtype=float), "analog_ok": np.array(ok if ok is not None else [True] * n)}
    return M.Table({"body": body, "radius_km": radius, "grid_deg": 10, "fake": True}, cols)


W_SLOPE = {k: 0 for k in M.KEYS} | {"slope": 100}


# ---- export_web ----
def test_column_null_and_rounding():
    df = pd.DataFrame({"lat": [1.123456, 2.0], "t_day_k": [200.126, np.nan],
                       "analog_ok": [True, np.nan], "image_url": ["a.png", np.nan]})
    assert EW.column(df, "lat") == [1.1235, 2.0]
    assert EW.column(df, "t_day_k") == [200.13, None]
    assert EW.column(df, "analog_ok") == [True, False]  # null analog_ok -> False, never None
    assert EW.column(df, "image_url") == ["a.png", None]


def test_column_analog_ok_nullable_boolean_dtype():
    df = pd.DataFrame({"analog_ok": pd.array([True, None, False], dtype="boolean")})
    assert EW.column(df, "analog_ok") == [True, False, False]


def test_decimate_keeps_every_nth_line():
    lat, lon = np.meshgrid(np.arange(-2, 2.01, 0.5), np.arange(0, 4.01, 0.5), indexing="ij")
    df = pd.DataFrame({"lat": lat.ravel(), "lon": lon.ravel()})
    out = EW.decimate(df, 2, 0.5)
    assert sorted(out["lat"].unique()) == [-2.0, -1.0, 0.0, 1.0, 2.0]
    assert sorted(out["lon"].unique()) == [0.0, 1.0, 2.0, 3.0, 4.0]
    assert len(out) == 25
    assert EW.decimate(df, 1, 0.5) is df and EW.decimate(df, 0, 0.5) is df


def test_kv_parse():
    assert EW.kv("") == {}
    assert EW.kv("earth=2,moon=0.5") == {"earth": 2.0, "moon": 0.5}


@pytest.mark.skipif(not (FAKE / "earth.parquet").exists(), reason="run make_fake_tables")
def test_export_cli_decimate_and_meta(tmp_path):
    subprocess.run([sys.executable, str(ROOT / "matcher/export_web.py"), "--src", str(FAKE), "--fake",
                    "--dst", str(tmp_path), "--decimate", "earth=2"], check=True, capture_output=True)
    full = json.loads((DATA / "earth.json").read_text()) if (DATA / "earth.json").exists() else None
    dec = json.loads((tmp_path / "earth.json").read_text())
    assert dec["meta"]["fake"] is True
    n = len(dec["cols"]["lat"])
    assert all(len(v) == n for v in dec["cols"].values())
    assert set(dec["cols"]["analog_ok"]) <= {True, False}
    if full:
        assert dec["meta"]["grid_deg"] == pytest.approx(2 * full["meta"]["grid_deg"])
        assert n < len(full["cols"]["lat"])
    # moon not decimated: grid unchanged
    assert json.loads((tmp_path / "moon.json").read_text())["meta"]["grid_deg"] > 0


@pytest.mark.skipif(not (FAKE / "earth.parquet").exists(), reason="run make_fake_tables")
def test_export_cli_real_mode_needs_grid(tmp_path):
    r = subprocess.run([sys.executable, str(ROOT / "matcher/export_web.py"), "--src", str(FAKE),
                        "--dst", str(tmp_path)], capture_output=True, text=True)
    assert r.returncode != 0 and "--grid needs" in r.stderr  # no --grid, no --fake: clear error


# ---- validate.py ----
@need_data
def test_validate_runs_on_fake_data_and_writes_nothing():
    before = (ROOT / "validation").exists()
    r = subprocess.run([sys.executable, str(ROOT / "matcher/validate.py"), "--data", str(DATA), "--sweep"],
                       capture_output=True, text=True, cwd=ROOT)
    assert r.returncode == 0, r.stderr
    assert "PLUMBING CHECK" in r.stdout
    assert "[absolute] hit@10" in r.stdout and "[relative] hit@10" in r.stdout
    assert "[sweep x0.5]" in r.stdout and "[sweep x3.0]" in r.stdout
    assert "wrote validation" not in r.stdout
    assert (ROOT / "validation").exists() == before  # fake run must not create results


@need_data
def test_validate_summarize_and_symmetry():
    sys.path.insert(0, str(ROOT / "matcher"))
    import validate as V
    T = V.load(DATA)
    ka = json.loads((ROOT / "known_analogs.json").read_text())
    w = M.preset_weights("balanced")
    for mode in ("absolute", "relative"):
        s = V.summarize(T, ka, w, mode)
        assert s["n_inputs"] == len(s["hits"]) > 0
        assert 0 <= s["hit_at_10"] <= s["n_inputs"]
        assert s["neg_n"] == len(s["neg"]) and 0 <= s["neg_red"] <= s["neg_n"]
        assert s["neg_region_top10_hits"] >= 0
        assert V.symmetry(T, w, mode, n=45) < 1e-9


# ---- match() corner cases (Python) ----
def test_k_larger_than_candidates():
    t = tiny(n=3)
    res = M.match(tiny("moon", n=3), 0, 0, t, W_SLOPE, k=50)
    assert len(res) == 3


def test_k_zero_returns_empty():
    assert M.match(tiny("moon"), 0, 0, tiny(), W_SLOPE, k=0) == []


def test_empty_target_no_analog_ok_cells():
    t = tiny(ok=[False] * 6)
    assert M.match(tiny("moon"), 0, 0, t, W_SLOPE) == []


def test_all_zero_weights_returns_empty():
    assert M.match(tiny("moon"), 0, 0, tiny(), {k: 0 for k in M.KEYS}) == []


def test_missing_weights_keys_default_zero():
    assert M.match(tiny("moon"), 0, 0, tiny(), {"slope": 100}, k=2)


def test_nan_input_row_returns_empty():
    inp = tiny("moon")
    inp.cols["slope_deg"][0] = np.nan
    assert M.match(inp, 0, 0, tiny(), W_SLOPE) == []


def test_same_body_everything_excluded():
    t = tiny(n=2, radius=1000.0)  # cells 0 and 175 km from input: both inside the 300 km exclusion
    assert M.match(t, 0, 0, t, W_SLOPE, k=10) == []


def test_min_sep_limits_picks():
    t = tiny(n=6, radius=1000.0)  # 10 deg = 175 km < 200 km min separation
    res = M.match(tiny("moon"), 0, 0, t, W_SLOPE, k=10)
    assert 1 <= len(res) < 6


def test_include_none_and_none_value_python():
    w = M.preset_weights("balanced")
    a = M.effective_weights(w, None)
    b = M.effective_weights(w, {})
    assert a == b
    _, wk = M.effective_weights(w, {"slope": None})
    assert wk["slope"] == 0


# ---- JS parity on the same corner cases ----
JS = """
import {{ match, effectiveWeights, prepareTable }} from {url};
const raw = (body, n, ok, radius) => ({{ meta: {{ body, radius_km: radius, grid_deg: 10, fake: true }},
  cols: {{ lat: Array(n).fill(0), lon: [...Array(n).keys()].map((i) => i * 10),
    slope_deg: [...Array(n).keys()], analog_ok: ok }} }});
const W = {{ slope: 100 }};
const run = (a, t, extra = {{}}) => match({{ inputTable: a, inputLat: 0, inputLon: 0, targetTable: t, weights: W, ...extra }}).length;
const moon = raw('moon', 6, Array(6).fill(true), 2000);
const earth = raw('earth', 6, Array(6).fill(true), 2000);
const same = raw('earth', 2, [true, true], 1000);
const nanIn = raw('moon', 6, Array(6).fill(true), 2000); nanIn.cols.slope_deg[0] = null;
const wAll = effectiveWeights({{ slope: 100, temp: 50 }}, null).wk;
console.log(JSON.stringify({{
  kBig: match({{ inputTable: raw('moon', 3, [true, true, true], 2000), inputLat: 0, inputLon: 0,
    targetTable: raw('earth', 3, [true, true, true], 2000), weights: W, k: 50 }}).length,
  k0: run(moon, earth, {{ k: 0 }}),
  emptyTarget: run(moon, raw('earth', 6, Array(6).fill(false), 2000)),
  zeroW: match({{ inputTable: moon, inputLat: 0, inputLon: 0, targetTable: earth, weights: {{}} }}).length,
  nanInput: run(nanIn, earth),
  sameBody: match({{ inputTable: same, inputLat: 0, inputLon: 0, targetTable: same, weights: W, k: 10 }}).length,
  includeNull: run(moon, earth, {{ include: null }}),
  includeNullVal: effectiveWeights({{ slope: 100 }}, {{ slope: null }}).wk.slope,
  wkNull: wAll.slope,
}}));
"""


def test_js_corner_cases_match_python(tmp_path):
    f = tmp_path / "edge.mjs"
    f.write_text(JS.format(url=json.dumps((ROOT / "web/src/match.js").as_uri())))
    out = subprocess.run(["node", str(f)], capture_output=True, text=True, check=True).stdout
    js = json.loads(out)
    m6, e6 = tiny("moon"), tiny()
    assert js["kBig"] == len(M.match(tiny("moon", n=3), 0, 0, tiny(n=3), W_SLOPE, k=50)) == 3
    assert js["k0"] == len(M.match(m6, 0, 0, e6, W_SLOPE, k=0)) == 0
    assert js["emptyTarget"] == len(M.match(m6, 0, 0, tiny(ok=[False] * 6), W_SLOPE)) == 0
    assert js["zeroW"] == len(M.match(m6, 0, 0, e6, {})) == 0
    nan_in = tiny("moon")
    nan_in.cols["slope_deg"][0] = np.nan
    assert js["nanInput"] == len(M.match(nan_in, 0, 0, e6, W_SLOPE)) == 0
    t2 = tiny(n=2, radius=1000.0)
    assert js["sameBody"] == len(M.match(t2, 0, 0, t2, W_SLOPE, k=10)) == 0
    assert js["includeNull"] == len(M.match(m6, 0, 0, e6, W_SLOPE, include=None))
    assert js["includeNullVal"] == M.effective_weights({"slope": 100}, {"slope": None})[1]["slope"] == 0
    assert js["wkNull"] == 100
