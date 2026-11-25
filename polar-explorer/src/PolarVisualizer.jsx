/**
 * =============================================================================
 * Polar Curve Explorer
 *
 * An interactive teaching tool for second-semester calculus (Math 252) that
 * pairs two synchronized plots:
 *
 *   - LEFT:  the rectangular plot of r = f(θ) or θ = f(r) on Cartesian axes
 *   - RIGHT: the corresponding polar curve in the plane
 *
 * As the user drags the slider (or presses Play), a point traces both plots
 * simultaneously, making the connection between the two representations
 * concrete.
 *
 * On the polar plot:
 *   - The TERMINAL SIDE of θ is drawn solid amber.
 *   - Its opposite ray (the EXTENSION, meaningful when r < 0) is dashed green.
 *   - The radius segment from the origin to the actual point is drawn in the
 *     color that matches the ray it lies on (amber if r > 0, green if r < 0),
 *     making the sign of r geometrically obvious.
 *
 * Author: Gary Church, College of San Mateo
 * =============================================================================
 */

import React, {
  useState,
  useMemo,
  useEffect,
  useRef,
  useCallback,
} from "react";
import { evaluate, parse } from "mathjs";

/* =============================================================================
 * SECTION 1 — Constants
 *
 * Layout, colors, and timing. Kept at module scope so they are allocated once
 * and shared across renders.
 * =========================================================================== */

const TWO_PI = 2 * Math.PI;

/** Number of samples used to draw each curve. 600 is smooth without stressing
 *  the DOM. Raise for very wiggly curves; lower on very slow machines. */
const SAMPLE_COUNT = 600;

// ---------- Rectangular plot layout ----------
const RECT_W = 460;
const RECT_H = 440;
const RECT_PAD = { l: 55, r: 20, t: 20, b: 45 };
const RECT_PLOT_W = RECT_W - RECT_PAD.l - RECT_PAD.r;
const RECT_PLOT_H = RECT_H - RECT_PAD.t - RECT_PAD.b;

// ---------- Polar plot layout (square, centered) ----------
const POLAR_W = 460;
const POLAR_H = 440;
const POLAR_PAD = 25;
const POLAR_CX = POLAR_W / 2;
const POLAR_CY = POLAR_H / 2;
const POLAR_SIZE = Math.min(POLAR_W, POLAR_H) - 2 * POLAR_PAD;

// ---------- Vertical clipping for the rectangular curve path ----------
// Functions like r = tan(θ) can produce enormous values near asymptotes.
// We discard samples whose screen y lies more than this many pixels outside
// the plot area, which keeps the SVG viewBox from getting polluted.
const RECT_Y_CLIP_SLACK = 50;

// ---------- Colors ----------
// Keeping the palette in one place makes it easy to retune visual hierarchy
// without hunting through the render tree.
const COLOR = {
  curve:          "#4f46e5", // primary curve stroke
  curveFaint:     "#cbd5e1", // curve shown behind partial trail
  rectPoint:      "#dc2626", // moving point on rectangular plot
  terminalSide:   "#d97706", // solid amber — terminal side of θ
  arcStroke:      "#d97706", // amber spiral indicating the swept angle
  arcLabel:       "#b45309", // amber for the θ label
  extension:      "#059669", // dashed green — extension of terminal side
  radiusPositive: "#b45309", // amber radius when r ≥ 0 (on terminal side)
  radiusNegative: "#047857", // green radius when r < 0 (on extension)
  grid:           "#e2e8f0", // grid lines
  axis:           "#94a3b8", // zero lines, polar reference axes
  label:          "#475569", // tick labels
  labelAxis:      "#334155", // axis labels
  errorBg:        "#fef2f2",
  errorFg:        "#b91c1c",
  errorBorder:    "#fecaca",
};

// ---------- Animation parameters ----------
/** Playback-speed multipliers offered in the UI. */
const SPEED_OPTIONS = [0.25, 0.5, 1, 2, 4];
/** Time (in seconds) for the slider to sweep the full range at speed = 1. */
const BASE_SWEEP_SECONDS = 4;
/** Clamp per-frame dt. Guards against huge jumps when the tab is backgrounded. */
const MAX_DT = 0.1;

/* =============================================================================
 * SECTION 2 — Pure helpers
 *
 * None of these touch React state, so they live at module scope.
 * =========================================================================== */

/**
 * Evaluate a mathjs expression string, returning a numeric fallback on error.
 *
 * Used to parse the slider-range strings ("2*pi", "pi/3", etc.) that the user
 * types into the min/max inputs.
 *
 * @param {string} expr      source expression
 * @param {number} fallback  value to return on parse error or non-finite result
 * @returns {number}
 */
function safeEvaluate(expr, fallback) {
  try {
    const v = evaluate(expr);
    return typeof v === "number" && isFinite(v) ? v : fallback;
  } catch {
    return fallback;
  }
}

/**
 * Compile a user-supplied expression into a callable `(x) => number`.
 *
 * The returned `fn` always yields a Number (possibly NaN) rather than a Complex
 * or other mathjs object, so downstream plotting code can treat NaN uniformly
 * as "curve breaks here." Returning `{ fn, error }` lets the caller surface the
 * parse error to the UI without the compiler having to touch React state.
 *
 * @param {string} src       source expression (e.g. "2 + 2*cos(theta)")
 * @param {string} variable  the free variable the source is a function of
 * @returns {{ fn: ((x:number)=>number)|null, error: string|null }}
 */
function compileExpression(src, variable) {
  try {
    const compiled = parse(src).compile();
    // Trial evaluation surfaces syntax and reference errors immediately
    compiled.evaluate({ [variable]: 0 });
    const fn = (x) => {
      try {
        const v = compiled.evaluate({ [variable]: x });
        // mathjs can return Complex, BigNumber, etc. Fold everything to NaN
        // except plain JS numbers.
        return typeof v === "number" ? v : NaN;
      } catch {
        return NaN;
      }
    };
    return { fn, error: null };
  } catch (e) {
    return { fn: null, error: e.message };
  }
}

/**
 * Generate "nice" (multiples of 1, 2, 5 times a power of ten) ticks covering
 * the range [min, max].
 *
 * @param {number} min
 * @param {number} max
 * @param {number} nTicks  target number of ticks (±2 of actual)
 * @returns {number[]} ascending tick positions
 */
function niceTicks(min, max, nTicks = 6) {
  if (!isFinite(min) || !isFinite(max) || max <= min) return [min];
  const range = max - min;
  const rough = range / nTicks;
  const pow = Math.pow(10, Math.floor(Math.log10(rough)));
  const norm = rough / pow;
  let step;
  if (norm < 1.5)      step = 1 * pow;
  else if (norm < 3)   step = 2 * pow;
  else if (norm < 7)   step = 5 * pow;
  else                 step = 10 * pow;
  const ticks = [];
  const start = Math.ceil(min / step) * step;
  for (let v = start; v <= max + 1e-9; v += step) ticks.push(v);
  return ticks;
}

/**
 * Generate ticks at convenient π-multiples. Chooses the first step from
 * π/6, π/4, π/3, π/2, π, 2π that yields between 3 and 10 ticks; for very wide
 * ranges (e.g. 0 to 6π), falls back to a scaled multiple of π.
 *
 * @param {number} min
 * @param {number} max
 * @returns {{ ticks: number[], step: number }}
 */
