// About page: the method in plain sentences, the validation tests, Role 3's model check and comparison figures, data
// credits and the team.
import { loadValidation } from "../data/api.js";
import { useLoaded } from "../data/useLoaded.js";
import { ValidationSummary } from "../components/ValidationGrid.jsx";
import ModelCheck from "../components/ModelCheck.jsx";
import { DATA_CREDITS, FIGURES, LOW_SCORE_NOTE, FULL_CREDITS_NOTE, METHOD_STAGES, TEAM_ROLES } from "../content/about.js";
import "../styles/about.css";

export default function AboutPage() {
  return (
    <div className="page about">
      <header>
        <h1 className="page-title">How it works</h1>
        <p className="page-lede">
          How the site scores Earth against the Moon and Mars, how we checked that the scores make sense, and whose
          data it is built on.
        </p>
      </header>

      <section className="about-section" aria-labelledby="about-method-heading">
        <h2 id="about-method-heading" className="section-heading">The method</h2>
        <div className="about-stages">
          {METHOD_STAGES.map((stage) => (
            <div key={stage.title} className="about-stage">
              <h3 className="about-stage-title">{stage.title}</h3>
              <div className="about-stage-text">
                {stage.sentences.map((sentence) => (
                  <p key={sentence}>{sentence}</p>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="about-section" aria-labelledby="about-validation-heading">
        <h2 id="about-validation-heading" className="section-heading">Does it work?</h2>
        <p className="about-text">
          Ranking extreme places high is easy. The real test is picking the right analog for each target: icy Devon
          Island and Svalbard should beat the dry Atacama for Mars ice targets, and the reverse for dry lake beds like
          Jezero and Gale. Preset weights were set by judgement before this check was run, not tuned on it.
        </p>
        <ValidationResult />
        <h3 className="about-stage-title">Why Moon and Mars scores look low</h3>
        <p className="about-text">{LOW_SCORE_NOTE.join(" ")}</p>
      </section>

      <ModelCheck />

      <section className="about-section" aria-labelledby="about-figures-heading">
        <h2 id="about-figures-heading" className="section-heading">Comparison figures</h2>
        <FigureGallery figures={FIGURES} />
      </section>

      <section className="about-section" aria-labelledby="about-credits-heading">
        <h2 id="about-credits-heading" className="section-heading">Data credits</h2>
        <div className="about-credits">
          {DATA_CREDITS.map((group) => (
            <div key={group.agency} className="about-credit-group">
              <h3 className="about-credit-agency">{group.agency}</h3>
              <ul className="about-credit-list">
                {group.datasets.map((dataset) => (
                  <li key={dataset.name}>
                    <span className="about-credit-name">{dataset.name}</span>
                    <span className="about-credit-about">{dataset.about}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <p className="about-text">{FULL_CREDITS_NOTE}</p>
      </section>

      <section className="about-section" aria-labelledby="about-team-heading">
        <h2 id="about-team-heading" className="section-heading">The team</h2>
        <ul className="about-team">
          {TEAM_ROLES.map((teamRole) => (
            <li key={teamRole.name} className="about-team-role">
              <h3 className="about-team-name">
                {teamRole.name} <span className="about-team-number">{teamRole.role}</span>
              </h3>
              <p>{teamRole.work}</p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

/** validation.json's headline number, four tests and grid, with loading and error lines. */
function ValidationResult() {
  const { data: validation, error, isLoading } = useLoaded(() => loadValidation(), []);

  if (isLoading) return <p className="about-text" role="status">Loading the validation check…</p>;
  if (error) {
    return <p className="about-text" role="alert">The validation check could not be loaded. Check your connection and reload the page.</p>;
  }
  return <ValidationSummary validation={validation} />;
}

/** Role 3's figures from content/about.js, or one line saying they are still to come. */
function FigureGallery({ figures }) {
  if (figures.length === 0) return <p className="about-text">Comparison figures will appear here.</p>;

  return (
    <div className="about-figures">
      {figures.map((figure) => (
        <figure key={figure.file} className="about-figure">
          <img src={`${import.meta.env.BASE_URL}figures/${figure.file}`} alt={figure.caption ?? ""} loading="lazy" decoding="async" />
          {figure.caption && <figcaption>{figure.caption}</figcaption>}
        </figure>
      ))}
    </div>
  );
}
