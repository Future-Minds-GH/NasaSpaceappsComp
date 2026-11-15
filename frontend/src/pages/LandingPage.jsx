// Landing page: one black hero, NASA-style. The promise and the headline action (Discover, as plan v2.1 asks) sit
// above the Moon and Mars as two spinning globes that grow on hover; picking one opens Explore on that body.
import { Link } from "react-router-dom";
import { BODY_NAMES } from "../content/labels.js";
import PlanetGlobe from "../components/PlanetGlobe.jsx";
import "../styles/landing.css";

const PLANETS = [
  { body: "moon", eyebrow: "Lunar surface", sentence: "Craters, basalt plains and ice in the south pole's never-sunlit craters." },
  { body: "mars", eyebrow: "Martian surface", sentence: "Dry riverbeds, giant volcanoes, buried ice and dust storms." },
];

export default function LandingPage() {
  return (
    <div className="landing">
      <section className="landing-hero" aria-labelledby="landing-title">
        <header className="landing-intro">
          <h1 id="landing-title" className="page-title">Which places on Earth are most like the Moon and Mars?</h1>
          <p className="page-lede">
            Astronauts and rovers practise on Earth first. We rank all of Earth's land against any spot you pick on the
            Moon or Mars, explain every score, and point out strong test sites nobody has catalogued yet.
          </p>
          <div className="landing-actions">
            <Link className="button button-primary" to="/discover">See new analog candidates</Link>
            <Link className="button button-on-space" to="/explore/earth">Start from a place on Earth</Link>
          </div>
        </header>

        <div className="landing-planets">
          <h2 id="landing-planets-heading" className="visually-hidden">Pick the Moon or Mars</h2>
          <ul className="landing-planet-list">
            {PLANETS.map((planet) => (
              <li key={planet.body}>
                <Link className={`landing-planet landing-planet-${planet.body}`} to={`/explore/${planet.body}`}>
                  <span className="landing-planet-globe">
                    <PlanetGlobe body={planet.body} isSpinning label={`Spinning globe of ${BODY_NAMES[planet.body]}`} />
                  </span>
                  <span className="eyebrow landing-planet-eyebrow">{planet.eyebrow}</span>
                  <span className="landing-planet-name">{BODY_NAMES[planet.body]}</span>
                  <span className="landing-planet-sentence">{planet.sentence}</span>
                  <span className="arrow-link landing-planet-action">Click anywhere on {planet.body === "moon" ? "the Moon" : "Mars"}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </div>
  );
}
