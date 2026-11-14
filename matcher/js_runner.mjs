// Runs match.js on a fixture and prints JSON. Used by tests/test_match.py.
import fs from 'node:fs';
import { match, pairScore, prepareTable } from '../web/src/match.js';
const fx = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const T = {};
for (const b of ['earth', 'moon', 'mars']) T[b] = prepareTable(JSON.parse(fs.readFileSync(`web/public/data/${b}.json`, 'utf8')));
const out = fx.cases.map((c) => {
  const r = match({ inputTable: T[c.input], inputLat: c.lat, inputLon: c.lon, targetTable: T[c.target],
    weights: c.weights, include: c.include || {}, mode: c.mode, knownSites: fx.knownSites });
  const p = c.pairs.map(([i, j]) => pairScore(T[c.input], i, T[c.target], j, c.weights, c.include || {}, c.mode));
  return { match: r, pairs: p };
});
console.log(JSON.stringify(out));
