// Site title shown on every page. The mode tabs were removed: the landing workspace is the whole app now, and the
// other pages stay reachable by link (e.g. "See all matches" opens Explore).
import { Link } from "react-router-dom";

export default function SiteHeader() {
  return (
    <header className="site-header">
      <Link className="site-title" to="/">Terrestrial Analog Finder</Link>
    </header>
  );
}
