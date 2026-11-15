"""Turn moon.parquet and mars.parquet into the binary files the website reads, and write vectors/schema.json.

Output (under --out), in the format of the front end's make-sample-vectors.mjs (schema v0.1):
  vectors/schema.json      field order, encoding and lookups (same fields as build_vectors.py)
  vectors/moon.bin         EVERY Moon tile, HEALPix NESTED nside 64, 35 bytes each, in tile-index order
  vectors/mars_<0-11>.bin  EVERY Mars tile, nside 128, split by base cell (tiles base*nside^2 .. (base+1)*nside^2-1)
  tiles/<body>_meta.json   reality gap, named tiles, the target sites for the globe buttons, min_estimated

How a tile gets its values: each tile takes the 0.5 deg cell that contains the tile centre. Tiles whose cell has
analog_ok = false (or no row) get 255 (null) in every byte. Percentile fields are ranks among the scored tiles of
that body only. Fields the tables do not have (embeddings, codes, flags, atmosphere, ...) are 255.
Known gap: the surf_* fractions have no field in the schema, so they are not exported.

Install:  pip install astropy-healpix pandas pyarrow numpy
Usage:    python src/build_body_vectors.py --moon moon.parquet --mars mars.parquet --out frontend/public/data
                                           [--targets data/targets.json]
"""
import argparse
import json
import re
import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_vectors import BYTES, FIELDS, NEEDED, NULL, field_values, to_byte  # noqa: E402

NSIDE = {"earth": 256, "moon": 64, "mars": 128}
CELL = 0.5
NROWS, NCOLS = 360, 720
REALITY_GAP = {  # same wording as frontend/scripts/sample-places.mjs
    "moon": ["Vacuum: no air at all", "Gravity 1/6 of Earth's", "Two-week days and two-week nights",
             "No shielding from cosmic radiation", "Sharp, unweathered dust"],
    "mars": ["Air 1% as thick as Earth's, mostly CO₂", "Gravity 38% of Earth's", "Strong surface radiation",
             "Toxic perchlorate salts in the soil", "Planet-wide dust storms"],
}
TREK = {  # same layers as trekImageUrl() in frontend/scripts/make-sample-data.mjs
    "mars": ("Mars/EQ/THEMIS_DayIR_ControlledMosaics_100m_v2_oct2018", 9, "png"),
    "moon": ("Moon/EQ/LRO_WAC_Mosaic_Global_303ppd_v02", 8, "jpg"),
}

FACTOR_ORDER = ["terrain", "elevation", "geology", "mineralogy", "climate", "atmosphere", "water_ice"]
LOOKUP_OF = {"topo_position": "topo_position", "rock_class": "rock_class", "ice_depth": "ice_depth", "ice_form": "ice_form"}
LOOKUPS = {  # copied from SCHEMA in frontend/scripts/make-sample-vectors.mjs
    "topo_position": {"names": ["basin", "lower slope", "flat", "upper slope", "ridge"],
                      "rule": "same 1, neighbouring code 0.5, else 0"},
    "rock_class": {"names": ["anorthosite", "basalt", "other igneous", "sedimentary", "evaporite", "impact breccia", "ice"],
                   "groups": ["igneous", "igneous", "igneous", "sedimentary", "sedimentary", "impact", "ice"],
                   "rule": "same 1, same group 0.5, else 0"},
    "ice_depth": {"names": ["surface", "under 1 m", "deeper", "none"], "rule": "same 1, else 0"},
    "ice_form": {"names": ["none", "seasonal", "ground ice", "buried glacial ice", "exposed ice sheet"],
                 "related": [[2, 3]], "rule": "same 1, ground vs buried 0.5, else 0"},
}


def schema():
    factors = []
    for fac in FACTOR_ORDER:
        fields = []
        for factor, fid, kind, _src in FIELDS:
            if factor == fac:
                f = {"id": fid, "kind": kind}
                if fid in LOOKUP_OF:
                    f["lookup"] = LOOKUP_OF[fid]
                fields.append(f)
        factors.append({"id": fac, "fields": fields})
    flat = [f["id"] for fac in factors for f in fac["fields"]]
    assert flat == [f[1] for f in FIELDS], "FIELDS are not grouped by factor in factor order"
    return {
        "version": "0.2", "sample": False, "nside": NSIDE, "scheme": "nested", "null_code": NULL,
        "encoding": {"percentile": "round(p × 254)", "fraction": "round(f × 254)",
                     "embedding": "round((e + 1) / 2 × 254)", "code": "integer code", "flag": "0 or 1"},
        "mars_shards": "mars_<base cell 0-11>.bin", "factors": factors, "lookups": LOOKUPS,
    }


def tile_centres(nside):
    from astropy import units as u
    from astropy_healpix import HEALPix
    hp = HEALPix(nside=nside, order="nested")
    lon, lat = hp.healpix_to_lonlat(np.arange(hp.npix))
    lon = (lon.to_value(u.deg) + 180.0) % 360.0 - 180.0
    return lat.to_value(u.deg), lon


