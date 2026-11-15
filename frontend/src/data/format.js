// Display formatting shared by every screen: coordinates, scores, distances, and CSV/JSON downloads.

export function formatCoordinates(lat, lon) {
  const latText = `${Math.abs(lat).toFixed(2)}° ${lat >= 0 ? "N" : "S"}`;
  const lonText = `${Math.abs(lon).toFixed(2)}° ${lon >= 0 ? "E" : "W"}`;
  return `${latText}, ${lonText}`;
}

export function formatScore(score) {
  return String(Math.round(score));
}

export function formatKm(km) {
  return `${Math.round(km).toLocaleString("en-US")} km`;
}

/** Starts a browser download of text built in the page (exports of the current matches). */
export function downloadText(fileName, text, mimeType) {
  const url = URL.createObjectURL(new Blob([text], { type: mimeType }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  // Revoke on the next tick: some browsers start the download asynchronously after click().
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** CSV with a header row; values containing commas or quotes are quoted. */
export function toCsv(columns, rows) {
  const escapeValue = (value) => {
    const text = value === null || value === undefined ? "" : String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return [columns.join(","), ...rows.map((row) => columns.map((column) => escapeValue(row[column])).join(","))].join("\n") + "\n";
}
