// Black header bar on every page: the site name (home, the comparison workspace), links to the other pages and the
// visit count.
import { Link, NavLink } from "react-router-dom";
import VisitorCounter from "./VisitorCounter.jsx";

const PAGES = [
  { path: "/discover", label: "Discover" },
  { path: "/characterize", label: "Characterize" },
  { path: "/findings", label: "Findings" },
  { path: "/about", label: "About" },
];

export default function SiteHeader() {
  return (
    <header className="site-header">
      <Link className="site-title" to="/">
        <SiteMark />
        Terrestrial Analog Finder
      </Link>
      <div className="site-header-end">
        <nav className="site-nav" aria-label="Pages">
          {/* NavLink marks the current page with aria-current="page", which the CSS underlines in red. */}
          {PAGES.map((page) => (
            <NavLink key={page.path} to={page.path} className="site-nav-link">{page.label}</NavLink>
          ))}
        </nav>
        <VisitorCounter />
      </div>
    </header>
  );
}

/** Two overlapping worlds: a place on Earth standing in for a place on another body. */
function SiteMark() {
  return (
    <svg className="site-mark" viewBox="0 0 30 20" aria-hidden="true">
      <circle cx="10" cy="10" r="7.5" fill="currentColor" />
      <circle cx="20" cy="10" r="7.5" fill="none" stroke="#D83933" strokeWidth="2" />
    </svg>
  );
}
