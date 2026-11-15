"""Turn earth.parquet into the binary files the website reads.

Output (under --out):
  vectors/earth.bin        one 35-byte row per scored Earth tile, in tile-index order
  earth_meta.bin           one 12-byte row per tile, same order (little-endian)
  tiles/earth_meta.json    the lists earth_meta.bin points into

Format (from the front end's make-sample-vectors.mjs, schema v0.1):
  HEALPix NESTED, nside 256. 35 bytes per tile, fields in schema order below.
  v0.2: 'feldspathic' added after 'mafic' (the main lunar mineral class; was dropped in v0.1).
  Percentile and fraction fields: round(x * 254). Code and flag fields: the integer. 255 = null.
  earth_meta row: uint32 tile index, uint16 km to the nearest known analog (65535 = unknown),
  uint16 tag bits, uint16 name index (65535 = none), uint8 environment (255 = none),
  uint8 flags (bit 0 = mineralogy is estimated, not measured).

How a tile gets its values: each tile takes the 0.25 deg cell that contains the tile centre (no
gaps, no double counting). A tile is scored only where analog_ok is true. Percentile fields are
the rank among the scored tiles.

Install:  pip install astropy-healpix pandas pyarrow numpy   (healpy also works but does not build on Windows)
Usage:  python build_vectors.py earth.parquet --out web/public/data [--schema schema.json]
                                [--known-analogs known_analogs.json]
"""
import argparse
import json
from pathlib import Path

import numpy as np
import pandas as pd

NSIDE = 256
NULL = 255
CELL = 0.25
NROWS, NCOLS = 720, 1440
NO_KM = 65535
NO_NAME = 65535
NO_ENV = 255
EARTH_RADIUS_KM = 6371.0

# (factor, field id, kind, source). Order = byte order. source:
#   ("pct", col)             percentile rank of a column among the scored tiles
#   ("pct_mean", [c1, c2])   percentile rank of the mean of two columns
#   ("frac", col)            the column as a 0-1 fraction
#   None                     Earth has no data for this field: always 255
FIELDS = [
    ("terrain", "emb0", "embedding", None), ("terrain", "emb1", "embedding", None),
    ("terrain", "emb2", "embedding", None), ("terrain", "emb3", "embedding", None),
    ("terrain", "emb4", "embedding", None), ("terrain", "emb5", "embedding", None),
    ("terrain", "emb6", "embedding", None), ("terrain", "emb7", "embedding", None),
    ("terrain", "slope", "percentile", ("pct", "slope_deg")),
    ("terrain", "roughness", "percentile", ("pct", "rough_m")),
    ("elevation", "relief", "percentile", ("pct", "elev_m")),
    ("elevation", "topo_position", "code", None),
    ("geology", "rock_class", "code", None),
    ("geology", "volcanic", "flag", None),
    ("geology", "impact", "flag", None),
    ("mineralogy", "mafic", "fraction", ("frac", "min_mafic")),
    ("mineralogy", "feldspathic", "fraction", ("frac", "min_feldspathic")),
    ("mineralogy", "clays", "fraction", ("frac", "min_clay")),
    ("mineralogy", "sulfates", "fraction", ("frac", "min_sulfate")),
    ("mineralogy", "carbonates", "fraction", ("frac", "min_carbonate")),
    ("mineralogy", "iron_oxides", "fraction", ("frac", "min_ironox")),
    ("mineralogy", "salts", "fraction", None),
    ("climate", "aridity", "percentile", None),
    ("climate", "mean_temp", "percentile", ("pct_mean", ["t_day_k", "t_night_k"])),
    ("climate", "day_night_range", "percentile", ("pct", "t_swing_k")),
    ("climate", "cold_extreme", "percentile", None),
    ("climate", "sunlit_fraction", "percentile", ("pct", "sun_wm2")),
    ("atmosphere", "pressure", "percentile", None),
    ("atmosphere", "wind", "percentile", None),
    ("atmosphere", "dust", "percentile", None),
    ("atmosphere", "dust_storms", "percentile", None),
    ("water_ice", "ice_fraction", "fraction", ("frac", "ice_prob")),
    ("water_ice", "ice_depth", "code", None),
    ("water_ice", "ice_form", "code", None),
    ("water_ice", "liquid_water", "fraction", None),
]
BYTES = len(FIELDS)
assert BYTES == 35
NEEDED = ["analog_ok", "slope_deg", "rough_m", "elev_m", "t_day_k", "t_night_k", "t_swing_k", "sun_wm2",
          "min_mafic", "min_feldspathic", "min_clay", "min_sulfate", "min_carbonate", "min_ironox", "ice_prob"]


