// HEALPix in the NESTED scheme, the tile grid every body uses : a clicked lat/lon becomes the same tile
// index healpy computes in Colab (healpy.ang2pix(nside, theta, phi, nest=True)), and a tile index becomes its
// centre and outline. Ported from the reference healpix_base (Górski et al. 2005). Longitudes are east-positive.

const HALF_PI = Math.PI / 2;
const TWO_THIRDS = 2 / 3;
// Face layout of the 12 base pixels: ring number of each face's corner and its longitude position.
const FACE_RING = [2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4];
const FACE_LONGITUDE = [1, 3, 5, 7, 0, 2, 4, 6, 1, 3, 5, 7];

/** Nested tile index of a point; the plan's tile id is `${body}_${nside}_${index}`. */
export function latLonToTile(nside, lat, lon) {
  const z = Math.sin((lat * Math.PI) / 180);
  const zAbs = Math.abs(z);
  const phi = (((lon % 360) + 360) % 360) * (Math.PI / 180);
  const tt = (phi / HALF_PI) % 4; // in [0, 4)
  let face;
  let ix;
  let iy;

  if (zAbs <= TWO_THIRDS) {
    // Equatorial belt
    const temp1 = nside * (0.5 + tt);
    const temp2 = nside * z * 0.75;
    const jp = Math.floor(temp1 - temp2); // ascending edge line index
    const jm = Math.floor(temp1 + temp2); // descending edge line index
    const ifp = Math.floor(jp / nside);
    const ifm = Math.floor(jm / nside);
    face = ifp === ifm ? ifp | 4 : ifp < ifm ? ifp : ifm + 8;
    ix = jm & (nside - 1);
    iy = nside - (jp & (nside - 1)) - 1;
  } else {
    // Polar caps
    const ntt = Math.min(3, Math.floor(tt));
    const tp = tt - ntt;
    const tmp = nside * Math.sqrt(3 * (1 - zAbs));
    const jp = Math.min(nside - 1, Math.floor(tp * tmp));
    const jm = Math.min(nside - 1, Math.floor((1 - tp) * tmp));
    if (z >= 0) {
      face = ntt;
      ix = nside - jm - 1;
      iy = nside - jp - 1;
    } else {
      face = ntt + 8;
      ix = jp;
      iy = jm;
    }
  }
  return face * nside * nside + interleaveBits(ix, iy);
}

/** Centre of a tile as { lat, lon } (lon in -180..180). */
export function tileCenter(nside, index) {
  const { face, ix, iy } = splitIndex(nside, index);
  return facePointToLatLon(face, (ix + 0.5) / nside, (iy + 0.5) / nside);
}

/**
 * Outline of a tile as [lat, lon] points, counter-clockwise, with `stepsPerEdge` points per edge so the curved
 * HEALPix edges look right on a globe.
 */
export function tileOutline(nside, index, stepsPerEdge = 3) {
  const { face, ix, iy } = splitIndex(nside, index);
  const corners = [[0, 0], [1, 0], [1, 1], [0, 1]];
  const points = [];
  for (let corner = 0; corner < 4; corner++) {
    const [x0, y0] = corners[corner];
    const [x1, y1] = corners[(corner + 1) % 4];
    for (let step = 0; step < stepsPerEdge; step++) {
      const fraction = step / stepsPerEdge;
      const { lat, lon } = facePointToLatLon(face, (ix + x0 + (x1 - x0) * fraction) / nside, (iy + y0 + (y1 - y0) * fraction) / nside);
      points.push([lat, lon]);
    }
  }
  return points;
}

export const tileCount = (nside) => 12 * nside * nside;

/** Base cell (0-11) of a tile: the plan splits Mars vectors into one file per base cell. */
export const baseCellOf = (nside, index) => Math.floor(index / (nside * nside));

// ---- Helpers ---------------------------------------------------------------------------------------------------

function splitIndex(nside, index) {
  const perFace = nside * nside;
  const face = Math.floor(index / perFace);
  const { x, y } = deinterleaveBits(index - face * perFace);
  return { face, ix: x, iy: y };
}

// Point inside a base face (x, y in 0..1) to lat/lon: healpix_base's xyf2loc.
function facePointToLatLon(face, x, y) {
  const jr = FACE_RING[face] - x - y;
  let nr;
  let z;
  if (jr < 1) {
    nr = jr;
    z = 1 - (nr * nr) / 3;
  } else if (jr > 3) {
    nr = 4 - jr;
    z = (nr * nr) / 3 - 1;
  } else {
    nr = 1;
    z = ((2 - jr) * 2) / 3;
  }
  let position = FACE_LONGITUDE[face] * nr + x - y;
  if (position < 0) position += 8;
  if (position >= 8) position -= 8;
  const phi = nr < 1e-15 ? 0 : (0.5 * HALF_PI * position) / nr;
  const lat = (Math.asin(Math.max(-1, Math.min(1, z))) * 180) / Math.PI;
  let lon = (phi * 180) / Math.PI;
  if (lon > 180) lon -= 360;
  return { lat, lon };
}

// Morton order: x bits on even positions, y bits on odd positions. Works for nside up to 2^15 without 32-bit overflow.
function interleaveBits(x, y) {
  let result = 0;
  for (let bit = 0; bit < 16; bit++) {
    result += ((x >> bit) & 1) * 2 ** (2 * bit) + ((y >> bit) & 1) * 2 ** (2 * bit + 1);
  }
  return result;
}

function deinterleaveBits(value) {
  let x = 0;
  let y = 0;
  for (let bit = 0; bit < 16; bit++) {
    x += Math.floor(value / 2 ** (2 * bit)) % 2 << bit;
    y += Math.floor(value / 2 ** (2 * bit + 1)) % 2 << bit;
  }
  return { x, y };
}
