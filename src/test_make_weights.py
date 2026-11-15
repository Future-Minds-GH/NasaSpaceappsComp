import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))
import make_weights as W  # noqa: E402

PRESETS = json.loads((W.ROOT / "web" / "src" / "presets.json").read_text(encoding="utf-8"))
SCHEMA = json.loads((W.ROOT / "data" / "schema.json").read_text(encoding="utf-8"))
KEYS = ["temp", "swing", "sun", "slope", "rough", "elev", "surface", "minerals", "ice"]


def test_every_preset_sums_to_one_and_has_9_keys():
    out = W.build(PRESETS, SCHEMA)
    assert [f["id"] for f in out["factors"]] == KEYS
    assert out["default_preset"] in out["presets"] and out["sample"] is False and out["default_mode"] == "absolute"
    assert set(out) == {"sample", "default_preset", "default_mode", "factors", "groups", "presets"}
    for pid, p in out["presets"].items():
        assert list(p["weights"]) == KEYS, pid
        assert abs(sum(p["weights"].values()) - 1) < 1e-3, pid
        assert p["description"], pid


def test_balanced_shares_and_labels():
    out = W.build(PRESETS, SCHEMA)
    w = out["presets"]["balanced"]["weights"]
    # balanced: 15 10 10 15 15 5 0 15 15 -> total 100: nothing regrouped or dropped
    assert w == {"temp": 0.15, "swing": 0.1, "sun": 0.1, "slope": 0.15, "rough": 0.15, "elev": 0.05,
                 "surface": 0.0, "minerals": 0.15, "ice": 0.15}
    assert out["factors"][0] == {"id": "temp", "label": "Temperature (day and night)", "group": "weather"}
    assert out["presets"]["solar"]["weights"]["sun"] == 0.45 and out["presets"]["solar"]["weights"]["surface"] == 0.25


def test_keys_must_match_schema():
    import copy
    bad = copy.deepcopy(SCHEMA)
    bad["factors"].pop()
    with pytest.raises(AssertionError):
        W.build(PRESETS, bad)
