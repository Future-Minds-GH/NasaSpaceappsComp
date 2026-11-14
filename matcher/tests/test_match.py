import json
import math
import re
import subprocess
import sys
from pathlib import Path

import numpy as np
import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "matcher"))
sys.path.insert(0, str(ROOT / "src"))
import match as M  # noqa: E402
from surface_fractions import surface_fractions  # noqa: E402

BODIES = ["earth", "moon", "mars"]
DATA = ROOT / "web/public/data"
pytestmark = pytest.mark.skipif(not (DATA / "earth.json").exists(), reason="run make_fake_tables + export_web")


@pytest.fixture(scope="module")
def T():
    return {b: M.Table.from_path(DATA / f"{b}.json") for b in BODIES}


def test_presets_sum_100():
    for name, p in M.PRESETS["presets"].items():
        assert sum(p[k] for k in M.KEYS) == 100, name


def test_surface_fractions_sum_and_null():
    a = np.array([0.1, 0.3, 0.5, np.nan])
    ati = np.array([0.003, 0.012, 0.04, 0.01])
    ice = np.array([0.0, 0.2, 1.0, 0.0])
    d, s, r, i = surface_fractions(a, ati, ice)
    assert np.allclose((d + s + r + i)[:3], 1.0)
    assert np.isnan([d[3], s[3], r[3], i[3]]).all()
    assert surface_fractions(0.2, 0.012, np.nan)[0] != surface_fractions(0.2, 0.012, np.nan)[0]  # NaN


def test_fake_tables_flagged_and_columns(T):
    for b in BODIES:
        assert T[b].meta["fake"] is True
        assert T[b].meta["body"] == b


def test_bands_edges():
    assert M.band_of(90.0) == "green" and M.band_of(89.999) == "yellow"
    assert M.band_of(60.0) == "yellow" and M.band_of(59.999) == "red"


def test_self_score_is_100(T):
    w = M.preset_weights("balanced")
    for mode in ("absolute", "relative"):
        sc, bd, _ = M.pair_score(T["mars"], 10, T["mars"], 10, w, mode=mode)
        # ice may be all-zero in relative mode; identical cell must still be perfect
        assert sc == pytest.approx(100.0)


@pytest.mark.parametrize("a", BODIES)
@pytest.mark.parametrize("b", BODIES)
@pytest.mark.parametrize("mode", ["absolute", "relative"])
@pytest.mark.parametrize("preset", ["balanced", "solar"])
def test_pair_score_symmetric(T, a, b, mode, preset):
    rng = np.random.default_rng(1)
    w = M.preset_weights(preset)
    for _ in range(25):
        i = int(rng.integers(T[a].n))
        j = int(rng.integers(T[b].n))
        if not (T[a].ok_mask()[i] and T[b].ok_mask()[j]):
            continue
        s1, _, _ = M.pair_score(T[a], i, T[b], j, w, mode=mode)
        s2, _, _ = M.pair_score(T[b], j, T[a], i, w, mode=mode)
        assert (s1 is None) == (s2 is None)
        if s1 is not None:
            assert s1 == pytest.approx(s2, abs=1e-9)


def test_missing_data_drops_feature(T):
    earth = T["earth"]
    gaps = np.nonzero(np.isnan(earth.cols["min_mafic"]))[0]
    assert len(gaps) > 0
    w = {k: 0 for k in M.KEYS}
    w.update(slope=50, minerals=50)
    sc, bd, _ = M.pair_score(T["mars"], 0, earth, int(gaps[0]), w)
    assert bd["minerals"] is None
    assert sc == pytest.approx(100 * bd["slope"])  # weight re-spread over slope only


def test_zero_weight_gives_none(T):
    sc, bd, w = M.pair_score(T["mars"], 0, T["moon"], 0, {k: 0 for k in M.KEYS})
    assert sc is None and bd == {}


def test_match_all_nine_pairs(T):
    w = M.preset_weights("balanced")
    for a in BODIES:
        for b in BODIES:
            res = M.match(T[a], 10.0, 20.0, T[b], w, mode="absolute")
            assert 1 <= len(res) <= 5
            scores = [r["score"] for r in res]
            assert scores == sorted(scores, reverse=True)
            assert all(0 <= s <= 100 for s in scores)
            rr = T[b].meta["radius_km"]
            for x in range(len(res)):
                for y in range(x + 1, len(res)):
                    d = M.haversine_km(res[x]["lat"], res[x]["lon"], res[y]["lat"], res[y]["lon"], rr)
                    assert d >= 200
            assert all(T[b].ok_mask()[r["index"]] for r in res)
            assert len(res[0]["worst"]) <= 2


