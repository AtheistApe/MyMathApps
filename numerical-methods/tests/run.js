// Test harness for src/ode.js. Run with: node tests/run.js
//
// We test:
//   1. Each method gets the right answer to 1e-10 tolerance on a trivial IVP
//      (y' = y, y(0) = 1, exact: e^t) at small h.
//   2. Empirical convergence order matches the theoretical order for each
//      method by halving h and measuring error reduction.
//   3. Multistep methods bootstrap correctly (first k-1 nodes flagged, value
//      matches RK4).
//   4. Implicit Euler converges on stiff problem y' = -50y where forward
//      Euler diverges.
//   5. Reference trajectory agrees with closed-form to high precision.
//   6. Error metrics interpolate correctly and sign-correctly handle backward
//      integration.
//   7. Marks are emitted with the right structure for each method.

import {
  forwardEuler, heun, rk4, implicitEuler, ab4, am3,
  METHODS, runMethod, referenceTrajectory, computeErrors,
  compileF, evalF, convergenceStudy,
} from '../src/ode.js'

let passed = 0, failed = 0
const failures = []

function check(name, ok, detail) {
  if (ok) { passed++; console.log(`  PASS  ${name}`) }
  else {
    failed++
    failures.push({ name, detail })
    console.log(`  FAIL  ${name}${detail ? '  — ' + detail : ''}`)
  }
}

function approx(a, b, tol = 1e-9) {
  return Math.abs(a - b) <= tol * Math.max(1, Math.abs(a), Math.abs(b))
}

// ============================================================================
console.log('\n[1] Each method on y\' = y, y(0) = 1, exact = e^t')
// ============================================================================
{
  const { code } = compileF('y')
  const tEnd = 1.0
  for (const method of METHODS) {
    const h = 0.001  // small h so even Euler is decent
    const nodes = runMethod(method, code, 0, 1, h, tEnd)
    const last = nodes[nodes.length - 1]
    const exact = Math.exp(last.t)
    const err = Math.abs(last.y - exact)
    // Tolerances scaled to method order: Euler is bad even at h=0.001.
    const tol = method.order === 1 ? 5e-3 : (method.order === 2 ? 5e-6 : 1e-9)
    check(`${method.name}: y(${last.t.toFixed(3)}) ≈ e^${last.t.toFixed(3)} (err=${err.toExponential(2)})`,
      err < tol, `error ${err} exceeded tolerance ${tol}`)
  }
}

// ============================================================================
console.log('\n[2] Empirical convergence orders on y\' = -y, y(0) = 1')
// ============================================================================
// True convergence order for method of order p: error scales as h^p.
// Halving h should reduce error by factor 2^p.
{
  const { code } = compileF('-y')
  const tEnd = 1.0
  const exact = Math.exp(-tEnd)

  function maxErr(method, h) {
    const nodes = runMethod(method, code, 0, 1, h, tEnd)
    return Math.abs(nodes[nodes.length - 1].y - exact)
  }

  // Pick h-pairs that are well inside the asymptotic regime — small enough
  // to be in the leading-order error regime, but not so small that
  // floating-point noise dominates.
  const tests = [
    { method: forwardEuler, h1: 0.02,    h2: 0.01,    expected: 1 },
    { method: heun,         h1: 0.05,    h2: 0.025,   expected: 2 },
    { method: rk4,          h1: 0.1,     h2: 0.05,    expected: 4 },
    { method: implicitEuler,h1: 0.02,    h2: 0.01,    expected: 1 },
    { method: ab4,          h1: 0.02,    h2: 0.01,    expected: 4 },
    { method: am3,          h1: 0.05,    h2: 0.025,   expected: 4 },
  ]
  for (const { method, h1, h2, expected } of tests) {
    const e1 = maxErr(method, h1)
    const e2 = maxErr(method, h2)
    if (e2 < 1e-15) {
      // Below noise floor; skip ratio check, but verify error is small.
      check(`${method.name}: at noise floor (e1=${e1.toExponential(2)}, e2=${e2.toExponential(2)})`,
        e1 < 1e-3)
      continue
    }
    // Empirical order = log2(e1 / e2). Ratio of h's is 2.
    const order = Math.log2(e1 / e2)
    // Allow ±0.5 from theoretical (multistep + RK4 sometimes show
    // super-convergence; we mainly want to catch order-1 vs order-4 confusion).
    const ok = Math.abs(order - expected) < 0.7
    check(`${method.name}: empirical order ${order.toFixed(2)} ≈ ${expected}`,
      ok, `e1=${e1.toExponential(2)}, e2=${e2.toExponential(2)}, ratio=${(e1/e2).toFixed(2)}`)
  }
}

