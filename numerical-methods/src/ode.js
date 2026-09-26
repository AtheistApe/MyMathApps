// ----------------------------------------------------------------------------
// ODE numerical methods for the Math 252 visualizer.
//
// Each method exports a "stepper" with a uniform interface:
//
//   step({ code, t, y, h, history }) -> {
//     yNext: number,                         // y_{n+1}
//     marks: Array<{kind: string, ...}>,     // visual annotations for the UI
//   }
//
// Marks are tagged drawing instructions the UI can render to teach how the
// method works (predictor points, slope evaluations, Newton iterates, etc.).
// The math layer never touches the DOM — UI consumers decide what to draw.
//
// History: multistep methods (Adams-Bashforth, Adams-Moulton) need previous
// (t, y, f) tuples. The runner manages this and passes a `history` array
// where history[i] = { t, y, f } with i=0 being the most recent committed
// node. Single-step methods ignore history.
//
// Reference solution: a fixed-step RK4 with very small h. Honest "exact" for
// equations without closed-form solutions.
// ----------------------------------------------------------------------------

import { parse } from 'mathjs'

// ----- Compilation / evaluation -----

export function compileF(expr) {
  try {
    const node = parse(expr)
    const code = node.compile()
    code.evaluate({ t: 0, y: 0 })  // smoke-test
    return { code, error: null, node }
  } catch (e) {
    return { code: null, error: e.message, node: null }
  }
}

export function evalF(code, t, y) {
  try {
    const v = code.evaluate({ t, y })
    if (typeof v !== 'number' || !isFinite(v)) return NaN
    return v
  } catch {
    return NaN
  }
}

// ----- Single-step explicit methods -----

export const forwardEuler = {
  id: 'fwd-euler',
  name: 'Forward Euler',
  order: 1,
  type: 'explicit',
  multistep: false,
  step({ code, t, y, h }) {
    const f = evalF(code, t, y)
    const yNext = y + h * f
    return {
      yNext,
      marks: [
        // The tangent line at (t, y) with slope f, drawn from t to t+h.
        // The UI draws this as a faint segment showing what Euler "sees".
        { kind: 'tangent', t0: t, y0: y, slope: f, t1: t + h, y1: yNext },
      ],
    }
  },
}

// Heun's method (improved Euler, RK2 in trapezoidal form):
//   k1 = f(t, y)
//   k2 = f(t+h, y + h k1)             ← predictor uses Euler step
//   y_{n+1} = y + (h/2)(k1 + k2)      ← corrector averages slopes
export const heun = {
  id: 'heun',
  name: "Heun's method",
  order: 2,
  type: 'explicit',
  multistep: false,
  step({ code, t, y, h }) {
    const k1 = evalF(code, t, y)
    const yPred = y + h * k1
    const k2 = evalF(code, t + h, yPred)
    const yNext = y + (h / 2) * (k1 + k2)
    return {
      yNext,
      marks: [
        // Predictor leg: the Euler tangent the predictor follows.
        { kind: 'predictor', t0: t, y0: y, slope: k1, t1: t + h, y1: yPred },
        // Corrector slope at the predicted point.
        { kind: 'slope-at', t: t + h, y: yPred, slope: k2 },
        // Final corrected segment (averaged slope).
        { kind: 'corrector', t0: t, y0: y, slope: (k1 + k2) / 2, t1: t + h, y1: yNext },
      ],
    }
  },
}

// Classical RK4.
//   k1 = f(t, y)
//   k2 = f(t+h/2, y + h k1/2)
//   k3 = f(t+h/2, y + h k2/2)
//   k4 = f(t+h, y + h k3)
//   y_{n+1} = y + (h/6)(k1 + 2k2 + 2k3 + k4)
export const rk4 = {
  id: 'rk4',
  name: 'RK4',
  order: 4,
  type: 'explicit',
  multistep: false,
  step({ code, t, y, h }) {
    const k1 = evalF(code, t, y)
    const k2 = evalF(code, t + h / 2, y + (h / 2) * k1)
    const k3 = evalF(code, t + h / 2, y + (h / 2) * k2)
    const k4 = evalF(code, t + h, y + h * k3)
    const yNext = y + (h / 6) * (k1 + 2 * k2 + 2 * k3 + k4)
    return {
      yNext,
      marks: [
        // The four slope evaluations, with the points at which they're taken.
        { kind: 'k-eval', label: 'k1', t: t,         y: y,                  slope: k1 },
        { kind: 'k-eval', label: 'k2', t: t + h / 2, y: y + (h / 2) * k1,   slope: k2 },
        { kind: 'k-eval', label: 'k3', t: t + h / 2, y: y + (h / 2) * k2,   slope: k3 },
        { kind: 'k-eval', label: 'k4', t: t + h,     y: y + h * k3,         slope: k4 },
        // The final committed step using the weighted-average slope.
        { kind: 'rk4-step', t0: t, y0: y, slope: (k1 + 2 * k2 + 2 * k3 + k4) / 6, t1: t + h, y1: yNext },
      ],
    }
  },
}

