import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import make_weights as W  # noqa: E402

PRESETS = json.loads((W.ROOT / "web" / "src" / "presets.json").read_text(encoding="utf-8"))


def test_every_preset_sums_to_one_and_has_7_factors():
    out = W.build(PRESETS)
    assert [f["id"] for f in out["factors"]] == W.FACTORS
    assert out["default_preset"] in out["presets"] and out["sample"] is False
    for pid, p in out["presets"].items():
        assert set(p["weights"]) == set(W.FACTORS), pid
        assert abs(sum(p["weights"].values()) - 1) < 1e-3, pid
        assert p["weights"]["geology"] == 0 and p["weights"]["atmosphere"] == 0


def test_balanced_mapping():
    w = W.build(PRESETS)["presets"]["balanced"]["weights"]
    # balanced: temp 15 swing 10 sun 10 slope 15 rough 15 elev 5 surface 0 minerals 15 ice 15 -> total 100
    assert w["climate"] == 0.35 and w["terrain"] == 0.3 and w["elevation"] == 0.05
    assert w["mineralogy"] == 0.15 and w["water_ice"] == 0.15
