// A short "What Earth cannot match" list for a Moon or Mars site, shown with every Earth analog result.
import { EARTH_LIMITS, LIMITS_TITLE } from "../content/limits.js";

export default function LimitsList({ body, className = "limits-list" }) {
  const limits = EARTH_LIMITS[body];
  if (!limits) return null;
  return (
    <div className={className}>
      <p className="limits-list-title">{LIMITS_TITLE}</p>
      <ul className="limits-list-items">
        {limits.map((limit) => <li key={limit}>{limit}</li>)}
      </ul>
    </div>
  );
}