// ----- Implicit Euler -----
// y_{n+1} = y_n + h · f(t_{n+1}, y_{n+1})
// Solve for y_{n+1} via Newton's method on
//     g(Y) = Y - y_n - h · f(t_{n+1}, Y) = 0.
// Jacobian estimated by finite differences (no symbolic differentiation).
//
// We track Newton iterates so the UI can show the convergence to the implicit
// answer — students see this isn't magic, it's an inner solve.
export const implicitEuler = {
  id: 'imp-euler',
  name: 'Implicit Euler',
  order: 1,
  type: 'implicit',
  multistep: false,
  step({ code, t, y, h }) {
    const tNext = t + h
    // Initial guess: forward Euler step.
    let Y = y + h * evalF(code, t, y)
    const iterates = [Y]
    let converged = false
    const maxIter = 30
    const tol = 1e-10
    for (let k = 0; k < maxIter; k++) {
      const fY = evalF(code, tNext, Y)
      if (!isFinite(fY)) break
      const g = Y - y - h * fY
      // Numerical Jacobian: ∂g/∂Y = 1 - h · ∂f/∂Y at (tNext, Y).
      const eps = Math.max(1e-8, 1e-6 * Math.abs(Y))
      const fYp = evalF(code, tNext, Y + eps)
      if (!isFinite(fYp)) break
      const dfdy = (fYp - fY) / eps
      const dg = 1 - h * dfdy
      if (Math.abs(dg) < 1e-14) break  // singular Jacobian
      const dY = -g / dg
      Y = Y + dY
      iterates.push(Y)
      if (Math.abs(dY) < tol) { converged = true; break }
    }
    return {
      yNext: Y,
      converged,
      marks: [
        // Newton iterate trail, for the UI to render as small markers.
        { kind: 'newton-iterates', tNext, iterates },
        // The final committed step.
        { kind: 'implicit-step', t0: t, y0: y, t1: tNext, y1: Y },
      ],
    }
  },
}

// ----- Adams-Bashforth 4 (explicit, 4-step) -----
// y_{n+1} = y_n + (h/24)(55 f_n - 59 f_{n-1} + 37 f_{n-2} - 9 f_{n-3})
// Needs 4 history points. For step indices n < 3, the runner bootstraps with
// RK4 — the math layer just reports needsBootstrap.
export const ab4 = {
  id: 'ab4',
  name: 'Adams-Bashforth 4',
  order: 4,
  type: 'explicit',
  multistep: true,
  steps: 4,
  step({ code, t, y, h, history }) {
    if (!history || history.length < 4) {
      return { yNext: NaN, needsBootstrap: true, marks: [] }
    }
    // history[0] = current = (t, y, f_n); history[1..3] = previous.
    const f0 = history[0].f
    const f1 = history[1].f
    const f2 = history[2].f
    const f3 = history[3].f
    const yNext = y + (h / 24) * (55 * f0 - 59 * f1 + 37 * f2 - 9 * f3)
    return {
      yNext,
      marks: [
        // Show the history window the method is using.
        {
          kind: 'multistep-window',
          nodes: history.slice(0, 4).map(h => ({ t: h.t, y: h.y })),
        },
        { kind: 'committed-step', t0: t, y0: y, t1: t + h, y1: yNext },
      ],
    }
  },
}

