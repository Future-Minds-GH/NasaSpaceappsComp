// Starts the search worker. Vite bundles searchWorker.js as its own file from this URL pattern.

export function startSearchWorker() {
  return new Worker(new URL("./searchWorker.js", import.meta.url), { type: "module" });
}
