// A still map of the Moon or Mars around one spot, used where a picked spot has no close-up photo.
import { useEffect } from "react";
import L from "leaflet";
import { CircleMarker, MapContainer, TileLayer, useMap } from "react-leaflet";
import { BODY_TILE_LAYERS } from "../content/tileSources.js";

const SNAPSHOT_ZOOM = 3;

export default function BodySnapshot({ body, lat, lon, label }) {
  const tiles = BODY_TILE_LAYERS[body];
  return (
    <div className="body-snapshot" role="img" aria-label={label}>
      <MapContainer
        crs={L.CRS.EPSG4326}
        center={[lat, lon]}
        zoom={SNAPSHOT_ZOOM}
        zoomControl={false}
        attributionControl={false}
        dragging={false}
        scrollWheelZoom={false}
        doubleClickZoom={false}
        boxZoom={false}
        keyboard={false}
        touchZoom={false}
      >
        <TileLayer url={tiles.url} tileSize={256} maxNativeZoom={tiles.maxNativeZoom} noWrap />
        <CircleMarker center={[lat, lon]} radius={8} pathOptions={{ className: "target-pin target-pin-picked", weight: 3, fillOpacity: 1 }} />
        <MeasureWhenShown center={[lat, lon]} />
      </MapContainer>
    </div>
  );
}

// The map is created inside a dialog that opens a moment later, while it still measures 0 × 0. Measure again once
// the dialog is on screen, or Leaflet loads tiles for an empty frame.
function MeasureWhenShown({ center }) {
  const map = useMap();
  const [lat, lon] = center;
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      map.invalidateSize();
      map.setView([lat, lon], SNAPSHOT_ZOOM, { animate: false });
    });
    return () => cancelAnimationFrame(frame);
  }, [map, lat, lon]);
  return null;
}
