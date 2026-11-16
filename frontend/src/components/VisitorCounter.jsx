// The site's visit count, shown in the header on every page like NASA's small "LIVE" tag: a mono number in an outline.
import { useEffect, useState } from "react";
import { loadVisitCount } from "../data/visitorCount.js";

const numberFormat = new Intl.NumberFormat("en-US");

export default function VisitorCounter() {
  const [count, setCount] = useState(null);

  useEffect(() => {
    let isCurrent = true;
    loadVisitCount().then((value) => {
      if (isCurrent) setCount(value);
    });
    return () => {
      isCurrent = false;
    };
  }, []);

  // While it loads, or if the counting service is down, nothing shows: a header is no place for an error.
  if (count === null) return null;
  const label = `${numberFormat.format(count)} ${count === 1 ? "visit" : "visits"}`;
  return (
    <p className="visit-count" title="Visits to this site so far">
      <span className="visit-count-dot" aria-hidden="true" />
      {label}
    </p>
  );
}