function piTicks(min, max) {
  if (!isFinite(min) || !isFinite(max) || max <= min) {
    return { ticks: [min], step: Math.PI };
  }
  const candidates = [
    Math.PI / 6, Math.PI / 4, Math.PI / 3, Math.PI / 2, Math.PI, TWO_PI,
  ];
  const range = max - min;
  let step = Math.PI / 2;
  for (const c of candidates) {
    const n = range / c;
    if (n >= 3 && n <= 10) { step = c; break; }
  }
  // Very wide range → choose a bigger step at integer multiples of π
  if (range / step > 12) {
    step = Math.PI * Math.max(1, Math.ceil(range / (12 * Math.PI)));
  }
  const ticks = [];
  const start = Math.ceil(min / step) * step;
  for (let v = start; v <= max + 1e-9; v += step) ticks.push(v);
  return { ticks, step };
}

/**
 * If `v` is a simple multiple of π that students recognize (numerator over a
 * denominator in {1, 2, 3, 4, 6, 8, 12}), return the π-fraction string.
 * Otherwise return null.
 *
 * Kept separate from `formatPi` so formatters that only want the exact form
 * (e.g. the slider readout, which already shows the decimal elsewhere) can
 * skip the decimal fallback.
 *
 * @param {number} v
 * @returns {string|null}
 */
function piFractionOrNull(v) {
  if (!isFinite(v)) return null;
  const r = v / Math.PI;
  // Zero is its own clean decimal; prefixing "0 ≈ 0.000 rad = 0.00°" would
  // just echo the number back. Callers that need a tick-label string handle
  // zero themselves.
  if (Math.abs(r) < 1e-9) return null;
  for (const den of [1, 2, 3, 4, 6, 8, 12]) {
    const num = r * den;
    if (Math.abs(num - Math.round(num)) < 1e-6) {
      const n = Math.round(num);
      if (den === 1) {
        if (n === 1)  return "π";
        if (n === -1) return "-π";
        return `${n}π`;
      }
      if (n === 1)  return `π/${den}`;
      if (n === -1) return `-π/${den}`;
      return `${n}π/${den}`;
    }
  }
  return null;
}

/**
 * Render a numeric value as a π-fraction (e.g. 3π/4, -π, 2π) when it matches
 * one of the simple multiples students see in class, otherwise as a two-place
 * decimal. Used for tick labels where every tick needs *some* string.
 *
 * @param {number} v
 * @returns {string}
 */
function formatPi(v) {
  if (!isFinite(v)) return "—";
  if (Math.abs(v) < 1e-9) return "0";
  const p = piFractionOrNull(v);
  return p !== null ? p : v.toFixed(2);
}

/**
 * Format a plain-number axis label. Integer values get no decimal places;
 * others get two. Robust to floating-point drift.
 */
function formatPlain(v) {
  if (!isFinite(v)) return "—";
  return Math.abs(v - Math.round(v)) < 1e-9
    ? String(Math.round(v))
    : v.toFixed(2);
}

/**
 * Format an angle in both radians and degrees for the readouts.
 *
 * Shape:
 *   • "π/4 ≈ 0.785 rad = 45.00°"   — when θ is a recognized π-fraction
 *   • "0.500 rad = 28.65°"          — when it isn't (no redundant prefix)
 *   • "0.785 rad = 45.0°"           — compact variant used in the status line
 *
 * The π-fraction prefix is dropped when `piFractionOrNull` has nothing to add,
 * so the readout never shows the same decimal twice in slightly different
 * precisions.
 *
 * @param {number} theta       angle in radians
 * @param {object} [opts]
 * @param {boolean} [opts.compact=false]  drop the π-fraction form entirely
 * @returns {string}
 */
function formatAngle(theta, { compact = false } = {}) {
  if (!isFinite(theta)) return "—";
  const deg = (theta * 180) / Math.PI;
  const decRad = `${theta.toFixed(3)} rad`;
  if (compact) {
    return `${decRad} = ${deg.toFixed(1)}°`;
  }
  const base = `${decRad} = ${deg.toFixed(2)}°`;
  const piForm = piFractionOrNull(theta);
  return piForm !== null ? `${piForm} ≈ ${base}` : base;
}

/**
 * Compute [min, max] of a possibly-NaN array in a single pass.
 *
 * Avoids `Math.min(...arr)`, which spreads the array through the call stack
 * and can throw "Maximum call stack size exceeded" for large N.
 *
 * @param {number[]} values
 * @returns {{min:number, max:number}|null}  null iff no finite value present
 */
function finiteMinMax(values) {
  let min = Infinity;
  let max = -Infinity;
  let any = false;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (isFinite(v)) {
      any = true;
      if (v < min) min = v;
      if (v > max) max = v;
    }
  }
  return any ? { min, max } : null;
}

/**
 * Compute the padded extent of a 1D sample set for the rectangular y-axis.
 * Spreads a constant function out to a visible range.
 *
 * @param {Array<{t:number, v:number}>} samples
 * @returns {{min:number, max:number}}
 */
function computeRectExtent(samples) {
  const vals = new Array(samples.length);
  for (let i = 0; i < samples.length; i++) vals[i] = samples[i].v;
  const mm = finiteMinMax(vals);
  if (!mm) return { min: -1, max: 1 };
  let { min, max } = mm;
  if (min === max) { min -= 1; max += 1; }
  const pad = 0.1 * (max - min);
  return { min: min - pad, max: max + pad };
}

/**
 * Compute a symmetric half-side for the polar viewport, tight enough to fill
 * but loose enough that the curve doesn't clip at the edge.
 *
 * @param {Array<{x:number, y:number}>} polarPts
 * @returns {number} half-side in world units (at least 1)
 */
function computePolarExtent(polarPts) {
  let m = 0;
  let any = false;
  for (let i = 0; i < polarPts.length; i++) {
    const { x, y } = polarPts[i];
    if (isFinite(x) && isFinite(y)) {
      any = true;
      const ax = Math.abs(x);
      const ay = Math.abs(y);
      if (ax > m) m = ax;
      if (ay > m) m = ay;
    }
  }
  if (!any) return 5;
  return Math.max(m * 1.15, 1);
}

/**
 * Binary search: largest index i such that `samples[i].t ≤ cutoff`, or −1 if
 * every sample lies past the cutoff. Requires the sample list to be ordered
 * by `t` (it is: we generate it monotonically).
 *
 * This replaces an O(n) scan on every slider frame (which is O(n²) over an
 * animation run) with O(log n).
 *
 * @param {Array<{t:number}>} samples
 * @param {number} cutoff
 * @returns {number}
 */
function findCutoffIndex(samples, cutoff) {
  if (samples.length === 0 || samples[0].t > cutoff) return -1;
  let lo = 0;
  let hi = samples.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >>> 1;
    if (samples[mid].t <= cutoff) lo = mid;
    else                          hi = mid - 1;
  }
  return lo;
}

/**
 * Build an SVG path string for the rectangular plot from samples 0..endIndex,
 * breaking the pen on NaN/Infinity and clipping vertically so that blow-ups
 * in functions like r = tan(θ) do not poison the path.
 *
 * @param {Array<{t:number, v:number}>} samples
 * @param {number} endIndex                 inclusive upper bound (−1 ⇒ empty)
 * @param {(t:number)=>number} xToPx
 * @param {(v:number)=>number} yToPx
 * @param {number} yClipMin                 any py below this breaks the pen
 * @param {number} yClipMax                 any py above this breaks the pen
 * @returns {string}  SVG path "d" attribute
 */
