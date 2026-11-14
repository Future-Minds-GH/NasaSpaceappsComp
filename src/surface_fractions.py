"""Shared surface-type function. One copy, used for Earth, Moon and Mars.

surface_fractions(albedo, ati, ice_surface, cuts) -> (dust, sand, rock, ice), each 0-1, sum 1.

Rule:
- ice = ice_surface: snow and ice-sheet cover only. Permafrost stays in the separate ice_prob
  factor, so buried ice is not counted twice and a cell with permafrost can still be dust or rock.
- The rest (1 - ice) is split into dust, sand and rock by apparent thermal inertia (ATI).
  Low ATI = loose dust. High ATI = solid rock. Sand is in between.
- ATI depends on day length and on when the satellite measures, so one fixed cut-off pair does
  not work for all bodies (Moon and Mars read as all dust, humid Earth as all rock). Each body
  therefore gets its own cuts, taken from the ranks of its own ATI values: ati_cuts(ati_body).
  Surface type is then relative within the body. Where a measured thermal inertia exists
  (Diviner for the Moon, TES for Mars) use that instead of ATI and pass its own cuts.
- cuts = (dust_full, sand_peak, rock_full): ATI at or below dust_full is all dust, at sand_peak
  all sand, at or above rock_full all rock. Linear in between.
- Any NaN input gives NaN for all four outputs. Never a 0-filled guess.
"""
import numpy as np


def ati_cuts(ati, pcts=(20, 50, 80)):
    """Cuts for one body from the percentiles of its own valid ATI values."""
    a = np.asarray(ati, dtype="float64")
    a = a[np.isfinite(a)]
    assert a.size > 0, "no valid ATI values"
    cuts = tuple(float(np.percentile(a, p)) for p in pcts)
    assert cuts[0] < cuts[1] < cuts[2], f"cuts are not increasing: {cuts}"
    return cuts


def surface_fractions(albedo, ati, ice_surface, cuts):
    albedo, ati, ice = (np.asarray(x, dtype="float64") for x in (albedo, ati, ice_surface))
    dust_full, sand_peak, rock_full = cuts
    assert dust_full < sand_peak < rock_full, f"cuts are not increasing: {cuts}"
    known_ice = ice[~np.isnan(ice)]
    assert np.all((known_ice >= 0) & (known_ice <= 1)), "ice_surface must be 0-1"
    with np.errstate(invalid="ignore"):
        dust = np.clip((sand_peak - ati) / (sand_peak - dust_full), 0, 1)
        rock = np.clip((ati - sand_peak) / (rock_full - sand_peak), 0, 1)
    sand = 1 - dust - rock
    land = 1 - ice
    out = np.stack([dust * land, sand * land, rock * land, ice])
    # albedo only gates the result: no albedo means no trusted ATI, so no surface type
    bad = np.isnan(albedo) | np.isnan(ati) | np.isnan(ice)
    out[:, bad] = np.nan
    return tuple(out)
