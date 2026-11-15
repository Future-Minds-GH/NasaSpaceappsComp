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
 */
export const MEASUREMENTS = [
  { key: "terrain.shape", factor: "terrain", label: "Surface look" },
  { key: "terrain.slope", factor: "terrain", label: "Slope" },
  { key: "terrain.roughness", factor: "terrain", label: "Roughness" },
  { key: "elevation.relief", factor: "elevation", label: "Relief" },
  { key: "elevation.topo_position", factor: "elevation", label: "Landform" },
  { key: "geology.rock_class", factor: "geology", label: "Rock type" },
  { key: "geology.volcanic", factor: "geology", label: "Volcanic" },
  { key: "geology.impact", factor: "geology", label: "Impact craters" },
  { key: "mineralogy.mafic", factor: "mineralogy", label: "Basaltic minerals" },
  { key: "mineralogy.clays", factor: "mineralogy", label: "Clays" },
  { key: "mineralogy.sulfates", factor: "mineralogy", label: "Sulfates" },
  { key: "mineralogy.carbonates", factor: "mineralogy", label: "Carbonates" },
  { key: "mineralogy.iron_oxides", factor: "mineralogy", label: "Iron oxides" },
  { key: "mineralogy.salts", factor: "mineralogy", label: "Salts" },
  { key: "climate.mean_temp", factor: "climate", label: "Temperature" },
  { key: "climate.day_night_range", factor: "climate", label: "Day–night swing" },
  { key: "climate.cold_extreme", factor: "climate", label: "Coldest temperature" },
  { key: "climate.sunlit_fraction", factor: "climate", label: "Sunlight" },
  { key: "climate.aridity", factor: "climate", label: "Dryness" },
  { key: "atmosphere.pressure", factor: "atmosphere", label: "Air pressure" },
  { key: "atmosphere.wind", factor: "atmosphere", label: "Wind" },
  { key: "atmosphere.dust", factor: "atmosphere", label: "Dust" },
  { key: "atmosphere.dust_storms", factor: "atmosphere", label: "Dust storms" },
  { key: "water_ice.ice_fraction", factor: "water_ice", label: "Ice amount" },
  { key: "water_ice.ice_depth", factor: "water_ice", label: "Ice depth" },
  { key: "water_ice.ice_form", factor: "water_ice", label: "Ice type" },
  { key: "water_ice.liquid_water", factor: "water_ice", label: "Liquid water" },
];
