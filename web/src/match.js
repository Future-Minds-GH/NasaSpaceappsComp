// Terrestrial Analog Finder matcher (JS). Mirror of matcher/match.py. See contract.md section 4.
// Keep both files identical in behaviour. No code here branches on a body name.
import TOL from './tolerances.json' with { type: 'json' };
import PRESETS from './presets.json' with { type: 'json' };

export const KEYS = PRESETS.weightKeys;
const SURF = ['surf_dust', 'surf_sand', 'surf_rock', 'surf_ice'];
const MINS = ['min_mafic', 'min_feldspathic', 'min_ironox', 'min_sulfate', 'min_clay', 'min_carbonate'];
// [feature, kind, weight key, share]. Order is fixed: it fixes the sum order.
const FEATURES = [
  ['t_day_k', 'scalar', 'temp', 0.5],
  ['t_night_k', 'scalar', 'temp', 0.5],
  ['t_swing_k', 'scalar', 'swing', 1],
  ['sun_wm2', 'scalar', 'sun', 1],
  ['slope_deg', 'scalar', 'slope', 1],
  ['rough_m', 'scalar', 'rough', 1],
  ['elev_pct', 'scalar', 'elev', 1],
  ['surface', 'vector', 'surface', 1],
  ['minerals', 'vector', 'minerals', 1],
  ['ice_prob', 'scalar', 'ice', 1],
];
const SCALARS = FEATURES.filter((f) => f[1] === 'scalar').map((f) => f[0]);
const VECTORS = { surface: SURF, minerals: MINS };

const prepCache = new WeakMap();

/** Convert a web table {meta, cols} into typed arrays (null -> NaN). Cached per object. */
export function prepareTable(raw) {
  if (raw.prepared) return raw;
  if (prepCache.has(raw)) return prepCache.get(raw);
  const cols = {};
  for (const [k, v] of Object.entries(raw.cols)) {
    if (k === 'analog_ok') cols[k] = Uint8Array.from(v, (x) => (x ? 1 : 0));
    else if (k === 'image_url') cols[k] = v;
    else cols[k] = Float64Array.from(v, (x) => (x === null ? NaN : x));
  }
  const t = { prepared: true, meta: raw.meta, cols, n: cols.lat.length, _rel: null };
  prepCache.set(raw, t);
  return t;
}

function okAt(t, i) {
  const a = t.cols.analog_ok;
  return a ? a[i] === 1 : true;
}

// Percentile columns: pct = 100 * (L + E/2) / n, reference = analog_ok rows. elev_pct used as is.
function rel(t) {
  if (t._rel) return t._rel;
  const out = {};
  for (const f of SCALARS) {
    const col = t.cols[f];
    if (!col) continue;
    if (f === 'elev_pct') { out[f] = col; continue; }
    const ref = [];
    for (let i = 0; i < t.n; i++) if (okAt(t, i) && !Number.isNaN(col[i])) ref.push(col[i]);
    ref.sort((a, b) => a - b);
    const n = ref.length;
    const pct = new Float64Array(t.n).fill(NaN);
    if (n > 0) {
      for (let i = 0; i < t.n; i++) {
        const v = col[i];
        if (Number.isNaN(v)) continue;
        const lo = bound(ref, v, false);
        const hi = bound(ref, v, true);
        pct[i] = (100 * (lo + (hi - lo) / 2)) / n;
      }
    }
    out[f] = pct;
  }
  t._rel = out;
  return out;
}