def check_schema(schema):
    """The field order of the front end's schema.json must equal FIELDS."""
    theirs = [f["id"] for factor in schema["factors"] for f in factor["fields"]]
    ours = [f[1] for f in FIELDS]
    assert theirs == ours, f"schema.json field order differs:\n theirs {theirs}\n ours   {ours}"
    assert schema["nside"]["earth"] == NSIDE and schema["scheme"] == "nested"
    assert schema["null_code"] == NULL


def tile_cell_ids(nside=NSIDE):
    """For every HEALPix NESTED tile: the cell_id of the 0.25 deg cell that holds the tile centre."""
    from astropy import units as u
    from astropy_healpix import HEALPix
    hp = HEALPix(nside=nside, order="nested")
    lon, lat = hp.healpix_to_lonlat(np.arange(hp.npix))
    lon = (lon.to_value(u.deg) + 180.0) % 360.0 - 180.0
    lat = lat.to_value(u.deg)
    row = np.clip(np.floor((90.0 - lat) / CELL).astype("int64"), 0, NROWS - 1)
    col = np.clip(np.floor((lon + 180.0) / CELL).astype("int64"), 0, NCOLS - 1)
    return row * NCOLS + col, lat, lon


def to_byte(x, scale=254):
    """0-1 array (NaN = missing) to uint8. Missing -> 255."""
    x = np.asarray(x, dtype="float64")
    assert np.all((x[~np.isnan(x)] >= -1e-6) & (x[~np.isnan(x)] <= 1 + 1e-6)), "value outside 0-1"
    out = np.full(x.shape, NULL, dtype="uint8")
    ok = ~np.isnan(x)
    out[ok] = np.floor(np.clip(x[ok], 0, 1) * scale + 0.5).astype("uint8")   # half up, like JS Math.round
    return out


def percentile_rank(x):
    """Rank of each value among the valid values, 0-1. NaN stays NaN."""
    s = pd.Series(np.asarray(x, dtype="float64"))
    return ((s.rank(method="average") - 0.5) / s.notna().sum()).to_numpy()


def field_values(df_tiles, source):
    """The 0-1 values (or None when Earth has no data) of one field for the scored tiles."""
    if source is None:
        return None
    kind, arg = source
    if kind == "pct":
        return percentile_rank(df_tiles[arg])
    if kind == "pct_mean":
        return percentile_rank(df_tiles[arg].mean(axis=1, skipna=False))
    if kind == "frac":
        return df_tiles[arg].to_numpy(dtype="float64")
    raise ValueError(kind)


def haversine_km(lat1, lon1, lat2, lon2):
    p1, p2 = np.radians(lat1), np.radians(lat2)
    dphi, dl = p2 - p1, np.radians(lon2 - lon1)
    a = np.sin(dphi / 2) ** 2 + np.cos(p1) * np.cos(p2) * np.sin(dl / 2) ** 2
    return 2 * EARTH_RADIUS_KM * np.arcsin(np.sqrt(a))


def nearest_analog_km(lat, lon, sites):
    """Distance in km from each tile centre to the nearest known Earth site (65535 if no sites)."""
    if not sites:
        return np.full(lat.shape, NO_KM, dtype="uint16")
    assert len(sites) <= 1000, f"{len(sites)} known sites is too many"
    d = np.full(lat.shape, np.inf)
    for s in sites:                                  # running minimum: one array at a time
        d = np.minimum(d, haversine_km(lat, lon, s["lat"], s["lon"]))
    return np.minimum(np.rint(d), NO_KM - 1).astype("uint16")


