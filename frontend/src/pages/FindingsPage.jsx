// Findings: the plan's one-page write-up of our top three discoveries, saying what matches, where the analogy breaks
// and how each place could help exploration. Built from discoveries.json, so it follows the published list.
import { Link } from "react-router-dom";
import FindingCard from "../components/FindingCard.jsx";
import { loadDiscoveries, loadTargets } from "../data/api.js";
import { useLoaded } from "../data/useLoaded.js";
import "../styles/findings.css";

const FINDINGS_COUNT = 3;

export default function FindingsPage() {
  const { data, error, isLoading } = useLoaded(() => Promise.all([loadDiscoveries(), loadTargets()]), []);

  return (
    <div className="findings-page">
      <header className="page-hero">
        <div className="page-hero-inner">
          <h1 className="page-title">Findings</h1>
          <p className="page-lede">
            Our top three discoveries: places on Earth that match the Moon or Mars well and sit far from every site already
            used for testing.
          </p>
          <p className="findings-hero-note">
            Built from the same published list as Discover, so it always shows the current top three.
          </p>
          <Link className="arrow-link findings-hero-link" to="/discover">See every candidate in Discover</Link>
        </div>
      </header>

      <div className="page-body">
        {isLoading && <p className="page-message" role="status">Loading the findings…</p>}
        {error && (
          <p className="page-message" role="alert">
            The findings didn't load ({error.message}). Check your connection, then reload the page.
          </p>
        )}
        {data && <FindingsList discoveries={data[0] ?? []} targets={data[1]} />}
      </div>
    </div>
  );
}

/** The top three places, best first, or a line saying none are published yet. */
function FindingsList({ discoveries, targets }) {
  const topFindings = pickTopFindings(discoveries);
  if (topFindings.length === 0) {
    return <p className="page-message">No discoveries have been published yet. Check back once the analysis has run.</p>;
  }

  return (
    <ol className="findings-list">
      {topFindings.map((finding) => {
        const target = targets.find((site) => site.target_id === finding.best_target_id && site.body !== "earth");
        return (
          <li key={finding.name}>
            <FindingCard finding={finding} target={target} />
          </li>
        );
      })}
    </ol>
  );
}

/** The best-ranked discoveries, one per place (the same place can rank for two targets). */
function pickTopFindings(discoveries) {
  const seenNames = new Set();
  return [...discoveries]
    .sort((first, second) => (first.rank ?? Infinity) - (second.rank ?? Infinity))
    .filter((discovery) => {
      if (seenNames.has(discovery.name)) return false;
      seenNames.add(discovery.name);
      return true;
    })
    .slice(0, FINDINGS_COUNT);
}
