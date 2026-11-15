// Page shell and routes: landing (two globes), Explore (search from any tile), Discover, Findings, Characterize and About. Each page loads on demand, so the globe (three.js) is only downloaded on pages that show one.
import { lazy, Suspense } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import SiteHeader from "./components/SiteHeader.jsx";
import RouteErrorBoundary from "./components/RouteErrorBoundary.jsx";
const LandingPage = lazy(() => import("./pages/LandingPage.jsx"));
const ExplorePage = lazy(() => import("./pages/ExplorePage.jsx"));
const CharacterizePage = lazy(() => import("./pages/CharacterizePage.jsx"));
const DiscoverPage = lazy(() => import("./pages/DiscoverPage.jsx"));
const FindingsPage = lazy(() => import("./pages/FindingsPage.jsx"));
const AboutPage = lazy(() => import("./pages/AboutPage.jsx"));

export default function App() {
  const { pathname } = useLocation();
  return (
    <>
      <a className="skip-link" href="#main">Skip to content</a>
      <SiteHeader />
      <main id="main" tabIndex={-1}>
        {/* The key gives the boundary a fresh start on every route change. */}
        <RouteErrorBoundary key={pathname}>
          <Suspense fallback={<p className="page-loading" role="status">Loading…</p>}>
            <Routes>
              <Route path="/" element={<LandingPage />} />
              <Route path="/explore" element={<Navigate to="/explore/mars" replace />} />
              <Route path="/explore/:body" element={<ExplorePage />} />
              {/* Older links to Find still work. */}
              <Route path="/find/*" element={<Navigate to="/explore/mars" replace />} />
              <Route path="/characterize" element={<CharacterizePage />} />
              <Route path="/discover" element={<DiscoverPage />} />
              <Route path="/findings" element={<FindingsPage />} />
              <Route path="/about" element={<AboutPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        </RouteErrorBoundary>
      </main>
    </>
  );
}
