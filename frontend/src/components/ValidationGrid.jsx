// The "Does it work?" results from validation.json: the headline number, the plan's four tests (recall, specificity,
// baseline, hard negatives) each with its verdict in words, and the grid asking whether each Moon/Mars target ranks
// the RIGHT known analogs highest. validation.json: { value, out_of, summary, tests: [{ id, name, result, passed }],
// specificity: { analogs: ["Devon Island", …], rows: [{ target: "Arcadia Planitia", expected: ["Devon Island"], ranks: [98.1, …] }] } }

/** Verdict words, so a test's result never depends on colour alone. */
const VERDICTS = {
  passed: { className: "is-passed", label: "Passed" },
  failed: { className: "is-failed", label: "Not passed" },
  pending: { className: "is-pending", label: "Not run yet" },
};

/** Everything validation.json holds, or one line saying it is still to come; copes with any field missing. */
export function ValidationSummary({ validation }) {
  const value = readNumber(validation?.value);
  const outOf = readNumber(validation?.out_of);
  const summary = typeof validation?.summary === "string" ? validation.summary.trim() : "";
  const tests = Array.isArray(validation?.tests) ? validation.tests : [];

  if (value === null && !summary && tests.length === 0) {
    return <p className="about-small-print">The validation check has not been published yet. It will appear here once the team's results are in.</p>;
  }

  return (
    <>
      {(value !== null || summary) && (
        <div className="validation-headline">
          {value !== null && (
            <p className="stat-value validation-number">
              {value}
              {outOf !== null && <span className="validation-out-of"> of {outOf}</span>}
            </p>
          )}
          {summary && <p className="validation-summary">{summary}</p>}
        </div>
      )}
      <ValidationTests tests={tests} />
      <ValidationGrid specificity={validation?.specificity} />
    </>
  );
}

/** The plan's tests as a short list, each with "Passed", "Not passed" or "Not run yet" written out. */
function ValidationTests({ tests }) {
  if (tests.length === 0) return null;
  const passedCount = tests.filter((test) => test.passed === true).length;

  return (
    <div className="validation-tests">
      <h3 className="about-subheading">{passedCount} of {tests.length} tests passed</h3>
      <ul className="validation-test-list">
        {tests.map((test) => {
          const verdict = VERDICTS[describeVerdict(test.passed)];
          return (
            <li key={test.id ?? test.name} className={`validation-test ${verdict.className}`}>
              <span className="validation-test-verdict">{verdict.label}</span>
              <div className="validation-test-text">
                <p className="validation-test-name">{test.name}</p>
                {test.result && <p className="validation-test-result">{test.result}</p>}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * One row per known analog and one column per Moon/Mars target (five columns fit the page; nine analog columns did not),
 * each cell that analog's Earth rank: the share of Earth it beats. The table scrolls inside its frame on phones.
 */
export default function ValidationGrid({ specificity }) {
  if (!specificity?.rows?.length) return null;
  const targets = specificity.rows;

  return (
    <div className="validation-grid-scroll" role="region" aria-labelledby="validation-grid-caption" tabIndex={0}>
      <table className="validation-grid">
        <caption id="validation-grid-caption">
          Earth rank of each known analog for each target: the share of Earth's land it beats, higher is a better match.
          Outlined cells are the analogs that should win.
        </caption>
        <thead>
          <tr>
            <th scope="col">Known analog</th>
            {targets.map((target) => <th scope="col" key={target.target}>{target.target}</th>)}
          </tr>
        </thead>
        <tbody>
          {specificity.analogs.map((analog, analogIndex) => (
            <tr key={analog}>
              <th scope="row">{analog}</th>
              {targets.map((target) => {
                const rank = target.ranks?.[analogIndex];
                const isExpected = Boolean(target.expected?.includes(analog));
                return (
                  <td key={target.target} className={isExpected ? "is-expected" : undefined} style={{ "--rank": typeof rank === "number" ? rank / 100 : 0 }}>
                    {typeof rank === "number" ? `${Math.round(rank)}%` : "n/a"}
                    {isExpected && <span className="visually-hidden"> (should win)</span>}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A test's `passed` flag as a verdict key; anything other than true or false means it has not been run. */
function describeVerdict(passed) {
  if (passed === true) return "passed";
  if (passed === false) return "failed";
  return "pending";
}

/** A finite number from a number or numeric string, otherwise null. */
function readNumber(rawValue) {
  if (typeof rawValue === "number") return Number.isFinite(rawValue) ? rawValue : null;
  if (typeof rawValue === "string" && rawValue.trim() !== "") {
    const parsed = Number(rawValue);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}
