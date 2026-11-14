// Mission preset choice (from weights.json) as a segmented control built on real radio buttons,
// so arrow keys move between presets without extra code.
export default function PresetPicker({ presets, selectedPresetId, onSelect, name = "preset" }) {
  return (
    <fieldset className="preset-picker">
      <legend className="control-label">Mission type</legend>
      <div className="segmented">
        {Object.entries(presets).map(([presetId, preset]) => (
          <label className="segmented-option" key={presetId} title={preset.description}>
            <input
              type="radio"
              name={name}
              value={presetId}
              checked={presetId === selectedPresetId}
              onChange={() => onSelect(presetId)}
            />
            <span>{preset.label ?? presetId}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