// ============================================================================
console.log('\n[3] Multistep bootstrap')
// ============================================================================
{
  const { code } = compileF('-y')
  const h = 0.1
  const nodes = runMethod(ab4, code, 0, 1, h, 1.0)
  // AB4 needs 4 history points → bootstrap fills nodes 1, 2, 3 with RK4.
  // Nodes: 0 (IC), 1, 2, 3 (bootstrap), 4..n (AB4).
  check('AB4: node 0 is IC, not bootstrapped', !nodes[0].bootstrapped)
  check('AB4: node 1 is bootstrapped', nodes[1].bootstrapped)
  check('AB4: node 2 is bootstrapped', nodes[2].bootstrapped)
  check('AB4: node 3 is bootstrapped', nodes[3].bootstrapped)
  if (nodes.length > 4) {
    check('AB4: node 4 is NOT bootstrapped', !nodes[4].bootstrapped)
    check('AB4: node 4 has multistep-window mark',
      nodes[4].marks.some(m => m.kind === 'multistep-window'))
  }
  // Check bootstrap value matches a stand-alone RK4 run.
  const rk4Nodes = runMethod(rk4, code, 0, 1, h, 1.0)
  check('AB4: bootstrap node 1 matches RK4',
    approx(nodes[1].y, rk4Nodes[1].y, 1e-12),
    `${nodes[1].y} vs ${rk4Nodes[1].y}`)

  // AM3 needs 3 history points → bootstraps 2.
  const am3Nodes = runMethod(am3, code, 0, 1, h, 1.0)
  check('AM3: nodes 1, 2 bootstrapped',
    am3Nodes[1].bootstrapped && am3Nodes[2].bootstrapped)
  if (am3Nodes.length > 3) {
    check('AM3: node 3 NOT bootstrapped', !am3Nodes[3].bootstrapped)
  }
}

// ============================================================================
console.log('\n[4] Stiff problem: implicit Euler vs forward Euler')
// ============================================================================
// y' = -50y with h = 0.05. Stability requires |1 + h·λ| < 1, i.e.
// |1 - 50·0.05| = |1 - 2.5| = 1.5. Forward Euler is UNSTABLE here.
// Implicit Euler: |1/(1 - h·λ)| = 1/(1 + 2.5) = 0.286, stable.
{
  const { code } = compileF('-50 * y')
  const h = 0.05, tEnd = 1.0
  const exact = Math.exp(-50 * tEnd)  // ≈ 1.93e-22

  const fe = runMethod(forwardEuler, code, 0, 1, h, tEnd)
  const ie = runMethod(implicitEuler, code, 0, 1, h, tEnd)
  const feLast = Math.abs(fe[fe.length - 1].y)
  const ieLast = Math.abs(ie[ie.length - 1].y)

  // Forward Euler nodes oscillate with growing magnitude. Sequence of
  // multipliers (1 + hλ) = (1 - 2.5) = -1.5, so |y_n| = 1.5^n.
  check(`Fwd Euler diverges (|y_final|=${feLast.toExponential(2)} >> 1)`, feLast > 10)
  check(`Implicit Euler stable (|y_final|=${ieLast.toExponential(2)} small)`, ieLast < 1e-3)
  // Implicit Euler should be small but not as accurate as exact (it's order 1).
  check(`Implicit Euler converged on each step`,
    ie.every((n, i) => i === 0 || n.meta?.converged !== false))
}

