import json

import numpy as np
import pytest

import place_names as pn


def square(x0, y0, x1, y1):
    return [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]


def feature(name, admin, coords, kind="Polygon"):
    return {"type": "Feature", "properties": {"name": name, "admin": admin, "NAME": name},
            "geometry": {"type": kind, "coordinates": coords}}


@pytest.fixture()
def folder(tmp_path):
    a1 = [feature("Ring", "Landia", [square(0, 0, 10, 10), square(4, 4, 6, 6)]),                 # square with a hole
          feature("Twin", "Landia", [[square(20, 0, 22, 2)], [square(30, 0, 32, 2)]], "MultiPolygon"),
          feature("Isle", "Isleland", [square(60, 0, 62, 2)])]                                      # in no country
    a0 = [feature("Landia", "Landia", [square(-5, -5, 40, 15)]),
          feature("Hole Country", "Hole Country", [square(100, 0, 110, 10)])]
    for fname, feats in (("ne_10m_admin_1_states_provinces.geojson", a1), ("ne_10m_admin_0_countries.geojson", a0)):
        (tmp_path / fname).write_text(json.dumps({"type": "FeatureCollection", "features": feats}), encoding="utf-8")
    return tmp_path


def names_of(folder, pts):
    lat, lon = np.array([p[0] for p in pts]), np.array([p[1] for p in pts])
    idx, names = pn.name_points(lat, lon, folder)
    return [names[i] if i != 65535 else None for i in idx], idx, names


def test_inside_hole_multipolygon_country_and_none(folder):
    got, _, _ = names_of(folder, [(2, 2), (5, 5), (1, 21), (1, 31), (12, 20), (5, 105), (-50, -50)])
    assert got == ["Ring, Landia", "Landia", "Twin, Landia", "Twin, Landia", "Landia", "Hole Country", None]


def test_near_polygon_within_100_km_only(folder):
    got, _, _ = names_of(folder, [(2.5, 61.0), (10.0, 61.0)])      # 0.5 deg (56 km) and 8 deg from Isle
    assert got == ["Near Isle, Isleland", None]


def test_near_km_distance():
    near = pn.near_km(np.array([31.0]), np.array([2.5]), [np.array(square(30, 0, 32, 2))])
    assert 50 < near[0] < 60                    # 0.5 deg of latitude is about 55.6 km


def test_names_are_deduplicated(folder):
    _, idx, names = names_of(folder, [(2, 2), (3, 3), (1, 1)])
    assert names == ["Ring, Landia"] and set(idx) == {0}


def test_missing_files_raise(tmp_path):
    with pytest.raises(FileNotFoundError):
        pn.name_points(np.array([0.0]), np.array([0.0]), tmp_path)


def test_label_does_not_repeat_country():
    from place_names import label
    assert label("Antarctica", "Antarctica") == "Antarctica"
    assert label("Valais", "Switzerland") == "Valais, Switzerland"
    assert label(None, "Chile") == "Chile"


def test_empty_points_and_unsorted_order(folder):
    idx, names = pn.name_points(np.array([]), np.array([]), folder)
    assert idx.size == 0 and names == []
    got, _, _ = names_of(folder, [(-50, -50), (2, 2), (12, 20), (1, 21)])     # not sorted by latitude
    assert got == [None, "Ring, Landia", "Landia", "Twin, Landia"]


def test_50m_files_are_the_fallback_and_null_geometry_is_skipped(tmp_path):
    a1 = [feature("Ring", "Landia", [square(0, 0, 10, 10)]), {"type": "Feature", "properties": {"name": "Ghost"}, "geometry": None}]
    a0 = [feature("Landia", "Landia", [square(-5, -5, 40, 15)])]
    for fname, feats in (("ne_50m_admin_1_states_provinces.geojson", a1), ("ne_50m_admin_0_countries.geojson", a0)):
        (tmp_path / fname).write_text(json.dumps({"type": "FeatureCollection", "features": feats}), encoding="utf-8")
    assert pn.find_files(tmp_path) is not None
    assert pn.find_files(tmp_path / "nowhere") is None
    got, _, names = names_of(tmp_path, [(2, 2)])
    assert got == ["Ring, Landia"] and "Ghost" not in names


def test_near_wraps_across_the_antimeridian():
    near = pn.near_km(np.array([-179.5]), np.array([1.0]), [np.array(square(178, 0, 180, 2))])
    assert near[0] < 60                          # 0.5 deg of longitude, not 359


def test_label_empty():
    assert pn.label(None, None) == ""
