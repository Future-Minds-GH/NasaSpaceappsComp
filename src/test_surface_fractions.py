import numpy as np
from surface_fractions import ati_cuts, surface_fractions

CUTS = (0.02, 0.04, 0.06)


def test_sums_to_one_and_extremes():
    albedo = np.full(5, 0.3)
    ati = np.array([0.0, 0.02, 0.04, 0.06, 0.2])
    dust, sand, rock, ice_f = surface_fractions(albedo, ati, np.zeros(5), CUTS)
    assert np.allclose(dust + sand + rock + ice_f, 1)
    assert dust[0] == 1 and dust[1] == 1
    assert sand[2] == 1
    assert rock[3] == 1 and rock[4] == 1


def test_ice_takes_share():
    dust, sand, rock, ice = surface_fractions([0.8], [0.0], [0.4], CUTS)
    assert np.allclose([dust[0], ice[0]], [0.6, 0.4])
    assert np.allclose(dust + sand + rock + ice, 1)


def test_nan_stays_nan():
    out = surface_fractions([np.nan, 0.3], [0.04, np.nan], [0.0, 0.0], CUTS)
    assert all(np.isnan(x).all() for x in out)


def test_cuts_per_body_spread_the_classes():
    # Two bodies whose ATI differs by 30x: with their own cuts, both get all three classes.
    rng = np.random.default_rng(1)
    for scale in (0.003, 0.1):
        ati = rng.uniform(0.5, 1.5, 3000) * scale
        cuts = ati_cuts(ati)
        dust, sand, rock, ice = surface_fractions(np.full(3000, 0.3), ati, np.zeros(3000), cuts)
        assert dust.mean() > 0.15 and sand.mean() > 0.15 and rock.mean() > 0.15
        assert np.allclose(dust + sand + rock + ice, 1)


def test_permafrost_does_not_make_ice_surface():
    # ice_surface = 0 for a bare permafrost cell, so it keeps its dust, sand and rock share
    dust, sand, rock, ice = surface_fractions([0.3], [0.02], [0.0], CUTS)
    assert ice[0] == 0 and dust[0] == 1
