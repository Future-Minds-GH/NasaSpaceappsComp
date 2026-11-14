"""Terrestrial Analog Finder matcher (Python). Mirror of web/src/match.js.

Keep both files identical in behaviour. See contract.md section 4.
No code here branches on a body name.
"""
import json
import math
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
TOL = json.loads((ROOT / "web/src/tolerances.json").read_text())
PRESETS = json.loads((ROOT / "web/src/presets.json").read_text())

KEYS = PRESETS["weightKeys"]  # temp, swing, sun, slope, rough, elev, surface, minerals, ice
SURF = ["surf_dust", "surf_sand", "surf_rock", "surf_ice"]
MINS = ["min_mafic", "min_feldspathic", "min_ironox", "min_sulfate", "min_clay", "min_carbonate"]
# (feature, kind, weight key, share of that key's weight). Order is fixed: it fixes the sum order.
FEATURES = [
    ("t_day_k", "scalar", "temp", 0.5),
    ("t_night_k", "scalar", "temp", 0.5),
    ("t_swing_k", "scalar", "swing", 1.0),
    ("sun_wm2", "scalar", "sun", 1.0),
    ("slope_deg", "scalar", "slope", 1.0),
    ("rough_m", "scalar", "rough", 1.0),
    ("elev_pct", "scalar", "elev", 1.0),
    ("surface", "vector", "surface", 1.0),
    ("minerals", "vector", "minerals", 1.0),
    ("ice_prob", "scalar", "ice", 1.0),
]
SCALARS = [f[0] for f in FEATURES if f[1] == "scalar"]
VECTORS = {"surface": SURF, "minerals": MINS}


class Table:
    """cols: name -> numpy array (float with NaN for null; bool for analog_ok)."""

    def __init__(self, meta, cols):
        self.meta = meta
        self.cols = cols
        self.n = len(cols["lat"])
        self._rel = None

    @staticmethod
    def from_json(obj):
        cols = {}
        for k, v in obj["cols"].items():
            if k == "analog_ok":
                cols[k] = np.array([bool(x) for x in v], dtype=bool)
            elif k == "image_url":
                cols[k] = np.array(v, dtype=object)
            else:
                cols[k] = np.array([np.nan if x is None else x for x in v], dtype=float)
        return Table(obj["meta"], cols)

    @staticmethod
    def from_path(path):
        return Table.from_json(json.loads(Path(path).read_text()))

    def ok_mask(self):
        a = self.cols.get("analog_ok")
        return a if a is not None else np.ones(self.n, dtype=bool)

    def rel(self):
        """Percentile columns, computed once. pct = 100*(L + E/2)/n, reference = analog_ok rows."""
        if self._rel is None:
            ok = self.ok_mask()
            rel = {}
            for f in SCALARS:
                col = self.cols.get(f)
                if col is None:
                    continue
                if f == "elev_pct":
                    rel[f] = col
                    continue
                ref = np.sort(col[ok & ~np.isnan(col)])
                n = len(ref)
                if n == 0:
                    rel[f] = np.full(self.n, np.nan)
                    continue
                lo = np.searchsorted(ref, col, side="left")
                hi = np.searchsorted(ref, col, side="right")
                pct = 100.0 * (lo + (hi - lo) / 2.0) / n
                rel[f] = np.where(np.isnan(col), np.nan, pct)
            self._rel = rel
        return self._rel


def haversine_km(lat1, lon1, lat2, lon2, radius_km):
    p1 = np.radians(lat1)
    p2 = np.radians(lat2)
    dphi = p2 - p1
    dl = np.radians(lon2) - np.radians(lon1)
    a = np.sin(dphi / 2.0) ** 2 + np.cos(p1) * np.cos(p2) * np.sin(dl / 2.0) ** 2
    return radius_km * 2.0 * np.arcsin(np.minimum(1.0, np.sqrt(a)))


def effective_weights(weights, include=None):
    """Map the 9 UI weights to per-feature weights."""
    include = include or {}
    wk = {k: (float(weights.get(k, 0) or 0) if include.get(k, True) else 0.0) for k in KEYS}
    return {f[0]: wk[f[2]] * f[3] for f in FEATURES}, wk


def _vec(table, names):
    cols = [table.cols.get(n) for n in names]
    if any(c is None for c in cols):
        return None
    return np.stack(cols, axis=1)


def row_values(table, i, mode):
    """Feature values of one cell: scalar -> float, vector -> array."""
    src = table.rel() if mode == "relative" else table.cols
    out = {}
    for f in SCALARS:
        col = src.get(f)
        out[f] = np.nan if col is None else float(col[i])
    for name, names in VECTORS.items():
        cols = [table.cols.get(n) for n in names]
        out[name] = None if any(c is None for c in cols) else np.array([c[i] for c in cols], dtype=float)
    return out


