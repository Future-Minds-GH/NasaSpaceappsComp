// Real coordinates used to build the sample data: the Moon/Mars targets, known Earth analogs and candidate Earth sites.
// Role 2's real files replace everything this produces; only the shapes must stay the same.

export const FACTORS = ["terrain", "elevation", "geology", "mineralogy", "climate", "atmosphere", "water_ice"];

export const TARGETS = [
  {
    target_id: "shackleton_ridge", body: "moon", track: "base", name: "Shackleton Connecting Ridge", lat: -89.45, lon: -136.0,
    summary: "A ridge on the rim of Shackleton crater at the lunar south pole, sunlit most of the year next to craters that never see the Sun.",
    factors: {
      terrain: "Gentle ridge crest, steep crater walls nearby",
      elevation: "High ground above the surrounding polar plains",
      geology: "Old highland rock, broken up by impacts",
      mineralogy: "Pale feldspar-rich rock (anorthosite)",
      climate: "About −50 °C on the ridge, below −200 °C in shadowed craters",
      atmosphere: "No air, no wind, no rain",
      water_ice: "Ice likely trapped in the shadowed crater floor",
    },
    resources: { water_ice: "Likely in nearby permanently shadowed craters", illumination: "Sunlit about 80–90% of the year" },
  },
  {
    target_id: "malapert_massif", body: "moon", track: "base", name: "Malapert Massif", lat: -85.99, lon: 2.93,
    summary: "A 5 km-high mountain near the south pole with a direct line of sight to Earth for radio contact.",
    factors: {
      terrain: "Broad mountain with long, smooth slopes",
      elevation: "One of the highest peaks near the south pole",
      geology: "Highland rock thrown up by an ancient basin impact",
      mineralogy: "Feldspar-rich highland rock",
      climate: "Very cold, with long stretches of sunlight on the summit",
      atmosphere: "No air, no wind, no rain",
      water_ice: "Shadowed hollows at its base may hold ice",
    },
    resources: { water_ice: "Possible in shadowed hollows at the base", illumination: "Sunlit about 70% of the year" },
  },
  {
    target_id: "nobile_rim_1", body: "moon", track: "base", name: "Nobile Rim 1", lat: -84.6, lon: 58.6,
    summary: "The rim of Nobile crater, an Artemis candidate region next to a large shadowed crater floor.",
    factors: {
      terrain: "Crater rim with rolling, pitted ground",
      elevation: "Raised rim above a deep crater floor",
      geology: "Highland rock reworked by many small impacts",
      mineralogy: "Feldspar-rich highland rock",
      climate: "Very cold; the crater floor stays in permanent shadow",
      atmosphere: "No air, no wind, no rain",
      water_ice: "Ice expected in the shadowed crater floor",
    },
    resources: { water_ice: "Expected in the shadowed floor of Nobile crater", illumination: "Sunlit about 60% of the year" },
  },
  {
    target_id: "arcadia_planitia", body: "mars", track: "base", name: "Arcadia Planitia", lat: 46.0, lon: -170.0,
    summary: "Smooth northern plains with water ice a metre or less below the surface, a favourite for a first crewed base.",
    factors: {
      terrain: "Flat, smooth plains with few boulders",
      elevation: "Low-lying northern lowlands",
      geology: "Old lava plains under a mantle of dust and ice",
      mineralogy: "Basalt dust and fine soil",
      climate: "Cold and very dry, around −60 °C on average",
      atmosphere: "Thin, dusty air; seasonal frost",
      water_ice: "Ice sheets within a metre of the surface",
    },
    resources: { water_ice: "Shallow buried ice, easy to dig", illumination: "Normal day-night cycle, weak winter Sun" },
  },
  {
    target_id: "jezero_crater", body: "mars", track: "base", name: "Jezero Crater", lat: 18.44, lon: 77.45,
    summary: "An ancient lake with a river delta, where the Perseverance rover collects samples.",
    factors: {
      terrain: "Crater floor with a layered river delta",
      elevation: "Low basin floor",
      geology: "Lake and river sediments over volcanic rock",
      mineralogy: "Clays and carbonates formed in water",
      climate: "Cold and dry",
      atmosphere: "Thin air, dust devils",
      water_ice: "No surface ice today; water shaped it long ago",
    },
    resources: { water_ice: "None near the surface", illumination: "Normal day-night cycle near the equator" },
  },
  {
    target_id: "gale_crater", body: "mars", track: "base", name: "Gale Crater", lat: -5.4, lon: 137.8,
    summary: "A deep crater with a 5 km layered mountain, explored by the Curiosity rover since 2012.",
    factors: {
      terrain: "Crater floor rising into a layered mountain",
      elevation: "Deep crater, low point of the region",
      geology: "Stacked lake and wind-blown sediments",
      mineralogy: "Clays, sulfates and iron oxides",
      climate: "Cold and dry, mild for Mars",
      atmosphere: "Thin air, strong daily wind shifts",
      water_ice: "No surface ice; minerals hold some water",
    },
    resources: { water_ice: "Water bound in clay and sulfate minerals", illumination: "Normal day-night cycle near the equator" },
  },
  {
    target_id: "utopia_planitia", body: "mars", track: "base", name: "Utopia Planitia", lat: 46.7, lon: 117.5,
    summary: "A vast northern basin with ice-rich ground, where the Viking 2 and Zhurong landers set down.",
    factors: {
      terrain: "Smooth plains with scalloped hollows",
      elevation: "Deep basin floor",
      geology: "Lava plains under sediment and ice",
      mineralogy: "Basalt dust with some clays",
      climate: "Cold and dry, below −60 °C on average",
      atmosphere: "Thin air, seasonal frost and dust",
      water_ice: "Thick buried ice within a few metres",
    },
    resources: { water_ice: "Large buried ice deposits", illumination: "Normal day-night cycle, weak winter Sun" },
  },
  {
    target_id: "marius_hills_pit", body: "moon", track: "cave", name: "Marius Hills pit", lat: 14.09, lon: -56.77,
    summary: "A 60 m-wide skylight into what may be a lava tube under the volcanic Marius Hills.",
    factors: {
      terrain: "Collapse pit in a field of volcanic domes",
      elevation: "Mid-level volcanic plateau",
      geology: "Lava flows with a possible tube beneath",
      mineralogy: "Dark basalt",
      climate: "Stable around −20 °C inside the tube, extreme swings outside",
      atmosphere: "No air, no wind, no rain",
      water_ice: "None expected",
    },
    resources: { water_ice: "None expected", illumination: "Two-week days; the cave itself is dark" },
  },
  {
    target_id: "arsia_mons_pits", body: "mars", track: "cave", name: "Arsia Mons pits", lat: -9.0, lon: -121.0,
    summary: "Dark pit openings on the flanks of a giant volcano, possible entrances to lava caves.",
    factors: {
      terrain: "Pit chains on a volcano's gentle flank",
      elevation: "Very high, about 17 km up the volcano",
      geology: "Lava flows with collapsed tubes",
      mineralogy: "Basalt",
      climate: "Cold outside, steadier inside the pits",
      atmosphere: "Very thin air at this height, morning cloud",
      water_ice: "Possible frost or ice inside cold pits",
    },
    resources: { water_ice: "Possible ice in shaded pit floors", illumination: "Normal day-night cycle; pits are shaded" },
  },
];

