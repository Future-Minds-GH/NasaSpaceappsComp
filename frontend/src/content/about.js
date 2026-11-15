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

/**
 * Role 3's comparison figures. Put each image in frontend/public/figures/ and add it here:
 * { file: "atacama_vs_jezero.png", caption: "One sentence saying what the figure shows." }
 */
export const FIGURES = [];

/** Only well-known public datasets. Role 1's citations.md holds the complete list with formal citations. */
// The challenge's 11 official resources (Resources tab, read Nov 14), grouped by agency, plus what the site itself shows.
export const DATA_CREDITS = [
  {
    agency: "NASA",
    datasets: [
      { name: "Earthdata Search", about: "MODIS vegetation and land temperature, MERRA-2 and POWER climate, SMAP soil moisture, EMIT minerals" },
      { name: "Worldview / GIBS", about: "True-colour Earth images on the result cards and the Earth maps" },
      { name: "Planetary Data System", about: "Mars elevation (MOLA), minerals (CRISM, TES), THEMIS thermal inertia and Odyssey GRS hydrogen" },
      { name: "Lunar Reconnaissance Orbiter", about: "Moon elevation and sunlight (LOLA), hydrogen (LEND) and radar (Mini-RF)" },
      { name: "LRO Diviner", about: "Moon temperatures, thermal inertia and where ice can survive" },
      { name: "Moon Trek and Mars Trek", about: "The globe textures and map tiles on this site (LRO WAC mosaic, Viking MDIM 2.1 colour mosaic)" },
    ],
  },
  {
    agency: "CSA",
    datasets: [
      { name: "RADARSAT Constellation Mission", about: "Radar checks of surface roughness over Arctic Canada" },
      { name: "RADARSAT-1 open archive", about: "Radar fallback where newer scenes are hard to get" },
      { name: "SAR Python tutorial", about: "Starting code for reading and calibrating radar data" },
    ],
  },
  {
    agency: "ESA",
    datasets: [
      { name: "Copernicus Data Space", about: "Copernicus DEM elevation and Sentinel-1 radar" },
      { name: "Open Science Catalog", about: "The ESA CCI permafrost product" },
    ],
  },
  {
    agency: "JAXA",
    datasets: [
      { name: "G-Portal", about: "GCOM-C/SGLI snow cover and land surface temperature" },
    ],
  },
];

export const FULL_CREDITS_NOTE =
  "Also used: USGS Moon and Mars geologic maps, GLiM lithology, the Earth Impact Database, the Mars Climate Database, SWIM ice maps, the ESA and IMEWG analog catalogues, RGI glaciers. The full list with formal citations is Role 1's citations.md in the repository.";

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
