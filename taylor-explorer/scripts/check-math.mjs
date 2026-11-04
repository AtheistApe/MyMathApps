// Sanity checks: node scripts/check-math.mjs
// For every preset and several centers, compare T_n(a+h) with f(a+h) for small h,
// and compare the stated radius with the coefficient-based estimate.
import { PRESETS } from '../src/math/functions.js';
import { horner, radiusEstimates } from '../src/math/taylor.js';
import { describeCoef, termText, polynomialText } from '../src/math/numfmt.js';

let bad = 0;
const fail = (m) => { bad++; console.log('FAIL', m); };

for (const p of PRESETS) {
  for (const a of [0, 0.5, -0.5, 1.5, 2]) {
    if (a < p.centerRange[0] || a > p.centerRange[1]) continue;
    const N = 30;
    const c = p.coeffs(a, N);
    if (!c.every(Number.isFinite)) { if (!(p.id === 'geom' && a === 1)) fail(`${p.id} a=${a}: non-finite coeffs`); continue; }
    const R = p.radius(a);
    const h = Math.min(0.15, R * 0.3);
    for (const s of [-1, 1]) {
      const x = a + s * h;
      const fx = p.f(x);
      if (!Number.isFinite(fx)) continue;
      const err = Math.abs(horner(c, N, x - a) - fx);
      if (err > 1e-9 * Math.max(1, Math.abs(fx))) fail(`${p.id} a=${a} h=${s * h}: |f-T| = ${err}`);
    }
    // radius estimate at a=0 should be in the right ballpark for finite R
    if (a === 0 && Number.isFinite(R)) {
      const est = radiusEstimates(c, N, 1).pop();
      if (!est || Math.abs(est.est - R) > 0.25 * R) fail(`${p.id}: radius ${R} vs estimate ${est?.est}`);
    }
  }
}

// Exact fractions at a = 0
const show = (id, n) => polynomialText(PRESETS.find((p) => p.id === id).coeffs(0, n), 0, n);
const expect = (got, want) => got === want || fail(`expected "${want}" got "${got}"`);
expect(show('exp', 4), '1 + x + x²/2 + x³/6 + x⁴/24');
expect(show('sin', 5), 'x − x³/6 + x⁵/120');
expect(show('cos', 4), '1 − x²/2 + x⁴/24');
expect(show('geom', 3), '1 + x + x² + x³');
expect(show('ln', 4), 'x − x²/2 + x³/3 − x⁴/4');
expect(show('atan', 5), 'x − x³/3 + x⁵/5');
expect(show('lorentz', 4), '1 − x² + x⁴');
expect(show('tan', 5), 'x + x³/3 + 2x⁵/15');
expect(show('gauss', 4), '1 − x² + x⁴/2');
expect(show('sqrt', 3), '1 + x/2 − x²/8 + x³/16');
expect(termText(describeCoef(1 / 6, 3), 0.5, 3), '(x − 0.5)³/6');


// ---- custom functions (series arithmetic) vs. the preset formulas and known series ----
const { buildCustom } = await import('../src/math/customFunction.js');
const close = (u, v, tol = 1e-9) => u.every((x, i) => Math.abs(x - v[i]) <= tol * Math.max(1, Math.abs(v[i])));
const same = async (expr, id, a = 0, N = 14) => {
  const cf = await buildCustom(expr);
  const p = PRESETS.find((q) => q.id === id);
  close(cf.coeffs(a, N), p.coeffs(a, N)) || fail(`custom "${expr}" at a=${a} differs from preset ${id}`);
};
for (const a of [0, 0.5, -0.4]) {
  await same('exp(x)', 'exp', a); await same('sin(x)', 'sin', a); await same('cos(x)', 'cos', a);
  await same('1/(1-x)', 'geom', a); await same('1/(1+x^2)', 'lorentz', a); await same('log(1+x)', 'ln', a);
  await same('atan(x)', 'atan', a); await same('sqrt(1+x)', 'sqrt', a); await same('exp(-x^2)', 'gauss', a);
  await same('tan(x)', 'tan', a); await same('(1+x)^0.5', 'sqrt', a);
}
{
  const cf = await buildCustom('exp(x)*cos(x)');
  close(cf.coeffs(0, 6), [1, 1, 0, -1 / 3, -1 / 6, -1 / 30, 0]) || fail('exp(x)cos(x) series');
  const g = await buildCustom('sin(x)/(2-x)');
  close(g.coeffs(0, 5), [0, 0.5, 0.25, 1 / 24, 1 / 48, 7 / 480]) || fail('sin(x)/(2-x) series');
  const h = await buildCustom('2x + x^3 - 3');
  close(h.coeffs(1, 4), [0, 5, 3, 1, 0]) || fail('polynomial with implicit multiplication');
  const sinhx = await buildCustom('(exp(x) - exp(-x))/2');
  close(sinhx.coeffs(0, 5), [0, 1, 0, 1 / 6, 0, 1 / 120]) || fail('sinh via exp');
  const asin = await buildCustom('asin(x)');
  close(asin.coeffs(0, 5), [0, 1, 0, 1 / 6, 0, 3 / 40]) || fail('asin series');
  const twoX = await buildCustom('2^x');
  close(twoX.coeffs(0, 3), [1, Math.LN2, Math.LN2 ** 2 / 2, Math.LN2 ** 3 / 6]) || fail('2^x series');
  const bad1 = await buildCustom('sin(x)/x');
  bad1.coeffs(0, 3).every(Number.isNaN) || fail('sin(x)/x at 0 should be NaN, not analytic as written');
  for (const t of ['foo(x)', 'y+x', 'x +', '']) {
    let threw = false;
    try { await buildCustom(t); } catch { threw = true; }
    threw || fail(`"${t}" should be rejected`);
  }
}

console.log(bad ? `\n${bad} problem(s)` : 'All math checks passed.');
process.exit(bad ? 1 : 0);
