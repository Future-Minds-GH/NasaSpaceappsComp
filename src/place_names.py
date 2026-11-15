"""Name points on Earth from Natural Earth GeoJSON (admin-1 states/provinces, admin-0 countries). Offline, numpy only.

Name of a point: "<admin-1 name>, <country>"; else "<country>"; else, within NEAR_KM of an admin-1 polygon,
"Near <admin-1 name>, <country>"; else no name (-1).

Files read from the folder: ne_10m_admin_1_states_provinces.geojson, ne_10m_admin_0_countries.geojson
(the 50m files, ne_50m_*, are used when the 10m files are missing). Natural Earth is public domain.
"""
import json
from pathlib import Path

import numpy as np

NEAR_KM = 100.0
KM_PER_DEG = 111.19
MAX_NAMES = 65535                     # name index 65535 means "none"
ADMIN1 = "admin_1_states_provinces"
ADMIN0 = "admin_0_countries"


def find_files(folder):
    """(admin-1 path, admin-0 path) in folder, or None if either is missing."""
    folder = Path(folder)
    for scale in ("10m", "50m"):
        a1, a0 = folder / f"ne_{scale}_{ADMIN1}.geojson", folder / f"ne_{scale}_{ADMIN0}.geojson"
        if a1.is_file() and a0.is_file():
            return a1, a0
    return None


def read_features(path, name_keys, country_keys=()):
    """List of (name, country, bbox (x0, y0, x1, y1), rings). A ring is a float array [n, 2] of (lon, lat).
    Holes are rings too: the even-odd rule handles them."""
    assert Path(path).stat().st_size < 200_000_000, f"{path} is larger than 200 MB"
    out = []
    for feat in json.loads(Path(path).read_text(encoding="utf-8"))["features"]:
        geom, props = feat["geometry"], feat["properties"]
        if not geom:
            continue
        polys = [geom["coordinates"]] if geom["type"] == "Polygon" else geom["coordinates"]
        assert geom["type"] in ("Polygon", "MultiPolygon"), f"geometry {geom['type']} not supported"
        rings = [np.asarray(r, dtype="float64")[:, :2] for poly in polys for r in poly]
        if not rings:
            continue
        allp = np.concatenate(rings)
        bbox = (allp[:, 0].min(), allp[:, 1].min(), allp[:, 0].max(), allp[:, 1].max())
        pick = lambda keys: next((props[k] for k in keys if props.get(k)), None)
        out.append((pick(name_keys), pick(country_keys), bbox, rings))
    return out


def inside(lon, lat, rings):
    """Boolean mask: which points (lon, lat sorted by lat) lie inside the polygon made of rings (even-odd)."""
    par = np.zeros(lon.size, dtype=bool)
    for r in rings:
        x1, y1, x2, y2 = r[:-1, 0], r[:-1, 1], r[1:, 0], r[1:, 1]
        keep = y1 != y2
        x1, y1, x2, y2 = x1[keep], y1[keep], x2[keep], y2[keep]
        lo, hi = np.minimum(y1, y2), np.maximum(y1, y2)
        i0, i1 = np.searchsorted(lat, lo, "left"), np.searchsorted(lat, hi, "left")     # points with lo <= y < hi
        for k in np.flatnonzero(i1 > i0):
            s = slice(i0[k], i1[k])
            xi = x1[k] + (lat[s] - y1[k]) * (x2[k] - x1[k]) / (y2[k] - y1[k])
            par[s] ^= lon[s] < xi
    return par


def near_km(lon, lat, rings):
    """Distance in km from each point to the nearest ring segment (flat-earth approximation, fine below ~200 km)."""
    best = np.full(lon.size, np.inf)
    kx = np.cos(np.radians(lat))[:, None]
    for r in rings:
        for c in range(0, len(r) - 1, 500):                          # chunks of 500 edges bound memory
            e = r[c:c + 501]
            ax, ay, bx, by = e[:-1, 0], e[:-1, 1], e[1:, 0], e[1:, 1]
            dx, dy = (bx - ax)[None, :] * kx, (by - ay)[None, :]
            px, py = (lon[:, None] - ax[None, :] + 180.0) % 360.0 - 180.0, lat[:, None] - ay[None, :]
            px = px * kx
            len2 = dx * dx + dy * dy
            t = np.clip((px * dx + py * dy) / np.where(len2 == 0, 1, len2), 0, 1)
            d = np.hypot(px - t * dx, py - t * dy).min(axis=1) * KM_PER_DEG
            best = np.minimum(best, d)
    return best


def candidates(lon, lat, bbox, margin_deg=0.0):
    """Indices into the lat-sorted points that fall in bbox (grown by margin_deg of latitude)."""
    x0, y0, x1, y1 = bbox
    mx = margin_deg / max(np.cos(np.radians(min(max(abs(y0), abs(y1)) + margin_deg, 89.0))), 0.02)
    idx = np.arange(np.searchsorted(lat, y0 - margin_deg, "left"), np.searchsorted(lat, y1 + margin_deg, "right"))
    return idx[(lon[idx] >= x0 - mx) & (lon[idx] <= x1 + mx)]


def label(name, country):
    """'<name>, <country>', or one of them when the other is missing or the two are the same."""
    if name and country and name != country:
        return f"{name}, {country}"
    return name or country or ""


def name_points(lat, lon, folder):
    """(index uint16 array, names list). index 65535 = no name. Raises FileNotFoundError if the files are missing."""
    files = find_files(folder)
    if files is None:
        raise FileNotFoundError(f"Natural Earth admin-1 and admin-0 GeoJSON not found in {folder}")
    admin1 = read_features(files[0], ("name", "name_en"), ("admin", "geonunit"))
    admin0 = read_features(files[1], ("NAME", "ADMIN", "NAME_EN"))
    lat, lon = np.asarray(lat, dtype="float64"), np.asarray(lon, dtype="float64")
    order = np.argsort(lat, kind="stable")
    slat, slon = lat[order], lon[order]
    text = np.full(lat.size, None, dtype=object)                    # in sorted order

    def assign(features, text_of):
        for f in features:
            cand = candidates(slon, slat, f[2])
            cand = cand[np.equal(text[cand], None)]
            if cand.size:
                hit = inside(slon[cand], slat[cand], f[3])
                text[cand[hit]] = text_of(f)

    assign(admin1, lambda f: label(f[0], f[1]))
    assign(admin0, lambda f: f[0])
    left = np.flatnonzero(np.equal(text, None))                     # coast, small islands
    if left.size:
        best = np.full(left.size, np.inf)
        for f in admin1:
            c = candidates(slon[left], slat[left], f[2], margin_deg=NEAR_KM / KM_PER_DEG + 0.1)
            if c.size:
                d = near_km(slon[left[c]], slat[left[c]], f[3])
                win = (d <= NEAR_KM) & (d < best[c])
                best[c[win]] = d[win]
                text[left[c[win]]] = "Near " + label(f[0], f[1])
    names, number = [], {}
    index = np.full(lat.size, MAX_NAMES, dtype="uint16")
    for pos, t in zip(order, text):
        if t is None:
            continue
        if t not in number:
            assert len(names) < MAX_NAMES, "too many distinct names for a uint16 index"
            number[t] = len(names)
            names.append(t)
        index[pos] = number[t]
    return index, names
