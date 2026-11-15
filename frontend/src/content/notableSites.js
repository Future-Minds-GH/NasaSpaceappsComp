// Well-known places shown on the input globe next to the project's own named sites (tiles/<body>_meta.json):
// landing sites and landmarks people recognise. Coordinates are planetocentric, east-positive longitude (−180…180).
export const EXTRA_SITES = [
  // Moon
  { body: "moon", target_id: "apollo_11", name: "Apollo 11", lat: 0.674, lon: 23.473 },
  { body: "moon", target_id: "apollo_15", name: "Apollo 15 (Hadley Rille)", lat: 26.132, lon: 3.634 },
  { body: "moon", target_id: "apollo_17", name: "Apollo 17 (Taurus-Littrow)", lat: 20.191, lon: 30.772 },
  { body: "moon", target_id: "change_4", name: "Chang'e 4 (far side)", lat: -45.445, lon: 177.599 },
  { body: "moon", target_id: "shackleton", name: "Shackleton crater", lat: -89.9, lon: 0 },
  // Mars
  { body: "mars", target_id: "olympus_mons", name: "Olympus Mons", lat: 18.65, lon: -133.8 },
  { body: "mars", target_id: "valles_marineris", name: "Valles Marineris", lat: -13.9, lon: -59.2 },
  { body: "mars", target_id: "hellas", name: "Hellas Basin", lat: -42.4, lon: 70.5 },
  { body: "mars", target_id: "viking_1", name: "Viking 1", lat: 22.27, lon: -47.95 },
  { body: "mars", target_id: "pathfinder", name: "Mars Pathfinder", lat: 19.13, lon: -33.22 },
  // Earth
  { body: "earth", target_id: "rio_tinto", name: "Río Tinto, Spain", lat: 37.72, lon: -6.57 },
  { body: "earth", target_id: "svalbard", name: "Svalbard (Bockfjord)", lat: 79.4, lon: 13.3 },
];

/** The project's control sites (forest, cities) are for validation, not for picking. */
export const isPickableSite = (site) => !/negative control/i.test(site.name);

/** Shorter labels for the globe: drop the parenthesised notes from the project's long site names. */
export const shortSiteName = (name) => name.replace(/\s*\(.*?\)\s*/g, " ").replace(/\s+,/g, ",").trim();
