// Plain-language names for the codes in the data files, so the default view reads without a science background.
// The factor labels are the ones in data/schema.json (a test keeps the two in step).

export const BODY_NAMES = { moon: "Moon", mars: "Mars", earth: "Earth" };

export const FACTOR_LABELS = {
  temp: "Temperature (day and night)",
  swing: "Day-night swing",
  sun: "Sunlight",
  slope: "Slope",
  rough: "Roughness",
  elev: "Relative elevation",
  surface: "Surface type",
  minerals: "Minerals",
  ice: "Water ice",
};

/** Each factor's name inside a sentence ("Very close on slope and water ice"). */
export const FACTOR_SHORT_NAMES = {
  temp: "temperature",
  swing: "day-night swing",
  sun: "sunlight",
  slope: "slope",
  rough: "roughness",
  elev: "elevation",
  surface: "surface type",
  minerals: "minerals",
  ice: "water ice",
};

/** One-line meaning of each factor, shown beside the numbers in the Details panel. */
export const FACTOR_MEANINGS = {
  temp: "Average day and night surface temperature, in kelvin",
  swing: "How far the temperature falls from day to night, in kelvin",
  sun: "Sunlight reaching the ground, in W/m²",
  slope: "How steep the ground is, in degrees",
  rough: "How rough the ground is, in metres",
  elev: "How high the spot sits compared with the rest of its planet",
  surface: "Share of dust, sand, rock and ice on the surface",
  minerals: "Share of basaltic, feldspar-rich, iron-oxide, sulfate, clay and carbonate minerals",
  ice: "Chance of water ice in the ground",
};

/** Plain reason shown when a factor matches strongly (for spots people pick, which have no written reasons). */
export const FACTOR_REASONS = {
  temp: "Similar day and night temperatures",
  swing: "Same day-night temperature swing",
  sun: "About as much sunlight",
  slope: "Similar slopes",
  rough: "Similar roughness",
  elev: "Similar height within its planet",
  surface: "Similar mix of dust, sand and rock",
  minerals: "Similar minerals at the surface",
  ice: "Ice in the ground like the target",
};

/** The two ways to score the factors: what each one compares, in one plain sentence. */
export const MODE_INFO = {
  absolute: { label: "Absolute", sentence: "Compares real units: kelvin, W/m², degrees, metres." },
  relative: { label: "Relative", sentence: "Compares rank within each planet: a cold place on the Moon matches a cold place on Earth." },
};

/** Text for each score band (colour is never the only cue). */
export const BAND_LABELS = { green: "Strong analog", yellow: "Partial analog", red: "Weak analog" };

export const ENVIRONMENT_LABELS = {
  desert: "Desert",
  polar: "Polar",
  volcanic: "Volcanic",
  arid: "Arid",
  cave: "Lava cave",
};
