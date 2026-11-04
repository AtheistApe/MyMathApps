# Taylor Polynomials & Series Explorer

Interactive app for Math 252. Vite + React + Zustand; math.js is loaded lazily and used only to
*parse* a student's custom function. Runs with mouse (laptop) or touch (iPad).

## Run / build

```bash
npm install
npm run dev        # local development
npm run build      # production build in dist/
npm run check      # numerical sanity checks of every preset (no browser needed)
```

`vite.config.js` sets `base: './'`, so the built `dist/` works from any sub-folder, including
`https://<user>.github.io/MyMathApps/taylor-explorer/`.

## What is in v1

| Tab | Contents |
|---|---|
| **Taylor polynomials** | f(x) and Tₙ(x) on one plot; degree slider with ▶ animation; draggable center *a* and test point x₀; faint lower-degree polynomials; shaded gap; error plot \|f − Tₙ\| (log or linear, x-axis linked to the main plot); live coefficient table f⁽ᵏ⁾(a) → k! → cₖ → term, with exact fractions; optional "evaluate at x₀" columns |
| **Interval of convergence** | Shaded interval (a − R, a + R) with open/closed endpoint dots; Tₙ up to n = 40; partial sums Sₖ(x₀) vs k; ratio-test style table estimating R from the coefficients; works for any center a |

Presets: eˣ, sin x, cos x, 1/(1−x), 1/(1+x²), ln(1+x), arctan x, √(1+x), e^(−x²), tan x. Each has
exact coefficients about **any** center, an exact radius R(a), and known endpoint behavior.
"Your own function…" accepts any expression in x (sin, cos, tan, exp, log, sqrt, atan, asin, acos,
sinh, cosh, tanh, abs, ^, implicit multiplication). Its coefficients come from series arithmetic
(`src/math/tps.js`), so no symbolic differentiation is involved and degree 40 is instant. For a
custom function the radius is *estimated* and endpoints are marked "?".
Removable gaps such as `sin(x)/x`, `(e^x − 1)/x` or `x/(e^x − 1)` at the center 0 work: when the top
and bottom of a quotient both vanish, the common factor (x − a) is cancelled (see `div` in `tps.js`),
and f itself is defined there by its limit. Genuine poles (`1/x`, `sin(x)/x^2`) are still reported as undefined.

For a typed function the radius of convergence is estimated from the coefficients, comparing terms `g` places apart
(g = 2 for sin x, 3 for 1/(1 − x³), 4 for 1/(1 + x⁴) or sin(x²), …). If the estimates keep growing with k, as they do for
eˣ or sin x, the series is reported as converging everywhere (R = ∞); that is a judgement from the coefficients, not a proof.

Keyboard: click the plot (or Tab to it), then arrows pan, + / − zoom, 0 resets.

Touch / mouse: drag to pan; scroll-wheel or pinch to zoom; double-click (or *Reset view*) to reset.
To change the aspect ratio, drag along an axis (or scroll over it), use Shift+wheel (x only) or Alt+wheel
(y only), or use the Horizontal / Vertical buttons under each plot. On a touchscreen, pinch with two fingers
side by side to stretch x, one above the other to stretch y, or diagonally for both.
Sliders and buttons are at least 44 px for fingers.

## Project layout

```
src/
  main.jsx, App.jsx        shell: header, tab bar (keyboard accessible; the tab is also in the URL hash: #explore, #convergence)
  config.js                app title and course label
  store.js                 shared state: function, center a, degree n, test point x0, per-tab views
  theme.js, styles.css     colors / styling
  math/                    no React in here: easy to test with node
    functions.js           PRESETS (coefficients about any a, radius, endpoints, default view)
    customFunction.js      parses student input (lazy, tree-shaken math.js parser) -> same interface as a preset
    tps.js                 truncated power series arithmetic (the engine behind custom functions)
    taylor.js              Horner, partial sums, error + round-off floor, radius estimate
    convergence.js         radius / interval / verdict for the convergence tab
    numfmt.js              unicode math text, exact fractions, interval text
    ticks.js, util.js      axis ticks; clamp and snap
  plot/                    the plotting toolkit
    geometry.js            data <-> pixel mapping, zoom, pan, hit regions (pure functions)
    draw.js                grid, curves, dots, handles, test-point marks
    useGestures.js         mouse / touch / wheel / keyboard handling
  components/
    PlotCanvas.jsx         the plot component (canvas + zoom toolbar)
    Controls.jsx           FunctionPicker, DegreeControl, CenterControl, TestPointControl, Toggle
    useHandles.js          the draggable center a and test point x0
    CoefficientTable.jsx
  tabs/
    index.js               TAB REGISTRY  <- add new features here
    Explore.jsx, Convergence.jsx
scripts/check-math.mjs     numerical checks (npm run check)
```

## Adding a feature later

1. Create `src/tabs/MyFeature.jsx` and default-export a component.
2. Add one line to `TABS` in `src/tabs/index.js`. A tab bar entry and the `#id` URL appear automatically.

Inside a tab you already have everything shared:

```jsx
import { useFn, useStore, useTabView } from '../store.js';            // function, a, n, x0, pan/zoom window
import PlotCanvas from '../components/PlotCanvas.jsx';                  // plot with handles
import { FunctionPicker, DegreeControl, CenterControl } from '../components/Controls.jsx';

const fn = useFn();                       // fn.f(x), fn.coeffs(a, N), fn.radius(a), fn.endpoints(a)
const a = useStore((s) => s.a);
const coeffs = fn.coeffs(a, fn.maxDegree); // c_k = f^(k)(a)/k!
```

`PlotCanvas` is controlled (`view`, `onView`) and takes a `draw(ctx, H)` callback, where
`H.X(x)`, `H.Y(y)` map data to pixels, `H.curve(f, style)` and `H.stroke(xs, ys, style)` draw
curves (gaps and asymptotes handled), and `H.samples()` returns pixel-spaced x values.
`plot/draw.js` has `drawDot`, `drawLine` and `drawTestPoint`; `useCenterTestHandles(fn)` gives you
the draggable *a* and *x₀* handles for free.

Where the planned features would plug in:

| Feature | Where to build on |
|---|---|
| Error bound / Lagrange remainder | new tab; `fn.coeffs(a, n+1)` gives the (n+1)th derivative as `c[n+1]*(n+1)!`; reuse the error plot code from `Explore.jsx` |
| Match-the-function challenge | new tab; local state for the student's coefficients, `PlotCanvas` with handles, compare with `fn.coeffs` |
| How many terms do I need? | new tab; loop `partialSums(coeffs, N, x - a)` from `math/taylor.js` until the error is below tolerance |
| Series manipulation (substitution, d/dx, ∫) | new tab; operate on coefficient arrays (`tps.js` already has add, mul, div, exp, log, …) |
| Partial sums & convergence tests | extend `Convergence.jsx` or add a tab; `partialSums` and `radiusEstimates` are ready |
| A new preset | add an object to `PRESETS` in `math/functions.js` (copy a neighbor), then run `npm run check` |

## Deploying in MyMathApps

Copy this folder into the repo as `MyMathApps/taylor-explorer/`. If your GitHub Actions workflow
already builds each app folder (`npm ci && npm run build`) and publishes the `dist/` folders, nothing else
is needed. Otherwise add this folder to that workflow the same way as your other apps.

Edit the title and course label in `src/config.js`.
