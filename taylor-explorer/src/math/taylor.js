// Core Taylor-polynomial numerics (no UI, no dependencies)

/** Horner evaluation of c_0 + c_1 h + ... + c_n h^n. */
export function horner(c, n, h) {
  let s = 0;
  for (let k = n; k >= 0; k--) s = s * h + c[k];
  return s;
}

/** Horner evaluation of sum |c_k| t^k (t >= 0): the size of the terms, used to estimate round-off. */
export function hornerAbs(c, n, t) {
  let s = 0;
  for (let k = n; k >= 0; k--) s = s * t + Math.abs(c[k]);
  return s;
}

/** All partial sums S_0..S_n at offset h = x − a. */
export function partialSums(c, n, h) {
  const out = new Array(n + 1);
  let s = 0;
  let p = 1;
  for (let k = 0; k <= n; k++) {
    s += c[k] * p;
    out[k] = s;
    p *= h;
  }
  return out;
}

/**
 * Partial sums S_0..S_nMax for many x at once, stored as one Float64Array per k
 * (rows[k][i] = S_k(xs[i])). Much lighter on memory than one array per x.
 */
export function partialSumsGrid(c, nMax, xs, a) {
  const rows = Array.from({ length: nMax + 1 }, () => new Float64Array(xs.length));
  for (let i = 0; i < xs.length; i++) {
    const h = xs[i] - a;
    let s = 0;
    let p = 1;
    for (let k = 0; k <= nMax; k++) {
      s += c[k] * p;
      rows[k][i] = s;
      p *= h;
    }
  }
  return rows;
}

const EPS = 2.22e-16; // double-precision round-off

/**
 * |f − Tn| at one point, plus the round-off floor of that subtraction.
 * Differences below the floor are noise (0 or random multiples of 1e-16), so `shown`
 * holds max(err, floor): a smooth curve that is safe to put on a log axis.
 * `fx` is f(x) and h = x − a.
 */
export function errorInfo(fx, c, n, h) {
  const err = Math.abs(fx - horner(c, n, h));
  if (!Number.isFinite(err)) return { err: NaN, floor: NaN, shown: NaN };
  const floor = EPS * (Math.abs(fx) + hornerAbs(c, n, Math.abs(h)));
  return { err, floor, shown: Math.max(err, floor, 1e-300) };
}

/** True when c_0..c_n are all finite numbers. */
export function coeffsOK(c, n) {
  if (!c) return false;
  for (let k = 0; k <= n; k++) if (!Number.isFinite(c[k])) return false;
  return true;
}

/**
 * Radius of convergence estimated from the coefficients: |c_k / c_{k+2}|^{1/2}.
 * (A two-step ratio, so series with every other coefficient zero — sin, cos, arctan — still work.)
 * Returns { R, rows: [{k, est}] (the last `count` valid estimates), terminates }.
 * A series whose last four coefficients are exactly 0 is a polynomial: R = ∞.
 */
export function estimateRadius(c, N, count = 6) {
  if (N >= 4 && c[N] === 0 && c[N - 1] === 0 && c[N - 2] === 0 && c[N - 3] === 0) {
    return { R: Infinity, rows: [], terminates: true };
  }
  const rows = [];
  for (let k = N - 2; k >= 0 && rows.length < count; k--) {
    const a = Math.abs(c[k]);
    const b = Math.abs(c[k + 2]);
    if (a > 0 && b > 0 && Number.isFinite(a) && Number.isFinite(b)) rows.push({ k, est: Math.sqrt(a / b) });
  }
  rows.reverse();
  return { R: rows.length ? rows[rows.length - 1].est : NaN, rows, terminates: false };
}
