// React hook around the api.js loaders: tracks loading and errors, and ignores answers that arrive after the inputs changed.
import { useEffect, useState } from "react";

/**
 * @param {() => Promise<any> | null} load  Returns a promise, or null when there is nothing to load yet.
 * @param {any[]} dependencies  Reload whenever one of these changes.
 */
export function useLoaded(load, dependencies) {
  const [state, setState] = useState({ data: null, error: null, isLoading: true });

  useEffect(() => {
    const request = load();
    if (!request) {
      setState({ data: null, error: null, isLoading: false });
      return undefined;
    }
    let isCurrent = true;
    // Keep the previous data on screen while the next file loads, so lists don't flash empty.
    setState((previous) => ({ ...previous, error: null, isLoading: true }));
    request
      .then((data) => isCurrent && setState({ data, error: null, isLoading: false }))
      .catch((error) => isCurrent && setState({ data: null, error, isLoading: false }));
    return () => {
      isCurrent = false;
    };
    // The caller owns the dependency list, like useEffect itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, dependencies);

  return state;
}