def tile_of(nside, lat, lon):
    from astropy import units as u
    from astropy_healpix import HEALPix
    hp = HEALPix(nside=nside, order="nested")
    return int(hp.lonlat_to_healpix(lon * u.deg, lat * u.deg))


def cell_of(lat, lon):
    row = np.clip(np.floor((90.0 - lat) / CELL).astype("int64"), 0, NROWS - 1)
    col = np.clip(np.floor((lon + 180.0) / CELL).astype("int64"), 0, NCOLS - 1)
    return row * NCOLS + col


def build_body(df, nside):
    """Returns (vectors uint8 [npix, 35] for EVERY tile, summary)."""
    missing = [c for c in NEEDED if c not in df.columns]
    assert not missing, f"table is missing columns {missing}"
    assert df["cell_id"].is_unique, "cell_id must be unique"
    assert df["cell_id"].between(0, NROWS * NCOLS - 1).all(), "cell_id must be 0..N-1"
    df = df.set_index("cell_id").reindex(np.arange(NROWS * NCOLS))
    df["analog_ok"] = df["analog_ok"].astype("boolean").fillna(False).astype(bool)
    lat, lon = tile_centres(nside)
    cell = cell_of(lat, lon)
    scored = np.flatnonzero(df["analog_ok"].to_numpy()[cell])
    assert scored.size > 0, "no scored tiles: analog_ok is never true"
    sub = df.iloc[cell[scored]].reset_index(drop=True)
    vectors = np.full((lat.size, BYTES), NULL, dtype="uint8")
    filled = {}
    for j, (_f, fid, _kind, source) in enumerate(FIELDS):
        v = field_values(sub, source)
        if v is not None:
            vectors[scored, j] = to_byte(v)
        filled[fid] = float((vectors[scored, j] != NULL).mean())
    return vectors, {"tiles": int(lat.size), "scored_tiles": int(scored.size), "share_filled": filled}


def trek_image_url(body, lat, lon):
    path, zoom, ext = TREK[body]
    deg = 180 / 2 ** zoom
    return (f"https://trek.nasa.gov/tiles/{path}/1.0.0/default/default028mm/{zoom}/"
            f"{int((90 - lat) // deg)}/{int((lon + 180) // deg)}.{ext}")


def body_meta(body, targets):
    nside = NSIDE[body]
    sites, named = [], {}
    for t in targets:
        if t.get("body") != body or t.get("lat") is None:
            continue
        idx = tile_of(nside, t["lat"], t["lon"])
        named[str(idx)] = t["name"]
        sites.append({"target_id": re.sub(r"[^a-z0-9]+", "_", t["name"].lower()).strip("_"), "body": body,
                      "name": t["name"], "lat": t["lat"], "lon": t["lon"], "track": t.get("track", "base"),
                      "summary": t.get("summary", ""), "source_url": t.get("source_url"),
                      "tile_id": f"{body}_{nside}_{idx}", "image_url": trek_image_url(body, t["lat"], t["lon"]),
                      "reality_gap": REALITY_GAP[body]})
    return {"sample": False, "body": body, "nside": nside, "reality_gap": REALITY_GAP[body],
            "named": named, "sites": sites, "min_estimated": []}


def write_body(out, body, vectors):
    nside = NSIDE[body]
    assert vectors.shape == (12 * nside * nside, BYTES)
    if body == "mars":
        per = nside * nside
        for shard in range(12):
            (out / "vectors" / f"mars_{shard}.bin").write_bytes(vectors[shard * per:(shard + 1) * per].tobytes())
    else:
        (out / "vectors" / f"{body}.bin").write_bytes(vectors.tobytes())


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--moon", type=Path)
    ap.add_argument("--mars", type=Path)
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--targets", type=Path, default=Path(__file__).resolve().parent.parent / "data" / "targets.json")
    a = ap.parse_args()
    (a.out / "vectors").mkdir(parents=True, exist_ok=True)
    (a.out / "tiles").mkdir(parents=True, exist_ok=True)
    (a.out / "vectors" / "schema.json").write_text(json.dumps(schema(), indent=1, ensure_ascii=False), encoding="utf-8")
    targets = json.loads(a.targets.read_text(encoding="utf-8")) if a.targets.exists() else []
    for body, path in (("moon", a.moon), ("mars", a.mars)):
        if path is None:
            continue
        assert path.stat().st_size < 2_000_000_000, f"{path} is larger than 2 GB"
        vectors, summary = build_body(pd.read_parquet(path), NSIDE[body])
        write_body(a.out, body, vectors)
        (a.out / "tiles" / f"{body}_meta.json").write_text(
            json.dumps(body_meta(body, targets), ensure_ascii=False), encoding="utf-8")
        print(body, json.dumps(summary))


if __name__ == "__main__":
    main()
