// The picked spot's coordinates, editable: click them to type an exact latitude and longitude (e.g. "18.4, 77.5" or
// "18.4 N 77.5 E"), Enter to apply, Escape to cancel. Before any pick it shows the "click anywhere" hint.
import { useState } from "react";
import Coordinates from "./Coordinates.jsx";

export default function CoordinateInput({ point, onChange, placeholder }) {
  const [draft, setDraft] = useState(null);
  const [error, setError] = useState(false);

  function startEditing() {
    setDraft(point ? `${point.lat.toFixed(2)}, ${point.lon.toFixed(2)}` : "");
    setError(false);
  }

  function apply(event) {
    event.preventDefault();
    const parsed = parse(draft);
    if (!parsed) { setError(true); return; }
    onChange(parsed.lat, parsed.lon);
    setDraft(null);
  }

  if (draft !== null) {
    return (
      <form className="coord-input" onSubmit={apply}>
        <input
          autoFocus
          value={draft}
          onChange={(event) => { setDraft(event.target.value); setError(false); }}
          onKeyDown={(event) => event.key === "Escape" && setDraft(null)}
          onBlur={() => setDraft(null)}
          aria-label="Latitude, longitude"
          aria-invalid={error}
          placeholder="lat, lon  e.g. 18.4, 77.5"
        />
        <span className="coord-input-hint">{error ? "Use lat, lon (−90…90, −180…180)" : "Enter to apply"}</span>
      </form>
    );
  }
  return (
    <button type="button" className="coord-edit" onClick={startEditing} title="Type exact coordinates">
      {point ? <Coordinates lat={point.lat} lon={point.lon} /> : <span>{placeholder}</span>}
      <span className="coord-edit-icon" aria-hidden="true">✎</span>
    </button>
  );
}

/** "18.4, 77.5", "18.4 77.5" or "18.4 N 77.5 W" → { lat, lon }; null if out of range or unreadable. */
export function parse(text) {
  const match = String(text).trim().match(/^(-?\d+(?:\.\d+)?)\s*°?\s*([NS])?[\s,]+(-?\d+(?:\.\d+)?)\s*°?\s*([EW])?$/i);
  if (!match) return null;
  let lat = Number(match[1]);
  let lon = Number(match[3]);
  if (match[2]?.toUpperCase() === "S") lat = -Math.abs(lat);
  if (match[4]?.toUpperCase() === "W") lon = -Math.abs(lon);
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon };
}
