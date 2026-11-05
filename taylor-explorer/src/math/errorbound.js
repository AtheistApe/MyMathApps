// Taylor's Inequality (Lagrange error bound), as numbers:
//
//   if |f^(n+1)(t)| <= M for every t in an interval around a, then for x in the interval
//   |f(x) − Tn(x)| <= M |x − a|^(n+1) / (n+1)!
//
// Pure functions (no React) so they can be tested in plain node.

import { memoize1 } from './util.js';
import { factorial } from './numfmt.js';

/** f^(order)(t) as a function of t: the order-th Taylor coefficient about t, times order!. */
export function derivativeFn(fn, order) {
  const fact = factorial(order);
  return memoize1((t) => fn.coeffs(t, order)[order] * fact);
}

/**
 * The interval the bound is about, from the center a and the test point x0, with d = |x0 − a|.
 * symmetric: |x − a| <= d (the textbook form), otherwise just the stretch between a and x0.
 */
export function intervalFor(a, x0, symmetric) {
  const d = Math.abs(x0 - a);
  if (!symmetric) return { lo: Math.min(a, x0), hi: Math.max(a, x0), d };
  // the endpoint on x0's side is x0 itself, exactly (a + d can be off by a rounding step, which would hide a pole at x0)
  return x0 >= a ? { lo: 2 * a - x0, hi: x0, d } : { lo: x0, hi: 2 * a - x0, d };
}

/** M_n(x) = M |x − a|^(n+1) / (n+1)! */
export function boundValue(M, dist, n) {
  return (M * Math.pow(dist, n + 1)) / factorial(n + 1);
}

/** Round up to `digits` significant digits (so a revealed M is still a valid bound). */
export function roundUp(v, digits = 4) {
  if (!(v > 0) || !Number.isFinite(v)) return v;
  const p = Math.pow(10, Math.floor(Math.log10(v)) - (digits - 1));
  return Number((Math.ceil(v / p - 1e-9) * p).toPrecision(12));
}

/**
 * max |g| on [lo, hi]. Returns { M, at, unbounded }.
 * `unbounded` means no finite maximum: g is undefined or infinite at a sample point, or two different
 * sampling grids disagree by a large factor (a pole inside the interval).
 */
export function maxAbsOnInterval(g, lo, hi) {
  if (!(hi > lo)) {
    const v = Math.abs(g(lo));
    return Number.isFinite(v) ? { M: v, at: lo, unbounded: false } : { M: Infinity, at: lo, unbounded: true };
  }
  const scan = (S) => {
    let M = -1;
    let at = lo;
    for (let i = 0; i <= S; i++) {
      const t = i === 0 ? lo : i === S ? hi : lo + ((hi - lo) * i) / S; // the endpoints exactly, not up to a rounding step
      const v = Math.abs(g(t));
      if (!Number.isFinite(v)) return { M: Infinity, at: t, bad: true };
      if (v > M) {
        M = v;
        at = t;
      }
    }
    return { M, at, bad: false };
  };
  // Two grids that share no points (301 and 1201 intervals are coprime). Near a pole the maximum depends wildly on
  // how close a sample happens to land, so the two grids disagree by a huge factor, in one direction or the other.
  // (Nested grids would not work: a sample that lands almost exactly on the pole would be on both.)
  const coarse = scan(301);
  if (coarse.bad) return { M: Infinity, at: coarse.at, unbounded: true };
  const fine = scan(1201);
  if (fine.bad || fine.M > 3 * coarse.M || coarse.M > 3 * fine.M) {
    return { M: Infinity, at: fine.M > coarse.M ? fine.at : coarse.at, unbounded: true };
  }

  // polish the best sample with a golden-section search between its neighbours
  const step = (hi - lo) / 1201;
  let left = Math.max(lo, fine.at - step);
  let right = Math.min(hi, fine.at + step);
  const phi = (Math.sqrt(5) - 1) / 2;
  let best = fine;
  for (let i = 0; i < 40; i++) {
    const m1 = right - phi * (right - left);
    const m2 = left + phi * (right - left);
    const v1 = Math.abs(g(m1));
    const v2 = Math.abs(g(m2));
    if (v1 > best.M) best = { M: v1, at: m1 };
    if (v2 > best.M) best = { M: v2, at: m2 };
    if (v1 < v2) left = m1;
    else right = m2;
  }
  // A genuine smooth maximum is only slightly higher than the best sample. If the search ran off to a much
  // larger value, it was heading for a pole between the samples.
  if (best.M > 3 * fine.M) return { M: Infinity, at: best.at, unbounded: true };
  return { M: best.M, at: best.at, unbounded: false };
}

/**
 * Feedback on the student's M compared with the true maximum.
 *   none / unbounded / exact (the derivative is 0: Tn is exact) / small / valid / loose (more than 10× too big)
 */
export function classifyM(M, truth) {
  if (truth.unbounded) return { kind: 'unbounded' };
  if (truth.M < 1e-9) return { kind: 'exact' };
  if (M == null) return { kind: 'none' };
  if (M < truth.M * (1 - 1e-6)) return { kind: 'small', ratio: M / truth.M };
  if (M > 10 * truth.M) return { kind: 'loose', ratio: M / truth.M };
  return { kind: 'valid', ratio: M / truth.M };
}
