// A map of the body the matches are on (Earth, the Moon or Mars) with one numbered pin per current match.
import L from "leaflet";
import { CircleMarker, MapContainer, TileLayer, Tooltip } from "react-leaflet";
import EarthMap from "./EarthMap.jsx";
import { BODY_TILE_LAYERS } from "../content/tileSources.js";
import { BODY_NAMES } from "../content/labels.js";

const WHOLE_BODY_BOUNDS = [[-90, -180], [90, 180]];

export default function ResultsMap({ matches, body = "earth" }) {
  const pins = matches.map((match) => (
    <CircleMarker key={`${match.lat}-${match.lon}`} center={[match.lat, match.lon]} radius={7} pathOptions={{ className: "result-pin", weight: 2, fillOpacity: 1 }}>
      <Tooltip direction="top" offset={[0, -6]}>{`${match.rank}. ${match.name ?? `${BODY_NAMES[body]} tile`}`}</Tooltip>
    </CircleMarker>
  ));

  return (
    <section className="results-map" aria-label={`Where the matches are on ${BODY_NAMES[body]}`}>
      {body === "earth" ? (
        <EarthMap label="World map with a pin on each Earth match">{pins}</EarthMap>
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
    </section>
  );
}
