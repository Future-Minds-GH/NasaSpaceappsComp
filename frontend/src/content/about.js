// Words and lists for the About page (the method, Role 3's figures, data credits by agency, the team roles) and for
// the Findings page (what each kind of place lets teams rehearse).

/** The whole method in five plain sentences, grouped by pipeline stage. */
export const METHOD_STAGES = [
  {
    title: "Tiles and vectors",
    sentences: [
      "We cut the Moon, Mars and Earth into equal-area HEALPix tiles about 27 km across, so a 27 km crater looks the same size on all three.",
      "Every tile becomes one vector of numbers in nine parts: temperature (day and night), day-night swing, sunlight, slope, roughness, relative elevation, surface type, minerals and water ice. Each is stored in real units (kelvin, W/m², degrees, metres), plus a rank within its own planet.",
      "There is no machine learning in the score: every number is measured or derived from measured data (slope and roughness from elevation models), and estimated minerals are marked.",
    ],
  },
  {
    title: "The search",
    sentences: [
      "When you click a Moon or Mars tile, your browser compares its vector with every Earth tile, scores the nine factors from 0 to 1 (1 minus the gap divided by a tolerance, such as 40 K for temperature), and combines them with a weighted average. A factor with no data on either tile is left out. In Relative mode each factor compares ranks within its own planet instead of real units.",
    ],
  },
  {
    title: "Where it runs",
    sentences: [
      "All vectors are computed in Google Colab ahead of time and published as static files, so this site needs no server and the mission sliders re-rank live.",
    ],
  },
];

/** Why Absolute-mode scores for the Moon and Mars are often yellow or red (about 50 to 65). Matches data/schema.json tolerances and similarity.js. */
export const LOW_SCORE_NOTE = [
  "Moon and Mars scores in Absolute mode are often yellow or red. The new Earth places in the Discover list score 44 to 71.",
  "In our data, the warmest Mars night (197 K) is colder than the coldest Earth night (210 K). The median Moon night is 99 K. The median Mars day-night swing is 87 K; the largest on Earth is 45 K.",
  "Absolute mode compares real values with fixed tolerances, such as 40 K for temperature and 30 K for the day-night swing. A gap larger than the tolerance scores 0 for that factor.",
  "Relative mode compares ranks within each planet instead, so it usually scores higher.",
];

/**
 * Role 3's comparison figures. Put each image in frontend/public/figures/ and add it here:
 * { file: "atacama_vs_jezero.png", caption: "One sentence saying what the figure shows." }
 */
export const FIGURES = [];

/** Only sources that feed a scored factor, the land filter or the known-analog list (earth_sources.md, moon_mars_sources.md). */
export const DATA_CREDITS = [
  {
    agency: "NASA",
    datasets: [
      { name: "Earthdata Search", about: "Earth day and night temperature and albedo (MODIS), sunlight (POWER), minerals (EMIT), and the land filter (MODIS vegetation, land cover)" },
      { name: "Planetary Data System", about: "Mars elevation, slope and roughness (MOLA), minerals and albedo (TES), and hydrogen for ice (Odyssey GRS)" },
      { name: "Lunar Reconnaissance Orbiter", about: "Moon elevation, slope and roughness (LOLA), albedo (LROC WAC) and hydrogen for ice (LEND)" },
      { name: "LRO Diviner", about: "Moon day and night temperatures and the cold traps where ice can survive" },
    ],
  },
  {
    agency: "ESA",
    datasets: [
      { name: "Copernicus DEM GLO-90", about: "Earth elevation, slope and roughness (the public AWS Open Data copy of the ESA product)" },
      { name: "ESA Permafrost CCI v5.0 (CEDA)", about: "Permafrost extent, used for Earth ice" },
      { name: "Natural Earth admin-0 and admin-1 boundaries (public domain)", about: "Place names for Earth tiles" },
    ],
  },
  {
    agency: "Other sources",
    datasets: [
      { name: "Mars Climate Database", about: "Mars day and night temperatures and sunlight" },
      { name: "SWIM ice maps", about: "Mars mid-latitude ground ice" },
      { name: "Lunar Prospector gamma-ray data", about: "Moon iron and titanium, for the mineral shares" },
      { name: "GLiM lithology", about: "Earth rock types, a rough stand-in for minerals where EMIT has no data" },
    ],
  },
];

export const FULL_CREDITS_NOTE =
  "Known test sites come from public pages (mostly Wikipedia) cited in known_analogs.json. Shown on the site but not scored: the Moon Trek and Mars Trek globe textures and the Worldview / GIBS Earth images. Processing details for every source are in earth_sources.md and moon_mars_sources.md in the repository.";

/** The four team roles. Member names are added by the team, never guessed. */
export const TEAM_ROLES = [
  { name: "Grid, Data API & Vectors", role: "Role 1", work: "Cuts all three bodies into tiles, wraps the agencies' data services, and builds every tile's vector." },
  { name: "Scoring & Results", role: "Role 2", work: "Measures temperature, sunlight, minerals and ice, writes the similarity maths, Discover and the validation." },
  { name: "AI/Terrain", role: "Role 3", work: "Turns elevation into slope and roughness, and makes the comparison figures." },
  { name: "Frontend & Demo", role: "Role 4", work: "Builds the globes, the live search and this site, and the demo." },
];

/**
 * Findings page: what each discovery tag lets teams rehearse on Earth, joined into one sentence per finding.
 * Tags not listed (hydrothermal, aeolian, ice dynamics) add nothing; a finding with no listed tag gets a general sentence.
 */
export const FINDINGS_EXPLORATION_USES = {
  volcanic: "cave and regolith-handling tests",
  permafrost: "ice-drilling trials",
  "hyperarid soil": "trials of life-detection instruments",
  evaporite: "sample-collection rehearsals",
  sedimentary: "sample-collection rehearsals",
};
