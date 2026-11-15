"""Write the site's weights.json (9 factors) from the team's preset table (web/src/presets.json).

Weights = preset values divided by their sum (4 decimals). Nothing is regrouped or dropped.
Factor ids and labels come from data/schema.json. The groups come from presets.json.

Usage: python src/make_weights.py --out frontend/public/data/weights.json
"""
import argparse
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DESCRIPTIONS = {
    "balanced": "Every factor counts. Surface type is not weighted.",
    "drilling": "Favours minerals, surface type and ice: what a drill meets.",
    "vehicles": "Favours slope, roughness and surface type: what a rover drives on.",
    "tooling": "Favours temperature, the day-night swing and surface type: what hardware must survive.",
    "solar": "Favours sunlight, temperature and surface type: what panels see.",
    "farming": "Favours minerals, temperature and sunlight: what plants grow in.",
    "pharma": "Favours sunlight and temperature. Radiation is not measured, so it is not matched.",
}


def shares(preset, keys):
    total = sum(preset[k] for k in keys)
    assert total > 0, "preset has no weight"
    return {k: round(preset[k] / total, 4) for k in keys}


def build(presets_json, schema):
    keys = presets_json["weightKeys"]
    factors = schema["factors"]
    assert keys == [f["id"] for f in factors], "presets.json keys differ from data/schema.json factors"
    group_of = {k: g for g, ks in presets_json["groups"].items() for k in ks}
    return {
        "sample": False, "default_preset": "balanced", "default_mode": "absolute",
        "factors": [{"id": f["id"], "label": f["label"], "group": group_of[f["id"]]} for f in factors],
        "groups": presets_json["groups"],
        "presets": {pid: {"label": v["label"], "description": DESCRIPTIONS.get(pid, ""),
                          "weights": shares(v, keys)} for pid, v in presets_json["presets"].items()},
    }


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--presets", type=Path, default=ROOT / "web" / "src" / "presets.json")
    ap.add_argument("--schema", type=Path, default=ROOT / "data" / "schema.json")
    ap.add_argument("--out", type=Path, required=True)
    a = ap.parse_args()
    out = build(json.loads(a.presets.read_text(encoding="utf-8")), json.loads(a.schema.read_text(encoding="utf-8")))
    a.out.parent.mkdir(parents=True, exist_ok=True)
    a.out.write_text(json.dumps(out, indent=1), encoding="utf-8")
    for pid, v in out["presets"].items():
        print(pid, v["weights"])


if __name__ == "__main__":
    main()
