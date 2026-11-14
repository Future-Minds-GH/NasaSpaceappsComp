// Tabs at the top of the results: the two bodies you didn't pick. Each tab shows that body's best matches for the
// picked tile. Built on the ARIA tabs pattern: arrow keys, Home and End move between tabs and select them.
import { useRef } from "react";
import { BODY_NAMES } from "../content/labels.js";
import { GLOBE_TEXTURES } from "./PlanetGlobe.jsx";

export const RESULTS_PANEL_ID = "explore-results-panel";

export default function ResultBodyTabs({ bodies, selectedBody, onSelect }) {
  const tabRefs = useRef({});

  function handleKeyDown(event, index) {
    const moves = { ArrowRight: index + 1, ArrowLeft: index - 1, Home: 0, End: bodies.length - 1 };
    if (!(event.key in moves)) return;
    event.preventDefault();
    const nextBody = bodies[(moves[event.key] + bodies.length) % bodies.length];
    onSelect(nextBody);
    tabRefs.current[nextBody]?.focus();
  }

  return (
    <div className="result-tabs" role="tablist" aria-label="Show matches from">
      {bodies.map((body, index) => {
        const isSelected = body === selectedBody;
        return (
          <button
            key={body}
            ref={(element) => { tabRefs.current[body] = element; }}
            type="button"
            role="tab"
            id={`result-tab-${body}`}
            aria-selected={isSelected}
            aria-controls={RESULTS_PANEL_ID}
            tabIndex={isSelected ? 0 : -1}
            className={`result-tab result-tab-${body}`}
            onClick={() => onSelect(body)}
            onKeyDown={(event) => handleKeyDown(event, index)}
          >
            <span className="result-tab-globe" style={{ backgroundImage: `url(${GLOBE_TEXTURES[body].url})` }} aria-hidden="true" />
            Matches on {body === "moon" ? "the Moon" : BODY_NAMES[body]}
          </button>
        );
      })}
    </div>
  );
}