// ----- Adams-Moulton 3 (implicit, 3-step) -----
// y_{n+1} = y_n + (h/24)(9 f_{n+1} + 19 f_n - 5 f_{n-1} + f_{n-2})
// Predictor-corrector mode: predict y_{n+1} with AB4 (or AB3 if only 3 nodes),
// then iterate the corrector to convergence (usually 1-3 iterations).
//
// Needs 3 history points (current + 2 previous). We bootstrap with RK4.
export const am3 = {
  id: 'am3',
  name: 'Adams-Moulton 3 (PECE)',
  order: 4,
  type: 'predictor-corrector',
  multistep: true,
  steps: 3,
  step({ code, t, y, h, history }) {
    if (!history || history.length < 3) {
      return { yNext: NaN, needsBootstrap: true, marks: [] }
    }
    const tNext = t + h
    const f0 = history[0].f
    const f1 = history[1].f
    const f2 = history[2].f
    // Predictor: AB3 (uses current + 2 prior; one less than AB4).
    //   y* = y_n + (h/12)(23 f_n - 16 f_{n-1} + 5 f_{n-2})
    let yPred = y + (h / 12) * (23 * f0 - 16 * f1 + 5 * f2)
    const predicted = yPred
    // Corrector iteration: AM3.
    let Y = yPred
    const iterates = [Y]
    const maxIter = 5
    const tol = 1e-10
    let converged = false
    for (let k = 0; k < maxIter; k++) {
      const fNext = evalF(code, tNext, Y)
      if (!isFinite(fNext)) break
      const Ynew = y + (h / 24) * (9 * fNext + 19 * f0 - 5 * f1 + f2)
      iterates.push(Ynew)
      if (Math.abs(Ynew - Y) < tol) { Y = Ynew; converged = true; break }
      Y = Ynew
    }
    return {
      yNext: Y,
      converged,
      marks: [
        {
          kind: 'multistep-window',
          nodes: history.slice(0, 3).map(h => ({ t: h.t, y: h.y })),
        },
        { kind: 'pc-predict', t: tNext, y: predicted },
        { kind: 'pc-corrected', tNext, iterates },
        { kind: 'committed-step', t0: t, y0: y, t1: tNext, y1: Y },
      ],
    }
  },
}

export const METHODS = [forwardEuler, heun, rk4, implicitEuler, ab4, am3]
export const METHOD_BY_ID = Object.fromEntries(METHODS.map(m => [m.id, m]))

// ----- Runner -----
//
// Given a method, an IVP (t0, y0), step size h, and a t-target, produce the
// full trajectory: array of { t, y, f, marks, bootstrapped }.
//
// Direction: sign of (tEnd - t0) determines forward/backward integration.
// Backward integration uses negative h with the same step formulas — works
// uniformly for one-step methods and for multi-step methods so long as the
// bootstrap respects sign.
//
// Bootstrap for multistep: when the method needs k history points but only
// j < k are available, we run RK4 with the same h to fill in. Bootstrap nodes
// are flagged so the UI can mark them visually.

export function runMethod(method, code, t0, y0, h, tEnd) {
  const direction = Math.sign(tEnd - t0) || 1
  const hSigned = direction * Math.abs(h)
  const span = Math.abs(tEnd - t0)
  if (span === 0 || h === 0) {
    const f0 = evalF(code, t0, y0)
    return [{ t: t0, y: y0, f: f0, marks: [], bootstrapped: false }]
  }
  const nSteps = Math.max(1, Math.floor(span / Math.abs(hSigned)))
  const nodes = []

  // Initial node. f is computed at the IC.
  const f0 = evalF(code, t0, y0)
  nodes.push({ t: t0, y: y0, f: f0, marks: [], bootstrapped: false })

  if (!method.multistep) {
    // Pure single-step loop.
    for (let i = 0; i < nSteps; i++) {
      const cur = nodes[nodes.length - 1]
      const result = method.step({ code, t: cur.t, y: cur.y, h: hSigned })
      if (!isFinite(result.yNext)) break
      const tNext = cur.t + hSigned
      const fNext = evalF(code, tNext, result.yNext)
      nodes.push({
        t: tNext, y: result.yNext, f: fNext,
        marks: result.marks, bootstrapped: false,
        meta: result.converged !== undefined ? { converged: result.converged } : undefined,
      })
    }
    return nodes
  }

  // Multistep: bootstrap with RK4 for the first (steps - 1) increments.
  // After bootstrap, history of length method.steps is available.
  const bootstrapCount = method.steps - 1
  for (let i = 0; i < Math.min(bootstrapCount, nSteps); i++) {
    const cur = nodes[nodes.length - 1]
    const result = rk4.step({ code, t: cur.t, y: cur.y, h: hSigned })
    if (!isFinite(result.yNext)) return nodes
    const tNext = cur.t + hSigned
    const fNext = evalF(code, tNext, result.yNext)
    nodes.push({
      t: tNext, y: result.yNext, f: fNext,
      marks: result.marks, bootstrapped: true,
    })
  }

  // Multistep loop. history is most-recent-first.
  for (let i = bootstrapCount; i < nSteps; i++) {
    const cur = nodes[nodes.length - 1]
    // Build history window: most recent first, length = method.steps.
    const history = []
    for (let k = 0; k < method.steps && nodes.length - 1 - k >= 0; k++) {
      history.push(nodes[nodes.length - 1 - k])
    }
    const result = method.step({ code, t: cur.t, y: cur.y, h: hSigned, history })
    if (!isFinite(result.yNext)) break
    const tNext = cur.t + hSigned
    const fNext = evalF(code, tNext, result.yNext)
    nodes.push({
      t: tNext, y: result.yNext, f: fNext,
      marks: result.marks, bootstrapped: false,
      meta: result.converged !== undefined ? { converged: result.converged } : undefined,
    })
  }

  return nodes
}

