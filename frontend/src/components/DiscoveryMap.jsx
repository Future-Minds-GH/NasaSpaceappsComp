// Discover's map: one pin per listed candidate, coloured by the body it stands in for, with the selected pin enlarged
// and labelled, plus the colour legend and a line describing the selection. It sits on Discover's black stage.
import { CircleMarker, LayerGroup, Tooltip } from "react-leaflet";
import EarthMap from "./EarthMap.jsx";
import { BODY_NAMES } from "../content/labels.js";

const PIN_RADIUS = 7;
const SELECTED_PIN_RADIUS = 10;
const LEGEND_BODIES = ["moon", "mars"];

export default function DiscoveryMap({ pins, selectedCandidate, selectedId, isSelectedListed, targetsById, focus, onSelectPin }) {
  return (
    <>
      <EarthMap focus={focus} label="Map of the candidate places in the list">
        {/* Leaflet can't restyle or restack pins in place, so a new order or selection redraws the whole group. */}
        <LayerGroup key={`${selectedId}|${pins.map((candidate) => candidate.published_rank).join(" ")}`}>
          {pins.map((candidate) => {
            const isSelected = candidate === selectedCandidate;
            const body = candidate.body ?? targetsById[candidate.best_target_id]?.body;
            return (
              <CircleMarker
                key={candidate.published_rank}
                center={[candidate.lat, candidate.lon]}
                radius={isSelected ? SELECTED_PIN_RADIUS : PIN_RADIUS}
                pathOptions={{
                  className: `discover-pin${body ? ` discover-for-${body}` : ""}${isSelected ? " is-selected" : ""}`,
                  weight: isSelected ? 3 : 2,
                  fillOpacity: 1,
                }}
                eventHandlers={{ click: () => onSelectPin(candidate.published_rank) }}
              >
                <Tooltip direction="top" offset={[0, -8]} permanent={isSelected}>{`${candidate.name} (rank ${candidate.rank})`}</Tooltip>
              </CircleMarker>
            );
          })}
        </LayerGroup>
      </EarthMap>
      <div className="discover-map-notes">
        <ul className="discover-legend" aria-label="Pin colours">
          {LEGEND_BODIES.map((body) => (
            <li key={body} className={`discover-for-${body}`}>{BODY_NAMES[body]} match</li>
          ))}
        </ul>
        <p className="discover-selection" aria-live="polite">
          {selectedCandidate
            ? `Selected: ${selectedCandidate.name}, rank ${selectedCandidate.rank}.${isSelectedListed ? " It is highlighted in the list." : ""}`
            : "Pins show the places in the list below. Select a pin or a place name to see it in both."}
        </p>
      </div>
    </>
  );
}

/** Worst rank first so better candidates sit on top where pins overlap, and the selected pin on top of everything. */
export function inDrawOrder(candidates, selectedCandidate) {
  const others = candidates.filter((candidate) => candidate !== selectedCandidate).reverse();
  return selectedCandidate ? [...others, selectedCandidate] : others;
}
