// Number / text formatting helpers (unicode math, exact fractions when possible)

export const MINUS = '\u2212';

const SUP = { 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹', '-': '⁻', '(': '⁽', ')': '⁾', k: 'ᵏ', n: 'ⁿ' };
const SUB = { 0: '₀', 1: '₁', 2: '₂', 3: '₃', 4: '₄', 5: '₅', 6: '₆', 7: '₇', 8: '₈', 9: '₉', n: 'ₙ', k: 'ₖ' };

export const sup = (s) => String(s).split('').map((ch) => SUP[ch] ?? ch).join('');
export const sub = (s) => String(s).split('').map((ch) => SUB[ch] ?? ch).join('');

/** Compact decimal formatting: 5 significant digits, scientific for very large/small. */
export function fmtNum(v, digits = 5) {
  if (v === undefined || v === null || Number.isNaN(v)) return 'undefined';
  if (!Number.isFinite(v)) return v > 0 ? '∞' : `${MINUS}∞`;
  if (v === 0) return '0';
  const av = Math.abs(v);
  if (av >= 1e6 || av < 1e-4) {
    const [m, e] = v.toExponential(digits - 1).split('e');
    const mant = m.includes('.') ? m.replace(/0+$/, '').replace(/\.$/, '') : m;
    return `${mant.replace('-', MINUS)}×10${sup(parseInt(e, 10))}`;
  }
  return String(parseFloat(v.toPrecision(digits))).replace('-', MINUS);
}

// ---- factorials (BigInt for exact fractions) -------------------------------
const factBig = [1n];
for (let i = 1; i <= 170; i++) factBig[i] = factBig[i - 1] * BigInt(i);
export const factorialBig = (k) => factBig[k];
export const factorial = (k) => Number(factBig[k]);

const gcd = (a, b) => {
  a = a < 0n ? -a : a;
  b = b < 0n ? -b : b;
  while (b) [a, b] = [b, a % b];
  return a;
};

/**
 * If v is (numerically) an integer with |v| < maxAbs, return it as a BigInt, else null.
 * relTol is the allowed relative error; keep both tight when deciding that a coefficient is an exact
 * fraction, because a loose test turns a large irrational number into a "fraction".
 */
export function asInteger(v, relTol = 1e-9, maxAbs = 1e15) {
  if (!Number.isFinite(v)) return null;
  const r = Math.round(v);
  if (Math.abs(r) >= maxAbs) return null;
  if (Math.abs(v - r) > relTol * Math.max(1, Math.abs(v))) return null;
  return BigInt(r);
}

export function bigToString(b) {
  return b < 0n ? MINUS + String(-b) : String(b);
}

/** Format f^(k)(a) */
export function fmtDeriv(d) {
  const i = asInteger(d);
  return i !== null ? bigToString(i) : fmtNum(d);
}

/**
 * The k-th derivative f^(k)(a) = k!·c_k as text. When c_k is an exact fraction so is the derivative
 * (sin(x)/x has f^(4)(0) = 1/5), so show it exactly unless decimals were asked for.
 * `co` is describeCoef(c_k, k, decimal) and d = c_k·k!.
 */
export function derivText(co, k, d, decimal = false) {
  if (!decimal && co.kind === 'frac') {
    const top = co.num * factBig[k];
    const g = gcd(top, co.den);
    const num = top / g;
    const den = co.den / g;
    return (co.neg ? MINUS : '') + (den === 1n ? String(num) : `${num}/${den}`);
  }
  return fmtDeriv(d);
}

/**
 * Describe the Taylor coefficient c_k = f^(k)(a)/k!.
 * Returns { kind: 'zero'|'frac'|'dec', neg, num, den, text, mag }.
 * 'frac' means c_k is an exact fraction (an integer derivative over k!, or a (k+j)! denominator).
 */
export function describeCoef(c, k, decimal = false) {
  if (c === 0) return { kind: 'zero', neg: false, text: '0', mag: '0' };
  if (decimal) {
    const mag = fmtNum(Math.abs(c));
    return { kind: 'dec', neg: c < 0, mag, text: (c < 0 ? MINUS : '') + mag };
  }
  // c_k = (integer) / D for D = (k + j)!, j = 0..3 (j = 0 is "f^(k)(a) is an integer"; j > 0 covers series
  // such as sin(x)/x, (e^x − 1)/x and x/(e^x − 1)), and D = (k/2)! for even k (e^(−x²) has c_k = ±1/(k/2)!).
  // The test is strict (1e-13 relative, |value| < 1e9) so an irrational coefficient is never mistaken for a fraction.
  const denominators = [0, 1, 2, 3].map((j) => factBig[k + j]);
  if (k >= 2 && k % 2 === 0) denominators.push(factBig[k / 2]);
  for (const f of denominators) {
    const di = asInteger(c * Number(f), 1e-13, 1e9);
    if (di === null || di === 0n) continue;
    const g = gcd(di, f);
    const num = (di < 0n ? -di : di) / g;
    const den = f / g;
    const neg = di < 0n;
    const mag = den === 1n ? String(num) : `${num}/${den}`;
    return { kind: 'frac', neg, num, den, mag, text: (neg ? MINUS : '') + mag };
  }
  // Not an integer derivative (e.g. binomial series): try a small-denominator fraction.
  const fr = smallFraction(Math.abs(c));
  if (fr) {
    const mag = fr.den === 1n ? String(fr.num) : `${fr.num}/${fr.den}`;
    return { kind: 'frac', neg: c < 0, num: fr.num, den: fr.den, mag, text: (c < 0 ? MINUS : '') + mag };
  }
  const mag = fmtNum(Math.abs(c));
  return { kind: 'dec', neg: c < 0, mag, text: (c < 0 ? MINUS : '') + mag };
}

/** Continued-fraction search for p/q with q <= maxDen matching v to a relative 1e-12 (strict, to avoid false hits). */
function smallFraction(v, maxDen = 2000) {
  if (!Number.isFinite(v) || v === 0 || v > 1e6) return null;
  let h1 = 1, h0 = 0, k1 = 0, k0 = 1;
  let x = v;
  for (let i = 0; i < 24; i++) {
    const ai = Math.floor(x);
    const h2 = ai * h1 + h0;
    const k2 = ai * k1 + k0;
    if (k2 > maxDen) return null;
    h0 = h1; h1 = h2; k0 = k1; k1 = k2;
    // relative tolerance, and a nonzero numerator: a tiny c_k must never collapse to "0"
    if (h1 > 0 && Math.abs(v - h1 / k1) <= 1e-12 * v) return { num: BigInt(h1), den: BigInt(k1) };
    const frac = x - ai;
    if (frac < 1e-15) return null;
    x = 1 / frac;
  }
  return null;
}

/** The variable part, e.g. "x³" or "(x − 0.5)²". */
export function powerText(a, k) {
  if (k === 0) return '';
  const base = a === 0 ? 'x' : `(x ${a < 0 ? '+' : MINUS} ${fmtNum(Math.abs(a))})`;
  return base + (k > 1 ? sup(k) : '');
}

/** The k-th term c_k (x−a)^k as text, e.g. "−x³/6". */
export function termText(co, a, k) {
  if (co.kind === 'zero') return '0';
  if (k === 0) return co.text;
  const v = powerText(a, k);
  const sign = co.neg ? MINUS : '';
  if (co.kind === 'frac') {
    const num = co.num === 1n ? '' : String(co.num);
    return co.den === 1n ? `${sign}${num}${v}` : `${sign}${num}${v}/${co.den}`;
  }
  return `${sign}${co.mag === '1' ? '' : co.mag}${v}`;
}

/** describeCoef for c_0 … c_n. Compute this once per render and share it (the table and the polynomial line both need it). */
export function describeAll(coeffs, n, decimal = false) {
  return Array.from({ length: n + 1 }, (_, k) => describeCoef(coeffs[k], k, decimal));
}

/** "T₃(x) = x − x³/6 + …": all nonzero terms for small n, otherwise an abbreviated form. */
export function polynomialText(coeffs, a, n, decimal = false, descs = describeAll(coeffs, n, decimal)) {
  const terms = [];
  descs.forEach((co, k) => {
    if (co.kind !== 'zero') terms.push({ k, co });
  });
  if (terms.length === 0) return '0';
  const show = terms.length <= 7 ? terms : [...terms.slice(0, 5), null, terms[terms.length - 1]];
  let out = '';
  show.forEach((t, i) => {
    if (t === null) {
      out += ' + ⋯';
      return;
    }
    const s = termText(t.co, a, t.k);
    if (i === 0) out += s;
    else if (s.startsWith(MINUS)) out += ` ${MINUS} ${s.slice(1)}`;
    else out += ` + ${s}`;
  });
  return out;
}

/** Format an interval of convergence like "(−1, 1]". */
export function intervalText(lo, hi, leftIncluded, rightIncluded) {
  const l = Number.isFinite(lo) ? fmtNum(lo, 4) : `${MINUS}∞`;
  const r = Number.isFinite(hi) ? fmtNum(hi, 4) : '∞';
  const lb = Number.isFinite(lo) && leftIncluded ? '[' : '(';
  const rb = Number.isFinite(hi) && rightIncluded ? ']' : ')';
  return `${lb}${l}, ${r}${rb}`;
}