function buildRectPath(samples, endIndex, xToPx, yToPx, yClipMin, yClipMax) {
  if (endIndex < 0) return "";
  let d = "";
  let pen = false;
  const last = Math.min(endIndex, samples.length - 1);
  for (let i = 0; i <= last; i++) {
    const s = samples[i];
    if (!isFinite(s.v)) { pen = false; continue; }
    const py = yToPx(s.v);
    if (!isFinite(py) || py < yClipMin || py > yClipMax) {
      pen = false;
      continue;
    }
    const px = xToPx(s.t);
    d += (pen ? " L" : " M") + px.toFixed(2) + "," + py.toFixed(2);
    pen = true;
  }
  return d;
}

/**
 * Build an SVG path string for the polar plot from samples 0..endIndex.
 *
 * @param {Array<{x:number, y:number}>} polarPts
 * @param {number} endIndex
 * @param {(x:number)=>number} pxOf
 * @param {(y:number)=>number} pyOf
 * @returns {string}
 */
function buildPolarPath(polarPts, endIndex, pxOf, pyOf) {
  if (endIndex < 0) return "";
  let d = "";
  let pen = false;
  const last = Math.min(endIndex, polarPts.length - 1);
  for (let i = 0; i <= last; i++) {
    const p = polarPts[i];
    if (!isFinite(p.x) || !isFinite(p.y)) { pen = false; continue; }
    const px = pxOf(p.x);
    const py = pyOf(p.y);
    d += (pen ? " L" : " M") + px.toFixed(2) + "," + py.toFixed(2);
    pen = true;
  }
  return d;
}

/**
 * Snap a raw slider value to a nearby "special" value when it's within half a
 * step: either an endpoint (tMinNum, tMaxNum) or a multiple of π/12 when the
 * independent variable is an angle.
 *
 * This fixes a UX nuisance for angular ranges: dragging the slider "all the
 * way to the right" often lands one step short of tMaxNum due to floating-
 * point step quantization. For θ = 6π with 1000 steps, being short by one
 * step is ~0.019 rad, which projects to ~4 px of y-deflection on the polar
 * plot — enough to make the terminal side look visibly off the x-axis when
 * it mathematically shouldn't be. Snapping to π/12 multiples has the
 * bonus that π/6, π/4, π/3, π/2, π, etc. are all easy to land on exactly.
 *
 * @param {number} raw           value reported by the range input
 * @param {number} tMinNum
 * @param {number} tMaxNum
 * @param {number} step          slider step size
 * @param {boolean} indepIsAngle snap to π/12 multiples when true
 * @returns {number}
 */
function snapSliderValue(raw, tMinNum, tMaxNum, step, indepIsAngle) {
  if (!isFinite(raw) || !isFinite(step) || step <= 0) return raw;
  const tol = step / 2;
  if (Math.abs(raw - tMinNum) < tol) return tMinNum;
  if (Math.abs(raw - tMaxNum) < tol) return tMaxNum;
  if (indepIsAngle) {
    const base = Math.PI / 12;
    const k = Math.round(raw / base);
    const snapped = k * base;
    if (Math.abs(raw - snapped) < tol) return snapped;
  }
  return raw;
}

/**
 * Build an SVG polyline tracing the angle θ as a spiral from the positive
 * x-axis outward, with radius growing with |u|. Each additional revolution
 * stays visible instead of overdrawing the previous one, so the number of
 * complete turns is read directly off the picture — no "× N turns" badge
 * needed and no artificial cap at 2π (which SVG's arc command imposes).
 *
 * Also returns the tangent at the tip (for positioning an arrow head) and
 * the chosen radius function (for placing the θ label along the curve).
 *
 * Shape:    ρ(u) = baseRadius + growth · |u| / (2π)
 * Density:  one segment per `segmentRad` radians, minimum 8 segments
 *
 * @param {number} theta        full angle (any real)
 * @param {number} cx           spiral center x (SVG px)
 * @param {number} cy           spiral center y (SVG px)
 * @param {number} baseRadius   radius at u = 0 (SVG px)
 * @param {number} growth       radius added per complete revolution (SVG px)
 * @param {number} [segmentRad] sampling step in radians (default 0.02)
 * @returns {{
 *   d: string,                 // SVG path "d"
 *   tipX: number, tipY: number,
 *   tangentX: number, tangentY: number,
 *   rhoAt: (u:number)=>number  // radius at a given u, for label placement
 * } | null}  null iff theta is 0 or not finite
 */
function buildAngleSpiral(theta, cx, cy, baseRadius, growth, segmentRad = 0.02) {
  if (!isFinite(theta) || Math.abs(theta) < 1e-9) return null;
  const rhoAt = (u) => baseRadius + (growth * Math.abs(u)) / TWO_PI;
  const pt = (u) => [
    cx + rhoAt(u) * Math.cos(u),
    cy - rhoAt(u) * Math.sin(u),
  ];
  const n = Math.max(8, Math.ceil(Math.abs(theta) / segmentRad));
  let d = "";
  for (let i = 0; i <= n; i++) {
    const u = (theta * i) / n;
    const [x, y] = pt(u);
    d += (i === 0 ? "M" : " L") + x.toFixed(2) + "," + y.toFixed(2);
  }
  const [tipX, tipY] = pt(theta);
  // Tangent at tip via a tiny backward step along the spiral parameter.
  const backStep = Math.sign(theta) * Math.min(0.2, Math.abs(theta));
  const [backX, backY] = pt(theta - backStep);
  const dxRaw = tipX - backX;
  const dyRaw = tipY - backY;
  const len = Math.hypot(dxRaw, dyRaw) || 1;
  return {
    d,
    tipX, tipY,
    tangentX: dxRaw / len,
    tangentY: dyRaw / len,
    rhoAt,
  };
}

/* =============================================================================
 * SECTION 3 — Preset catalog
 * =========================================================================== */

/**
 * @typedef {object} Preset
 * @property {string}                       name  human-readable label
 * @property {"r_of_theta"|"theta_of_r"}    mode
 * @property {string}                       fn    mathjs expression
 * @property {string}                       min   lower bound of free variable
 * @property {string}                       max   upper bound of free variable
 */

/** @type {Preset[]} */
const PRESETS = [
  { name: "Cardioid",             mode: "r_of_theta", fn: "2 + 2*cos(theta)",      min: "0", max: "2*pi" },
  { name: "Limaçon (inner loop)", mode: "r_of_theta", fn: "1 + 2*cos(theta)",      min: "0", max: "2*pi" },
  { name: "Rose (4 petals)",      mode: "r_of_theta", fn: "3*cos(2*theta)",        min: "0", max: "2*pi" },
  { name: "Rose (5 petals)",      mode: "r_of_theta", fn: "3*sin(5*theta)",        min: "0", max: "pi"   },
  // Real lemniscate r² = 9·cos(2θ) ⇒ r = 3·√(cos(2θ)), undefined where
  // cos(2θ) < 0. mathjs's sqrt returns a Complex for negative input, which
  // our evaluator folds to NaN — so the curve correctly breaks between lobes.
  //
  // The +1e-12 bias is a floating-point hack: Math.cos(3π/2) and Math.cos(7π/2)
  // return tiny negative values (~-2e-16) instead of exact zero due to π being
  // inexact. Without the bias, sqrt produces NaN at those two angles and the
  // lobes fail to close at the origin. The bias is small enough that genuinely
  // negative values of cos(2θ) one sample away (~0.02) still correctly break
  // the curve between the two lobes.
  { name: "Lemniscate",           mode: "r_of_theta", fn: "3*sqrt(cos(2*theta) + 1e-12)",  min: "0", max: "2*pi" },
  { name: "Archimedean spiral",   mode: "r_of_theta", fn: "0.3*theta",             min: "0", max: "6*pi" },
  { name: "Circle r=3",           mode: "r_of_theta", fn: "3",                     min: "0", max: "2*pi" },
  { name: "Circle r=4sin(θ)",     mode: "r_of_theta", fn: "4*sin(theta)",          min: "0", max: "pi"   },
  { name: "θ = r/2 (spiral)",     mode: "theta_of_r", fn: "r/2",                   min: "0", max: "10"   },
];

