// Plain-language names for the codes in the data files, so the default view reads without a science background.

export const BODY_NAMES = { moon: "Moon", mars: "Mars", earth: "Earth" };

export const FACTOR_LABELS = {
  terrain: "Terrain",
  elevation: "Elevation & topography",
  geology: "Geology",
  mineralogy: "Mineralogy",
  climate: "Climate",
  atmosphere: "Atmosphere: dust & wind",
  water_ice: "Water & ice",
};

/** One-line meaning of each factor, shown beside the numbers in the Details panel. */
export const FACTOR_MEANINGS = {
  terrain: "Shape of the ground: slopes, roughness, craters",
  elevation: "Relief and position: ridge, slope or basin",
  geology: "Rock family, volcanic or impact origin",
  mineralogy: "Iron, clays, sulfates, carbonates and salts at the surface",
  climate: "Dryness, cold, day-night swing and sunlight",
  atmosphere: "Air pressure, wind and dust (none on the Moon)",
  water_ice: "Ice amount, depth and form; liquid water counts against",
};

export const ENVIRONMENT_LABELS = {
  desert: "Desert",
  polar: "Polar",
  volcanic: "Volcanic",
  arid: "Arid",
  cave: "Lava cave",
};


/** Plain reason shown when a factor matches strongly (for spots people pick, which have no written reasons). */
export const FACTOR_REASONS = {
  terrain: "Same shape of ground",
  elevation: "Similar height and relief",
  geology: "Same rock family",
  mineralogy: "Similar minerals at the surface",
  climate: "Just as cold or dry",
  atmosphere: "Similar wind and dust",
  water_ice: "Ice or frozen ground like the target",
};
