// Absolute / Relative: how the factors are compared. A two-way segmented control on real radio buttons, with the
// one-sentence meaning of the chosen mode underneath.
import { MODE_INFO } from "../content/labels.js";
import { MODES } from "../data/similarity.js";

export default function ModeToggle({ mode, onChange, name = "score-mode" }) {
  const sentenceId = `${name}-sentence`;
  return (
    <fieldset className="mode-toggle" aria-describedby={sentenceId}>
      <legend className="control-label">How to compare</legend>
      <div className="segmented">
        {MODES.map((id) => (
          <label className="segmented-option" key={id}>
            <input type="radio" name={name} value={id} checked={id === mode} onChange={() => onChange(id)} />
            <span>{MODE_INFO[id].label}</span>
          </label>
        ))}
      </div>
      <p id={sentenceId} className="mode-toggle-sentence">{MODE_INFO[mode]?.sentence}</p>
    </fieldset>
  );
}
