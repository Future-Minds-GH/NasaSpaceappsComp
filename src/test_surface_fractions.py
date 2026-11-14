import numpy as np
from surface_fractions import surface_fractions


def test_sums_to_one_and_extremes():
    albedo = np.array([0.3, 0.3, 0.3, 0.3, 0.3])
    ati = np.array([0.0, 0.02, 0.04, 0.06, 0.2])
    ice = np.array([0.0, 0.0, 0.0, 0.0, 0.0])
    dust, sand, rock, ice_f = surface_fractions(albedo, ati, ice)
    assert np.allclose(dust + sand + rock + ice_f, 1)
    assert dust[0] == 1 and dust[1] == 1
    assert sand[2] == 1
    assert rock[3] == 1 and rock[4] == 1


def test_ice_takes_share():
    dust, sand, rock, ice = surface_fractions([0.8], [0.0], [0.4])
    assert np.allclose([dust[0], ice[0]], [0.6, 0.4])
    assert np.allclose(dust + sand + rock + ice, 1)


def test_nan_stays_nan():
    out = surface_fractions([np.nan, 0.3], [0.04, np.nan], [0.0, 0.0])
    assert all(np.isnan(x).all() for x in out)
