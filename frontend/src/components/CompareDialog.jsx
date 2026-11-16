// Side-by-side view of the picked place and one match, with what Earth can't reproduce when one of the two is on Earth.
// Uses the native <dialog>, which gives focus trapping, Escape to close and a backdrop for free. It is always dark, like
// an image viewer, so it carries .theme-space.
import { useEffect, useRef } from "react";
import { BODY_NAMES } from "../content/labels.js";
import { formatCoordinates } from "../data/format.js";
import BodySnapshot from "./BodySnapshot.jsx";

export default function CompareDialog({ target, match, onClose }) {
  const dialogRef = useRef(null);
  const matchName = match ? match.name ?? formatCoordinates(match.lat, match.lon) : "";
  const matchBody = match?.body ?? "earth";
  // The reality gap lists what Earth lacks of the Moon or Mars, so it only applies when one of the two places is on Earth.
  const realityGap = target.body === "earth" || matchBody === "earth" ? target.reality_gap ?? [] : [];

  useEffect(() => {
    const dialog = dialogRef.current;
    if (match && !dialog.open) dialog.showModal();
    if (!match && dialog.open) dialog.close();
  }, [match]);

  return (
    <dialog ref={dialogRef} className="compare-dialog theme-space" onClose={onClose} aria-labelledby="compare-title">
      {match && (
        <>
          <header className="compare-header">
            <h2 id="compare-title" className="compare-title">{capitalize(target.name)} and {matchName}</h2>
            <button className="button button-quiet" type="button" onClick={onClose}>Close</button>
          </header>

          <div className="compare-pair">
            <figure className="compare-side">
              {target.image_url ? (
                <img src={target.image_url} alt={`Orbital view of ${target.name}`} />
              ) : (
                <BodySnapshot body={target.body} lat={target.lat} lon={target.lon} label={`Map of ${target.name}`} />
              )}
              <figcaption>
                {/* A picked spot's name already says which body it is on. */}
                <strong>{target.track === "picked" ? capitalize(target.name) : `${target.name}, ${BODY_NAMES[target.body]}`}</strong>
                <span>{formatCoordinates(target.lat, target.lon)}</span>
              </figcaption>
            </figure>
            <figure className="compare-side">
              {match.image_url ? (
                <img src={match.image_url} alt={`Satellite view of ${matchName}`} />
              ) : matchBody !== "earth" ? (
                <BodySnapshot body={matchBody} lat={match.lat} lon={match.lon} label={`Map of ${matchName}`} />
              ) : (
                <div className="match-photo-missing">No photo for this spot yet</div>
              )}
              <figcaption>
                <strong>{matchName}, {BODY_NAMES[matchBody]}</strong>
                <span>{formatCoordinates(match.lat, match.lon)}</span>
              </figcaption>
            </figure>
          </div>

          {match.figure_url && (
            <figure className="compare-figure">
              <img src={match.figure_url} alt={`Ground comparison of ${target.name} and ${matchName}`} />
              <figcaption>Ground shape compared from elevation data.</figcaption>
            </figure>
          )}

          {realityGap.length > 0 && (
            <section className="reality-gap" aria-labelledby="reality-gap-title">
              <h3 id="reality-gap-title" className="reality-gap-title">What Earth can't reproduce</h3>
              <ul className="reality-gap-list">
                {realityGap.map((gap) => <li key={gap}>{gap}</li>)}
              </ul>
            </section>
          )}
        </>
      )}
    </dialog>
  );
}

const capitalize = (text) => text.charAt(0).toUpperCase() + text.slice(1);
