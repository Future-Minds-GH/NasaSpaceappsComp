// Page shell and routes: landing (two globes), Explore (search from any tile), Discover, Findings, Characterize and About.
import { Navigate, Route, Routes } from "react-router-dom";
import SiteHeader from "./components/SiteHeader.jsx";
import LandingPage from "./pages/LandingPage.jsx";
import ExplorePage from "./pages/ExplorePage.jsx";
import CharacterizePage from "./pages/CharacterizePage.jsx";
import DiscoverPage from "./pages/DiscoverPage.jsx";
import FindingsPage from "./pages/FindingsPage.jsx";
import AboutPage from "./pages/AboutPage.jsx";

export default function App() {
  return (
    <>
      <a className="skip-link" href="#main">Skip to content</a>
      <SiteHeader />
      <main id="main" tabIndex={-1}>
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
      </main>
    </>
  );
}
