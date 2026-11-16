// A map of the body the matches are on (Earth, the Moon or Mars) with one pin per match, numbered with its rank in the
// list below, so the map and the list read together.
import L from "leaflet";
import { MapContainer, Marker, TileLayer, Tooltip } from "react-leaflet";
import EarthMap from "./EarthMap.jsx";
import { BODY_TILE_LAYERS } from "../content/tileSources.js";
import { BODY_NAMES } from "../content/labels.js";

const WHOLE_BODY_BOUNDS = [[-90, -180], [90, 180]];
const PIN_SIZE_PX = 24;
// One icon per rank, made once: a new icon object on every re-rank would make Leaflet rebuild every pin.
const pinIconsByRank = new Map();

export default function ResultsMap({ matches, body = "earth" }) {
  // The list below holds the same places, so the pins stay out of the keyboard order.
  const pins = matches.map((match, index) => (
    <Marker key={`${match.lat}-${match.lon}`} position={[match.lat, match.lon]} icon={rankPinIcon(match.rank ?? index + 1)} keyboard={false}>
      <Tooltip direction="top" offset={[0, -PIN_SIZE_PX / 2]}>{match.name ?? `${BODY_NAMES[body]} tile`}</Tooltip>
    </Marker>
  ));

  return (
    <figure className="results-map">
      {body === "earth" ? (
        <EarthMap label="World map with a numbered pin on each Earth match">{pins}</EarthMap>
      ) : (
        <MapContainer
          key={body}
          className="earth-map"
          crs={L.CRS.EPSG4326}
          bounds={WHOLE_BODY_BOUNDS}
          maxBounds={WHOLE_BODY_BOUNDS}
          maxBoundsViscosity={1}
          minZoom={-1}
          maxZoom={8}
          zoomSnap={0}
          scrollWheelZoom={false}
        >
          <TileLayer url={BODY_TILE_LAYERS[body].url} attribution={BODY_TILE_LAYERS[body].attribution} tileSize={256} minZoom={-1} minNativeZoom={0} maxNativeZoom={BODY_TILE_LAYERS[body].maxNativeZoom} noWrap bounds={WHOLE_BODY_BOUNDS} />
          {pins}
        </MapContainer>
      )}
      <figcaption>Where the matches are on {body === "moon" ? "the Moon" : BODY_NAMES[body]}. Each pin carries the match's rank.</figcaption>
    </figure>
  );
}

function rankPinIcon(rank) {
  if (!pinIconsByRank.has(rank)) {
    pinIconsByRank.set(rank, L.divIcon({ className: "result-pin", html: `<span>${rank}</span>`, iconSize: [PIN_SIZE_PX, PIN_SIZE_PX] }));
  }
  return pinIconsByRank.get(rank);
}