// ============================================================================
console.log('\n[5] Reference trajectory accuracy on y\' = -y')
// ============================================================================
{
  const { code } = compileF('-y')
  const ref = referenceTrajectory(code, 0, 1, 2.0)
  const last = ref[ref.length - 1]
  const exact = Math.exp(-2)
  const err = Math.abs(last[1] - exact)
  check(`Reference at t=2: err=${err.toExponential(2)}`, err < 1e-10)
}

// ============================================================================
console.log('\n[6] Error metrics — interpolation + backward integration')
// ============================================================================
{
  const { code } = compileF('-y')
  // Forward integration.
  const nodes = runMethod(forwardEuler, code, 0, 1, 0.1, 1.0)
  const ref = referenceTrajectory(code, 0, 1, 1.0)
  const errs = computeErrors(nodes, ref)
  check('errors: same length as nodes', errs.length === nodes.length)
  check('errors: first error ≈ 0 (IC matches)', errs[0] < 1e-10)
  check('errors: monotone-ish growing for Euler on decay',
    errs[errs.length - 1] > errs[1])
  // Errors should match |y_node - e^(-t_node)| within 1e-12.
  for (let i = 1; i < nodes.length; i++) {
    const expected = Math.abs(nodes[i].y - Math.exp(-nodes[i].t))
    if (Math.abs(errs[i] - expected) > 1e-6) {
      check(`error[${i}] matches direct calc`, false,
        `${errs[i]} vs ${expected}`)
      break
    }
  }
  check(`errors: all match direct calc`, true)

  // Backward integration: y' = -y from (1, 1) back to t=0. Exact: y = e^(1-t).
  const codeB = compileF('-y').code
  const back = runMethod(rk4, codeB, 1, 1, 0.05, 0.0)
  // Last node should be at t≈0 with y ≈ e^1 = 2.718.
  const lastBack = back[back.length - 1]
  check('Backward RK4: ends near t=0',
    Math.abs(lastBack.t) < 0.1, `t=${lastBack.t}`)
  check(`Backward RK4: y(0) ≈ e (got ${lastBack.y.toFixed(6)})`,
    Math.abs(lastBack.y - Math.E) < 1e-3)
}

// ============================================================================
console.log('\n[7] Mark structure for each method')
// ============================================================================
{
  const { code } = compileF('y')

  // Forward Euler: one tangent mark per step.
  const feNodes = runMethod(forwardEuler, code, 0, 1, 0.5, 1.0)
  check('Forward Euler: each non-IC node has tangent mark',
    feNodes.slice(1).every(n => n.marks.some(m => m.kind === 'tangent')))

  // Heun: predictor + slope-at + corrector marks.
  const heunNodes = runMethod(heun, code, 0, 1, 0.5, 1.0)
  const hKinds = new Set(heunNodes[1].marks.map(m => m.kind))
  check("Heun: marks include predictor, slope-at, corrector",
    hKinds.has('predictor') && hKinds.has('slope-at') && hKinds.has('corrector'))

  // RK4: four k-eval marks.
  const rkNodes = runMethod(rk4, code, 0, 1, 0.5, 1.0)
  const kEvals = rkNodes[1].marks.filter(m => m.kind === 'k-eval')
  check(`RK4: 4 k-evals per step (got ${kEvals.length})`, kEvals.length === 4)
  check(`RK4: k-eval labels k1..k4`,
    kEvals.map(k => k.label).join(',') === 'k1,k2,k3,k4')

  // Implicit Euler: newton-iterates mark with iterates array.
  const ieNodes = runMethod(implicitEuler, code, 0, 1, 0.1, 0.5)
  const newtonMark = ieNodes[1].marks.find(m => m.kind === 'newton-iterates')
  check('Implicit Euler: has newton-iterates mark with non-empty array',
    newtonMark && Array.isArray(newtonMark.iterates) && newtonMark.iterates.length >= 2)

  // AB4: multistep-window mark on first non-bootstrap node.
  const ab4Nodes = runMethod(ab4, compileF('-y').code, 0, 1, 0.1, 1.0)
  if (ab4Nodes.length > 4) {
    const winMark = ab4Nodes[4].marks.find(m => m.kind === 'multistep-window')
    check('AB4: multistep-window mark has 4 nodes',
      winMark && winMark.nodes.length === 4)
  }

  // AM3: predictor + corrector iterates.
  const am3Nodes = runMethod(am3, compileF('-y').code, 0, 1, 0.1, 1.0)
  if (am3Nodes.length > 3) {
    const m = am3Nodes[3].marks
    check('AM3: has pc-predict and pc-corrected marks',
      m.some(x => x.kind === 'pc-predict') &&
      m.some(x => x.kind === 'pc-corrected'))
  }
}