// ----- Reference solution -----
//
// "Honest exact": fixed-step RK4 with a very small h. Default refinement is
// 50× the user's display step, capped so we never integrate forever.
// Returns an array of (t, y) sampled at the same node times as the user's
// numerical run, plus extra dense points between for smooth plotting.

export function referenceTrajectory(code, t0, y0, tEnd, opts = {}) {
  const direction = Math.sign(tEnd - t0) || 1
  const span = Math.abs(tEnd - t0)
  const refineFactor = opts.refineFactor || 50
  const baseH = opts.baseH || (span / 200)
  const hRef = direction * Math.min(Math.abs(baseH) / refineFactor, span / 50)
  const nSteps = Math.ceil(span / Math.abs(hRef))
  const out = [[t0, y0]]
  let t = t0, y = y0
  for (let i = 0; i < nSteps && i < 1_000_000; i++) {
    const h = (Math.abs(t + hRef - tEnd) < Math.abs(hRef)) ? (tEnd - t) : hRef
    const k1 = evalF(code, t, y)
    if (!isFinite(k1)) break
    const k2 = evalF(code, t + h / 2, y + (h / 2) * k1)
    const k3 = evalF(code, t + h / 2, y + (h / 2) * k2)
    const k4 = evalF(code, t + h, y + h * k3)
    if (!isFinite(k4)) break
    y = y + (h / 6) * (k1 + 2 * k2 + 2 * k3 + k4)
    t = t + h
    out.push([t, y])
    if ((direction > 0 && t >= tEnd) || (direction < 0 && t <= tEnd)) break
  }
  return out
}

// ----- Error metrics -----
//
// Given numerical nodes [{t, y, ...}] and a reference trajectory [[t, y], ...],
// produce per-node absolute error |y_num - y_exact| by interpolating the
// reference at each node's t.

export function computeErrors(nodes, reference) {
  if (reference.length < 2) return nodes.map(() => 0)
  const errs = []
  // Reference is monotone in t (forward or backward). Use a moving cursor.
  const direction = Math.sign(reference[1][0] - reference[0][0]) || 1
  let cursor = 0
  for (const node of nodes) {
    while (cursor < reference.length - 2 &&
           ((direction > 0 && reference[cursor + 1][0] < node.t) ||
            (direction < 0 && reference[cursor + 1][0] > node.t))) {
      cursor++
    }
    const [tA, yA] = reference[cursor]
    const [tB, yB] = reference[Math.min(cursor + 1, reference.length - 1)]
    const denom = tB - tA
    const yRef = denom === 0 ? yA : yA + (yB - yA) * ((node.t - tA) / denom)
    errs.push(Math.abs(node.y - yRef))
  }
  return errs
}

// ----- Convergence study -----
//
// For each method in `methods`, run it at each step size in `hList` and
// compute the max error over the whole trajectory against either an exact
// function (if provided) or a high-precision RK4 reference.
//
// Returns: [{ id, name, order, results: [{ h, maxErr, lastErr }] }]
//
// The empirical order between consecutive h values is log2(e1/e2) when the
// h ratio is 2. UI can compute this from the results array.

export function convergenceStudy({ methods, code, t0, y0, tEnd, hList, exactFn }) {
  // Build a high-precision reference once (only used if exactFn is null).
  const ref = exactFn ? null : referenceTrajectory(code, t0, y0, tEnd, {
    refineFactor: 100, baseH: Math.min(...hList) / 4,
  })

  return methods.map(method => {
    const results = hList.map(h => {
      const nodes = runMethod(method, code, t0, y0, h, tEnd)
      let maxErr = 0
      let lastErr = 0
      nodes.forEach(node => {
        let exact
        if (exactFn) exact = exactFn(node.t, y0, t0)
        else {
          // Linear interpolate the reference at node.t
          const r = ref
          if (r.length < 2) return
          // Binary search would be faster but list is short here.
          let i = 0
          while (i < r.length - 2 && r[i + 1][0] < node.t) i++
          const [tA, yA] = r[i], [tB, yB] = r[Math.min(i + 1, r.length - 1)]
          const denom = tB - tA
          exact = denom === 0 ? yA : yA + (yB - yA) * ((node.t - tA) / denom)
        }
        const err = Math.abs(node.y - exact)
        if (isFinite(err)) {
          if (err > maxErr) maxErr = err
          lastErr = err
        }
      })
      return { h, maxErr, lastErr, nSteps: nodes.length - 1 }
    })
    return { id: method.id, name: method.name, order: method.order, results }
  })
}