/* =============================================================================
 * SECTION 4 — RectangularPlot sub-component
 *
 * Renders the Cartesian plot of the dependent variable against the independent
 * one. All numeric heavy lifting (sampling, extent, path construction) is done
 * by the parent and passed in — this component just draws.
 * =========================================================================== */

/**
 * @typedef {object} RectPlotProps
 * @property {string}                   pathFull       pre-built SVG path for the whole curve
 * @property {string}                   pathTrail      pre-built SVG path for the drawn portion
 * @property {{min:number, max:number}} rectExtent     dependent-variable extent (padded)
 * @property {number}                   tMinNum        independent-variable range min
 * @property {number}                   tMaxNum        independent-variable range max
 * @property {number}                   t              current slider value
 * @property {number}                   currentDep     f(t); may be NaN
 * @property {boolean}                  indepIsAngle   true ⇒ use π-formatted x ticks
 * @property {boolean}                  depIsAngle     true ⇒ use π-formatted y ticks
 * @property {string}                   xAxisLabel     "θ" or "r"
 * @property {string}                   yAxisLabel     "θ" or "r"
 * @property {boolean}                  showGrid
 * @property {"full"|"partial"|"none"}  trailMode
 */

function RectangularPlot(props) {
  const {
    pathFull, pathTrail,
    rectExtent, tMinNum, tMaxNum,
    t, currentDep,
    indepIsAngle, depIsAngle,
    xAxisLabel, yAxisLabel,
    showGrid, trailMode,
  } = props;

  // --- World-to-pixel transforms (closures capture current extent) ---
  const xToPx = useCallback(
    (x) => RECT_PAD.l + ((x - tMinNum) / (tMaxNum - tMinNum)) * RECT_PLOT_W,
    [tMinNum, tMaxNum],
  );
  const yToPx = useCallback(
    (y) =>
      RECT_PAD.t +
      ((rectExtent.max - y) / (rectExtent.max - rectExtent.min)) * RECT_PLOT_H,
    [rectExtent],
  );

  // --- Tick computations ---
  const xTicks = useMemo(
    () => (indepIsAngle
      ? piTicks(tMinNum, tMaxNum).ticks
      : niceTicks(tMinNum, tMaxNum, 6)),
    [indepIsAngle, tMinNum, tMaxNum],
  );
  const yTicks = useMemo(
    () => (depIsAngle
      ? piTicks(rectExtent.min, rectExtent.max).ticks
      : niceTicks(rectExtent.min, rectExtent.max, 6)),
    [depIsAngle, rectExtent],
  );

  const formatX = indepIsAngle ? formatPi : formatPlain;
  const formatY = depIsAngle   ? formatPi : formatPlain;

  const plotRight  = RECT_PAD.l + RECT_PLOT_W;
  const plotBottom = RECT_PAD.t + RECT_PLOT_H;

  return (
    <svg viewBox={`0 0 ${RECT_W} ${RECT_H}`} className="w-full h-auto">
      {/* Plot area background */}
      <rect
        x={RECT_PAD.l}
        y={RECT_PAD.t}
        width={RECT_PLOT_W}
        height={RECT_PLOT_H}
        fill="#fafbfc"
        stroke="#cbd5e1"
      />

      {/* Grid lines */}
      {showGrid && xTicks.map((v, i) => (
        <line
          key={`xg${i}`}
          x1={xToPx(v)} x2={xToPx(v)}
          y1={RECT_PAD.t} y2={plotBottom}
          stroke={COLOR.grid}
        />
      ))}
      {showGrid && yTicks.map((v, i) => (
        <line
          key={`yg${i}`}
          x1={RECT_PAD.l} x2={plotRight}
          y1={yToPx(v)}   y2={yToPx(v)}
          stroke={COLOR.grid}
        />
      ))}

      {/* Zero lines (drawn only when zero is inside the range) */}
      {rectExtent.min < 0 && rectExtent.max > 0 && (
        <line
          x1={RECT_PAD.l} x2={plotRight}
          y1={yToPx(0)}   y2={yToPx(0)}
          stroke={COLOR.axis}
        />
      )}
      {tMinNum < 0 && tMaxNum > 0 && (
        <line
          x1={xToPx(0)}    x2={xToPx(0)}
          y1={RECT_PAD.t}  y2={plotBottom}
          stroke={COLOR.axis}
        />
      )}

      {/* Tick marks and labels */}
      {xTicks.map((v, i) => (
        <g key={`xt${i}`}>
          <line
            x1={xToPx(v)} x2={xToPx(v)}
            y1={plotBottom} y2={plotBottom + 4}
            stroke={COLOR.label}
          />
          <text
            x={xToPx(v)} y={plotBottom + 16}
            textAnchor="middle" fontSize="11" fill={COLOR.label}
            fontFamily="ui-monospace, monospace"
          >
            {formatX(v)}
          </text>
        </g>
      ))}
      {yTicks.map((v, i) => (
        <g key={`yt${i}`}>
          <line
            x1={RECT_PAD.l - 4} x2={RECT_PAD.l}
            y1={yToPx(v)}        y2={yToPx(v)}
            stroke={COLOR.label}
          />
          <text
            x={RECT_PAD.l - 6} y={yToPx(v) + 4}
            textAnchor="end" fontSize="11" fill={COLOR.label}
            fontFamily="ui-monospace, monospace"
          >
            {formatY(v)}
          </text>
        </g>
      ))}

      {/* Axis titles */}
      <text
        x={RECT_PAD.l + RECT_PLOT_W / 2}
        y={RECT_H - 8}
        textAnchor="middle" fontSize="14" fontStyle="italic"
        fill={COLOR.labelAxis}
      >
        {xAxisLabel}
      </text>
      <text
        x={15}
        y={RECT_PAD.t + RECT_PLOT_H / 2}
        textAnchor="middle" fontSize="14" fontStyle="italic"
        fill={COLOR.labelAxis}
        transform={`rotate(-90 15 ${RECT_PAD.t + RECT_PLOT_H / 2})`}
      >
        {yAxisLabel}
      </text>

      {/* Full curve (used by "full" and "partial" trail modes) */}
      {trailMode !== "none" && (
        <path
          d={pathFull}
          fill="none"
          stroke={trailMode === "partial" ? COLOR.curveFaint : COLOR.curve}
          strokeWidth="2"
        />
      )}
      {/* Drawn portion (only in "partial" mode) */}
      {trailMode === "partial" && (
        <path
          d={pathTrail}
          fill="none"
          stroke={COLOR.curve}
          strokeWidth="2.5"
        />
      )}

      {/* Guide lines from axes to the current point, plus the point itself */}
      {isFinite(currentDep) && (
        <>
          <line
            x1={xToPx(t)} x2={xToPx(t)}
            y1={plotBottom} y2={yToPx(currentDep)}
            stroke={COLOR.rectPoint} strokeWidth="1"
            strokeDasharray="3 3"
          />
          <line
            x1={RECT_PAD.l} x2={xToPx(t)}
            y1={yToPx(currentDep)} y2={yToPx(currentDep)}
            stroke={COLOR.rectPoint} strokeWidth="1"
            strokeDasharray="3 3"
          />
          <circle
            cx={xToPx(t)} cy={yToPx(currentDep)} r="5"
            fill={COLOR.rectPoint} stroke="white" strokeWidth="1.5"
          />
        </>
      )}
    </svg>
  );
}

