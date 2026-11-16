// Checks the visit counter's rules without the real service: the first page of a browser session adds one ("hit"),
// later pages and local previews only read the total ("get"), a counter nobody has hit yet reads 0, and a failing
// service gives null instead of an error.
import { test } from "node:test";
import assert from "node:assert/strict";

/** Fresh copy of the module (it caches its one request per page load) with a fake browser around it. */
async function loadCounter({ hostname = "future-minds-gh.github.io", storage = new Map(), respond }) {
  const requestedUrls = [];
  globalThis.window = {
    location: { hostname },
    sessionStorage: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
  };
  globalThis.fetch = async (url) => {
    requestedUrls.push(url);
    return respond(url);
  };
  const module = await import(`../src/data/visitorCount.js?case=${Math.random()}`);
  return { ...module, requestedUrls, storage };
}

const okResponse = (value) => ({ ok: true, status: 200, json: async () => ({ value }) });

test("the first page of a session adds one; the next page only reads", async () => {
  const storage = new Map();
  const first = await loadCounter({ storage, respond: () => okResponse(41) });
  assert.equal(await first.loadVisitCount(), 41);
  assert.match(first.requestedUrls[0], /\/hit\//);
  assert.equal(storage.get("visit-counted"), "1");

  const second = await loadCounter({ storage, respond: () => okResponse(41) });
  assert.equal(await second.loadVisitCount(), 41);
  assert.match(second.requestedUrls[0], /\/get\//);
});

test("one request per page load, however many times it is asked", async () => {
  const counter = await loadCounter({ respond: () => okResponse(7) });
  await Promise.all([counter.loadVisitCount(), counter.loadVisitCount()]);
  assert.equal(counter.requestedUrls.length, 1);
});

test("local previews read the total but never add to it", async () => {
  const storage = new Map();
  const counter = await loadCounter({ hostname: "localhost", storage, respond: () => okResponse(12) });
  assert.equal(await counter.loadVisitCount(), 12);
  assert.match(counter.requestedUrls[0], /\/get\//);
  assert.equal(storage.has("visit-counted"), false);
});

test("a counter nobody has hit yet reads 0", async () => {
  const counter = await loadCounter({ hostname: "localhost", respond: () => ({ ok: false, status: 404, json: async () => ({ error: "Key not found" }) }) });
  assert.equal(await counter.loadVisitCount(), 0);
});

test("a failing or unreachable service gives null and does not mark the session as counted", async () => {
  const storage = new Map();
  const failing = await loadCounter({ storage, respond: () => ({ ok: false, status: 500, json: async () => ({}) }) });
  assert.equal(await failing.loadVisitCount(), null);
  assert.equal(storage.has("visit-counted"), false);

  const offline = await loadCounter({ storage, respond: () => { throw new TypeError("network down"); } });
  assert.equal(await offline.loadVisitCount(), null);
});
