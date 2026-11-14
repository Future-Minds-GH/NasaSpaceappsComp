// Site title and the mode navigation shown on every page.
import { Link, useLocation } from "react-router-dom";

const MODES = [
  { path: "/explore/mars", section: "/explore", label: "Explore" },
  { path: "/discover", section: "/discover", label: "Discover" },
  { path: "/findings", section: "/findings", label: "Findings" },
  { path: "/characterize", section: "/characterize", label: "Characterize" },
  { path: "/about", section: "/about", label: "About" },
];

export default function SiteHeader() {
  const { pathname } = useLocation();

  return (
    <header className="site-header">
      <Link className="site-title" to="/">Terrestrial Analog Finder</Link>
      <nav className="site-nav" aria-label="Modes">
        {MODES.map((mode) => {
          // Explore links to Mars by default but stays marked as current on /explore/moon too.
          const isCurrent = pathname.startsWith(mode.section);
          return (
            <Link key={mode.section} to={mode.path} className="site-nav-link" aria-current={isCurrent ? "page" : undefined}>
              {mode.label}
            </Link>
          );
        })}
      </nav>
    </header>
  );
}
