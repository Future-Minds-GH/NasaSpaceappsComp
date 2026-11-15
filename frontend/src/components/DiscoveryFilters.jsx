// Discover filters (Moon or Mars, habitability/process tag) as labelled native selects, plus the matching rules.
import { BODY_NAMES } from "../content/labels.js";

const SHOW_ALL = "all";
const FILTERABLE_BODIES = ["moon", "mars"];
const FILTER_FIELDS = [
  { key: "body", label: "Moon or Mars" },
  { key: "tag", label: "Tag" },
];

export const NO_FILTERS = { body: SHOW_ALL, tag: SHOW_ALL };

/**
 * @param {{ filters: typeof NO_FILTERS, optionsByFilter: Record<string, {value: string, label: string}[]>,
 *           onChange: (nextFilters: typeof NO_FILTERS) => void }} props
 */
export default function DiscoveryFilters({ filters, optionsByFilter, onChange }) {
  return (
    <div className="discover-filters">
      {/* A filter with no choices (no tags in the data) would show only "All": leave it out. */}
      {FILTER_FIELDS.filter(({ key }) => optionsByFilter[key].length > 0).map(({ key, label }) => (
        <div className="discover-filter" key={key}>
          <label className="control-label" htmlFor={`discover-filter-${key}`}>{label}</label>
          <select
            id={`discover-filter-${key}`}
            className="select"
            value={filters[key]}
            onChange={(event) => onChange({ ...filters, [key]: event.target.value })}
          >
            <option value={SHOW_ALL}>All</option>
            {optionsByFilter[key].map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </div>
      ))}
    </div>
  );
}

/** Choices for each filter: both bodies, and only the tags that appear in the list. */
export function buildFilterOptions(candidates) {
  const tags = [...new Set(candidates.flatMap((candidate) => candidate.tags ?? []))].sort();
  return {
    body: FILTERABLE_BODIES.map((body) => ({ value: body, label: BODY_NAMES[body] })),
    tag: tags.map((tag) => ({ value: tag, label: tag.charAt(0).toUpperCase() + tag.slice(1) })),
  };
}

/** Candidates that pass every filter, in the order they came in (the live ranking). */
export function filterCandidates(candidates, filters, targetsById) {
  return candidates.filter((candidate) => {
    const body = candidate.body ?? targetsById[candidate.best_target_id]?.body;
    return (
      (filters.body === SHOW_ALL || body === filters.body) &&
      (filters.tag === SHOW_ALL || (candidate.tags ?? []).includes(filters.tag))
    );
  });
}