/* =============================================================================
 * SECTION 5 — PolarPlot sub-component
 *
 * Renders the polar graph: radial grid, angular rays, the curve itself, and
 * the moving decoration (terminal side, extension, radius, arc, labels).
 * =========================================================================== */

/**
 * @typedef {object} PolarPtDyn
 * @property {number} x        px-space x of current point
 * @property {number} y        px-space y of current point
 * @property {number} r        current r value (may be negative)
 * @property {number} th       current θ value (may be any real)
 */

/**
 * @typedef {object} PolarPlotProps
 * @property {string}              pathFull       pre-built SVG path for the whole curve
 * @property {string}              pathTrail      pre-built SVG path for the drawn portion
 * @property {number}              polarExtent    half-side of viewport in world units
 * @property {PolarPtDyn}          currentPolar   current point in world coords plus (r, θ)
 * @property {boolean}             showGrid
 * @property {"full"|"partial"|"none"} trailMode
 */

function PolarPlot(props) {
  const {
    pathFull, pathTrail,
    polarExtent, currentPolar,
    showGrid, trailMode,
  } = props;

  // --- World-to-pixel transforms ---
  const pScale = POLAR_SIZE / (2 * polarExtent);
  const pxOf = useCallback((x) => POLAR_CX + x * pScale, [pScale]);
  const pyOf = useCallback((y) => POLAR_CY - y * pScale, [pScale]);

  // --- Grid tick positions ---
  // Radial circles at "nice" positive r values
  const polarRTicks = useMemo(
    () => niceTicks(0, polarExtent, 5).filter((r) => r > 0),
    [polarExtent],
  );
  // Angular rays every 30°
  const angTicks = useMemo(() => {
    const arr = new Array(12);
    for (let k = 0; k < 12; k++) arr[k] = (k * Math.PI) / 6;
    return arr;
  }, []);

  // Precompute the spiral indicator for the current angle. The spiral starts
  // at 30px and widens by 12px per full turn, matching the convention from the
  // earlier Polar Coordinates Explorer so students see a consistent idiom
  // across both apps.
  const spiral = useMemo(
    () => buildAngleSpiral(currentPolar.th, POLAR_CX, POLAR_CY, 30, 12),
    [currentPolar.th],
  );

  const edge = polarExtent * pScale;
  const pointIsValid = isFinite(currentPolar.x) && isFinite(currentPolar.y);

  return (
    <svg viewBox={`0 0 ${POLAR_W} ${POLAR_H}`} className="w-full h-auto">
      {/* Radial grid circles */}
      {showGrid && polarRTicks.map((r, i) => (
        <circle
          key={`rc${i}`}
          cx={POLAR_CX} cy={POLAR_CY}
          r={r * pScale}
          fill="none" stroke={COLOR.grid}
        />
      ))}

      {/* Angular ray grid */}
      {showGrid && angTicks.map((a, i) => (
        <line
          key={`al${i}`}
          x1={POLAR_CX}                    y1={POLAR_CY}
          x2={POLAR_CX + edge * Math.cos(a)}
          y2={POLAR_CY - edge * Math.sin(a)}
          stroke={COLOR.grid}
        />
      ))}

      {/* Radial tick labels */}
      {showGrid && polarRTicks.map((r, i) => (
        <text
          key={`rt${i}`}
          x={POLAR_CX + r * pScale + 3}
          y={POLAR_CY - 3}
          fontSize="10" fill={COLOR.label}
          fontFamily="ui-monospace, monospace"
        >
          {Math.abs(r - Math.round(r)) < 1e-9 ? String(Math.round(r)) : r.toFixed(1)}
        </text>
      ))}

      {/* Standard-angle labels around the outside */}
      {showGrid && [
        { a: 0,             label: "0"    },
        { a: Math.PI / 2,   label: "π/2"  },
        { a: Math.PI,       label: "π"    },
        { a: 3 * Math.PI / 2, label: "3π/2" },
      ].map((d, i) => (
        <text
          key={`alab${i}`}
          x={POLAR_CX + (edge + 12) * Math.cos(d.a)}
          y={POLAR_CY - (edge + 12) * Math.sin(d.a) + 4}
          fontSize="11" fill={COLOR.label}
          textAnchor="middle"
        >
          {d.label}
        </text>
      ))}

      {/* Reference x/y axes */}
      <line x1={POLAR_PAD}     y1={POLAR_CY}  x2={POLAR_W - POLAR_PAD} y2={POLAR_CY} stroke={COLOR.axis} />
      <line x1={POLAR_CX} y1={POLAR_PAD} x2={POLAR_CX}             y2={POLAR_H - POLAR_PAD} stroke={COLOR.axis} />

      {/* Full polar curve */}
      {trailMode !== "none" && (
        <path
          d={pathFull} fill="none"
          stroke={trailMode === "partial" ? COLOR.curveFaint : COLOR.curve}
          strokeWidth="2"
        />
      )}
      {/* Drawn portion of polar curve */}
      {trailMode === "partial" && (
        <path
          d={pathTrail} fill="none"
          stroke={COLOR.curve} strokeWidth="2.5"
        />
      )}

      {/* Dynamic decoration: spiral angle indicator, terminal side, extension,
          radius, origin, point, labels. Rendered only when the current point
          is finite. */}
      {pointIsValid && (
        <>
          {/* Extension of terminal side: green dashed, opposite direction */}
          <line
            x1={POLAR_CX} y1={POLAR_CY}
            x2={POLAR_CX + edge * Math.cos(currentPolar.th + Math.PI)}
            y2={POLAR_CY - edge * Math.sin(currentPolar.th + Math.PI)}
            stroke={COLOR.extension} strokeWidth="2.5"
            strokeDasharray="8 5"
          />

          {/* Terminal side of θ: solid amber, always emphasized */}
          <line
            x1={POLAR_CX} y1={POLAR_CY}
            x2={POLAR_CX + edge * Math.cos(currentPolar.th)}
            y2={POLAR_CY - edge * Math.sin(currentPolar.th)}
            stroke={COLOR.terminalSide} strokeWidth="3.5"
          />

          {/* Spiral angle indicator (replaces the SVG arc). Handles |θ| > 2π
              naturally — each extra turn widens outward instead of overdrawing. */}
          {spiral && (() => {
            // Arrow head: isoceles triangle, 12 px long and 12 px wide,
            // oriented along the tangent at the tip of the spiral.
            const { tipX, tipY, tangentX, tangentY, rhoAt } = spiral;
            const backX = tipX - 12 * tangentX;
            const backY = tipY - 12 * tangentY;
            // Perpendicular (left-hand) to the tangent
            const perpX = -tangentY;
            const perpY =  tangentX;
            const leftX  = backX + 6 * perpX;
            const leftY  = backY + 6 * perpY;
            const rightX = backX - 6 * perpX;
            const rightY = backY - 6 * perpY;

            // θ label placement, following the same heuristic as the earlier
            // Polar Coordinates Explorer:
            //   tiny |θ|   → nudge past the tip by a fixed offset
            //   |θ| ≤ 2π  → midpoint of the first turn
            //   large |θ| → one half-turn back from the tip, so the label
            //               sits on the outer edge of the latest winding
            const sg = Math.sign(currentPolar.th);
            const absTh = Math.abs(currentPolar.th);
            const labelU =
              absTh < 0.5    ? currentPolar.th + sg * 0.45 :
              absTh <= TWO_PI ? currentPolar.th / 2
                              : currentPolar.th - sg * Math.PI;
            const labelRho = rhoAt(labelU) + 12;
            const labelX = POLAR_CX + labelRho * Math.cos(labelU);
            const labelY = POLAR_CY - labelRho * Math.sin(labelU) + 4;

            return (
              <>
                <path
                  d={spiral.d} fill="none"
                  stroke={COLOR.arcStroke} strokeWidth="2.5"
                  strokeLinecap="round" strokeLinejoin="round"
                />
                <polygon
                  points={`${tipX.toFixed(2)},${tipY.toFixed(2)} ` +
                          `${leftX.toFixed(2)},${leftY.toFixed(2)} ` +
                          `${rightX.toFixed(2)},${rightY.toFixed(2)}`}
                  fill={COLOR.arcStroke}
                />
                <text
                  x={labelX} y={labelY}
                  fontSize="13" fill={COLOR.arcLabel}
                  fontFamily="ui-monospace, monospace" fontWeight="700"
                  textAnchor="middle"
                >
                  θ
                </text>
              </>
            );
          })()}

          {/* Radius segment. Color encodes sign of r:
                r ≥ 0 → amber (lies on terminal side)
                r < 0 → green (lies on extension) */}
          <line
            x1={POLAR_CX}             y1={POLAR_CY}
            x2={pxOf(currentPolar.x)} y2={pyOf(currentPolar.y)}
            stroke={currentPolar.r >= 0 ? COLOR.radiusPositive : COLOR.radiusNegative}
            strokeWidth="4.5"
          />

          {/* Origin marker */}
          <circle cx={POLAR_CX} cy={POLAR_CY} r="3" fill={COLOR.label} />

          {/* Current point */}
          <circle
            cx={pxOf(currentPolar.x)} cy={pyOf(currentPolar.y)} r="6"
            fill={COLOR.rectPoint} stroke="white" strokeWidth="1.5"
          />

          {/* r label on radius (hidden when the segment is too short to carry it) */}
          {isFinite(currentPolar.r) && Math.abs(currentPolar.r) > 0.1 && (
            <text
              x={(POLAR_CX + pxOf(currentPolar.x)) / 2 + 8}
              y={(POLAR_CY + pyOf(currentPolar.y)) / 2 - 6}
              fontSize="12" fill={COLOR.rectPoint}
              fontFamily="ui-monospace, monospace" fontWeight="600"
            >
              r = {currentPolar.r.toFixed(2)}
            </text>
          )}
        </>
      )}
    </svg>
  );
}

