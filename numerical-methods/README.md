# Numerical Methods

Visualizer for numerical solution methods of first-order ODEs y' = f(t, y).
Built for Math 252 at the College of San Mateo.

Companion app to [slope-field](https://github.com/AtheistApe/slope-field) —
that app covers qualitative analysis (slope fields, equilibria, phase lines);
this one covers quantitative methods and their convergence/stability behavior.

## Methods implemented

| Method | Order | Type | Multistep |
|---|---|---|---|
| Forward Euler | 1 | explicit | no |
| Heun's method (improved Euler) | 2 | explicit | no |
| RK4 | 4 | explicit | no |
| Implicit Euler | 1 | implicit (Newton) | no |
| Adams-Bashforth 4 | 4 | explicit | yes (4-step) |
| Adams-Moulton 3 (PECE) | 4 | predictor-corrector | yes (3-step) |

Multistep methods bootstrap with RK4 for the first k−1 steps. Bootstrap nodes
render as hollow squares to make this visible. Implicit Euler uses Newton with
a numerical Jacobian.

## Features

- **Method picker** — multi-select; RK4 + Forward Euler load by default
- **Click-to-set-IC** plus a numeric `y(t₀) = y₀` form
- **Step-by-step playback** — walk through the algorithm one node at a time;
  current step's scaffolding renders at full strength, earlier steps dimmed
- **Convergence study** — halve `h` six times for the active methods, get a
  table of empirical orders and a log-log plot
- **SVG export** of the plot + error panel and of the convergence study,
  formatted for LaTeX inclusion
- **"How methods work" document** — student-facing explainer (KaTeX math,
  one-liner intuition + formula + geometric meaning per method) opens in a
  new tab; printable
- **Pedagogical scaffolding** for every method: tangent lines, predictor
  legs, k-evaluations, Newton iterates, multistep history windows
- **Linear / log error plot** computed against the analytic exact solution
  when available, or against an RK4 reference otherwise
- **Stiff and oscillatory presets** designed to make method choice matter

## Project layout

```
src/
  ode.js          # six methods + runner + reference + error metrics + convergence study
  svgExport.js    # SVG builders for plot+error and convergence
  presets.js      # equation presets, with closed-form exacts where possible
  App.jsx         # full UI
  main.jsx        # React entry
public/
  methods.html    # student-facing explainer document (uses KaTeX from CDN)
tests/
  run.js          # 48 tests covering accuracy, orders, marks, edge cases, convergence study
  svg.js          # 19 tests covering SVG export structure
```

## Develop

```bash
npm install
npm run dev      # local dev server
npm test         # math + SVG tests (67 total, ~1 second)
npm run build    # production build to dist/
```

## Test coverage

Empirical convergence orders verified by halving h:

- Forward Euler: 1.01 ≈ 1
- Heun's method: 2.03 ≈ 2
- RK4: 4.06 ≈ 4
- Implicit Euler: 0.99 ≈ 1
- Adams-Bashforth 4: 3.98 ≈ 4
- Adams-Moulton 3: 3.92 ≈ 4

The stiff-stability test confirms forward Euler diverges on `y' = -50y` with
`h = 0.05` (`|y_final| ≈ 3300`) while implicit Euler stays stable
(`|y_final| ≈ 1.3e-11`). That contrast is the point of one of the presets.

The convergence study test verifies forward Euler reduces error 9.5× when h
shrinks 8× (theoretical: 8×) and RK4 reduces error 5366× (theoretical: 4096×).
