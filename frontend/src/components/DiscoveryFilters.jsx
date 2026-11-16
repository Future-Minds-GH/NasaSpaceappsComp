// Discover's filters: Moon or Mars as a segmented control on real radio buttons (arrow keys move between them), a tag
// select when the list has tags, and the rules that apply them.
import { BODY_NAMES } from "../content/labels.js";

const SHOW_ALL = "all";
const FILTERABLE_BODIES = ["moon", "mars"];

export const NO_FILTERS = { body: SHOW_ALL, tag: SHOW_ALL };

/**
 * @param {{ filters: typeof NO_FILTERS, optionsByFilter: Record<string, {value: string, label: string}[]>,
 *           onChange: (nextFilters: typeof NO_FILTERS) => void }} props
 */
export default function DiscoveryFilters({ filters, optionsByFilter, onChange }) {
  const changeFilter = (key, value) => onChange({ ...filters, [key]: value });

  return (
    <div className="discover-filters">
      <fieldset className="discover-filter">
        <legend className="control-label">Moon or Mars</legend>
        <div className="segmented">
          {[{ value: SHOW_ALL, label: "Both" }, ...optionsByFilter.body].map((option) => (
            <label className="segmented-option" key={option.value}>
              <input
                type="radio"
                name="discover-filter-body"
                value={option.value}
                checked={filters.body === option.value}
                onChange={() => changeFilter("body", option.value)}
              />
              <span>{option.label}</span>
            </label>
          ))}
        </div>
      </fieldset>

      {/* A tag select with no tags in the data would only offer "All": leave it out. */}
      {optionsByFilter.tag.length > 0 && (
        <div className="discover-filter">
          <label className="control-label" htmlFor="discover-filter-tag">Tag</label>
          <select
            id="discover-filter-tag"
            className="select"
            value={filters.tag}
            onChange={(event) => changeFilter("tag", event.target.value)}
          >
            <option value={SHOW_ALL}>All</option>
            {optionsByFilter.tag.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </div>
      )}
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
