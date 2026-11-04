// Convergence facts about the current series: radius, interval, and a plain-language verdict at x0.
// Pure functions (no React) so they are easy to test.

import { estimateRadius } from './taylor.js';
import { intervalText, MINUS } from './numfmt.js';

/** Plain-language statement about convergence at x0. Returns { cls: 'in'|'out'|'edge'|'none', text }. */
export function verdictAt({ ok, R, dist, x0, a, ends, terminates }) {
  if (!ok || Number.isNaN(R)) return { cls: 'none', text: 'No Taylor series at this center.' };
  if (terminates) return { cls: 'in', text: 'This series has finitely many terms (a polynomial), so it converges for every x.' };
  if (R === Infinity) return { cls: 'in', text: 'The series converges for every x (R = ∞).' };
  const eps = 1e-9 * Math.max(1, R);
  if (dist < R - eps) return { cls: 'in', text: `|x₀ ${MINUS} a| < R: the series converges absolutely at x₀.` };
  if (dist > R + eps) return { cls: 'out', text: `|x₀ ${MINUS} a| > R: the series diverges at x₀. The terms don't even go to 0.` };
  const side = x0 > a ? ends?.right : ends?.left;
  if (side === 'converges') return { cls: 'edge', text: 'x₀ is an endpoint, and the series converges there (check it with the alternating series test or comparison).' };
  if (side === 'diverges') return { cls: 'edge', text: 'x₀ is an endpoint, and the series diverges there.' };
  return { cls: 'edge', text: 'x₀ is an endpoint: the ratio test is inconclusive, so test this series directly.' };
}

/**
 * Everything the convergence tab shows. The radius is exact for preset functions and
 * estimated from the coefficients for custom ones.
 */
export function analyzeConvergence({ fn, a, x0, coeffs, N, ok }) {
  const exactR = fn.radius(a); // null when unknown (custom function)
  const est = ok ? estimateRadius(coeffs, N) : { R: NaN, rows: [], terminates: false };
  const isExact = exactR !== null;
  const R = isExact ? exactR : est.R;
  const ends = fn.endpoints(a); // { left, right } | null
  const dist = Math.abs(x0 - a);
  const lo = a - R;
  const hi = a + R;
  const hasInterval = ok && !Number.isNaN(R);
  return {
    R,
    isExact,
    exactR,
    rows: est.rows,
    terminates: est.terminates,
    ends,
    lo,
    hi,
    dist,
    verdict: verdictAt({ ok, R, dist, x0, a, ends, terminates: est.terminates }),
    interval: hasInterval ? intervalText(lo, hi, ends?.left === 'converges', ends?.right === 'converges') : '—',
  };
}
