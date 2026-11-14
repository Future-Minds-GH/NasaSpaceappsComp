// Footer on every page: imagery credits, plus a note while the site still runs on Role 2's sample files.
import { useSyncExternalStore } from "react";
import { Link } from "react-router-dom";
import { getIsShowingSampleData, subscribeToSampleFlag } from "../data/api.js";

export default function SiteFooter() {
  const isShowingSampleData = useSyncExternalStore(subscribeToSampleFlag, getIsShowingSampleData);

  return (
    <footer className="site-footer">
      {isShowingSampleData && (
        <p className="sample-data-note" role="status">
          Showing sample data. Scores and matches are placeholders until the team's results are published.
        </p>
      )}
      <p className="site-footer-lead">Built for the 2026 NASA Space Apps Challenge.</p>
      <p>
        Imagery: NASA Moon Trek and Mars Trek, NASA GIBS, and Copernicus Sentinel-2 cloudless by EOX (ESA data).
        Full data credits are on the <Link to="/about">About</Link> page.
      </p>
    </footer>
  );
}
