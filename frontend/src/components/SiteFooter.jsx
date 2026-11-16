// Footer on every page: who built the site, the imagery credits (Sentinel-2 cloudless by EOX asks for visible
// attribution), a link to the full data credits, and the sample-data warning when it applies.
import { useSyncExternalStore } from "react";
import { Link } from "react-router-dom";
import { getIsShowingSampleData, subscribeToSampleFlag } from "../data/api.js";

export default function SiteFooter() {
  const isShowingSampleData = useSyncExternalStore(subscribeToSampleFlag, getIsShowingSampleData);

  return (
    <footer className="site-footer">
      <div className="site-footer-inner">
        <div className="site-footer-text">
          {isShowingSampleData && (
            <p className="sample-data-note" role="status">Showing sample data. Scores are placeholders until the team's results are published.</p>
          )}
          <p className="site-footer-lead">Built for the 2026 NASA Space Apps Challenge.</p>
          <p>
            Imagery: NASA GIBS, NASA Moon Trek and Mars Trek, and Sentinel-2 cloudless by EOX (contains modified Copernicus
            Sentinel data). <Link to="/about">Data credits and method</Link>
          </p>
        </div>
      </div>
    </footer>
  );
}
