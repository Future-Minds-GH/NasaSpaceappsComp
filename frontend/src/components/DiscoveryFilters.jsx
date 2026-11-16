// Discover filter (Moon or Mars) as a labelled native select, plus its matching rule.
import { BODY_NAMES } from "../content/labels.js";

const SHOW_ALL = "all";
const FILTERABLE_BODIES = ["moon", "mars"];

export const NO_FILTERS = { body: SHOW_ALL };

export default function DiscoveryFilters({ filters, onChange }) {
  return (
    <div className="discover-filters">
      <div className="discover-filter">
        <label className="control-label" htmlFor="discover-filter-body">Moon or Mars</label>
        <select id="discover-filter-body" className="select" value={filters.body} onChange={(event) => onChange({ ...filters, body: event.target.value })}>
          <option value={SHOW_ALL}>All</option>
          {FILTERABLE_BODIES.map((body) => <option key={body} value={body}>{BODY_NAMES[body]}</option>)}
        </select>
      </div>
    </div>
  );
}

/** Candidates that pass the filter, in the order they came in (the live ranking). */
export function filterCandidates(candidates, filters, targetsById) {
  return candidates.filter((candidate) => filters.body === SHOW_ALL || (candidate.body ?? targetsById[candidate.best_target_id]?.body) === filters.body);
}