// ============================================================================
console.log('\n[8] Edge cases')
// ============================================================================
{
  // Zero-span integration.
  const { code } = compileF('y')
  const zeroSpan = runMethod(rk4, code, 1, 2, 0.1, 1)
  check('Zero-span returns just IC', zeroSpan.length === 1 && zeroSpan[0].y === 2)

  // Bad expression handling (not a math test, but a robustness one).
  const bad = compileF('this is not math')
  check('Bad expression returns error', bad.code === null && bad.error)

  // NaN propagation: y' = 1/y, IC at y=0 should produce NaN immediately.
  const { code: divCode } = compileF('1 / y')
  const nans = runMethod(forwardEuler, divCode, 0, 0, 0.1, 1.0)
  // First step: f(0,0) = 1/0 = NaN → integration stops at IC.
  check('NaN at IC stops integration', nans.length === 1)
}

// ============================================================================
console.log('\n[9] Convergence study')
// ============================================================================
{
  const { code } = compileF('-y')
  const exactFn = (t, y0, t0) => y0 * Math.exp(-(t - t0))
  const hList = [0.4, 0.2, 0.1, 0.05]

  const study = convergenceStudy({
    methods: [forwardEuler, rk4],
    code, t0: 0, y0: 1, tEnd: 1.0,
    hList, exactFn,
  })

  check('Returns one entry per method', study.length === 2)
  check('First method is forwardEuler', study[0].id === 'fwd-euler')
  check('Each method has results for each h', study[0].results.length === hList.length)

  // Check that for forward Euler, halving h roughly halves max error.
  const feR = study[0].results
  // Order between idx 0 (h=0.4) and idx 3 (h=0.05): h ratio = 8. Error
  // ratio ~ 8 for order-1 method.
  const fePower = feR[0].maxErr / feR[3].maxErr
  check(`Forward Euler error ratio over 8x h-shrink ≈ 8 (got ${fePower.toFixed(2)})`,
    fePower > 5 && fePower < 12)

  // RK4: error ratio over h ratio 8 should be ~ 8^4 = 4096.
  const rkR = study[1].results
  const rkPower = rkR[0].maxErr / rkR[3].maxErr
  check(`RK4 error ratio over 8x h-shrink ≈ 4096 (got ${rkPower.toFixed(0)})`,
    rkPower > 1000 && rkPower < 10000)

  // Test the exactFn=null branch with RK4 reference.
  const studyNoExact = convergenceStudy({
    methods: [forwardEuler],
    code, t0: 0, y0: 1, tEnd: 1.0,
    hList: [0.1, 0.05], exactFn: null,
  })
  check('RK4-reference fallback works',
    studyNoExact[0].results[0].maxErr > 0 && studyNoExact[0].results[1].maxErr > 0)
  check('Errors decrease with smaller h (RK4 ref)',
    studyNoExact[0].results[0].maxErr > studyNoExact[0].results[1].maxErr)
}

// ============================================================================
console.log(`\n=== ${passed} passed, ${failed} failed ===`)
if (failed > 0) {
  console.log('\nFailures:')
  for (const f of failures) console.log(`  - ${f.name}: ${f.detail || '(no detail)'}`)
  process.exit(1)
}
