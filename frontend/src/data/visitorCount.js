// The site's visit count, kept by Abacus (abacus.jasoncameron.dev), a free counting service with no sign-up: the site is
// static (GitHub Pages), so it has no server of its own to count on. A visit is one browser session: reloading or moving
// between pages doesn't add another, closing the tab and coming back later does.

const COUNTER_HOST = "https://abacus.jasoncameron.dev";
// Namespace and key only identify this counter; they are opaque on purpose.
const COUNTER_PATH = "x7k2q9v4m1/visits";
const COUNTED_FLAG = "visit-counted";
// Local previews show the total but never add to it, so the team's own testing doesn't inflate the number.
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
// Abacus answers 404 for a counter nobody has added to yet.
const NOT_CREATED_YET = 404;

let countRequest = null;

/**
 * The number of visits so far, or null when the service can't be reached. The first page of a browser session adds one
 * ("hit"); every other page, and every local preview, only reads the total ("get"). One request per page load, however
 * many components ask (React's development mode runs effects twice).
 */
export function loadVisitCount() {
  countRequest ??= requestCount();
  return countRequest;
}

async function requestCount() {
  const isLocalPreview = LOCAL_HOSTS.has(window.location.hostname);
  const isAlreadyCounted = isLocalPreview || readCountedFlag();
  try {
    const response = await fetch(`${COUNTER_HOST}/${isAlreadyCounted ? "get" : "hit"}/${COUNTER_PATH}`);
    if (response.status === NOT_CREATED_YET) return 0;
    if (!response.ok) return null;
    const { value } = await response.json();
    if (!isAlreadyCounted) writeCountedFlag();
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

// Storage can be blocked (private windows, strict settings). Then each page load counts, which beats no count at all.
function readCountedFlag() {
  try {
    return window.sessionStorage.getItem(COUNTED_FLAG) === "1";
  } catch {
    return false;
  }
}

function writeCountedFlag() {
  try {
    window.sessionStorage.setItem(COUNTED_FLAG, "1");
  } catch {
    // Blocked storage: see readCountedFlag.
  }
}