def test_same_body_excludes_neighbourhood(T):
    w = M.preset_weights("balanced")
    res = M.match(T["mars"], 18.4, 77.6, T["mars"], w)
    rr = T["mars"].meta["radius_km"]
    for r in res:
        assert M.haversine_km(18.4, 77.6, r["lat"], r["lon"], rr) >= 300


def test_include_false_zeroes_weight(T):
    w = M.preset_weights("balanced")
    res = M.match(T["mars"], 0, 0, T["earth"], w, include={"minerals": False, "ice": False})
    assert "minerals" not in res[0]["breakdown"] and "ice" not in res[0]["breakdown"]


def test_is_new_flag(T):
    w = M.preset_weights("balanced")
    res = M.match(T["mars"], 0, 0, T["earth"], w)
    here = [{"body": "earth", "lat": res[0]["lat"], "lon": res[0]["lon"]}]
    res2 = M.match(T["mars"], 0, 0, T["earth"], w, known_sites=here)
    assert res2[0]["isNew"] is False
    far = [{"body": "moon", "lat": res[0]["lat"], "lon": res[0]["lon"]}]  # other body: ignored
    assert M.match(T["mars"], 0, 0, T["earth"], w, known_sites=far)[0]["isNew"] is True
    assert res[0]["isNew"] is None


def test_groups_and_relative(T):
    w = M.apply_group(M.preset_weights("balanced"), "weather")
    assert w["slope"] == 0 and w["temp"] == 15
    r = M.match(T["moon"], 0, 0, T["earth"], M.preset_weights("balanced"), mode="relative")
    assert r and r[0]["breakdown"]["temp"] is not None


def test_no_body_names_in_matchers():
    for f in (ROOT / "matcher/match.py", ROOT / "web/src/match.js"):
        code = re.sub(r"(#|//).*", "", f.read_text())
        assert not re.search(r"""['"](earth|moon|mars)['"]""", code, re.I), f.name


def test_python_equals_js(T, tmp_path):
    cases = []
    rng = np.random.default_rng(7)
    weights = {"balanced": M.preset_weights("balanced"), "solar": M.preset_weights("solar")}
    for a in BODIES:
        for b in BODIES:
            for mode in ("absolute", "relative"):
                pairs = [[int(rng.integers(T[a].n)), int(rng.integers(T[b].n))] for _ in range(8)]
                cases.append({"input": a, "target": b, "lat": float(rng.uniform(-60, 60)),
                              "lon": float(rng.uniform(-170, 170)), "mode": mode,
                              "weights": weights["balanced" if mode == "absolute" else "solar"],
                              "include": {"ice": False} if b == "mars" else {}, "pairs": pairs})
    sites = [{"body": "earth", "lat": 24.0, "lon": -70.0}, {"body": "mars", "lat": 18.4, "lon": 77.6}]
    fx = tmp_path / "fx.json"
    fx.write_text(json.dumps({"cases": cases, "knownSites": sites}))
    out = subprocess.run(["node", str(ROOT / "matcher/js_runner.mjs"), str(fx)], cwd=ROOT,
                         capture_output=True, text=True, check=True).stdout
    js = json.loads(out)
    for c, j in zip(cases, js):
        py = M.match(T[c["input"]], c["lat"], c["lon"], T[c["target"]], c["weights"], c["include"],
                     c["mode"], known_sites=sites)
        assert [r["index"] for r in py] == [r["index"] for r in j["match"]]
        for p, q in zip(py, j["match"]):
            assert p["score"] == pytest.approx(q["score"], abs=1e-9)
            assert p["band"] == q["band"] and p["worst"] == q["worst"] and p["isNew"] == q["isNew"]
            assert p["caveKm"] == (pytest.approx(q["caveKm"]) if q["caveKm"] is not None else None)
            assert set(p["breakdown"]) == set(q["breakdown"])
            for k, v in p["breakdown"].items():
                assert (v is None) == (q["breakdown"][k] is None)
                if v is not None:
                    assert v == pytest.approx(q["breakdown"][k], abs=1e-9)
        for (i, jx), q in zip(c["pairs"], j["pairs"]):
            s, bd, worst = M.pair_score(T[c["input"]], i, T[c["target"]], jx, c["weights"], c["include"], c["mode"])
            assert (s is None) == (q["score"] is None)
            if s is not None:
                assert s == pytest.approx(q["score"], abs=1e-9)
            assert worst == q["worst"]
