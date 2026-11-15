// Latitude and longitude as two small readouts ("9.95° N · 94.00° E"): numbers in the display font, the hemisphere
// letter softer, so a coordinate reads at a glance instead of as one long mono string.
export default function Coordinates({ lat, lon, className = "" }) {
  return (
    <span className={`coords ${className}`} aria-label={`${Math.abs(lat).toFixed(2)} degrees ${lat >= 0 ? "north" : "south"}, ${Math.abs(lon).toFixed(2)} degrees ${lon >= 0 ? "east" : "west"}`}>
      <span className="coord" aria-hidden="true">{Math.abs(lat).toFixed(2)}°<span className="coord-hemi">{lat >= 0 ? "N" : "S"}</span></span>
      <span className="coord" aria-hidden="true">{Math.abs(lon).toFixed(2)}°<span className="coord-hemi">{lon >= 0 ? "E" : "W"}</span></span>
    </span>
  );
}
