"""Shared surface-type function. One copy, used for Earth, Moon and Mars.

surface_fractions(albedo, ati, ice_prob) -> (dust, sand, rock, ice), each in 0-1, sum 1.

Rule:
- ice = ice_prob.
- The rest (1 - ice) is split into dust, sand and rock by apparent thermal inertia (ATI).
  Low ATI = loose dust. High ATI = solid rock. Sand is in between.
- Splits use triangular memberships on ATI. The two thresholds are STARTING VALUES,
  not measured facts. Tune them with the validation numbers (hit@10), on all bodies at once.
- Any NaN input gives NaN for all four outputs. Never a 0-filled guess.
"""
import numpy as np

ATI_DUST = 0.02   # at or below: all dust (1/K). Starting value.
ATI_ROCK = 0.06   # at or above: all rock (1/K). Starting value.


def surface_fractions(albedo, ati, ice_prob):
    albedo, ati, ice = (np.asarray(x, dtype="float64") for x in (albedo, ati, ice_prob))
    assert np.all((ice[~np.isnan(ice)] >= 0) & (ice[~np.isnan(ice)] <= 1)), "ice_prob must be 0-1"
    assert ATI_DUST < ATI_ROCK
    mid = (ATI_DUST + ATI_ROCK) / 2
    half = (ATI_ROCK - ATI_DUST) / 2
    dust = np.clip((mid - ati) / half, 0, 1)            # 1 at ATI_DUST, 0 at mid
    rock = np.clip((ati - mid) / half, 0, 1)            # 0 at mid, 1 at ATI_ROCK
    sand = 1 - dust - rock                              # peak at mid
    land = 1 - ice
    out = np.stack([dust * land, sand * land, rock * land, ice])
    # albedo only gates the result: no albedo means no trusted ATI, so no surface type
    bad = np.isnan(albedo) | np.isnan(ati) | np.isnan(ice)
    out[:, bad] = np.nan
    return tuple(out)
