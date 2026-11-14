"""Convert parquet tables to web JSON ({meta, cols}). See contract.md section 3.

Usage:
  python matcher/export_web.py --src data/fake --fake
  python matcher/export_web.py --src analog-finder/processed --decimate earth=2,moon=2,mars=2 --grid earth=0.25,moon=0.5,mars=0.5
--decimate N keeps every Nth lat and lon line of a regular grid (needs lat/lon on the source grid).
"""
import argparse
import json
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
RADIUS = {"earth": 6371.0, "moon": 1737.4, "mars": 3389.5}
WEB_COLS = ["lat", "lon", "t_day_k", "t_night_k", "t_swing_k", "sun_wm2", "slope_deg", "rough_m",
            "elev_m", "elev_pct", "surf_dust", "surf_sand", "surf_rock", "surf_ice", "min_mafic",
            "min_feldspathic", "min_ironox", "min_sulfate", "min_clay", "min_carbonate",
            "ice_prob", "analog_ok", "cave_km", "image_url"]
WARN_MB = 15


def kv(s):
    return {a.split("=")[0]: float(a.split("=")[1]) for a in s.split(",")} if s else {}


def decimate(df, n, grid):
    if n <= 1:
        return df
    keep_lat = np.round((df["lat"] - df["lat"].min()) / grid).astype(int) % n == 0
    keep_lon = np.round((df["lon"] - df["lon"].min()) / grid).astype(int) % n == 0
    return df[keep_lat & keep_lon]


def column(df, name):
    s = df[name]
    if name == "analog_ok":
        return [False if pd.isna(x) else bool(x) for x in s]
    if name == "image_url":
        return [None if (x is None or x != x) else str(x) for x in s]
    dec = 4 if name in ("lat", "lon") else 2
    arr = s.astype(float).round(dec).to_numpy()
    return [None if np.isnan(x) else float(x) for x in arr]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", required=True)
    ap.add_argument("--dst", default=str(ROOT / "web/public/data"))
    ap.add_argument("--fake", action="store_true")
    ap.add_argument("--decimate", default="")
    ap.add_argument("--grid", default="", help="source grid deg per body, e.g. earth=0.25,moon=0.5")
    a = ap.parse_args()
    src, dst = Path(a.src), Path(a.dst)
    dst.mkdir(parents=True, exist_ok=True)
    dec, grid = kv(a.decimate), kv(a.grid)
    for body in ("earth", "moon", "mars"):
        df = pd.read_parquet(src / f"{body}.parquet")
        if a.fake:
            g = json.loads((src / f"{body}.meta.json").read_text())["grid_deg"]
        elif body in grid:
            g = grid[body]
        else:
            ap.error(f"--grid needs {body}=<source grid deg> unless --fake is set")
        n = int(dec.get(body, 1))
        df = decimate(df, n, g)
        cols = {c: column(df, c) for c in WEB_COLS if c in df.columns}
        meta = {"body": body, "radius_km": RADIUS[body], "grid_deg": g * n, "fake": bool(a.fake)}
        path = dst / f"{body}.json"
        path.write_text(json.dumps({"meta": meta, "cols": cols}, separators=(",", ":")))
        mb = path.stat().st_size / 1e6
        print(f"{body}: {len(df)} rows, {mb:.1f} MB" + ("  <-- TOO BIG: raise --decimate" if mb > WARN_MB else ""))


if __name__ == "__main__":
    main()
