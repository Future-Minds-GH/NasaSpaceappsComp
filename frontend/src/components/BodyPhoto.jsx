// A Moon or Mars card picture: the body's globe texture (an equirectangular map) cropped and centred on one tile.
// Needs no outside image server, so it works wherever the site is hosted.
import { GLOBE_TEXTURES } from "./PlanetGlobe.jsx";

// The crop shows 1/ZOOM of the map's width: about 45° of longitude at 8.
const ZOOM = 8;

export default function BodyPhoto({ body, lat, lon, label }) {
  // Background-position percentages place that fraction of the image at the same fraction of the box,
  // so this centres the tile's point of the map in the crop (clamped at the map's edges).
  const x = clamp01((lon + 180) / 360) * 100;
  const y = clamp01((90 - lat) / 180) * 100;
  return (
    <div
      className="body-photo"
      role="img"
      aria-label={label}
      style={{ backgroundImage: `url(${GLOBE_TEXTURES[body].url})`, backgroundSize: `${ZOOM * 100}% ${ZOOM * 100 * 0.8}%`, backgroundPosition: `${x}% ${y}%` }}
    />
  );
}

function clamp01(value) {
  return Math.min(1, Math.max(0, value));
}
