// Absolute / Relative: how the factors are compared. Two real radio buttons, each with its one-sentence meaning.
import { MODE_INFO } from "../content/labels.js";
import { MODES } from "../data/similarity.js";

export default function ModeToggle({ mode, onChange, name = "score-mode" }) {
  return (
    <fieldset className="mode-toggle">
      <legend className="control-label">How to compare</legend>
      {MODES.map((id) => (
        <label className="mode-toggle-option" key={id}>
          <input type="radio" name={name} value={id} checked={id === mode} onChange={() => onChange(id)} />
          <strong>{MODE_INFO[id].label}</strong>
          <span>{MODE_INFO[id].sentence}</span>
        </label>
      ))}
    </fieldset>
  );
}
