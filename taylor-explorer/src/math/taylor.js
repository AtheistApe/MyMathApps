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

// Gaps g tried when comparing coefficients: |c_k / c_{k+g}|^{1/g}. Series that skip terms need g > 1:
// sin x skips every other term (g = 2), 1/(1 − x³) has a term only every third place (g = 3), and so on.
const RADIUS_GAPS = [2, 3, 4, 5, 6, 8, 10, 12];

/**
 * Radius of convergence estimated from the coefficients (the ratio / root test idea):
 * R ≈ |c_k / c_{k+g}|^{1/g} for large k, using the smallest gap g for which the coefficients can be compared.
 *
 * Returns { R, rows: [{k, est}] (the last few estimates), step: g, terminates, entire }.
 *  - terminates: the last four coefficients are exactly 0, so this is a polynomial and R = ∞.
 *  - entire: the estimates keep growing with k (they do for e^x, sin x, e^(x²), …; for a finite radius they
 *    settle down), so the series appears to converge everywhere and R = ∞. This one is a judgement from
 *    the coefficients, not a proof.
 */
export function estimateRadius(c, N, count = 6) {
  if (N >= 4 && c[N] === 0 && c[N - 1] === 0 && c[N - 2] === 0 && c[N - 3] === 0) {
    return { R: Infinity, rows: [], step: 2, terminates: true, entire: false };
  }
  for (const g of RADIUS_GAPS) {
    const rows = [];
    for (let k = N - g; k >= 0 && rows.length < count; k--) {
      const a = Math.abs(c[k]);
      const b = Math.abs(c[k + g]);
      if (a > 0 && b > 0 && Number.isFinite(a) && Number.isFinite(b)) rows.push({ k, est: Math.pow(a / b, 1 / g) });
    }
    if (rows.length < Math.min(3, count)) continue; // too few comparable pairs at this gap: try a larger one
    rows.reverse();
    const entire = rows[rows.length - 1].est > 1.1 * rows[0].est;
    return { R: entire ? Infinity : rows[rows.length - 1].est, rows, step: g, terminates: false, entire };
  }
  return { R: NaN, rows: [], step: 2, terminates: false, entire: false };
}
