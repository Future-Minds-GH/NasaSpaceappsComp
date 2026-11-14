// World map (NASA GIBS shaded relief) used by Characterize (click to pick a spot) and Discover (candidate pins).
import { useEffect } from "react";
import L from "leaflet";
import { MapContainer, Rectangle, WMSTileLayer, useMap, useMapEvents } from "react-leaflet";
import { EARTH_WMS_LAYER } from "../content/tileSources.js";

const WORLD_BOUNDS = [[-90, -180], [90, 180]];
const FOCUS_ZOOM = 4;

/**
 * @param {{ onPick?: (lat: number, lon: number) => void, highlightBounds?: number[][], focus?: [number, number],
 *           children?: React.ReactNode, label: string }} props
 */
export default function EarthMap({ onPick, highlightBounds, focus, children, label }) {
  return (
    <div className="earth-map-frame" role="region" aria-label={label}>
      <MapContainer
        className="earth-map"
        crs={L.CRS.EPSG4326}
        bounds={WORLD_BOUNDS}
        maxBounds={WORLD_BOUNDS}
        maxBoundsViscosity={1}
        // Below zoom 0 so the whole world fits frames narrower than 512 px.
        minZoom={-1}
        maxZoom={8}
        // Whole or quarter zoom steps leave dark bands around the world; free zoom fits any 2:1 frame exactly.
        zoomSnap={0}
        scrollWheelZoom={false}
      >
        <WMSTileLayer
          url={EARTH_WMS_LAYER.url}
          layers={EARTH_WMS_LAYER.layers}
          format="image/jpeg"
          version="1.3.0"
          attribution={EARTH_WMS_LAYER.attribution}
          noWrap
          bounds={WORLD_BOUNDS}
        />
        {onPick && <ClickToPick onPick={onPick} />}
        {focus && <FlyToFocus focus={focus} />}
        {highlightBounds && <Rectangle bounds={highlightBounds} pathOptions={{ className: "picked-cell", weight: 2, fillOpacity: 0.25 }} />}
        {children}
      </MapContainer>
    </div>
  );
}

function ClickToPick({ onPick }) {
  useMapEvents({ click: (event) => onPick(event.latlng.lat, event.latlng.lng) });
  return null;
}

/** Moves the map to a newly chosen site, keeping the user's zoom if they are already closer in. */
function FlyToFocus({ focus }) {
  const map = useMap();
  const [lat, lon] = focus;
  useEffect(() => {
    const isReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    map.flyTo([lat, lon], Math.max(map.getZoom(), FOCUS_ZOOM), { animate: !isReducedMotion, duration: 0.8 });
  }, [map, lat, lon]);
  return null;
}