export const REALITY_GAP = {
  moon: ["Vacuum: no air at all", "Gravity 1/6 of Earth's", "Two-week days and two-week nights", "No shielding from cosmic radiation", "Sharp, unweathered dust"],
  mars: ["Air less than 1% as thick as Earth's, mostly CO₂", "Gravity 38% of Earth's", "Strong surface radiation", "Toxic perchlorate salts in the soil", "Planet-wide dust storms"],
};

/** Places already used as analogs; "new analog" means more than 300 km from all of these. */
export const KNOWN_ANALOGS = [
  { name: "Atacama Desert, Chile", lat: -24.08, lon: -69.92 },
  { name: "Haughton Crater, Devon Island", lat: 75.38, lon: -89.68 },
  { name: "Death Valley, USA", lat: 36.25, lon: -116.83 },
  { name: "McMurdo Dry Valleys, Antarctica", lat: -77.52, lon: 161.85 },
  { name: "Hanksville (MDRS), Utah", lat: 38.41, lon: -110.79 },
  { name: "Rio Tinto, Spain", lat: 37.72, lon: -6.56 },
  { name: "Svalbard, Norway", lat: 79.42, lon: 13.33 },
  { name: "Kīlauea, Hawaiʻi", lat: 19.35, lon: -155.3 },
  { name: "Mauna Kea, Hawaiʻi", lat: 19.82, lon: -155.47 },
  { name: "Craters of the Moon, Idaho", lat: 43.42, lon: -113.52 },
  { name: "Meteor Crater, Arizona", lat: 35.03, lon: -111.02 },
  { name: "Lanzarote, Canary Islands", lat: 29.0, lon: -13.75 },
];

