"""Write the site's weights.json (7 factors) from the team's preset table (web/src/presets.json, 9 keys).

Mapping of the 9 preset keys to the site's 7 factors:
  terrain    = slope + rough          mineralogy = minerals
  elevation  = elev                   climate    = temp + swing + sun
  water_ice  = ice                    geology, atmosphere = 0 (no Earth data for these fields)
  surface    -> dropped: schema v0.1 has no surface-type field. The rest is rescaled to sum 1.

Usage: python src/make_weights.py --out frontend/public/data/weights.json
"""
import argparse
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FACTORS = ["terrain", "elevation", "geology", "mineralogy", "climate", "atmosphere", "water_ice"]
LABELS = {"terrain": "Terrain", "elevation": "Elevation & topography", "geology": "Geology",
          "mineralogy": "Mineralogy", "climate": "Climate", "atmosphere": "Atmosphere: dust & wind",
          "water_ice": "Water & ice"}
MAP = {"terrain": ["slope", "rough"], "elevation": ["elev"], "geology": [], "mineralogy": ["minerals"],
       "climate": ["temp", "swing", "sun"], "atmosphere": [], "water_ice": ["ice"]}
DESCRIPTIONS = {
    "balanced": "Every measured factor counts.",
    "drilling": "Favours minerals, surface type and ice: what a drill meets.",
    "vehicles": "Favours slope and roughness: what a rover drives on.",
    "tooling": "Favours temperature and the day-night swing: what hardware must survive.",
    "solar": "Favours sunlight and temperature: what panels see.",
    "farming": "Favours minerals, temperature and sunlight: what plants grow in.",
    "pharma": "Favours sunlight and temperature. Radiation cannot be matched on Earth.",
}


def factor_weights(preset):
    raw = {f: sum(preset[k] for k in MAP[f]) for f in FACTORS}
    total = sum(raw.values())
    assert total > 0, "preset has no weight on any exported factor"
    return {f: round(v / total, 4) for f, v in raw.items()}


def build(presets_json):
    p = presets_json["presets"]
    return {
        "sample": False,
        "factors": [{"id": f, "label": LABELS[f]} for f in FACTORS],
        "default_preset": "balanced",
        "presets": {pid: {"label": v["label"], "description": DESCRIPTIONS.get(pid, ""),
                          "weights": factor_weights(v)} for pid, v in p.items()},
    }


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--presets", type=Path, default=ROOT / "web" / "src" / "presets.json")
    ap.add_argument("--out", type=Path, required=True)
    a = ap.parse_args()
    out = build(json.loads(a.presets.read_text(encoding="utf-8")))
    a.out.parent.mkdir(parents=True, exist_ok=True)
    a.out.write_text(json.dumps(out, indent=1), encoding="utf-8")
    for pid, v in out["presets"].items():
        print(pid, v["weights"])


if __name__ == "__main__":
    main()