def build(df, known_sites=None, nside=NSIDE):
    """Returns (vectors uint8 [n, 35], meta bytes, tile indices, summary dict)."""
    missing = [c for c in NEEDED if c not in df.columns]
    assert not missing, f"earth.parquet is missing columns {missing}"
    assert df["cell_id"].is_unique, "cell_id must be unique"
    assert df["cell_id"].between(0, NROWS * NCOLS - 1).all(), "cell_id must be 0..N-1"
    df = df.set_index("cell_id").reindex(np.arange(NROWS * NCOLS))      # a missing cell has no data: not scored
    df["analog_ok"] = df["analog_ok"].astype("boolean").fillna(False).astype(bool)
    cell, lat, lon = tile_cell_ids(nside)
    scored = df["analog_ok"].to_numpy()[cell]
    tiles = np.flatnonzero(scored)
    assert tiles.size > 0, "no scored tiles: analog_ok is never true"
    sub = df.iloc[cell[tiles]].reset_index(drop=True)

    vectors = np.full((tiles.size, BYTES), NULL, dtype="uint8")
    filled = {}
    for j, (_, fid, _kind, source) in enumerate(FIELDS):
        v = field_values(sub, source)
        if v is not None:
            vectors[:, j] = to_byte(v)
        filled[fid] = float((vectors[:, j] != NULL).mean())

    meta = np.zeros(tiles.size, dtype=[("tile", "<u4"), ("km", "<u2"), ("tags", "<u2"), ("name", "<u2"), ("env", "u1"), ("flags", "u1")])
    meta["tile"] = tiles
    meta["km"] = nearest_analog_km(lat[tiles], lon[tiles], known_sites)
    meta["tags"] = 0
    meta["name"] = NO_NAME
    meta["env"] = NO_ENV
    # GLiM-only cells (estimated): the rock class is set and all four EMIT classes are known zeros.
    emit_classes = sub[["min_ironox", "min_sulfate", "min_clay", "min_carbonate"]]
    estimated = sub["min_mafic"].notna() & emit_classes.notna().all(axis=1) & (emit_classes == 0).all(axis=1)
    meta["flags"] = estimated.to_numpy().astype("uint8")
    assert meta.dtype.itemsize == 12
    summary = {"tiles": int(tiles.size), "bytes_per_tile": BYTES, "share_filled": filled,
               "estimated_mineralogy_tiles": int(estimated.sum())}
    return vectors, meta.tobytes(), tiles, summary


def sites_for_json(known):
    out = []
    for s in known or []:
        out.append({"target_id": s["id"], "name": s["name"], "lat": s["lat"], "lon": s["lon"],
                    "track": "base", "summary": s.get("source_note", "")})
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("parquet", type=Path)
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--schema", type=Path, help="the front end's vectors/schema.json: checks the field order")
    ap.add_argument("--known-analogs", type=Path, help="known_analogs.json: fills the km-to-nearest-analog field")
    args = ap.parse_args()

    if args.schema:
        assert args.schema.stat().st_size < 5_000_000, "schema.json is larger than 5 MB"
        check_schema(json.loads(args.schema.read_text(encoding="utf-8")))
    known = []
    if args.known_analogs:
        assert args.known_analogs.stat().st_size < 5_000_000, "known_analogs.json is larger than 5 MB"
        known = [s for s in json.loads(args.known_analogs.read_text(encoding="utf-8"))["sites"] if s.get("body") == "earth"]
    assert args.parquet.stat().st_size < 2_000_000_000, "earth.parquet is larger than 2 GB"
    df = pd.read_parquet(args.parquet)
    vectors, meta, tiles, summary = build(df, known)

    (args.out / "vectors").mkdir(parents=True, exist_ok=True)
    (args.out / "tiles").mkdir(parents=True, exist_ok=True)
    (args.out / "vectors" / "earth.bin").write_bytes(vectors.tobytes())
    (args.out / "earth_meta.bin").write_bytes(meta)
    (args.out / "tiles" / "earth_meta.json").write_text(json.dumps({
        "sample": False, "record_bytes": 12, "tile_count": int(tiles.size),
        "names": [], "environments": [], "tags": [], "sites": sites_for_json(known),
    }), encoding="utf-8")
    print(json.dumps(summary, indent=1))


if __name__ == "__main__":
    main()
