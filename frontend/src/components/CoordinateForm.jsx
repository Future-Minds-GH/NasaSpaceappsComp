// Keyboard alternative to clicking the Earth map: type a latitude and longitude in decimal degrees.

export default function CoordinateForm({ onSubmit }) {
  function handleSubmit(event) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    onSubmit(Number(fields.get("lat")), Number(fields.get("lon")));
  }

  return (
    <form className="characterize-coordinates" onSubmit={handleSubmit} aria-describedby="characterize-coordinates-hint">
      <label className="characterize-coordinate-field">
        <span className="control-label">Latitude</span>
        <input className="text-input" name="lat" type="number" min="-90" max="90" step="any" placeholder="-24.1" required />
      </label>
      <label className="characterize-coordinate-field">
        <span className="control-label">Longitude</span>
        <input className="text-input" name="lon" type="number" min="-180" max="180" step="any" placeholder="-69.9" required />
      </label>
      <button className="button" type="submit">Show this spot</button>
      <p id="characterize-coordinates-hint" className="characterize-coordinates-hint">
        Decimal degrees, with south and west as negative numbers: -24.1 and -69.9 is the Atacama Desert. The map snaps to
        the nearest half-degree square, about 50 km across.
      </p>
    </form>
  );
}