/** Candidate Earth sites with the environment tag and the target bodies they suit best. */
export const EARTH_PLACES = [
  ...KNOWN_ANALOGS.map((place) => ({ ...place, env_type: knownEnvType(place.name) })),
  { name: "Danakil Depression, Ethiopia", lat: 14.24, lon: 40.3, env_type: "volcanic" },
  { name: "Rubʿ al Khali, Arabia", lat: 20.5, lon: 50.0, env_type: "desert" },
  { name: "Qaidam Basin, China", lat: 38.5, lon: 91.4, env_type: "arid" },
  { name: "Badain Jaran Desert, China", lat: 39.8, lon: 102.4, env_type: "desert" },
  { name: "Pilbara, Australia", lat: -21.1, lon: 119.4, env_type: "arid" },
  { name: "Dasht-e Lut, Iran", lat: 30.4, lon: 57.9, env_type: "desert" },
  { name: "Tibesti Mountains, Chad", lat: 19.79, lon: 18.55, env_type: "volcanic" },
  { name: "Kerguelen Islands", lat: -49.3, lon: 69.5, env_type: "polar" },
  { name: "Dome C, Antarctica", lat: -75.1, lon: 123.35, env_type: "polar" },
  { name: "Namib Desert, Namibia", lat: -24.73, lon: 15.29, env_type: "desert" },
  { name: "Salar de Uyuni, Bolivia", lat: -20.13, lon: -67.49, env_type: "arid" },
  { name: "Wolfe Creek Crater, Australia", lat: -19.17, lon: 127.8, env_type: "arid" },
  { name: "Ellef Ringnes Island, Canada", lat: 78.78, lon: -103.53, env_type: "polar" },
  { name: "Western Sahara plateau", lat: 21.12, lon: -11.4, env_type: "desert" },
  { name: "Holuhraun lava field, Iceland", lat: 64.87, lon: -16.83, env_type: "volcanic" },
  { name: "Lonar Crater, India", lat: 19.98, lon: 76.51, env_type: "volcanic" },
  { name: "Licancabur, Chile–Bolivia", lat: -22.83, lon: -67.88, env_type: "volcanic" },
  { name: "Ross Island, Antarctica", lat: -77.53, lon: 167.15, env_type: "polar" },
  { name: "Pinacate lava field, Mexico", lat: 31.77, lon: -113.5, env_type: "volcanic" },
  { name: "Lava Beds, California", lat: 41.71, lon: -121.51, env_type: "volcanic" },
  { name: "Axel Heiberg Island, Canada", lat: 79.42, lon: -90.77, env_type: "polar" },
];

function knownEnvType(name) {
  if (/Haughton|McMurdo|Svalbard/.test(name)) return "polar";
  if (/Kīlauea|Mauna|Craters of the Moon|Lanzarote|Meteor/.test(name)) return "volcanic";
  if (/Hanksville|Rio Tinto/.test(name)) return "arid";
  return "desert";
}

/** Short phrases that explain a strong factor match, used for the `why` lists. */
export const WHY_PHRASES = {
  terrain: "Same kind of slopes and roughness",
  elevation: "Similar height and relief",
  geology: "Same rock family",
  mineralogy: "Similar minerals at the surface",
  climate: "Just as cold or dry",
  atmosphere: "Similar wind and dust",
  water_ice: "Ice or frozen ground like the target",
};
