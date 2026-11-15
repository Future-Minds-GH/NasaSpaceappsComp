// The clicked tile in plain words, read straight from its vector before any search finishes: its real values in the
// units of data/schema.json ("Night 170 K", "Slope 4°"). Factors with no data on this tile are left out.
import { FACTORS } from "../data/scoring.js";
import { describeFactorValue } from "../data/fieldValues.js";
import { FACTOR_LABELS } from "../content/labels.js";

export default function TileProfile({ vector, layout }) {
  if (!vector || !layout) return null;
  const rows = FACTORS.map((factor) => ({ factor, text: describeFactorValue(layout, factor, vector) })).filter((row) => row.text);
  if (rows.length === 0) return null;
  return (
    <section className="tile-profile" aria-label="What this tile is like">
      <h3 className="tile-profile-title">What this tile is like</h3>
      <ul className="tile-profile-list">
        {rows.map(({ factor, text }) => <li key={factor}><strong>{FACTOR_LABELS[factor]}:</strong> {text}</li>)}
      </ul>
    </section>
  );
}
