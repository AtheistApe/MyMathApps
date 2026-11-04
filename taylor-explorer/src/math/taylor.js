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

/** True when c_0..c_n are all finite numbers. */
export function coeffsOK(c, n) {
  if (!c) return false;
  for (let k = 0; k <= n; k++) if (!Number.isFinite(c[k])) return false;
  return true;
}

/**
 * Estimates of the radius of convergence from the coefficients: |c_k / c_{k+2}|^{1/2}.
 * (Two-step ratio so that series with every other coefficient zero — sin, cos, arctan — still work.)
 * Returns the last `count` valid estimates as [{k, est}].
 */
export function radiusEstimates(c, N, count = 6) {
  const rows = [];
  for (let k = N - 2; k >= 0 && rows.length < count; k--) {
    const a = Math.abs(c[k]);
    const b = Math.abs(c[k + 2]);
    if (a > 0 && b > 0 && Number.isFinite(a) && Number.isFinite(b)) rows.push({ k, est: Math.sqrt(a / b) });
  }
  return rows.reverse();
}

/** Round to the 0.05 grid used by sliders and handles. */
export function snap(v, step = 0.05) {
  return Number((Math.round(v / step) * step).toFixed(6));
}

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
