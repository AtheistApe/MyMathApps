// Sanity checks: node scripts/check-math.mjs
// For every preset and several centers, compare T_n(a+h) with f(a+h) for small h,
// and compare the stated radius with the coefficient-based estimate.
import { PRESETS } from '../src/math/functions.js';
import { horner, estimateRadius, errorInfo, partialSumsGrid, partialSums } from '../src/math/taylor.js';
import { niceTicks } from '../src/math/ticks.js';
import { snap, clamp } from '../src/math/util.js';
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
      const est = estimateRadius(c, N, 1).rows.pop();
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
  const pole = await buildCustom('1/x');
  pole.coeffs(0, 3).every(Number.isNaN) || fail('1/x at 0 is a genuine pole and should be undefined');
  for (const t of ['foo(x)', 'y+x', 'x +', '']) {
    let threw = false;
    try { await buildCustom(t); } catch { threw = true; }
    threw || fail(`"${t}" should be rejected`);
  }
}


// ---- regression tests for bugs found in the code review ----
{
  // tiny non-integer-derivative coefficients must not collapse to "0"
  const e = PRESETS[0].coeffs(0.5, 30);
  const co = describeCoef(e[30], 30);
  co.text !== '0' && !/^0\(/.test(termText(co, 0.5, 30)) || fail(`tiny coefficient shown as zero: ${co.text}`);

  // terminating series (polynomials) have R = infinity, not a bogus finite estimate
  const poly = await buildCustom('x^3 + 2x');
  for (const a of [0, 0.5, -1.2]) estimateRadius(poly.coeffs(a, 40), 40).R === Infinity || fail(`polynomial radius at a=${a}`);
  const geo = await buildCustom('1/(2-x)');
  Math.abs(estimateRadius(geo.coeffs(0, 40), 40).R - 2) < 1e-9 || fail('1/(2-x) radius should be 2');

  // ticks terminate and stay sensible at extreme positions
  niceTicks(1e13, 1e13 + 1e-3, 6).length <= 200 || fail('niceTicks runaway');
  niceTicks(-5, 5, 8).length === 11 || fail('niceTicks(-5,5)');
  niceTicks(3, 3, 6).length === 0 || fail('niceTicks on an empty range');

  // round-off floor: near the center the error of a high-degree polynomial is below the floor
  const c = PRESETS[0].coeffs(0, 40);
  const info = errorInfo(Math.exp(0.3), c, 19, 0.3);
  info.shown >= info.err && info.shown > 0 || fail('errorInfo');
  const far = errorInfo(Math.exp(5), c, 5, 5);
  far.err > far.floor || fail('far-from-center error should exceed the floor');

  // grid of partial sums agrees with the per-point version
  const xs = [-1, 0.2, 0.9];
  const grid = partialSumsGrid(c, 6, xs, 0);
  xs.forEach((x, i) => partialSums(c, 6, x).every((v, k) => Math.abs(v - grid[k][i]) < 1e-14) || fail('partialSumsGrid'));

  snap(0.123) === 0.1 || fail('snap'); clamp(5, 0, 1) === 1 || fail('clamp');

  // more series functions, each checked against the function itself (Taylor polynomial vs f near a)
  const around = async (expr, f, a, tol = 1e-9) => {
    const cf = await buildCustom(expr);
    const cs = cf.coeffs(a, 24);
    for (const h of [-0.07, 0.04]) {
      const t = horner(cs, 24, h);
      Math.abs(t - f(a + h)) <= tol * Math.max(1, Math.abs(f(a + h))) || fail(`${expr} at a=${a}, h=${h}: ${t} vs ${f(a + h)}`);
    }
  };
  for (const a of [0, 0.4, -0.3]) {
    await around('tanh(x)', Math.tanh, a); await around('cosh(x)', Math.cosh, a); await around('sinh(x)', Math.sinh, a);
    await around('sec(x)', (x) => 1 / Math.cos(x), a); await around('acos(x)', Math.acos, a); await around('asin(x)', Math.asin, a);
    await around('cbrt(1+x)', (x) => Math.cbrt(1 + x), a); await around('abs(x - 0.9) + 1', (x) => Math.abs(x - 0.9) + 1, a);
    await around('log10(2+x)', (x) => Math.log10(2 + x), a); await around('log(2+x, 3)', (x) => Math.log(2 + x) / Math.log(3), a);
    await around('x^x', (x) => Math.pow(x, x), a + 1); await around('exp(sin(x))/(1+x^2)', (x) => Math.exp(Math.sin(x)) / (1 + x * x), a);
    await around('cot(x+1)', (x) => 1 / Math.tan(x + 1), a); await around('csc(x+1)', (x) => 1 / Math.sin(x + 1), a);
  }
  let msg = '';
  try { await buildCustom('x(x+1)'); } catch (err) { msg = err.message; }
  /\*/.test(msg) || fail('x(x+1) should suggest using *');
}


// ---- removable singularities: sin(x)/x at 0 and friends ----
{
  const finite = (cs) => cs.every(Number.isFinite);
  const series = async (expr, a = 0, N = 40) => (await buildCustom(expr)).coeffs(a, N);
  const fact = (k) => { let r = 1; for (let i = 2; i <= k; i++) r *= i; return r; };

  const sinc = await series('sin(x)/x');
  finite(sinc) || fail('sin(x)/x should have finite coefficients through degree 40');
  close(sinc.slice(0, 7), [1, 0, -1 / 6, 0, 1 / 120, 0, -1 / 5040]) || fail('sin(x)/x series');
  const f = (await buildCustom('sin(x)/x')).f;
  f(0) === 1 || fail(`sin(x)/x at 0 should be 1, got ${f(0)}`);
  Math.abs(f(0.5) - Math.sin(0.5) / 0.5) < 1e-15 || fail('sin(x)/x away from 0');

  close((await series('(exp(x)-1)/x')).slice(0, 8), Array.from({ length: 8 }, (_, k) => 1 / fact(k + 1))) || fail('(e^x - 1)/x');
  close((await series('(1-cos(x))/x^2')).slice(0, 5), [1 / 2, 0, -1 / 24, 0, 1 / 720]) || fail('(1 - cos x)/x^2');
  close((await series('x/(exp(x)-1)')).slice(0, 5), [1, -1 / 2, 1 / 12, 0, -1 / 720]) || fail('Bernoulli series x/(e^x - 1)');
  close((await series('tan(x)/x')).slice(0, 4), [1, 0, 1 / 3, 0]) || fail('tan(x)/x');
  close((await series('x/x')).slice(0, 4), [1, 0, 0, 0]) || fail('x/x');
  close((await series('(sin(x)/x - 1)/x^2')).slice(0, 4), [-1 / 6, 0, 1 / 120, 0]) || fail('nested cancellation');
  finite(await series('(sin(x)/x - 1)/x^2')) || fail('nested cancellation should stay finite through degree 40');
  close((await series('exp(sin(x)/x)')).slice(0, 3), [Math.E, 0, -Math.E / 6]) || fail('exp(sinc)');
  close((await series('sin(x)/x + cos(x)')).slice(0, 3), [2, 0, -1 / 6 - 1 / 2]) || fail('sinc + cos');

  // genuine poles stay undefined
  for (const bad of ['1/x', 'sin(x)/x^2', 'cos(x)/x', '1/sin(x)', '(sin(x)/x)/x']) {
    (await series(bad, 0, 10)).some(Number.isNaN) || fail(`${bad} at 0 is a pole and should stay undefined`);
  }
  // unchanged away from the singularity, and the preset-equivalent forms still agree
  close(await series('sin(x)/x', 0.5, 10), (await series('sin(x)*(1/x)', 0.5, 10))) || fail('sinc at 0.5');
}


// ---- exact fractions for series with (k+j)! denominators; irrational coefficients stay decimal ----
{
  const text = async (expr, n) => polynomialText((await buildCustom(expr)).coeffs(0, n), 0, n);
  expect(await text('sin(x)/x', 8), '1 − x²/6 + x⁴/120 − x⁶/5040 + x⁸/362880');
  expect(await text('(exp(x)-1)/x', 4), '1 + x/2 + x²/6 + x³/24 + x⁴/120');
  expect(await text('x/(exp(x)-1)', 4), '1 − x/2 + x²/12 − x⁴/720');
  expect(await text('(1-cos(x))/x^2', 4), '1/2 − x²/24 + x⁴/720');
  expect(polynomialText(PRESETS.find((q) => q.id === 'gauss').coeffs(0, 22), 0, 22), '1 − x² + x⁴/2 − x⁶/6 + x⁸/24 + ⋯ − x²²/39916800');
  // coefficients that are genuinely irrational must stay decimals
  const centers = [0.05, 0.1, 0.15, 0.3, 0.5, 0.65, 0.85, 1, 1.1, 1.35, 1.7, 2, 2.3, 2.75, 3, -0.4, -1.25];
  const cases = ['exp', 'sin', 'cos', 'gauss'].flatMap((id) => centers.map((a) => [id, a]));
  for (const [id, a] of cases) {
    const cs = PRESETS.find((q) => q.id === id).coeffs(a, 30);
    cs.forEach((c, k) => { c === 0 || describeCoef(c, k).kind === 'dec' || fail(`${id} at a=${a}: c_${k} wrongly shown as a fraction (${describeCoef(c, k).text})`); });
  }
}

console.log(bad ? `\n${bad} problem(s)` : 'All math checks passed.');
process.exit(bad ? 1 : 0);