def score_cells(inp, target, eff, mode):
    """Score one input cell against many target cells (the per-pair function).

    inp: row_values() dict. target: Table. eff: per-feature weights.
    Returns (score[N] with NaN where no usable weight, s{feature: array[N]} with NaN where absent).
    """
    tol = TOL[mode]
    src = target.rel() if mode == "relative" else target.cols
    n = target.n
    num = np.zeros(n)
    den = np.zeros(n)
    s_all = {}
    for name, kind, _key, _share in FEATURES:
        w = eff[name]
        if w <= 0:
            continue
        if kind == "scalar":
            col = src.get(name)
            a = inp[name]
            if col is None or math.isnan(a):
                s = np.full(n, np.nan)
            else:
                s = np.maximum(0.0, 1.0 - np.abs(a - col) / tol[name])
        else:
            m = _vec(target, VECTORS[name])
            p = inp[name]
            if m is None or p is None or np.isnan(p).any():
                s = np.full(n, np.nan)
            else:
                s = 1.0 - 0.5 * np.abs(p[None, :] - m).sum(axis=1)
                s = np.where(np.isnan(m).any(axis=1), np.nan, s)
        s_all[name] = s
        present = ~np.isnan(s)
        num = num + np.where(present, w * np.where(present, s, 0.0), 0.0)
        den = den + np.where(present, w, 0.0)
    with np.errstate(invalid="ignore", divide="ignore"):
        score = np.where(den > 0, 100.0 * num / den, np.nan)
    return score, s_all


def band_of(score):
    return "green" if score >= 90 else ("yellow" if score >= 60 else "red")


def breakdown_for(s_all, wk, j):
    """Per weight-key scores for target cell j, plus the 2 worst keys."""
    bd = {}
    for key in KEYS:
        if wk[key] <= 0:
            continue
        vals = []
        for name, _kind, k2, _share in FEATURES:
            if k2 == key and name in s_all and not math.isnan(s_all[name][j]):
                vals.append(float(s_all[name][j]))
        bd[key] = (sum(vals) / len(vals)) if vals else None
    ranked = [(v, i, k) for i, (k, v) in enumerate(bd.items()) if v is not None]
    ranked.sort()
    return bd, [k for _v, _i, k in ranked[:2]]


def nearest_index(table, lat, lon, radius_km):
    d = haversine_km(lat, lon, table.cols["lat"], table.cols["lon"], radius_km)
    return int(np.argmin(d))


def pair_score(input_table, i, target_table, j, weights, include=None, mode="absolute"):
    """Score between input cell i and target cell j. Returns (score|None, breakdown, worst)."""
    eff, wk = effective_weights(weights, include)
    inp = row_values(input_table, i, mode)
    sub = Table(target_table.meta, {k: v[j:j + 1] for k, v in target_table.cols.items()})
    if mode == "relative":
        sub._rel = {k: v[j:j + 1] for k, v in target_table.rel().items()}
    score, s_all = score_cells(inp, sub, eff, mode)
    sc = None if math.isnan(score[0]) else float(score[0])
    bd, worst = breakdown_for(s_all, wk, 0)
    return sc, bd, worst


def match(input_table, input_lat, input_lon, target_table, weights, include=None,
          mode="absolute", k=5, min_sep_km=200.0, exclude_km=300.0,
          known_sites=None, new_km=300.0):
    eff, wk = effective_weights(weights, include)
    r_in = input_table.meta["radius_km"]
    r_t = target_table.meta["radius_km"]
    i = nearest_index(input_table, input_lat, input_lon, r_in)
    inp = row_values(input_table, i, mode)
    score, s_all = score_cells(inp, target_table, eff, mode)
    valid = target_table.ok_mask() & ~np.isnan(score)
    if input_table.meta["body"] == target_table.meta["body"]:
        d_in = haversine_km(input_lat, input_lon, target_table.cols["lat"],
                            target_table.cols["lon"], r_t)
        valid &= ~(d_in < exclude_km)
    cand = np.nonzero(valid)[0]
    order = cand[np.argsort(-score[cand], kind="stable")]
    lat, lon = target_table.cols["lat"], target_table.cols["lon"]
    picked = []
    for j in order:
        if len(picked) >= k:
            break
        if picked:
            pj = np.array(picked)
            if np.any(haversine_km(lat[j], lon[j], lat[pj], lon[pj], r_t) < min_sep_km):
                continue
        picked.append(int(j))
    sites = None
    if known_sites is not None:
        sites = [s for s in known_sites if s["body"] == target_table.meta["body"]]
    out = []
    for j in picked:
        bd, worst = breakdown_for(s_all, wk, j)
        if sites is None:
            is_new = None
        else:
            is_new = all(float(haversine_km(lat[j], lon[j], s["lat"], s["lon"], r_t)) > new_km
                         for s in sites)
        cave = target_table.cols.get("cave_km")
        cave_km = None if cave is None or np.isnan(cave[j]) else float(cave[j])
        out.append({"index": j, "lat": float(lat[j]), "lon": float(lon[j]),
                    "score": float(score[j]), "band": band_of(float(score[j])),
                    "breakdown": bd, "worst": worst, "isNew": is_new, "caveKm": cave_km})
    return out


def apply_group(weights, group):
    keep = set(PRESETS["groups"][group])
    return {k: (weights.get(k, 0) if k in keep else 0) for k in KEYS}


def preset_weights(name):
    p = PRESETS["presets"][name]
    return {k: p[k] for k in KEYS}
