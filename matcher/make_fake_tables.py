"""Make FAKE earth/moon/mars tables (plausible ranges, correct columns). meta.fake = true.

Never quote any number made from these tables. They exist so Job 4 can build the UI.
Usage: python matcher/make_fake_tables.py
"""
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "src"))
from surface_fractions import surface_fractions, ati_cuts  # noqa: E402
RADIUS = {"earth": 6371.0, "moon": 1737.4, "mars": 3389.5}
STEP = {"earth": 1.0, "moon": 2.0, "mars": 2.0}
MIN_COLS = ["min_mafic", "min_feldspathic", "min_ironox", "min_sulfate", "min_clay", "min_carbonate"]
# body -> (day mean K, night mean K, day lat drop K, sun W/m2 at equator, slope scale deg,
#          rough scale m, albedo mean, mineral Dirichlet alpha, ice base)
PARAMS = {
    "earth": dict(day=312, night=288, drop=45, swing_amp=10, sun=210, slope=3.0, rough=30, alb=0.28,
                  alpha=[2, 2, 2, 1, 2, 1], ice=0.02),
    "moon": dict(day=380, night=105, drop=150, swing_amp=20, sun=340, slope=6.0, rough=18, alb=0.12,
                 alpha=[4, 6, 0.5, 0.2, 0.2, 0.1], ice=0.01),
    "mars": dict(day=250, night=180, drop=90, swing_amp=15, sun=140, slope=4.0, rough=25, alb=0.25,
                 alpha=[3, 1, 4, 1.5, 1, 0.5], ice=0.03),
}


def smooth_noise(rng, lat, lon, n_waves=6):
    z = np.zeros_like(lat)
    for _ in range(n_waves):
        fl, fo = rng.uniform(0.5, 4, 2)
        z += np.sin(np.radians(lat) * fl + rng.uniform(0, 6.28)) * np.cos(np.radians(lon) * fo + rng.uniform(0, 6.28))
    return z / n_waves


def make(body, seed):
    rng = np.random.default_rng(seed)
    p = PARAMS[body]
    step = STEP[body]
    lats = np.arange(-90 + step / 2, 90, step)
    lons = np.arange(-180 + step / 2, 180, step)
    lon, lat = np.meshgrid(lons, lats)
    lat, lon = lat.ravel(), lon.ravel()
    if body == "earth":
        land = smooth_noise(rng, lat, lon, 8) > 0.02
        lat, lon = lat[land], lon[land]
    n = len(lat)
    c = np.cos(np.radians(lat))
    t_day = p["day"] - p["drop"] * (1 - c) + 8 * smooth_noise(rng, lat, lon) + rng.normal(0, 1.5, n)
    swing = np.clip((p["day"] - p["night"]) * (0.5 + 0.5 * c) + p["swing_amp"] * smooth_noise(rng, lat, lon) + rng.normal(0, 2, n), 5, None)
    t_night = t_day - swing
    sun = np.clip(p["sun"] * c + rng.normal(0, 8, n), 0, None)
    slope = np.clip(rng.gamma(2.0, p["slope"] / 2, n) * (1 + smooth_noise(rng, lat, lon)), 0, 45)
    rough = np.clip(rng.gamma(2.0, p["rough"] / 2, n) * (1 + 0.5 * smooth_noise(rng, lat, lon)), 0, None)
    elev = 1500 * smooth_noise(rng, lat, lon, 10) + rng.normal(0, 100, n)
    elev_pct = 100.0 * (np.argsort(np.argsort(elev)) + 0.5) / n
    albedo = np.clip(p["alb"] + 0.05 * smooth_noise(rng, lat, lon) + rng.normal(0, 0.01, n), 0.03, 0.9)
    ati = (1 - albedo) / (t_day - t_night)
    polar = np.abs(lat) > 70
    ice = np.clip(p["ice"] + polar * rng.uniform(0.3, 0.9, n) + rng.normal(0, 0.01, n), 0, 1)
    dust, sand, rock, sice = surface_fractions(albedo, ati, ice, ati_cuts(ati))
    mins = rng.dirichlet(np.array(p["alpha"]) + 0.05, n)
    df = pd.DataFrame({"cell_id": np.arange(n), "lat": lat, "lon": lon, "t_day_k": t_day,
                       "t_night_k": t_night, "t_swing_k": swing, "sun_wm2": sun,
                       "slope_deg": slope, "rough_m": rough, "elev_m": elev, "elev_pct": elev_pct,
                       "albedo": albedo, "ati": ati, "surf_dust": dust, "surf_sand": sand,
                       "surf_rock": rock, "surf_ice": sice})
    for i, name in enumerate(MIN_COLS):
        df[name] = mins[:, i]
    df["ice_prob"] = ice
    if body == "earth":
        df["analog_ok"] = (rng.random(n) < 0.7) & (ice < 0.2)
        df["cave_km"] = np.nan
    else:
        df["analog_ok"] = True
        df["cave_km"] = rng.gamma(2.0, 150, n)
    # a few gaps to exercise the missing-data rule
    if body == "earth":
        gap = rng.random(n) < 0.05
        for name in MIN_COLS:
            df.loc[gap, name] = np.nan
    return df


def main():
    out = ROOT / "data/fake"
    out.mkdir(parents=True, exist_ok=True)
    for seed, body in enumerate(["earth", "moon", "mars"]):
        df = make(body, 100 + seed)
        df.to_parquet(out / f"{body}.parquet", index=False)
        (out / f"{body}.meta.json").write_text(json.dumps(
            {"body": body, "radius_km": RADIUS[body], "grid_deg": STEP[body], "fake": True}))
        print(body, len(df), "rows")


if __name__ == "__main__":
    main()