function bound(arr, v, right) {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (right ? arr[mid] <= v : arr[mid] < v) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

const rad = (d) => (d * Math.PI) / 180;
export function haversineKm(lat1, lon1, lat2, lon2, radius) {
  const p1 = rad(lat1);
  const p2 = rad(lat2);
  const dphi = p2 - p1;
  const dl = rad(lon2) - rad(lon1);
  const a = Math.sin(dphi / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return radius * 2 * Math.asin(Math.min(1, Math.sqrt(a)));
}

export function effectiveWeights(weights, include) {
  include = include || {};
  const wk = {};
  for (const k of KEYS) {
    const on = include[k] === undefined ? true : include[k];
    wk[k] = on ? Number(weights[k] || 0) : 0;
  }
  const eff = {};
  for (const [name, , key, share] of FEATURES) eff[name] = wk[key] * share;
  return { eff, wk };
}

export function nearestIndex(t, lat, lon, radius) {
  let best = 0;
  let bd = Infinity;
  for (let i = 0; i < t.n; i++) {
    const d = haversineKm(lat, lon, t.cols.lat[i], t.cols.lon[i], radius);
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

export function rowValues(t, i, mode) {
  const src = mode === 'relative' ? rel(t) : t.cols;
  const out = {};
  for (const f of SCALARS) out[f] = src[f] ? src[f][i] : NaN;
  for (const [name, names] of Object.entries(VECTORS)) {
    out[name] = names.some((n) => !t.cols[n]) ? null : names.map((n) => t.cols[n][i]);
  }
  return out;
}

/** Per-pair scoring for one input cell against all target cells. Returns { score, s }. */
export function scoreCells(inp, target, eff, mode) {
  const tol = TOL[mode];
  const src = mode === 'relative' ? rel(target) : target.cols;
  const n = target.n;
  const num = new Float64Array(n);
  const den = new Float64Array(n);
  const sAll = {};
  for (const [name, kind] of FEATURES) {
    const w = eff[name];
    if (!(w > 0)) continue;
    const s = new Float64Array(n).fill(NaN);
    if (kind === 'scalar') {
      const col = src[name];
      const a = inp[name];
      if (col && !Number.isNaN(a)) {
        for (let j = 0; j < n; j++) {
          const b = col[j];
          if (!Number.isNaN(b)) s[j] = Math.max(0, 1 - Math.abs(a - b) / tol[name]);
        }
      }
    } else {
      const names = VECTORS[name];
      const cols = names.map((c) => target.cols[c]);
      const p = inp[name];
      if (p && !p.some(Number.isNaN) && cols.every(Boolean)) {
        for (let j = 0; j < n; j++) {
          let sum = 0;
          let bad = false;
          for (let c = 0; c < cols.length; c++) {
            const q = cols[c][j];
            if (Number.isNaN(q)) { bad = true; break; }
            sum += Math.abs(p[c] - q);
          }
          if (!bad) s[j] = 1 - 0.5 * sum;
        }
      }
    }
    sAll[name] = s;
    for (let j = 0; j < n; j++) {
      if (!Number.isNaN(s[j])) { num[j] += w * s[j]; den[j] += w; }
    }
  }
  const score = new Float64Array(n);
  for (let j = 0; j < n; j++) score[j] = den[j] > 0 ? (100 * num[j]) / den[j] : NaN;
  return { score, s: sAll };
}

export function bandOf(score) {
  return score >= 90 ? 'green' : score >= 60 ? 'yellow' : 'red';
}

export function breakdownFor(sAll, wk, j) {
  const bd = {};
  for (const key of KEYS) {
    if (!(wk[key] > 0)) continue;
    const vals = [];
    for (const [name, , k2] of FEATURES) {
      if (k2 === key && sAll[name] && !Number.isNaN(sAll[name][j])) vals.push(sAll[name][j]);
    }
    bd[key] = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  }
  const ranked = Object.entries(bd)
    .map(([k, v], i) => [v, i, k])
    .filter((r) => r[0] !== null)
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  return { bd, worst: ranked.slice(0, 2).map((r) => r[2]) };
}

/** Score between input cell i and target cell j. Returns { score|null, breakdown, worst }. */
export function pairScore(inputTable, i, targetTable, j, weights, include = {}, mode = 'absolute') {
  const input = prepareTable(inputTable);
  const target = prepareTable(targetTable);
  const { eff, wk } = effectiveWeights(weights, include);
  const sub = { meta: target.meta, n: 1, cols: {}, _rel: null };
  for (const [k, v] of Object.entries(target.cols)) sub.cols[k] = v.slice ? v.slice(j, j + 1) : [v[j]];
  if (mode === 'relative') {
    sub._rel = {};
    for (const [k, v] of Object.entries(rel(target))) sub._rel[k] = v.slice(j, j + 1);
  }
  const { score, s } = scoreCells(rowValues(input, i, mode), sub, eff, mode);
  const { bd, worst } = breakdownFor(s, wk, 0);
  return { score: Number.isNaN(score[0]) ? null : score[0], breakdown: bd, worst };
}

export function match({
  inputTable, inputLat, inputLon, targetTable, weights, include = {}, mode = 'absolute',
  k = 5, minSepKm = 200, excludeKm = 300, knownSites = null, newKm = 300,
}) {
  const input = prepareTable(inputTable);
  const target = prepareTable(targetTable);
  const { eff, wk } = effectiveWeights(weights, include);
  const rT = target.meta.radius_km;
  const i = nearestIndex(input, inputLat, inputLon, input.meta.radius_km);
  const { score, s } = scoreCells(rowValues(input, i, mode), target, eff, mode);
  const same = input.meta.body === target.meta.body;
  const lat = target.cols.lat;
  const lon = target.cols.lon;
  const cand = [];
  for (let j = 0; j < target.n; j++) {
    if (!okAt(target, j) || Number.isNaN(score[j])) continue;
    if (same && haversineKm(inputLat, inputLon, lat[j], lon[j], rT) < excludeKm) continue;
    cand.push(j);
  }
  cand.sort((a, b) => score[b] - score[a] || a - b);
  const picked = [];
  for (const j of cand) {
    if (picked.length >= k) break;
    if (picked.some((p) => haversineKm(lat[j], lon[j], lat[p], lon[p], rT) < minSepKm)) continue;
    picked.push(j);
  }
  const sites = knownSites ? knownSites.filter((x) => x.body === target.meta.body) : null;
  return picked.map((j) => {
    const { bd, worst } = breakdownFor(s, wk, j);
    const cave = target.cols.cave_km ? target.cols.cave_km[j] : NaN;
    return {
      index: j, lat: lat[j], lon: lon[j], score: score[j], band: bandOf(score[j]),
      breakdown: bd, worst,
      isNew: sites ? sites.every((x) => haversineKm(lat[j], lon[j], x.lat, x.lon, rT) > newKm) : null,
      caveKm: Number.isNaN(cave) ? null : cave,
    };
  });
}

export function applyGroup(weights, group) {
  const keep = new Set(PRESETS.groups[group]);
  const out = {};
  for (const k of KEYS) out[k] = keep.has(k) ? weights[k] || 0 : 0;
  return out;
}

export function presetWeights(name) {
  const p = PRESETS.presets[name];
  const out = {};
  for (const k of KEYS) out[k] = p[k];
  return out;
}

export { PRESETS, TOL };
