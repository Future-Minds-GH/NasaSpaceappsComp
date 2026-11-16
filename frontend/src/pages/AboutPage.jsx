// About page: the method in plain sentences with the five scored factors, the validation tests, Role 3's model check and
// comparison figures (each shown once published), data credits and the team.
import { loadValidation } from "../data/api.js";
import { useLoaded } from "../data/useLoaded.js";
import { ValidationSummary } from "../components/ValidationGrid.jsx";
import ModelCheck from "../components/ModelCheck.jsx";
import { DATA_CREDITS, FIGURES, LOW_SCORE_NOTE, FULL_CREDITS_NOTE, METHOD_STAGES, TEAM_ROLES } from "../content/about.js";
import { FACTOR_LABELS, FACTOR_MEANINGS } from "../content/labels.js";
import "../styles/about.css";

export default function AboutPage() {
  return (
    <div className="about-page">
      <header className="page-hero">
        <div className="page-hero-inner">
          <h1 className="page-title">How it works</h1>
          <p className="page-lede">
            How the site scores Earth against the Moon and Mars, how we checked that the scores make sense, and whose
            data it is built on.
          </p>
        </div>
      </header>

      <div className="page-body">
        <section className="page-section" aria-labelledby="about-method-heading">
          <h2 id="about-method-heading" className="section-heading">The method</h2>
          <ol className="about-stages">
            {METHOD_STAGES.map((stage, index) => (
              <li key={stage.title} className="about-stage">
                <h3 className="about-stage-title">
                  <span className="about-stage-number">{index + 1}</span> {stage.title}
                </h3>
                <div className="about-stage-text">
                  {stage.sentences.map((sentence) => <p key={sentence}>{sentence}</p>)}
                  {stage.factors && <FactorList factors={stage.factors} />}
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section className="page-section" aria-labelledby="about-validation-heading">
          <h2 id="about-validation-heading" className="section-heading">Does it work?</h2>
          <p className="section-lede">
            Ranking extreme places high is easy. The real test is picking the right analog for each target: the Mars
            training sites (Devon Island, the McMurdo Dry Valleys, the Atacama) should rank high for Mars targets, and the
            volcanic Moon training sites (Askja, Mauna Kea, Mauna Loa) for Moon targets. Preset weights were set by
            judgement before this check was run, not tuned on it.
          </p>
          <ValidationResult />
          <div className="about-note">
            <h3 className="about-subheading">Why Moon and Mars scores look low</h3>
            <p>{LOW_SCORE_NOTE.join(" ")}</p>
          </div>
        </section>

        <ModelCheck />

        {FIGURES.length > 0 && (
          <section className="page-section" aria-labelledby="about-figures-heading">
            <h2 id="about-figures-heading" className="section-heading">Comparison figures</h2>
            <FigureGallery figures={FIGURES} />
          </section>
        )}

        <section className="page-section" aria-labelledby="about-credits-heading">
          <h2 id="about-credits-heading" className="section-heading">Data credits</h2>
          <div className="about-credits">
            {DATA_CREDITS.map((group) => (
              <div key={group.agency} className="about-credit-group">
                <h3 className="about-subheading">{group.agency}</h3>
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
          <p className="about-small-print">{FULL_CREDITS_NOTE}</p>
        </section>

        <section className="page-section" aria-labelledby="about-team-heading">
          <h2 id="about-team-heading" className="section-heading">The team</h2>
          <ul className="about-team">
            {TEAM_ROLES.map((teamRole) => (
              <li key={teamRole.name} className="about-team-role">
                <p className="about-team-number">{teamRole.role}</p>
                <h3 className="about-subheading">{teamRole.name}</h3>
                <p className="about-team-work">{teamRole.work}</p>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}

/** The scored factors, each with its colour dot (the same as on the sliders and bars) and what it measures. */
function FactorList({ factors }) {
  return (
    <ul className="about-factor-list">
      {factors.map((factor) => (
        <li key={factor} className="about-factor" style={{ "--factor-color": `var(--factor-${factor})` }}>
          <span className="factor-swatch" aria-hidden="true" />
          <span className="about-factor-name">{FACTOR_LABELS[factor]}</span>
          <span className="about-factor-meaning">{FACTOR_MEANINGS[factor]}</span>
        </li>
      ))}
    </ul>
  );
}

/** validation.json's headline number, four tests and grid, with loading and error lines. */
function ValidationResult() {
  const { data: validation, error, isLoading } = useLoaded(() => loadValidation(), []);

  if (isLoading) return <p className="about-small-print" role="status">Loading the validation check…</p>;
  if (error) {
    return <p className="about-small-print" role="alert">The validation check could not be loaded. Check your connection and reload the page.</p>;
  }
  return <ValidationSummary validation={validation} />;
}

/** Role 3's figures from content/about.js, square-cornered with a caption under each. */
function FigureGallery({ figures }) {
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
