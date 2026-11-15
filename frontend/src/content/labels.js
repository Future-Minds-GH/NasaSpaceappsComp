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

/**
 * The single measurements inside each factor (fields of vectors/schema.json), keyed "factor.field" as the scoring
 * engine's fieldWeights expects. "terrain.shape" is the picture-similarity embedding.
 * hasData: the field has values in the shipped vectors (checked 2026-11-15 over every Earth, Moon and Mars tile).
 * Fields without data are kept here so they appear by flipping the flag once the data files include them.
 */
const ALL_MEASUREMENTS = [
  { key: "terrain.shape", factor: "terrain", label: "Surface look", hasData: false },
  { key: "terrain.slope", factor: "terrain", label: "Slope", hasData: true },
  { key: "terrain.roughness", factor: "terrain", label: "Roughness", hasData: true },
  { key: "elevation.relief", factor: "elevation", label: "Relief", hasData: true },
  { key: "elevation.topo_position", factor: "elevation", label: "Landform", hasData: false },
  { key: "geology.rock_class", factor: "geology", label: "Rock type", hasData: false },
  { key: "geology.volcanic", factor: "geology", label: "Volcanic", hasData: false },
  { key: "geology.impact", factor: "geology", label: "Impact craters", hasData: false },
  { key: "mineralogy.mafic", factor: "mineralogy", label: "Basaltic minerals", hasData: true },
  { key: "mineralogy.clays", factor: "mineralogy", label: "Clays", hasData: true },
  { key: "mineralogy.sulfates", factor: "mineralogy", label: "Sulfates", hasData: true },
  { key: "mineralogy.carbonates", factor: "mineralogy", label: "Carbonates", hasData: true },
  { key: "mineralogy.iron_oxides", factor: "mineralogy", label: "Iron oxides", hasData: true },
  { key: "mineralogy.salts", factor: "mineralogy", label: "Salts", hasData: false },
  { key: "climate.mean_temp", factor: "climate", label: "Temperature", hasData: true },
  { key: "climate.day_night_range", factor: "climate", label: "Day–night swing", hasData: true },
  { key: "climate.cold_extreme", factor: "climate", label: "Coldest temperature", hasData: false },
  { key: "climate.sunlit_fraction", factor: "climate", label: "Sunlight", hasData: true },
  { key: "climate.aridity", factor: "climate", label: "Dryness", hasData: false },
  { key: "atmosphere.pressure", factor: "atmosphere", label: "Air pressure", hasData: false },
  { key: "atmosphere.wind", factor: "atmosphere", label: "Wind", hasData: false },
  { key: "atmosphere.dust", factor: "atmosphere", label: "Dust", hasData: false },
  { key: "atmosphere.dust_storms", factor: "atmosphere", label: "Dust storms", hasData: false },
  { key: "water_ice.ice_fraction", factor: "water_ice", label: "Ice amount", hasData: true },
  { key: "water_ice.ice_depth", factor: "water_ice", label: "Ice depth", hasData: false },
  { key: "water_ice.ice_form", factor: "water_ice", label: "Ice type", hasData: false },
  { key: "water_ice.liquid_water", factor: "water_ice", label: "Liquid water", hasData: false },
];

/** Only the measurements the data actually has: the "Add a measurement" dropdown lists these. */
export const MEASUREMENTS = ALL_MEASUREMENTS.filter((item) => item.hasData);

/** Factors with at least one measured value; geology and atmosphere have none in the shipped data yet. */
export const FACTORS_WITH_DATA = [...new Set(MEASUREMENTS.map((item) => item.factor))];
