// Presets chosen to highlight method behavior. Each has an analytic solution
// when possible (so error plots are exact, not RK4-reference) and a "story"
// the app's UI can surface as a tooltip or footnote.

export const PRESETS = [
  {
    name: 'Exponential decay',
    f: '-y',
    t0: 0, y0: 1,
    tMin: 0, tMax: 5, yMin: -0.2, yMax: 1.2,
    h: 0.5,
    exact: (t, y0, t0) => y0 * Math.exp(-(t - t0)),
    note: "Smooth, well-behaved; baseline for showing convergence orders.",
  },
  {
    name: 'Stiff: y′ = −50y',
    f: '-50 * y',
    t0: 0, y0: 1,
    tMin: 0, tMax: 1, yMin: -0.5, yMax: 1.2,
    h: 0.05,
    exact: (t, y0, t0) => y0 * Math.exp(-50 * (t - t0)),
    note: "Forward Euler with h=0.05 oscillates wildly (h·λ = -2.5, outside stability). Implicit Euler is fine.",
  },
  {
    name: 'Logistic growth',
    f: 'y * (1 - y)',
    t0: 0, y0: 0.1,
    tMin: 0, tMax: 8, yMin: -0.1, yMax: 1.2,
    h: 0.5,
    exact: (t, y0, t0) => 1 / (1 + ((1 - y0) / y0) * Math.exp(-(t - t0))),
    note: "Classic S-curve. Methods agree well; good for showing each method 'works' on easy problems.",
  },
  {
    name: 'Oscillator: y′ = cos(t)',
    f: 'cos(t)',
    t0: 0, y0: 0,
    tMin: 0, tMax: 4 * Math.PI, yMin: -1.5, yMax: 1.5,
    h: 0.4,
    exact: (t, y0, t0) => y0 + Math.sin(t) - Math.sin(t0),
    note: "Pure t-dependence; tests how methods handle oscillation. Phase error visible at large h.",
  },
  {
    name: 'Linear: y′ = t − y',
    f: 't - y',
    t0: 0, y0: 1,
    tMin: 0, tMax: 5, yMin: -1, yMax: 5,
    h: 0.4,
    // Exact: y = t - 1 + 2 e^(-t), starting from y(0) = 1.
    exact: (t, y0, t0) => {
      // General: y = t - 1 + C e^(-t). Solve for C from initial: C = (y0 - t0 + 1) e^(t0).
      const C = (y0 - t0 + 1) * Math.exp(t0)
      return t - 1 + C * Math.exp(-t)
    },
    note: "Asymptotic to y = t - 1. Tests handling of mixed t and y dependence.",
  },
  {
    name: 'Riccati-ish: y′ = y² − t',
    f: 'y^2 - t',
    t0: 0, y0: 0,
    tMin: 0, tMax: 3, yMin: -2, yMax: 2,
    h: 0.2,
    exact: null,  // No elementary closed form. UI falls back to RK4 reference.
    note: "Nonlinear, no closed-form. Reference is RK4 with tiny step.",
  },
  {
    name: 'Stiff oscillation: y′ = −10(y − cos t) − sin t',
    f: '-10 * (y - cos(t)) - sin(t)',
    t0: 0, y0: 0,
    tMin: 0, tMax: 4, yMin: -1.5, yMax: 1.5,
    h: 0.1,
    // Exact solution: y = cos(t) + (y0 - cos(t0)) e^(-10(t-t0)).
    exact: (t, y0, t0) => Math.cos(t) + (y0 - Math.cos(t0)) * Math.exp(-10 * (t - t0)),
    note: "Fast transient + slow oscillation. RK4 handles it; explicit Euler struggles unless h is small.",
  },
  {
    name: 'Newton cooling',
    f: '-0.5 * (y - 2)',
    t0: 0, y0: 5,
    tMin: 0, tMax: 8, yMin: 1, yMax: 5.5,
    h: 0.5,
    exact: (t, y0, t0) => 2 + (y0 - 2) * Math.exp(-0.5 * (t - t0)),
    note: "Classic textbook problem. Approaches y = 2 (room temperature).",
  },
]
