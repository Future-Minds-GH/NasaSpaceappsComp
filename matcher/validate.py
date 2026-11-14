"""Validation harness: hit@10, negative controls, symmetry. Numbers for the pitch.

Usage: python matcher/validate.py [--data web/public/data] [--sweep]
If any table has meta.fake = true the run is a PLUMBING CHECK: nothing is written to
validation/results.* and the numbers must not be quoted.
"""
import argparse
import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import match as M  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
MIN_HIT_KM = 100.0
RED = 60.0


def load(data):
    return {b: M.Table.from_path(Path(data) / f"{b}.json") for b in ("earth", "moon", "mars")}


def site_map(ka):
    return {s["id"]: s for s in ka["sites"]}


def hit_at_k(T, ka, weights, mode, k=10):
    S = site_map(ka)
    rows = []
    r_e = T["earth"].meta["radius_km"]
    for pair in ka["pairs"]:
        inp_body = pair["id"].split("_to_")[0]
        for sid in pair["inputs"]:
            s = S[sid]
            res = M.match(T[inp_body], s["lat"], s["lon"], T["earth"], weights, mode=mode, k=k)
            hit_rank = None
            for rank, r in enumerate(res, 1):
                for eid in pair["earth_ids"]:
                    e = S[eid]
                    lim = max(e["radius_km"] or 0, MIN_HIT_KM)
                    if M.haversine_km(r["lat"], r["lon"], e["lat"], e["lon"], r_e) <= lim:
                        hit_rank = rank
                        break
                if hit_rank:
                    break
            rows.append({"pair": pair["id"], "input": sid, "hit": hit_rank is not None,
                         "rank": hit_rank, "top_score": res[0]["score"] if res else None})
    return rows


def negative_controls(T, ka, weights, mode):
    S = site_map(ka)
    r_e = T["earth"].meta["radius_km"]
    out = []
    ctrl = [s for s in ka["sites"] if s["role"] == "negative_control"]
    for pair in ka["pairs"]:
        inp_body = pair["id"].split("_to_")[0]
        tin = T[inp_body]
        for sid in pair["inputs"]:
            s = S[sid]
            i = M.nearest_index(tin, s["lat"], s["lon"], tin.meta["radius_km"])
            for c in ctrl:
                j = M.nearest_index(T["earth"], c["lat"], c["lon"], r_e)
                sc, _, _ = M.pair_score(tin, i, T["earth"], j, weights, mode=mode)
                out.append({"input": sid, "control": c["id"], "score": sc})
    return out


def control_region_hits(T, ka, weights, mode, k=10):
    """Count top-k Earth matches that fall inside a negative-control region (should be 0)."""
    S = site_map(ka)
    r_e = T["earth"].meta["radius_km"]
    ctrl = [s for s in ka["sites"] if s["role"] == "negative_control"]
    n = 0
    for pair in ka["pairs"]:
        inp_body = pair["id"].split("_to_")[0]
        for sid in pair["inputs"]:
            s = S[sid]
            for r in M.match(T[inp_body], s["lat"], s["lon"], T["earth"], weights, mode=mode, k=k):
                n += sum(M.haversine_km(r["lat"], r["lon"], c["lat"], c["lon"], r_e) <= c["radius_km"]
                         for c in ctrl)
    return n


def symmetry(T, weights, mode, n=300):
    rng = np.random.default_rng(0)
    worst = 0.0
    for a in T:
        for b in T:
            for _ in range(n // 9):
                i, j = int(rng.integers(T[a].n)), int(rng.integers(T[b].n))
                s1, _, _ = M.pair_score(T[a], i, T[b], j, weights, mode=mode)
                s2, _, _ = M.pair_score(T[b], j, T[a], i, weights, mode=mode)
                if s1 is not None and s2 is not None:
                    worst = max(worst, abs(s1 - s2))
    return worst


def summarize(T, ka, weights, mode):
    h = hit_at_k(T, ka, weights, mode)
    nc = negative_controls(T, ka, weights, mode)
    scores = [x["score"] for x in nc if x["score"] is not None]
    return {"hit_at_10": sum(x["hit"] for x in h), "n_inputs": len(h), "hits": h,
            "neg_max": max(scores) if scores else None,
            "neg_red": sum(s < RED for s in scores), "neg_n": len(scores), "neg": nc,
            "neg_region_top10_hits": control_region_hits(T, ka, weights, mode)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default=str(ROOT / "web/public/data"))
    ap.add_argument("--sweep", action="store_true", help="scale all absolute tolerances")
    a = ap.parse_args()
    T = load(a.data)
    ka = json.loads((ROOT / "known_analogs.json").read_text())
    fake = any(t.meta.get("fake") for t in T.values())
    print("*** FAKE DATA: PLUMBING CHECK ONLY. DO NOT QUOTE THESE NUMBERS. ***" if fake else "Real data.")
    w = M.preset_weights("balanced")
    result = {"fake": fake, "grid_deg": {b: T[b].meta["grid_deg"] for b in T}, "modes": {}}
    for mode in ("absolute", "relative"):
        r = summarize(T, ka, w, mode)
        r["symmetry_max_abs_diff"] = symmetry(T, w, mode)
        result["modes"][mode] = r
        print(f"[{mode}] hit@10 {r['hit_at_10']}/{r['n_inputs']}  neg-control red {r['neg_red']}/{r['neg_n']}"
              f"  top-10 inside control regions {r['neg_region_top10_hits']}  max neg score {r['neg_max']}  symmetry diff {r['symmetry_max_abs_diff']:.2e}")
        for x in r["hits"]:
            print("   ", x["input"], "hit" if x["hit"] else "miss", "rank", x["rank"])
    if a.sweep:
        base = dict(M.TOL["absolute"])
        result["sweep"] = []
        for f in (0.5, 0.75, 1.0, 1.5, 2.0, 3.0):
            M.TOL["absolute"] = {k: v * f for k, v in base.items()}
            r = summarize(T, ka, w, "absolute")
            result["sweep"].append({"tau_scale": f, "hit_at_10": r["hit_at_10"], "n": r["n_inputs"],
                                    "neg_red": r["neg_red"], "neg_n": r["neg_n"], "neg_max": r["neg_max"]})
            print(f"[sweep x{f}] hit@10 {r['hit_at_10']}/{r['n_inputs']}  neg red {r['neg_red']}/{r['neg_n']}")
        M.TOL["absolute"] = base
    if not fake:
        (ROOT / "validation").mkdir(exist_ok=True)
        (ROOT / "validation/results.json").write_text(json.dumps(result, indent=1))
        print("wrote validation/results.json")


if __name__ == "__main__":
    main()