/* =============================================================================
 * SECTION 6 — Main component
 *
 * Owns the UI state, parses the user's inputs, samples the curve, and feeds
 * ready-to-render props to the two plot sub-components.
 * =========================================================================== */

export default function PolarVisualizer() {
  // ---------- State ----------
  const [mode, setMode]             = useState("r_of_theta"); // or "theta_of_r"
  const [fnStr, setFnStr]           = useState("2 + 2*cos(theta)");
  const [tMin, setTMin]             = useState("0");
  const [tMax, setTMax]             = useState("2*pi");
  const [t, setT]                   = useState(0);
  const [showGrid, setShowGrid]     = useState(true);
  const [trailMode, setTrailMode]   = useState("partial"); // "full" | "partial" | "none"
  const [animating, setAnimating]   = useState(false);
  const [repeat, setRepeat]         = useState(true);   // loop vs. stop at end
  const [speed, setSpeed]           = useState(1);

  const animRef = useRef(null);

  // ---------- Derived: variable names ----------
  const indepVar     = mode === "r_of_theta" ? "theta" : "r";
  const depVar       = mode === "r_of_theta" ? "r"     : "theta";
  const indepIsAngle = mode === "r_of_theta";
  const depIsAngle   = mode === "theta_of_r";
  const xAxisLabel   = indepIsAngle ? "θ" : "r";
  const yAxisLabel   = depIsAngle   ? "θ" : "r";

  // ---------- Derived: numeric range from string inputs ----------
  const { tMinNum, tMaxNum } = useMemo(() => ({
    tMinNum: safeEvaluate(tMin, 0),
    tMaxNum: safeEvaluate(tMax, TWO_PI),
  }), [tMin, tMax]);

  /** True iff the range is a well-formed, strictly increasing interval. */
  const rangeOK = isFinite(tMinNum) && isFinite(tMaxNum) && tMaxNum > tMinNum;

  // ---------- Compile user expression ----------
  // Returning {fn, error} from a pure helper lets us memoize cleanly without
  // calling setState inside a memo body.
  const { fn, error } = useMemo(
    () => compileExpression(fnStr, indepVar),
    [fnStr, indepVar],
  );

  // ---------- Clamp the slider when the range or function changes ----------
  // These effects reset `t` on mode/function changes (so the slider starts
  // at the left edge for the new curve) and clamp it into range when the
  // user edits tMin/tMax.
  useEffect(() => {
    if (rangeOK) setT(tMinNum);
  }, [mode, fnStr]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!rangeOK) return;
    setT((cur) => {
      if (cur < tMinNum) return tMinNum;
      if (cur > tMaxNum) return tMaxNum;
      return cur;
    });
  }, [tMinNum, tMaxNum, rangeOK]);

  // ---------- Sample the curve ----------
  // samples[i] = { t, v }, with t evenly spaced over [tMinNum, tMaxNum] and
  // v = f(t) (NaN where f is undefined or non-numeric).
  const samples = useMemo(() => {
    if (!fn || !rangeOK) return [];
    const pts = new Array(SAMPLE_COUNT + 1);
    const span = tMaxNum - tMinNum;
    for (let i = 0; i <= SAMPLE_COUNT; i++) {
      const x = tMinNum + (span * i) / SAMPLE_COUNT;
      pts[i] = { t: x, v: fn(x) };
    }
    return pts;
  }, [fn, tMinNum, tMaxNum, rangeOK]);

  // ---------- Dependent value at the current slider position ----------
  const currentDep = useMemo(
    () => (fn ? fn(t) : NaN),
    [fn, t],
  );

  // ---------- Transform samples to the (x, y) plane for the polar plot ----------
  const polarPts = useMemo(() => {
    const out = new Array(samples.length);
    const rThetaMode = mode === "r_of_theta";
    for (let i = 0; i < samples.length; i++) {
      const s = samples[i];
      const r  = rThetaMode ? s.v : s.t;
      const th = rThetaMode ? s.t : s.v;
      if (!isFinite(r) || !isFinite(th)) {
        out[i] = { x: NaN, y: NaN, t: s.t };
      } else {
        out[i] = { x: r * Math.cos(th), y: r * Math.sin(th), t: s.t };
      }
    }
    return out;
  }, [samples, mode]);

  // ---------- Current point in world coords (plus raw r, θ for labels) ----------
  const currentPolar = useMemo(() => {
    const rThetaMode = mode === "r_of_theta";
    const r  = rThetaMode ? currentDep : t;
    const th = rThetaMode ? t          : currentDep;
    if (!isFinite(r) || !isFinite(th)) {
      return { x: NaN, y: NaN, r, th };
    }
    return { x: r * Math.cos(th), y: r * Math.sin(th), r, th };
  }, [t, currentDep, mode]);

  // ---------- Plot extents ----------
  const rectExtent  = useMemo(() => computeRectExtent(samples),    [samples]);
  const polarExtent = useMemo(() => computePolarExtent(polarPts),  [polarPts]);

  // ---------- Pre-build SVG paths ----------
  // The cutoff index is where the drawn trail ends; using it lets us pass
  // ready-to-render path strings to the children, and lets binary search
  // replace a per-frame linear scan.
  const cutoffIdx = useMemo(
    () => findCutoffIndex(samples, t),
    [samples, t],
  );

  const pScale = POLAR_SIZE / (2 * polarExtent);
  const rectPath = useMemo(() => {
    const xToPx = (x) =>
      RECT_PAD.l + ((x - tMinNum) / (tMaxNum - tMinNum)) * RECT_PLOT_W;
    const yToPx = (y) =>
      RECT_PAD.t +
      ((rectExtent.max - y) / (rectExtent.max - rectExtent.min)) * RECT_PLOT_H;
    return buildRectPath(
      samples, samples.length - 1,
      xToPx, yToPx,
      RECT_PAD.t - RECT_Y_CLIP_SLACK,
      RECT_PAD.t + RECT_PLOT_H + RECT_Y_CLIP_SLACK,
    );
  }, [samples, tMinNum, tMaxNum, rectExtent]);

  const rectTrail = useMemo(() => {
    if (trailMode !== "partial") return "";
    const xToPx = (x) =>
      RECT_PAD.l + ((x - tMinNum) / (tMaxNum - tMinNum)) * RECT_PLOT_W;
    const yToPx = (y) =>
      RECT_PAD.t +
      ((rectExtent.max - y) / (rectExtent.max - rectExtent.min)) * RECT_PLOT_H;
    return buildRectPath(
      samples, cutoffIdx,
      xToPx, yToPx,
      RECT_PAD.t - RECT_Y_CLIP_SLACK,
      RECT_PAD.t + RECT_PLOT_H + RECT_Y_CLIP_SLACK,
    );
  }, [samples, cutoffIdx, tMinNum, tMaxNum, rectExtent, trailMode]);

  const polarPath = useMemo(() => {
    const pxOf = (x) => POLAR_CX + x * pScale;
    const pyOf = (y) => POLAR_CY - y * pScale;
    return buildPolarPath(polarPts, polarPts.length - 1, pxOf, pyOf);
  }, [polarPts, pScale]);

  const polarTrail = useMemo(() => {
    if (trailMode !== "partial") return "";
    const pxOf = (x) => POLAR_CX + x * pScale;
    const pyOf = (y) => POLAR_CY - y * pScale;
    return buildPolarPath(polarPts, cutoffIdx, pxOf, pyOf);
  }, [polarPts, cutoffIdx, pScale, trailMode]);

  // ---------- Animation loop ----------
  // On each animation frame: advance t by dt·speed·span / BASE_SWEEP_SECONDS.
  // When the sweep crosses tMaxNum:
  //   • repeat = true  → wrap back into [tMinNum, tMaxNum]
  //   • repeat = false → clamp to tMaxNum, stop animating, and let the user
  //                       press Play again (which re-starts from the beginning
  //                       if we were already parked at the end)
  useEffect(() => {
    if (!animating || !rangeOK) {
      if (animRef.current) cancelAnimationFrame(animRef.current);
      return;
    }
    let last = performance.now();
    let stopped = false;
    const step = (now) => {
      if (stopped) return;
      const dt = Math.min((now - last) / 1000, MAX_DT);
      last = now;
      setT((prev) => {
        const span = tMaxNum - tMinNum;
        const next = prev + (dt * speed * span) / BASE_SWEEP_SECONDS;
        if (next >= tMaxNum) {
          if (repeat) {
            const wrapped = tMinNum + ((next - tMinNum) % span);
            return isFinite(wrapped) ? wrapped : tMinNum;
          }
          // One-shot: park at the end and halt the loop
          stopped = true;
          setAnimating(false);
          return tMaxNum;
        }
        return next;
      });
      if (!stopped) animRef.current = requestAnimationFrame(step);
    };
    animRef.current = requestAnimationFrame(step);
    return () => {
      stopped = true;
      if (animRef.current) cancelAnimationFrame(animRef.current);
    };
  }, [animating, rangeOK, tMinNum, tMaxNum, speed, repeat]);

  // ---------- Play button handler ----------
  // When Play is pressed while already parked at the end in one-shot mode,
  // rewind to the start so the user sees the sweep from the beginning.
  const togglePlay = useCallback(() => {
    if (animating) {
      setAnimating(false);
      return;
    }
    if (!repeat && rangeOK && Math.abs(t - tMaxNum) < 1e-9) {
      setT(tMinNum);
    }
    setAnimating(true);
  }, [animating, repeat, rangeOK, t, tMinNum, tMaxNum]);

  // ---------- Preset application ----------
  const applyPreset = useCallback((p) => {
    setMode(p.mode);
    setFnStr(p.fn);
    setTMin(p.min);
    setTMax(p.max);
  }, []);

  // ---------- Small formatting helper for the status line ----------
  const fmt = (v) => (isFinite(v) ? v.toFixed(3) : "—");

  // ---------- Slider step (must be strictly positive to satisfy browsers) ----------
  const sliderStep = rangeOK ? (tMaxNum - tMinNum) / 1000 : 0.001;

  return (
    <div className="w-full min-h-screen bg-slate-50 p-4">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-3">
          <h1 className="text-2xl font-semibold text-slate-800">
            Polar Curve Explorer
          </h1>
          <p className="text-sm text-slate-600">
            Connecting rectangular{" "}
            <span className="italic">{indepIsAngle ? "r vs θ" : "θ vs r"}</span>{" "}
            plots to polar curves
          </p>
        </div>

        {/* ============= Controls ============= */}
        <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-4 mb-4">
          {/* Mode toggle, function field, range inputs */}
          <div className="flex flex-wrap gap-4 items-end mb-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">
                Mode
              </label>
              <div className="flex rounded-md overflow-hidden border border-slate-300">
                <button
                  className={`px-3 py-1.5 text-sm ${
                    mode === "r_of_theta"
                      ? "bg-indigo-600 text-white"
                      : "bg-white text-slate-700 hover:bg-slate-50"
                  }`}
                  onClick={() => setMode("r_of_theta")}
                >
                  r = f(θ)
                </button>
                <button
                  className={`px-3 py-1.5 text-sm ${
                    mode === "theta_of_r"
                      ? "bg-indigo-600 text-white"
                      : "bg-white text-slate-700 hover:bg-slate-50"
                  }`}
                  onClick={() => setMode("theta_of_r")}
                >
                  θ = f(r)
                </button>
              </div>
            </div>

            <div className="flex-1 min-w-[240px]">
              <label className="block text-xs font-medium text-slate-600 mb-1">
                {depVar} = f({indepVar})
              </label>
              <input
                type="text"
                value={fnStr}
                onChange={(e) => setFnStr(e.target.value)}
                className="w-full px-3 py-1.5 border border-slate-300 rounded-md font-mono text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                placeholder={
                  mode === "r_of_theta" ? "e.g. 2+2*cos(theta)" : "e.g. r/2"
                }
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">
                {indepVar}<sub>min</sub>
              </label>
              <input
                type="text"
                value={tMin}
                onChange={(e) => setTMin(e.target.value)}
                className="w-24 px-2 py-1.5 border border-slate-300 rounded-md font-mono text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">
                {indepVar}<sub>max</sub>
              </label>
              <input
                type="text"
                value={tMax}
                onChange={(e) => setTMax(e.target.value)}
                className="w-24 px-2 py-1.5 border border-slate-300 rounded-md font-mono text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          </div>

          {/* Error pills */}
          {error && (
            <div
              className="text-sm rounded px-2 py-1 mb-2 border"
              style={{
                color:           COLOR.errorFg,
                backgroundColor: COLOR.errorBg,
                borderColor:     COLOR.errorBorder,
              }}
            >
              {error}
            </div>
          )}
          {!rangeOK && (
            <div
              className="text-sm rounded px-2 py-1 mb-2 border"
              style={{
                color:           COLOR.errorFg,
                backgroundColor: COLOR.errorBg,
                borderColor:     COLOR.errorBorder,
              }}
            >
              {indepVar}<sub>max</sub> must be greater than {indepVar}<sub>min</sub>.
            </div>
          )}

          {/* Preset row */}
          <div className="flex flex-wrap gap-2 mb-3">
            <span className="text-xs text-slate-500 self-center mr-1">
              Presets:
            </span>
            {PRESETS.map((p, i) => (
              <button
                key={`${p.name}-${i}`}
                onClick={() => applyPreset(p)}
                className="px-2 py-1 text-xs bg-slate-100 hover:bg-indigo-100 text-slate-700 rounded border border-slate-200"
              >
                {p.name}
              </button>
            ))}
          </div>

          {/* Slider + play controls */}
          <div className="flex items-center gap-3">
            <div className="text-sm font-mono text-slate-700 w-16">
              {indepVar} =
            </div>
            <input
              type="range"
              min={tMinNum}
              max={tMaxNum}
              step={sliderStep}
              value={t}
              onChange={(e) => setT(snapSliderValue(
                parseFloat(e.target.value),
                tMinNum, tMaxNum, sliderStep, indepIsAngle,
              ))}
              className="flex-1 accent-indigo-600"
              disabled={!rangeOK}
            />
            <div className={`font-mono text-sm text-slate-800 ${indepIsAngle ? "w-72" : "w-28"} text-right tabular-nums`}>
              {indepIsAngle ? formatAngle(t) : t.toFixed(3)}
            </div>
            <button
              onClick={togglePlay}
              className="px-3 py-1.5 text-sm bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-50"
              disabled={!rangeOK}
            >
              {animating ? "Pause" : "Play"}
            </button>
            <button
              onClick={() => setRepeat((r) => !r)}
              className={`px-3 py-1.5 text-sm rounded border ${
                repeat
                  ? "bg-indigo-100 border-indigo-400 text-indigo-700"
                  : "bg-white border-slate-300 text-slate-600 hover:bg-slate-50"
              }`}
              title={repeat
                ? "Looping: animation wraps around at the end"
                : "One-shot: animation stops at the end"}
              aria-pressed={repeat}
            >
              Repeat
            </button>
            <button
              onClick={() => rangeOK && setT(tMinNum)}
              className="px-3 py-1.5 text-sm bg-slate-100 text-slate-700 rounded hover:bg-slate-200 border border-slate-300"
              disabled={!rangeOK}
              title="Reset slider to start"
            >
              Reset
            </button>
            <select
              value={speed}
              onChange={(e) => setSpeed(parseFloat(e.target.value))}
              className="text-sm border border-slate-300 rounded px-1 py-1"
            >
              {SPEED_OPTIONS.map((s) => (
                <option key={s} value={s}>{s}×</option>
              ))}
            </select>
          </div>

          {/* Display options + status line */}
          <div className="flex flex-wrap gap-4 mt-3 text-sm items-center">
            <label className="flex items-center gap-1">
              <input
                type="checkbox"
                checked={showGrid}
                onChange={(e) => setShowGrid(e.target.checked)}
              />
              <span className="text-slate-700">Grid</span>
            </label>
            <div className="flex items-center gap-2">
              <span className="text-slate-600 text-xs">Trail:</span>
              {["full", "partial", "none"].map((m) => (
                <button
                  key={m}
                  onClick={() => setTrailMode(m)}
                  className={`px-2 py-0.5 text-xs rounded border ${
                    trailMode === m
                      ? "bg-indigo-100 border-indigo-400 text-indigo-700"
                      : "bg-white border-slate-300 text-slate-600"
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>
            <div className="ml-auto font-mono text-xs text-slate-600 text-right">
              <div>
                θ = {formatAngle(currentPolar.th, { compact: true })}
                ,&nbsp; r = {fmt(currentPolar.r)}
              </div>
              <div>
                (x, y) = ({fmt(currentPolar.x)}, {fmt(currentPolar.y)})
              </div>
            </div>
          </div>
        </div>

        {/* ============= Plots ============= */}
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-3">
            <div className="text-sm font-medium text-slate-700 mb-1 text-center">
              Rectangular plot: {yAxisLabel} vs {xAxisLabel}
            </div>
            <RectangularPlot
              pathFull={rectPath}
              pathTrail={rectTrail}
              rectExtent={rectExtent}
              tMinNum={tMinNum}
              tMaxNum={tMaxNum}
              t={t}
              currentDep={currentDep}
              indepIsAngle={indepIsAngle}
              depIsAngle={depIsAngle}
              xAxisLabel={xAxisLabel}
              yAxisLabel={yAxisLabel}
              showGrid={showGrid}
              trailMode={trailMode}
            />
          </div>

          <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-3">
            <div className="text-sm font-medium text-slate-700 mb-1 text-center">
              Polar plot: points (r, θ) in the plane
            </div>
            <PolarPlot
              pathFull={polarPath}
              pathTrail={polarTrail}
              polarExtent={polarExtent}
              currentPolar={currentPolar}
              showGrid={showGrid}
              trailMode={trailMode}
            />
          </div>
        </div>

        {/* Teaching tip (adapted to mode) */}
        <div className="mt-3 text-xs text-slate-500 bg-white rounded border border-slate-200 p-2">
          <strong className="text-slate-700">Teaching tip: </strong>
          {mode === "r_of_theta" ? (
            <>
              Press <em>Play</em> and watch how the moving red point on the
              rectangular plot (whose height is <em>r</em>) corresponds to the
              amber terminal side sweeping around the polar plot at angle θ.
              When r &gt; 0 the point lies on the <em>solid amber</em> ray at
              distance r; when r &lt; 0 it jumps to the <em>dashed green</em>{" "}
              extension at distance |r| on the opposite side of the origin.
            </>
          ) : (
            <>
              Press <em>Play</em> and watch how the moving red point on the
              rectangular plot (whose height is <em>θ</em>) corresponds to the
              amber terminal side rotating around the polar plot — the slider
              drives <em>r</em>, and the computed angle θ = f(r) sets the ray's
              direction.
            </>
          )}
        </div>
      </div>
    </div>
  );
}
