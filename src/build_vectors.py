"""Turn earth.parquet into the binary files the website reads (tile format v0.3).

Output (under --out):
  vectors/earth.bin        one row (one byte per schema field) per scored Earth tile, in tile-index order
  earth_meta.bin           one 12-byte row per tile, same order (little-endian)
  tiles/earth_meta.json    the lists earth_meta.bin points into

Format: data/schema.json is the one source (field list, order, min/max, kinds). HEALPix NESTED, nside 256.
  One byte per field, per tile: the factor fields in factor order, then the relative fields (25 in v0.3). 255 = null.
  value fields: round((clip(x, min, max) - min) / (max - min) * 254). fraction fields: round(f * 254).
  percentile fields: round(p * 254), p = (average rank - 0.5) / n over the scored tiles.
  elev_pct ranks elev_m; each relative field ranks its rel_of column.
  earth_meta row: uint32 tile index, uint16 km to the nearest known analog (65535 = unknown),
  uint16 tag bits, uint16 name index (65535 = none), uint8 environment (255 = none),
  uint8 flags (bit 0 = mineralogy is estimated, not measured).

How a tile gets its values: each tile takes the 0.25 deg cell that contains the tile centre (no
gaps, no double counting). A tile is scored only where analog_ok is true. Known analogs with
role "negative_control" do not count for the km field.

Install:  pip install astropy-healpix pandas pyarrow numpy   (healpy also works but does not build on Windows)
Usage:  python build_vectors.py earth.parquet --out web/public/data [--schema data/schema.json]
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

DEFAULT_SCHEMA = Path(__file__).resolve().parent.parent / "data" / "schema.json"
PCT_SOURCE = {"elev_pct": "elev_m"}          # a percentile field with no rel_of ranks this column


def load_schema(path=DEFAULT_SCHEMA):
    """Read data/schema.json. Returns (schema, fields): the 18 factor fields, then the 7 relative fields."""
    assert Path(path).stat().st_size < 5_000_000, "schema.json is larger than 5 MB"
    schema = json.loads(Path(path).read_text(encoding="utf-8"))
    fields = [f for fac in schema["factors"] for f in fac["fields"]] + schema["relative_fields"]
    assert schema["version"] == "0.3" and schema["scheme"] == "nested" and schema["null_code"] == NULL
    assert schema["byte_scale"] == 254 and schema["relative_fields"], "schema.json is not tile format v0.3"
    return schema, fields


def source_column(f):
    """The table column a field is built from."""
    return f.get("rel_of") or PCT_SOURCE.get(f["id"], f["id"])


def needed_columns(fields):
    return ["analog_ok", *dict.fromkeys(source_column(f) for f in fields)]


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


def field_values(df_tiles, f):
    """The 0-1 values of one schema field for the scored tiles (NaN = missing)."""
    col = df_tiles[source_column(f)].to_numpy(dtype="float64")
    if f["kind"] == "value":
        return np.clip((col - f["min"]) / (f["max"] - f["min"]), 0, 1)
    if f["kind"] == "fraction":
        return col
    return percentile_rank(col)


def fill_vectors(sub, fields, rows, vectors):
    """Write every field of the scored tiles `sub` into vectors[rows]. Returns the non-null share per field."""
    filled = {}
    for j, f in enumerate(fields):
        vectors[rows, j] = to_byte(field_values(sub, f))
        filled[f["id"]] = float((vectors[rows, j] != NULL).mean())
    return filled


def haversine_km(lat1, lon1, lat2, lon2):
    p1, p2 = np.radians(lat1), np.radians(lat2)
    dphi, dl = p2 - p1, np.radians(lon2 - lon1)
    a = np.sin(dphi / 2) ** 2 + np.cos(p1) * np.cos(p2) * np.sin(dl / 2) ** 2
    return 2 * EARTH_RADIUS_KM * np.arcsin(np.sqrt(a))


def nearest_analog_km(lat, lon, sites):
    """Distance in km from each tile centre to the nearest known Earth site (65535 if none).
    Sites with role "negative_control" are skipped."""
    sites = [s for s in sites or [] if s.get("role") != "negative_control"]
    if not sites:
        return np.full(lat.shape, NO_KM, dtype="uint16")
    assert len(sites) <= 1000, f"{len(sites)} known sites is too many"
    d = np.full(lat.shape, np.inf)
    for s in sites:                                  # running minimum: one array at a time
        d = np.minimum(d, haversine_km(lat, lon, s["lat"], s["lon"]))
    return np.minimum(np.rint(d), NO_KM - 1).astype("uint16")


def build(df, known_sites=None, nside=NSIDE, fields=None):
    """Returns (vectors uint8 [n, len(fields)], meta bytes, tile indices, summary dict)."""
    fields = fields or load_schema()[1]
    missing = [c for c in needed_columns(fields) if c not in df.columns]
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

    vectors = np.full((tiles.size, len(fields)), NULL, dtype="uint8")
    filled = fill_vectors(sub, fields, slice(None), vectors)

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
    summary = {"tiles": int(tiles.size), "bytes_per_tile": len(fields), "share_filled": filled,
               "estimated_mineralogy_tiles": int(estimated.sum())}
    return vectors, meta.tobytes(), tiles, summary


def sites_for_json(known):
    out = []
    for s in [s for s in known or [] if s.get("role") != "negative_control"]:   # controls are not analogs
        out.append({"target_id": s["id"], "name": s["name"], "lat": s["lat"], "lon": s["lon"],
                    "track": "base", "summary": s.get("source_note", "")})
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("parquet", type=Path)
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--schema", type=Path, default=DEFAULT_SCHEMA, help="data/schema.json (tile format v0.3)")
    ap.add_argument("--known-analogs", type=Path, help="known_analogs.json: fills the km-to-nearest-analog field")
    args = ap.parse_args()

    fields = load_schema(args.schema)[1]
    known = []
    if args.known_analogs:
        assert args.known_analogs.stat().st_size < 5_000_000, "known_analogs.json is larger than 5 MB"
        known = [s for s in json.loads(args.known_analogs.read_text(encoding="utf-8"))["sites"] if s.get("body") == "earth"]
    assert args.parquet.stat().st_size < 2_000_000_000, "earth.parquet is larger than 2 GB"
    df = pd.read_parquet(args.parquet)
    vectors, meta, tiles, summary = build(df, known, fields=fields)

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
