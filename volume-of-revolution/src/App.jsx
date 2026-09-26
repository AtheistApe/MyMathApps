import React, { useState, useRef, useEffect, useMemo, useCallback } from "react";
import * as THREE from "three";
import * as math from "mathjs";

/* ----------------------------------------------------------------------
   Palette / type tokens
   -------------------------------------------------------------------- */
const C = {
  bg: "#0a0d14",
  panel: "#12141f",
  panel2: "#171a27",
  border: "#262b3d",
  borderLight: "#333a52",
  text: "#e9ecf5",
  textMuted: "#8992a9",
  textFaint: "#5b6378",
  teal: "#2fd9c3",
  tealDim: "#1c7c6f",
  amber: "#f5b942",
  violet: "#9d8cf0",
  blue: "#60a5fa",
  danger: "#f0665e",
  good: "#4ade80",
};

const FONT_IMPORT =
  "@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=IBM+Plex+Mono:wght@400;500;600&family=Inter:wght@400;500;600&display=swap');";

const EXACT_N = 110;

/* ----------------------------------------------------------------------
   Math helpers
   -------------------------------------------------------------------- */
function compileFn(exprStr) {
  const node = math.parse(exprStr);
  const compiled = node.compile();
  // A common way people write the input is "f(x) = 2x^2 - x^3" (or
  // "g(x) = ..."), which mathjs parses as a function *definition*, not a
  // bare expression. Evaluating that returns the function itself, not a
  // number, for every x — so detect that case and call the returned
  // function directly instead of silently treating the curve as undefined.
  let unwrapped;
  try {
    unwrapped = compiled.evaluate({});
  } catch (e) {
    unwrapped = undefined;
  }
  if (typeof unwrapped === "function") {
    return (x) => {
      try {
        const v = unwrapped(x);
        if (typeof v !== "number" || !isFinite(v)) return NaN;
        return v;
      } catch (e) {
        return NaN;
      }
    };
  }
  const fn = (x) => {
    try {
      const v = compiled.evaluate({ x });
      if (typeof v !== "number" || !isFinite(v)) return NaN;
      return v;
    } catch (e) {
      return NaN;
    }
  };
  return fn;
}

function simpson(integrand, a, b, nSteps = 400) {
  let n = nSteps % 2 === 0 ? nSteps : nSteps + 1;
  const h = (b - a) / n;
  let sum = 0;
  let bad = 0;
  const evalAt = (x) => {
    const v = integrand(x);
    if (!isFinite(v)) {
      bad++;
      return 0;
    }
    return v;
  };
  sum += evalAt(a) + evalAt(b);
  for (let i = 1; i < n; i++) {
    const x = a + i * h;
    sum += (i % 2 === 0 ? 2 : 4) * evalAt(x);
  }
  return { value: (sum * h) / 3, badFraction: bad / (n + 1) };
}

// Curve range (min/max of f and g together over [a,b]) — the region's own
// vertical extent, independent of where the axis of revolution sits.
function curveExtent(fFn, gFn, a, b) {
  const N = 200;
  let lo = Infinity,
    hi = -Infinity;
  for (let i = 0; i <= N; i++) {
    const x = a + ((b - a) * i) / N;
    const yf = fFn(x);
    const yg = gFn(x);
    if (isFinite(yf)) {
      lo = Math.min(lo, yf);
      hi = Math.max(hi, yf);
    }
    if (isFinite(yg)) {
      lo = Math.min(lo, yg);
      hi = Math.max(hi, yg);
    }
  }
  if (!isFinite(lo)) {
    lo = 0;
    hi = 1;
  }
  return { lo, hi };
}

function computeBounds(fFn, gFn, a, b, axisType, k) {
  const { lo, hi } = curveExtent(fFn, gFn, a, b);
  let xMin = a,
    xMax = b,
    yMin = lo,
    yMax = hi;
  if (axisType === "horizontal") {
    yMin = Math.min(yMin, k);
    yMax = Math.max(yMax, k);
  } else {
    xMin = Math.min(xMin, k);
    xMax = Math.max(xMax, k);
  }
  return { xMin, xMax, yMin, yMax };
}

// Is (x,y) inside the region between f and g?
function insideTest(fFn, gFn, x, y) {
  const fx = fFn(x);
  const gx = gFn(x);
  if (!isFinite(fx) || !isFinite(gx)) return false;
  const lo = Math.min(fx, gx),
    hi = Math.max(fx, gx);
  return y >= lo && y <= hi;
}

// Finds the x-run(s) inside the region at height y via a coarse scan plus
// bisection refinement of each crossing. This is what lets us integrate
// "the other way" (over y) without needing a symbolic inverse of f/g.
function runsAtY(fFn, gFn, a, b, y, coarseSamples = 140, bisectIters = 24) {
  const dx = (b - a) / coarseSamples;
  const xs = [];
  const inside = [];
  for (let i = 0; i <= coarseSamples; i++) {
    const x = a + i * dx;
    xs.push(x);
    inside.push(insideTest(fFn, gFn, x, y));
  }
  const refine = (xLo, xHi, wantInsideAtHi) => {
    let lo = xLo,
      hi = xHi;
    for (let it = 0; it < bisectIters; it++) {
      const mid = (lo + hi) / 2;
      const midInside = insideTest(fFn, gFn, mid, y);
      if (midInside === wantInsideAtHi) hi = mid;
      else lo = mid;
    }
    return (lo + hi) / 2;
  };
  const runs = [];
  let runStart = inside[0] ? xs[0] : null;
  for (let i = 1; i <= coarseSamples; i++) {
    if (inside[i] && !inside[i - 1]) {
      runStart = refine(xs[i - 1], xs[i], true);
    } else if (!inside[i] && inside[i - 1]) {
      runs.push([runStart, refine(xs[i - 1], xs[i], false)]);
      runStart = null;
    }
  }
  if (runStart !== null) runs.push([runStart, xs[coarseSamples]]);
  return runs;
}

function widthAtY(fFn, gFn, a, b, y) {
  const runs = runsAtY(fFn, gFn, a, b, y);
  if (runs.length === 0) return { anyInside: false, xMinIn: 0, xMaxIn: 0, measureWidth: 0 };
  const xMinIn = Math.min(...runs.map((r) => r[0]));
  const xMaxIn = Math.max(...runs.map((r) => r[1]));
  const measureWidth = runs.reduce((s, r) => s + (r[1] - r[0]), 0);
  return { anyInside: true, xMinIn, xMaxIn, measureWidth };
}

// ---- Disk/washer decomposition. Natural (direct, dx) when the axis is
// horizontal; when the axis is vertical this is the "cross" method and is
// computed by slicing over y using widthAtY. ----
function computeDiskModel(fFn, gFn, a, b, axisType, k, n, samplePoint, yExtent) {
  const natural = axisType === "horizontal";
  const lo = natural ? a : yExtent.lo;
  const hi = natural ? b : yExtent.hi;
  const d = (hi - lo) / n;
  const pieces = [];
  let approxVolume = 0;
  let anyBad = false;
  for (let i = 0; i < n; i++) {
    const sLo = lo + i * d;
    const sHi = lo + (i + 1) * d;
    const sStar = samplePoint === "left" ? sLo : samplePoint === "right" ? sHi : (sLo + sHi) / 2;
    let innerR = 0,
      outerR = 0,
      valid = false,
      extra = {},
      segments = null;
    if (natural) {
      const fStar = fFn(sStar);
      const gStar = gFn(sStar);
      valid = isFinite(fStar) && isFinite(gStar);
      if (valid) {
        const d1 = Math.abs(fStar - k);
        const d2 = Math.abs(gStar - k);
        outerR = Math.max(d1, d2);
        innerR = Math.min(d1, d2);
      }
      extra = { xStar: sStar, fStar, gStar };
    } else {
      // The region can be disconnected at a given height (e.g. a
      // non-monotonic f(x)) — a single "leftmost to rightmost" span would
      // wrongly bridge the gap. Build one ring per actual run instead.
      const runs = runsAtY(fFn, gFn, a, b, sStar);
      valid = runs.length > 0;
      if (valid) {
        segments = runs.map(([rl, rh]) => {
          const r1 = Math.abs(rl - k);
          const r2 = Math.abs(rh - k);
          return { innerR: Math.min(r1, r2), outerR: Math.max(r1, r2) };
        });
        outerR = Math.max(...segments.map((s) => s.outerR));
        innerR = Math.min(...segments.map((s) => s.innerR));
      }
      extra = {
        yStar: sStar,
        xMinIn: valid ? Math.min(...runs.map((r) => r[0])) : 0,
        xMaxIn: valid ? Math.max(...runs.map((r) => r[1])) : 0,
        runCount: runs.length,
        xRuns: runs.map(([rl, rh]) => ({ spanLo: rl, spanHi: rh })),
      };
    }
    const volume = !valid
      ? 0
      : natural
      ? Math.PI * (outerR * outerR - innerR * innerR) * Math.abs(d)
      : segments.reduce((s, seg) => s + Math.PI * (seg.outerR * seg.outerR - seg.innerR * seg.innerR), 0) * Math.abs(d);
    pieces.push({ i, sliceLo: sLo, sliceHi: sHi, innerR, outerR, volume, valid, natural, segments, ...extra });
    if (valid) approxVolume += volume;
    else anyBad = true;
  }
  return { pieces, approxVolume, sliceWidth: d, anyBad, natural };
}

// ---- Cylindrical shell decomposition. Natural (direct, dx) when the axis
// is vertical; "cross" (via widthAtY, dy) when the axis is horizontal. ----
function computeShellModel(fFn, gFn, a, b, axisType, k, n, samplePoint, yExtent) {
  const natural = axisType === "vertical";
  const lo = natural ? a : yExtent.lo;
  const hi = natural ? b : yExtent.hi;
  const d = (hi - lo) / n;
  const pieces = [];
  let approxVolume = 0;
  let anyBad = false;
  for (let i = 0; i < n; i++) {
    const sLo = lo + i * d;
    const sHi = lo + (i + 1) * d;
    const sStar = samplePoint === "left" ? sLo : samplePoint === "right" ? sHi : (sLo + sHi) / 2;
    let innerR = Math.abs(sLo - k);
    let outerR = Math.abs(sHi - k);
    if (innerR > outerR) {
      const t = innerR;
      innerR = outerR;
      outerR = t;
    }
    const radius = Math.abs(sStar - k);
    let spanLo = 0,
      spanHi = 0,
      length = 0,
      valid = false,
      extra = {},
      segments = null;
    if (natural) {
      const fStar = fFn(sStar);
      const gStar = gFn(sStar);
      valid = isFinite(fStar) && isFinite(gStar);
      if (valid) {
        spanLo = Math.min(fStar, gStar);
        spanHi = Math.max(fStar, gStar);
        length = spanHi - spanLo;
      }
      extra = { xStar: sStar, fStar, gStar };
    } else {
      // Same disconnection issue as the disk case: don't bridge gaps with a
      // single leftmost-to-rightmost span. Each run becomes its own
      // separate shell segment at this same radius.
      const runs = runsAtY(fFn, gFn, a, b, sStar);
      valid = runs.length > 0;
      if (valid) {
        segments = runs.map(([rl, rh]) => ({ spanLo: rl, spanHi: rh }));
        length = segments.reduce((s, seg) => s + (seg.spanHi - seg.spanLo), 0);
        spanLo = Math.min(...runs.map((r) => r[0]));
        spanHi = Math.max(...runs.map((r) => r[1]));
      }
      extra = { yStar: sStar, xMinIn: spanLo, xMaxIn: spanHi, runCount: runs.length, xRuns: segments || [] };
    }
    const volume = valid ? 2 * Math.PI * radius * length * Math.abs(d) : 0;
    pieces.push({ i, sliceLo: sLo, sliceHi: sHi, innerR, outerR, spanLo, spanHi, radius, length, volume, valid, natural, segments, ...extra });
    if (valid) approxVolume += volume;
    else anyBad = true;
  }
  return { pieces, approxVolume, sliceWidth: d, anyBad, natural };
}

function computeNaturalExact(fFn, gFn, a, b, k, method) {
  const integrand =
    method === "disk"
      ? (x) => {
          const fx = fFn(x);
          const gx = gFn(x);
          const d1 = Math.abs(fx - k);
          const d2 = Math.abs(gx - k);
          const R = Math.max(d1, d2);
          const r = Math.min(d1, d2);
          return Math.PI * (R * R - r * r);
        }
      : (x) => 2 * Math.PI * Math.abs(x - k) * Math.abs(fFn(x) - gFn(x));
  return simpson(integrand, a, b, 400);
}

function computeCrossExact(fFn, gFn, a, b, k, method, yExtent) {
  const ySteps = 260;
  const { lo, hi } = yExtent;
  const n = ySteps % 2 === 0 ? ySteps : ySteps + 1;
  const h = (hi - lo) / n;
  let sum = 0;
  let bad = 0;
  for (let i = 0; i <= n; i++) {
    const y = lo + i * h;
    let val = 0;
    if (method === "disk") {
      // Sum one annulus per disconnected run, not one span over the
      // leftmost-to-rightmost extent (see runsAtY / computeDiskModel).
      const runs = runsAtY(fFn, gFn, a, b, y);
      if (runs.length > 0) {
        val = runs.reduce((s, [rl, rh]) => {
          const r1 = Math.abs(rl - k);
          const r2 = Math.abs(rh - k);
          const R = Math.max(r1, r2);
          const r = Math.min(r1, r2);
          return s + Math.PI * (R * R - r * r);
        }, 0);
      } else {
        bad++;
      }
    } else {
      const w = widthAtY(fFn, gFn, a, b, y);
      if (w.anyInside) {
        val = 2 * Math.PI * Math.abs(y - k) * w.measureWidth;
      } else {
        bad++;
      }
    }
    const weight = i === 0 || i === n ? 1 : i % 2 === 0 ? 2 : 4;
    sum += weight * val;
  }
  return { value: (sum * h) / 3, badFraction: bad / (n + 1) };
}

function fmt(v, d = 4) {
  if (v === null || v === undefined || !isFinite(v)) return "—";
  if (v !== 0 && Math.abs(v) < 1e-4) return v.toExponential(2);
  const r = Number(v.toFixed(d));
  return r.toString();
}

/* ----------------------------------------------------------------------
   Three.js geometry helpers
   -------------------------------------------------------------------- */
function buildAnnularPrism(innerR, outerR, extrudeLength, axis, segments = 56) {
  const shape = new THREE.Shape();
  const oR = Math.max(outerR, 0.0006);
  shape.absarc(0, 0, oR, 0, Math.PI * 2, false);
  if (innerR > 1e-5 && innerR < oR - 1e-6) {
    const hole = new THREE.Path();
    hole.absarc(0, 0, innerR, 0, Math.PI * 2, true);
    shape.holes.push(hole);
  }
  const geom = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(extrudeLength, 0.0008),
    bevelEnabled: false,
    curveSegments: segments,
  });
  if (axis === "x") {
    geom.rotateY(Math.PI / 2); // (Xl,Yl,Zl) -> (Zl,Yl,-Xl)
  } else {
    geom.rotateX(-Math.PI / 2); // (Xl,Yl,Zl) -> (Xl,Zl,-Yl)
  }
  return geom;
}

// Unified geometry builder for all four (axisType x method) combinations.
// The extrude direction is fixed by axisType alone (horizontal -> along X,
// vertical -> along Y); method decides which dimension gets the visual gap.
// Selection is highlighted with color/emissive only (see call site) — never
// by scaling the geometry, since inflating the radius would make a selected
// disk/washer visibly poke past its own reported radius (and past the f(x)
// curve line drawn in the same scene).
// `segment` optionally overrides the piece's own innerR/outerR (disk) or
// spanLo/spanHi (shell) — used when a piece is disconnected into multiple
// separate rings/segments at a single height (see runsAtY).
function buildPieceMesh(piece, axisType, method, k, gap, segment) {
  const extrudeAxis = axisType === "horizontal" ? "x" : "y";
  let innerR = (segment && segment.innerR !== undefined) ? segment.innerR : piece.innerR;
  let outerR = (segment && segment.outerR !== undefined) ? segment.outerR : piece.outerR;
  let spanLo, spanHi;
  if (method === "disk") {
    const full = piece.sliceHi - piece.sliceLo;
    const eff = Math.max(full * gap, 1e-5);
    const center = (piece.sliceLo + piece.sliceHi) / 2;
    spanLo = center - eff / 2;
    spanHi = center + eff / 2;
  } else {
    const mid = (innerR + outerR) / 2;
    const halfW = Math.max(((outerR - innerR) / 2) * gap, 1e-5);
    innerR = Math.max(mid - halfW, 0);
    outerR = mid + halfW;
    const lo = (segment && segment.spanLo !== undefined) ? segment.spanLo : piece.spanLo;
    const hi = (segment && segment.spanHi !== undefined) ? segment.spanHi : piece.spanHi;
    spanLo = lo;
    spanHi = Math.max(hi, spanLo + 0.0008);
  }
  const geom = buildAnnularPrism(innerR, outerR, spanHi - spanLo, extrudeAxis);
  if (extrudeAxis === "x") geom.translate(spanLo, k, 0);
  else geom.translate(k, spanLo, 0);
  return geom;
}

function disposeObject3D(obj) {
  obj.traverse((child) => {
    if (child.geometry) child.geometry.dispose();
    if (child.material) {
      if (Array.isArray(child.material)) child.material.forEach((m) => m.dispose());
      else child.material.dispose();
    }
  });
}

/* ----------------------------------------------------------------------
   Main component
   -------------------------------------------------------------------- */
export default function VolumeOfRevolutionExplorer() {
  const [fStr, setFStr] = useState("0.5*x^2 + 1");
  const [fInput, setFInput] = useState("0.5*x^2 + 1");
  const [gStr, setGStr] = useState("0");
  const [gInput, setGInput] = useState("0");
  const [aStr, setAStr] = useState("0");
  const [bStr, setBStr] = useState("3");
  const [axisType, setAxisType] = useState("horizontal");
  const [kStr, setKStr] = useState("-1");
  const [method, setMethod] = useState("disk");
  const [n, setN] = useState(8);
  const [samplePoint, setSamplePoint] = useState("mid");
  const [selectedIndex, setSelectedIndex] = useState(null);
  const [isolate, setIsolate] = useState(false);
  const [showExact, setShowExact] = useState(true);

  // Commit typed f(x)/g(x) automatically shortly after typing stops, rather
  // than relying solely on blur/Enter — a native blur() reliably triggers
  // React's onBlur, but not every "click away" interaction is guaranteed to
  // fire it (e.g. clicking straight into the 3D viewport), which could leave
  // an edit silently uncommitted with no visible error. onBlur/Enter below
  // still commit immediately when they do fire; this is the fallback that
  // guarantees the edit always takes effect.
  useEffect(() => {
    const t = setTimeout(() => setFStr(fInput), 500);
    return () => clearTimeout(t);
  }, [fInput]);
  useEffect(() => {
    const t = setTimeout(() => setGStr(gInput), 500);
    return () => clearTimeout(t);
  }, [gInput]);

  const a = parseFloat(aStr);
  const b = parseFloat(bStr);
  const k = parseFloat(kStr) || 0;

  /* ---- parse both curves, produce error text ---- */
  const { fn, gn, parseError } = useMemo(() => {
    try {
      const f = compileFn(fStr);
      const g = compileFn(gStr);
      const probeXs = [a, (a + b) / 2, b];
      const fOk = probeXs.some((x) => isFinite(f(x)));
      const gOk = probeXs.some((x) => isFinite(g(x)));
      if (!fOk && !gOk) return { fn: null, gn: null, parseError: "Neither f(x) nor g(x) is defined anywhere on [a, b]." };
      if (!fOk) return { fn: null, gn: null, parseError: "f(x) is undefined across the whole interval [a, b]." };
      if (!gOk) return { fn: null, gn: null, parseError: "g(x) is undefined across the whole interval [a, b]." };
      return { fn: f, gn: g, parseError: null };
    } catch (e) {
      return { fn: null, gn: null, parseError: "Can't parse one of the expressions. Try things like x^2, sqrt(x), sin(x)+2." };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fStr, gStr, a, b]);

  const intervalError = !isFinite(a) || !isFinite(b) ? "Enter numeric values for a and b." : a >= b ? "a must be less than b." : null;
  const nSafe = Math.max(1, Math.min(40, Math.round(n) || 1));

  const error = intervalError || parseError;

  const yExtent = useMemo(() => {
    if (error || !fn || !gn) return null;
    return curveExtent(fn, gn, a, b);
  }, [fn, gn, a, b, error]);

  const bounds = useMemo(() => {
    if (error || !fn || !gn) return null;
    return computeBounds(fn, gn, a, b, axisType, k);
  }, [fn, gn, a, b, axisType, k, error]);

  const diskModel = useMemo(() => {
    if (error || !fn || !gn || !yExtent) return null;
    return computeDiskModel(fn, gn, a, b, axisType, k, nSafe, samplePoint, yExtent);
  }, [fn, gn, a, b, axisType, k, nSafe, samplePoint, yExtent, error]);

  const shellModel = useMemo(() => {
    if (error || !fn || !gn || !yExtent) return null;
    return computeShellModel(fn, gn, a, b, axisType, k, nSafe, samplePoint, yExtent);
  }, [fn, gn, a, b, axisType, k, nSafe, samplePoint, yExtent, error]);

  const activeModel = method === "disk" ? diskModel : shellModel;

  const diskExact = useMemo(() => {
    if (error || !fn || !gn || !yExtent) return null;
    return axisType === "horizontal" ? computeNaturalExact(fn, gn, a, b, k, "disk") : computeCrossExact(fn, gn, a, b, k, "disk", yExtent);
  }, [fn, gn, a, b, axisType, k, yExtent, error]);

  const shellExact = useMemo(() => {
    if (error || !fn || !gn || !yExtent) return null;
    return axisType === "vertical" ? computeNaturalExact(fn, gn, a, b, k, "shell") : computeCrossExact(fn, gn, a, b, k, "shell", yExtent);
  }, [fn, gn, a, b, axisType, k, yExtent, error]);

  const activeExact = method === "disk" ? diskExact : shellExact;

  const exactPiecesActive = useMemo(() => {
    if (error || !fn || !gn || !showExact || !yExtent) return null;
    return method === "disk"
      ? computeDiskModel(fn, gn, a, b, axisType, k, EXACT_N, "mid", yExtent)
      : computeShellModel(fn, gn, a, b, axisType, k, EXACT_N, "mid", yExtent);
  }, [fn, gn, a, b, axisType, k, method, showExact, yExtent, error]);

  const axisCrossesRegion = useMemo(() => {
    if (error || !fn || !gn) return false;
    if (axisType === "vertical") return k > Math.min(a, b) && k < Math.max(a, b);
    const N = 60;
    for (let i = 0; i <= N; i++) {
      const x = a + ((b - a) * i) / N;
      const fx = fn(x);
      const gx = gn(x);
      if (!isFinite(fx) || !isFinite(gx)) continue;
      const lo = Math.min(fx, gx),
        hi = Math.max(fx, gx);
      if (k > lo + 1e-9 && k < hi - 1e-9) return true;
    }
    return false;
  }, [fn, gn, a, b, axisType, k, error]);

  useEffect(() => {
    setSelectedIndex(null);
  }, [fStr, gStr, a, b, axisType, method, k, nSafe, samplePoint]);

  /* ---------------- three.js ---------------- */
  const mountRef = useRef(null);
  const three = useRef({});
  const orbit = useRef({ az: 0.7, el: 1.15, radius: 8, target: new THREE.Vector3(), dragging: false, lastX: 0, lastY: 0, moved: 0 });

  // one-time scene setup
  useEffect(() => {
    const mount = mountRef.current;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(40, 1, 0.05, 500);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    mount.appendChild(renderer.domElement);

    const ambient = new THREE.AmbientLight(0xffffff, 0.55);
    const dir1 = new THREE.DirectionalLight(0xffffff, 0.9);
    dir1.position.set(4, 6, 5);
    const dir2 = new THREE.DirectionalLight(0x88aaff, 0.35);
    dir2.position.set(-5, -3, -4);
    scene.add(ambient, dir1, dir2);

    const contentGroup = new THREE.Group();
    scene.add(contentGroup);

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();

    function resize() {
      const w = mount.clientWidth;
      const h = mount.clientHeight;
      if (w === 0 || h === 0) return;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    }
    const ro = new ResizeObserver(resize);
    ro.observe(mount);
    resize();

    function onPointerDown(e) {
      orbit.current.dragging = true;
      orbit.current.lastX = e.clientX;
      orbit.current.lastY = e.clientY;
      orbit.current.moved = 0;
    }
    function onPointerMove(e) {
      if (!orbit.current.dragging) return;
      const dx = e.clientX - orbit.current.lastX;
      const dy = e.clientY - orbit.current.lastY;
      orbit.current.moved += Math.abs(dx) + Math.abs(dy);
      orbit.current.az -= dx * 0.008;
      orbit.current.el = Math.max(0.08, Math.min(Math.PI - 0.08, orbit.current.el - dy * 0.008));
      orbit.current.lastX = e.clientX;
      orbit.current.lastY = e.clientY;
    }
    function onPointerUp(e) {
      if (orbit.current.dragging && orbit.current.moved < 5) {
        const rect = renderer.domElement.getBoundingClientRect();
        pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
        raycaster.setFromCamera(pointer, camera);
        const hits = raycaster.intersectObjects(three.current.selectableMeshes || [], false);
        if (hits.length > 0) {
          const idx = hits[0].object.userData.index;
          if (typeof idx === "number") three.current.onSelect && three.current.onSelect(idx);
        }
      }
      orbit.current.dragging = false;
    }
    function onWheel(e) {
      e.preventDefault();
      orbit.current.radius = Math.max(1.2, Math.min(60, orbit.current.radius * (1 + e.deltaY * 0.0012)));
    }
    const dom = renderer.domElement;
    dom.style.touchAction = "none";
    dom.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    dom.addEventListener("wheel", onWheel, { passive: false });

    let raf;
    function animate() {
      raf = requestAnimationFrame(animate);
      const o = orbit.current;
      const x = o.target.x + o.radius * Math.sin(o.el) * Math.sin(o.az);
      const y = o.target.y + o.radius * Math.cos(o.el);
      const z = o.target.z + o.radius * Math.sin(o.el) * Math.cos(o.az);
      camera.position.set(x, y, z);
      camera.lookAt(o.target);
      renderer.render(scene, camera);
    }
    animate();

    Object.assign(three.current, { scene, camera, renderer, contentGroup, selectableMeshes: [] });

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      dom.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      dom.removeEventListener("wheel", onWheel);
      disposeObject3D(scene);
      renderer.dispose();
      if (mount.contains(dom)) mount.removeChild(dom);
    };
  }, []);

  // reframe camera on structural changes (bounds only depend on curves,
  // axisType and k — never on method, so switching method never re-frames)
  useEffect(() => {
    if (!bounds) return;
    const o = orbit.current;
    if (axisType === "horizontal") {
      const span = bounds.xMax - bounds.xMin;
      const rad = Math.max(Math.abs(bounds.yMax - k), Math.abs(bounds.yMin - k), Math.abs(k)) * 1.15;
      o.target.set((bounds.xMin + bounds.xMax) / 2, k, 0);
      o.radius = Math.max(span, rad * 2, 1.5) * 1.7;
    } else {
      const span = bounds.yMax - bounds.yMin;
      const rad = Math.max(Math.abs(bounds.xMax - k), Math.abs(bounds.xMin - k)) * 1.15;
      o.target.set(k, (bounds.yMin + bounds.yMax) / 2, 0);
      o.radius = Math.max(span, rad * 2, 1.5) * 1.7;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bounds && bounds.xMin, bounds && bounds.xMax, bounds && bounds.yMin, bounds && bounds.yMax, axisType, k]);

  three.current.onSelect = useCallback((idx) => setSelectedIndex((cur) => (cur === idx ? null : idx)), []);

  // rebuild geometry whenever the active model / view options change
  useEffect(() => {
    const t = three.current;
    if (!t.contentGroup) return;
    while (t.contentGroup.children.length) {
      const c = t.contentGroup.children.pop();
      disposeObject3D(c);
    }
    t.selectableMeshes = [];
    if (!activeModel || !bounds) return;

    // exact ghost solid (same method as the active view, high resolution)
    if (showExact && exactPiecesActive) {
      const ghost = new THREE.Group();
      exactPiecesActive.pieces.forEach((p) => {
        if (!p.valid) return;
        const segs = p.segments && p.segments.length ? p.segments : [undefined];
        segs.forEach((seg) => {
          const geom = buildPieceMesh(p, axisType, method, k, 1.0, seg);
          const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(C.violet), transparent: true, opacity: 0.09, depthWrite: false, side: THREE.DoubleSide });
          ghost.add(new THREE.Mesh(geom, mat));
        });
      });
      t.contentGroup.add(ghost);
    }

    // approximation pieces
    const pieceGroup = new THREE.Group();
    activeModel.pieces.forEach((p) => {
      if (!p.valid) return;
      const isSel = selectedIndex === p.i;
      if (isolate && selectedIndex !== null && !isSel) return;
      const gap = 0.86;
      const dim = selectedIndex !== null && !isSel;
      const color = isSel ? C.amber : C.teal;
      const opacity = isSel ? 0.95 : dim ? 0.16 : 0.62;
      const segs = p.segments && p.segments.length ? p.segments : [undefined];
      segs.forEach((seg) => {
        const geom = buildPieceMesh(p, axisType, method, k, gap, seg);
        const mat = new THREE.MeshStandardMaterial({
          color: new THREE.Color(color),
          transparent: true,
          opacity,
          roughness: 0.45,
          metalness: 0.08,
          side: THREE.DoubleSide,
          emissive: isSel ? new THREE.Color(color) : new THREE.Color(0x000000),
          emissiveIntensity: isSel ? 0.25 : 0,
        });
        const mesh = new THREE.Mesh(geom, mat);
        mesh.userData.index = p.i;
        pieceGroup.add(mesh);
        t.selectableMeshes.push(mesh);

        const edges = new THREE.EdgesGeometry(geom, 25);
        const lineMat = new THREE.LineBasicMaterial({
          color: new THREE.Color(isSel ? C.amber : C.teal),
          transparent: true,
          opacity: isSel ? 0.9 : dim ? 0.12 : 0.35,
        });
        pieceGroup.add(new THREE.LineSegments(edges, lineMat));
      });
    });
    t.contentGroup.add(pieceGroup);

    // profile curves: f(x) solid, g(x) dashed
    const NC = 160;
    const fPts = [];
    const gPts = [];
    for (let i = 0; i <= NC; i++) {
      const x = a + ((b - a) * i) / NC;
      const yf = fn(x);
      const yg = gn(x);
      if (isFinite(yf)) fPts.push(new THREE.Vector3(x, yf, 0));
      if (isFinite(yg)) gPts.push(new THREE.Vector3(x, yg, 0));
    }
    if (fPts.length > 1) {
      const curveGeom = new THREE.BufferGeometry().setFromPoints(fPts);
      const curveMat = new THREE.LineBasicMaterial({ color: 0xf3f5fb, transparent: true, opacity: 0.85 });
      t.contentGroup.add(new THREE.Line(curveGeom, curveMat));
    }
    if (gPts.length > 1) {
      const gGeom = new THREE.BufferGeometry().setFromPoints(gPts);
      const gMat = new THREE.LineDashedMaterial({ color: 0x8992a9, dashSize: 0.1, gapSize: 0.07, transparent: true, opacity: 0.85 });
      const gLine = new THREE.Line(gGeom, gMat);
      gLine.computeLineDistances();
      t.contentGroup.add(gLine);
    }

    // x-axis reference (y=0)
    const xAxisGeom = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(bounds.xMin - (bounds.xMax - bounds.xMin) * 0.08, 0, 0),
      new THREE.Vector3(bounds.xMax + (bounds.xMax - bounds.xMin) * 0.08, 0, 0),
    ]);
    t.contentGroup.add(new THREE.Line(xAxisGeom, new THREE.LineBasicMaterial({ color: 0x5b6378, transparent: true, opacity: 0.5 })));

    // axis of rotation (dashed)
    let axisLinePts;
    if (axisType === "horizontal") {
      const ext = (bounds.xMax - bounds.xMin) * 0.12 + 0.2;
      axisLinePts = [new THREE.Vector3(bounds.xMin - ext, k, 0), new THREE.Vector3(bounds.xMax + ext, k, 0)];
    } else {
      const ext = (bounds.yMax - bounds.yMin) * 0.12 + 0.2;
      axisLinePts = [new THREE.Vector3(k, bounds.yMin - ext, 0), new THREE.Vector3(k, bounds.yMax + ext, 0)];
    }
    const axisGeom = new THREE.BufferGeometry().setFromPoints(axisLinePts);
    const axisMat = new THREE.LineDashedMaterial({ color: new THREE.Color(C.amber), dashSize: 0.12, gapSize: 0.08, transparent: true, opacity: 0.85 });
    const axisLine = new THREE.Line(axisGeom, axisMat);
    axisLine.computeLineDistances();
    t.contentGroup.add(axisLine);
  }, [activeModel, exactPiecesActive, showExact, selectedIndex, isolate, axisType, method, k, bounds, fn, gn, a, b]);

  /* ---------------- derived UI values ---------------- */
  const axisLabel = axisType === "horizontal" ? `y = ${fmt(k, 3)}` : `x = ${fmt(k, 3)}`;
  const selected = activeModel && selectedIndex !== null ? activeModel.pieces.find((p) => p.i === selectedIndex) : null;
  const agreement =
    diskExact && shellExact
      ? Math.abs(diskExact.value - shellExact.value) / Math.max(1e-9, (Math.abs(diskExact.value) + Math.abs(shellExact.value)) / 2)
      : null;

  const presets = [
    { label: "x² (vs x-axis)", f: "x^2", g: "0" },
    { label: "√x (vs x-axis)", f: "sqrt(x)", g: "0" },
    { label: "sin(x)+2 (vs x-axis)", f: "sin(x) + 2", g: "0" },
    { label: "x  vs  x²", f: "x", g: "x^2", a: "0", b: "1" },
    { label: "4  vs  x²/2", f: "4", g: "x^2/2", a: "0", b: "2" },
  ];

  /* ---------------- 2D profile SVG ---------------- */
  const svg = useMemo(() => {
    if (error || !fn || !gn || !bounds) return null;
    const W = 520,
      H = 260,
      PAD = 28;
    const spanX = Math.max(bounds.xMax - bounds.xMin, 1e-6) * 1.18;
    const spanY = Math.max(bounds.yMax - bounds.yMin, 1e-6) * 1.25;
    const cx = (bounds.xMin + bounds.xMax) / 2;
    const cy = (bounds.yMin + bounds.yMax) / 2;
    const x0 = cx - spanX / 2,
      x1 = cx + spanX / 2;
    const y0 = cy - spanY / 2,
      y1 = cy + spanY / 2;
    const sx = (x) => PAD + ((x - x0) / (x1 - x0)) * (W - 2 * PAD);
    const sy = (y) => H - PAD - ((y - y0) / (y1 - y0)) * (H - 2 * PAD);

    const NC = 140;
    let dF = "",
      dG = "";
    for (let i = 0; i <= NC; i++) {
      const x = a + ((b - a) * i) / NC;
      const yf = fn(x);
      const yg = gn(x);
      if (isFinite(yf)) dF += `${dF ? "L" : "M"}${sx(x).toFixed(2)},${sy(yf).toFixed(2)} `;
      if (isFinite(yg)) dG += `${dG ? "L" : "M"}${sx(x).toFixed(2)},${sy(yg).toFixed(2)} `;
    }

    let rectPath = null;
    if (selected) {
      if (selected.natural) {
        const yTop = Math.max(selected.fStar, selected.gStar);
        const yBot = Math.min(selected.fStar, selected.gStar);
        rectPath = `M${sx(selected.sliceLo).toFixed(2)},${sy(yBot).toFixed(2)} L${sx(selected.sliceHi).toFixed(2)},${sy(yBot).toFixed(2)} L${sx(selected.sliceHi).toFixed(2)},${sy(yTop).toFixed(2)} L${sx(selected.sliceLo).toFixed(2)},${sy(yTop).toFixed(2)} Z`;
      } else {
        // Draw one rectangle per disconnected segment (see runsAtY) instead
        // of a single span from the leftmost to the rightmost point, which
        // would wrongly bridge any gap under the curve. xRuns holds the
        // actual x-position boundaries regardless of method (for disk-cross,
        // `segments` holds radii instead, which isn't what belongs here).
        const segs = selected.xRuns && selected.xRuns.length ? selected.xRuns : [{ spanLo: selected.xMinIn, spanHi: selected.xMaxIn }];
        rectPath = segs
          .map(
            (seg) =>
              `M${sx(seg.spanLo).toFixed(2)},${sy(selected.sliceLo).toFixed(2)} L${sx(seg.spanHi).toFixed(2)},${sy(selected.sliceLo).toFixed(2)} L${sx(seg.spanHi).toFixed(2)},${sy(selected.sliceHi).toFixed(2)} L${sx(seg.spanLo).toFixed(2)},${sy(selected.sliceHi).toFixed(2)} Z`
          )
          .join(" ");
      }
    }

    return { W, H, sx, sy, x0, x1, y0, y1, dF, dG, rectPath };
  }, [fn, gn, a, b, bounds, selected, error]);

  /* ---------------- render ---------------- */
  return (
    <div style={styles.app}>
      <style>{`${FONT_IMPORT}
        * { box-sizing: border-box; }
        .vre-scroll::-webkit-scrollbar { width: 8px; }
        .vre-scroll::-webkit-scrollbar-thumb { background: ${C.borderLight}; border-radius: 8px; }
        input[type=range] { -webkit-appearance: none; appearance: none; height: 4px; border-radius: 4px; background: ${C.border}; outline: none; }
        input[type=range]::-webkit-slider-thumb { -webkit-appearance: none; width: 15px; height: 15px; border-radius: 50%; background: ${C.teal}; cursor: pointer; border: 2px solid #0a0d14; }
        input[type=range]::-moz-range-thumb { width: 15px; height: 15px; border-radius: 50%; background: ${C.teal}; cursor: pointer; border: 2px solid #0a0d14; }
        input[type=text], input[type=number] { font-family: 'IBM Plex Mono', monospace; }
        @media (max-width: 880px) {
          .vre-layout { grid-template-columns: 1fr !important; }
          .vre-viewport { height: 380px !important; }
        }
      `}</style>

      <header style={styles.header}>
        <div style={styles.headerTop}>
          <div>
            <div style={styles.headerEyebrow}>MATH 252 · APPLICATIONS OF INTEGRATION</div>
            <h1 style={styles.h1}>Volume of Revolution Explorer</h1>
          </div>
          <a href="/guide.html" target="_blank" rel="noopener noreferrer" style={styles.guideLink}>
            Student guide
          </a>
        </div>
        <div style={styles.headerSub}>Disks, washers &amp; cylindrical shells for the region between two curves — two methods, the same solid.</div>
      </header>

      <div className="vre-layout" style={styles.layout}>
        {/* ---------------- Control column ---------------- */}
        <div className="vre-scroll" style={styles.controlCol}>
          <Section title="Region">
            <Field label="f(x)">
              <input
                style={styles.input}
                value={fInput}
                onChange={(e) => setFInput(e.target.value)}
                onBlur={() => setFStr(fInput)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") setFStr(fInput);
                }}
                spellCheck={false}
              />
            </Field>
            <Field label="g(x)  — leave as 0 to bound by the x-axis">
              <input
                style={styles.input}
                value={gInput}
                onChange={(e) => setGInput(e.target.value)}
                onBlur={() => setGStr(gInput)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") setGStr(gInput);
                }}
                spellCheck={false}
              />
            </Field>
            <div style={styles.presetRow}>
              {presets.map((p) => (
                <button
                  key={p.label}
                  style={styles.presetBtn}
                  onClick={() => {
                    setFInput(p.f);
                    setFStr(p.f);
                    setGInput(p.g);
                    setGStr(p.g);
                    if (p.a !== undefined) setAStr(p.a);
                    if (p.b !== undefined) setBStr(p.b);
                  }}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <Field label="a (left)">
                <input style={styles.input} type="number" value={aStr} onChange={(e) => setAStr(e.target.value)} />
              </Field>
              <Field label="b (right)">
                <input style={styles.input} type="number" value={bStr} onChange={(e) => setBStr(e.target.value)} />
              </Field>
            </div>
            <div style={styles.hint}>Region: the area between y = f(x) and y = g(x), for x in [a, b].</div>
          </Section>

          <Section title="Axis of revolution">
            <div style={styles.toggleRow}>
              <ToggleBtn active={axisType === "horizontal"} onClick={() => setAxisType("horizontal")}>
                Horizontal — y = k
              </ToggleBtn>
              <ToggleBtn active={axisType === "vertical"} onClick={() => setAxisType("vertical")}>
                Vertical — x = k
              </ToggleBtn>
            </div>
            <Field label={axisType === "horizontal" ? "k  (axis at y = k)" : "k  (axis at x = k)"}>
              <input style={styles.input} type="number" step="0.5" value={kStr} onChange={(e) => setKStr(e.target.value)} />
            </Field>
            {axisCrossesRegion && (
              <div style={styles.warning}>The axis passes through the region on this interval — the solid may self-intersect. Try moving the axis outside the region.</div>
            )}
          </Section>

          <Section title="Method">
            <div style={styles.toggleRow}>
              <ToggleBtn active={method === "disk"} onClick={() => setMethod("disk")}>
                Disks / Washers
              </ToggleBtn>
              <ToggleBtn active={method === "shell"} onClick={() => setMethod("shell")}>
                Cylindrical Shells
              </ToggleBtn>
            </div>
            <div style={styles.hint}>
              Both methods compute the volume of the <em>same</em> solid — one slices it perpendicular to the axis, the other parallel to it. The Volume panel below shows both numbers so you can see them agree.
            </div>
          </Section>

          <Section title="Approximation">
            <Field label={`Subintervals: n = ${nSafe}`}>
              <input style={{ width: "100%" }} type="range" min={1} max={40} step={1} value={nSafe} onChange={(e) => setN(parseInt(e.target.value, 10))} />
            </Field>
            <Field label="Sample point">
              <div style={styles.toggleRow}>
                {["left", "mid", "right"].map((sp) => (
                  <ToggleBtn key={sp} small active={samplePoint === sp} onClick={() => setSamplePoint(sp)}>
                    {sp === "mid" ? "midpoint" : sp}
                  </ToggleBtn>
                ))}
              </div>
            </Field>
            <label style={styles.checkboxRow}>
              <input type="checkbox" checked={showExact} onChange={(e) => setShowExact(e.target.checked)} />
              Show exact solid (ghost)
            </label>
          </Section>

          <Section title="Inspect a single piece">
            <Field label={selectedIndex === null ? "None selected — click a piece in the scene, or choose one:" : `Piece #${selectedIndex + 1} of ${nSafe}`}>
              <input
                style={{ width: "100%" }}
                type="range"
                min={0}
                max={nSafe - 1}
                step={1}
                value={selectedIndex === null ? 0 : selectedIndex}
                onChange={(e) => setSelectedIndex(parseInt(e.target.value, 10))}
              />
            </Field>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <button style={styles.smallBtn} onClick={() => setSelectedIndex(null)}>
                Clear selection
              </button>
              <label style={styles.checkboxRow}>
                <input type="checkbox" checked={isolate} onChange={(e) => setIsolate(e.target.checked)} disabled={selectedIndex === null} />
                Hide other pieces
              </label>
            </div>
          </Section>
        </div>

        {/* ---------------- Viewport column ---------------- */}
        <div style={styles.viewCol}>
          {/* The 3D mount point below must never be removed from the DOM —
              the Three.js scene/renderer are set up once on first mount and
              never re-attach themselves to a new element. So the error
              state is shown as an overlay on top of the viewport, not as a
              replacement for it, or clearing a field and then fixing it
              would permanently orphan the renderer with nothing rendering. */}
          <div className="vre-viewport" style={styles.viewport}>
            <div ref={mountRef} style={{ position: "absolute", inset: 0 }} />
            {error ? (
              <div style={styles.errorOverlay}>{error}</div>
            ) : (
              <>
                <div style={styles.viewportCaption}>drag to rotate · scroll to zoom · click a piece to inspect it</div>
                <Legend method={method} showExact={showExact} />
              </>
            )}
          </div>

          {!error && (
            <div style={styles.lowerGrid}>
                <div style={styles.profileCard}>
                  <div style={styles.cardTitle}>Generating region</div>
                  {svg && (
                    <svg width="100%" viewBox={`0 0 ${svg.W} ${svg.H}`} style={{ display: "block" }}>
                      <line x1={svg.sx(svg.x0)} y1={svg.sy(0)} x2={svg.sx(svg.x1)} y2={svg.sy(0)} stroke={C.textFaint} strokeWidth="1" />
                      <line x1={svg.sx(0)} y1={svg.sy(svg.y0)} x2={svg.sx(0)} y2={svg.sy(svg.y1)} stroke={C.textFaint} strokeWidth="1" />
                      {axisType === "horizontal" ? (
                        <line x1={svg.sx(svg.x0)} y1={svg.sy(k)} x2={svg.sx(svg.x1)} y2={svg.sy(k)} stroke={C.amber} strokeWidth="1.4" strokeDasharray="5,4" />
                      ) : (
                        <line x1={svg.sx(k)} y1={svg.sy(svg.y0)} x2={svg.sx(k)} y2={svg.sy(svg.y1)} stroke={C.amber} strokeWidth="1.4" strokeDasharray="5,4" />
                      )}
                      <line x1={svg.sx(a)} y1={svg.sy(svg.y0)} x2={svg.sx(a)} y2={svg.sy(svg.y1)} stroke={C.borderLight} strokeWidth="1" />
                      <line x1={svg.sx(b)} y1={svg.sy(svg.y0)} x2={svg.sx(b)} y2={svg.sy(svg.y1)} stroke={C.borderLight} strokeWidth="1" />
                      {svg.rectPath && <path d={svg.rectPath} fill={C.amber} fillOpacity="0.28" stroke={C.amber} strokeWidth="1.3" />}
                      <path d={svg.dG} fill="none" stroke={C.textMuted} strokeWidth="1.6" strokeDasharray="4,3" />
                      <path d={svg.dF} fill="none" stroke="#f3f5fb" strokeWidth="2" />
                    </svg>
                  )}
                  <div style={styles.cardCaption}>
                    white = f(x) · dashed gray = g(x) · dashed amber = axis of revolution ({axisLabel}) · shaded region = the piece selected below
                    {selected && !selected.natural ? " (shown as a horizontal band since this piece slices by height, not by x)" : ""}
                  </div>
                </div>

                <div style={styles.resultsCard}>
                  <div style={styles.cardTitle}>Volume — two methods, one solid</div>
                  <Row label="Disk/Washer — approx (n)" value={fmt(diskModel.approxVolume)} mono color={C.teal} />
                  <Row label="Disk/Washer — exact" value={fmt(diskExact.value)} mono strong color={C.teal} />
                  <Row label="Shell — approx (n)" value={fmt(shellModel.approxVolume)} mono color={C.blue} />
                  <Row label="Shell — exact" value={fmt(shellExact.value)} mono strong color={C.blue} />
                  {agreement !== null && (
                    <div style={agreement < 0.01 ? styles.matchGood : styles.warning}>
                      {agreement < 0.01
                        ? `✓ Exact volumes agree to within ${(agreement * 100).toFixed(2)}% — same solid, two methods.`
                        : `Exact volumes differ by ${(agreement * 100).toFixed(1)}% — check that the axis doesn't cut through the region.`}
                    </div>
                  )}
                  {(diskExact.badFraction > 0.01 || shellExact.badFraction > 0.01) && (
                    <div style={styles.warning}>f(x) or g(x) is undefined at some points on [a, b]; those points were skipped.</div>
                  )}

                  <div style={styles.divider} />
                  <div style={styles.cardTitle}>Selected piece ({method === "disk" ? "Disk/Washer" : "Shell"} view)</div>
                  {selected ? (
                    <>
                      <Row label={`${selected.natural ? "x" : "y"}-subinterval`} value={`[${fmt(selected.sliceLo, 3)}, ${fmt(selected.sliceHi, 3)}]`} mono />
                      <Row label={`Sample point ${selected.natural ? "x*" : "y*"}`} value={fmt(selected.natural ? selected.xStar : selected.yStar, 4)} mono />
                      {selected.natural ? (
                        <>
                          <Row label="f(x*)" value={fmt(selected.fStar, 4)} mono />
                          <Row label="g(x*)" value={fmt(selected.gStar, 4)} mono />
                        </>
                      ) : (
                        <Row label="region spans x ∈" value={`[${fmt(selected.xMinIn, 3)}, ${fmt(selected.xMaxIn, 3)}]`} mono />
                      )}
                      {!selected.natural && selected.runCount > 1 && (
                        <div style={styles.warning}>
                          The region is split into {selected.runCount} separate pieces at this height — the {method === "disk" ? "radii shown are the overall outer/inner extent" : "length shown is the combined total"}, but the volume below correctly accounts for all {selected.runCount} of them.
                        </div>
                      )}
                      {method === "disk" ? (
                        <>
                          <Row label="Outer radius R" value={fmt(selected.outerR, 4)} mono />
                          <Row label="Inner radius r" value={fmt(selected.innerR, 4)} mono />
                          <Row label={`Thickness Δ${selected.natural ? "x" : "y"}`} value={fmt(selected.sliceHi - selected.sliceLo, 4)} mono />
                          <Row label="Piece volume" value={`π(R² − r²)Δ${selected.natural ? "x" : "y"} = ${fmt(selected.volume, 5)}`} mono strong color={C.amber} />
                        </>
                      ) : (
                        <>
                          <Row label="Shell radius" value={fmt(selected.radius, 4)} mono />
                          <Row label="Shell length" value={fmt(selected.length, 4)} mono />
                          <Row label={`Wall thickness Δ${selected.natural ? "x" : "y"}`} value={fmt(selected.sliceHi - selected.sliceLo, 4)} mono />
                          <Row label="Piece volume" value={`2π·r·h·Δ${selected.natural ? "x" : "y"} = ${fmt(selected.volume, 5)}`} mono strong color={C.amber} />
                        </>
                      )}
                      <Row label="Share of this method's total" value={`${fmt((100 * selected.volume) / (activeModel.approxVolume || 1), 2)}%`} mono />
                    </>
                  ) : (
                    <div style={styles.hint}>Select a piece to see its dimensions and volume here.</div>
                  )}
                </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------------
   Small presentational helpers
   -------------------------------------------------------------------- */
function Section({ title, children }) {
  return (
    <div style={styles.section}>
      <div style={styles.sectionTitle}>{title}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>{children}</div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 5, flex: 1 }}>
      <div style={styles.fieldLabel}>{label}</div>
      {children}
    </div>
  );
}

function ToggleBtn({ active, onClick, children, small }) {
  return (
    <button
      onClick={onClick}
      style={{
        ...styles.toggleBtn,
        ...(active ? styles.toggleBtnActive : {}),
        ...(small ? { padding: "6px 10px", fontSize: 12 } : {}),
      }}
    >
      {children}
    </button>
  );
}

function Row({ label, value, mono, strong, color }) {
  return (
    <div style={styles.row}>
      <span style={styles.rowLabel}>{label}</span>
      <span
        style={{
          fontFamily: mono ? "'IBM Plex Mono', monospace" : "inherit",
          fontWeight: strong ? 600 : 500,
          color: color || C.text,
          fontSize: 13,
        }}
      >
        {value}
      </span>
    </div>
  );
}

function Legend({ method, showExact }) {
  return (
    <div style={styles.legend}>
      <LegendItem color={C.teal} label={method === "disk" ? "disk / washer pieces" : "shell pieces"} />
      <LegendItem color={C.amber} label="selected piece / axis" />
      {showExact && <LegendItem color={C.violet} label="exact solid" faint />}
    </div>
  );
}

function LegendItem({ color, label, faint }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, color: C.textMuted }}>
      <span style={{ width: 9, height: 9, borderRadius: 3, background: color, opacity: faint ? 0.4 : 0.95, display: "inline-block" }} />
      {label}
    </div>
  );
}

/* ----------------------------------------------------------------------
   Styles
   -------------------------------------------------------------------- */
const styles = {
  app: {
    fontFamily: "'Inter', -apple-system, 'Segoe UI', sans-serif",
    background: C.bg,
    color: C.text,
    minHeight: "100%",
    padding: "22px 22px 30px",
  },
  header: { marginBottom: 18 },
  headerTop: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" },
  guideLink: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 12,
    color: C.teal,
    textDecoration: "none",
    border: `1px solid ${C.border}`,
    borderRadius: 7,
    padding: "6px 12px",
    whiteSpace: "nowrap",
  },
  headerEyebrow: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 11,
    letterSpacing: "0.12em",
    color: C.teal,
    marginBottom: 6,
  },
  h1: {
    fontFamily: "'Space Grotesk', sans-serif",
    fontSize: 28,
    fontWeight: 700,
    margin: 0,
    letterSpacing: "-0.01em",
  },
  headerSub: { color: C.textMuted, fontSize: 14, marginTop: 6 },
  layout: {
    display: "grid",
    gridTemplateColumns: "300px 1fr",
    gap: 18,
    alignItems: "start",
  },
  controlCol: {
    display: "flex",
    flexDirection: "column",
    gap: 14,
    maxHeight: "calc(100vh - 160px)",
    overflowY: "auto",
    paddingRight: 4,
  },
  section: {
    background: C.panel,
    border: `1px solid ${C.border}`,
    borderRadius: 12,
    padding: 14,
  },
  sectionTitle: {
    fontFamily: "'Space Grotesk', sans-serif",
    fontSize: 13,
    fontWeight: 600,
    color: C.text,
    marginBottom: 10,
    textTransform: "uppercase",
    letterSpacing: "0.04em",
  },
  fieldLabel: { fontSize: 11.5, color: C.textMuted },
  input: {
    background: C.panel2,
    border: `1px solid ${C.border}`,
    borderRadius: 7,
    color: C.text,
    padding: "7px 9px",
    fontSize: 13,
    width: "100%",
    outline: "none",
  },
  presetRow: { display: "flex", flexWrap: "wrap", gap: 5, marginTop: 6 },
  presetBtn: {
    background: "transparent",
    border: `1px solid ${C.border}`,
    color: C.textMuted,
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 11,
    borderRadius: 6,
    padding: "3px 7px",
    cursor: "pointer",
  },
  hint: { fontSize: 11.5, color: C.textFaint, lineHeight: 1.4 },
  warning: {
    fontSize: 11.5,
    color: C.danger,
    background: "rgba(240,102,94,0.08)",
    border: `1px solid rgba(240,102,94,0.3)`,
    borderRadius: 7,
    padding: "6px 8px",
    lineHeight: 1.4,
  },
  matchGood: {
    fontSize: 11.5,
    color: C.good,
    background: "rgba(74,222,128,0.08)",
    border: `1px solid rgba(74,222,128,0.3)`,
    borderRadius: 7,
    padding: "6px 8px",
    lineHeight: 1.4,
  },
  toggleRow: { display: "flex", gap: 6 },
  toggleBtn: {
    flex: 1,
    background: C.panel2,
    border: `1px solid ${C.border}`,
    color: C.textMuted,
    borderRadius: 7,
    padding: "8px 8px",
    fontSize: 12.5,
    cursor: "pointer",
    fontFamily: "'Inter', sans-serif",
    lineHeight: 1.5,
  },
  toggleSubLabel: {
    fontSize: 10.5,
    fontWeight: 400,
    color: C.textFaint,
    fontFamily: "'IBM Plex Mono', monospace",
  },
  toggleBtnActive: {
    background: "rgba(47,217,195,0.12)",
    border: `1px solid ${C.teal}`,
    color: C.teal,
    fontWeight: 600,
  },
  methodBadge: {
    fontSize: 12.5,
    color: C.textMuted,
    background: C.panel2,
    border: `1px solid ${C.border}`,
    borderRadius: 7,
    padding: "7px 9px",
  },
  checkboxRow: { display: "flex", alignItems: "center", gap: 7, fontSize: 12.5, color: C.textMuted },
  smallBtn: {
    background: C.panel2,
    border: `1px solid ${C.border}`,
    color: C.text,
    borderRadius: 7,
    padding: "6px 10px",
    fontSize: 12,
    cursor: "pointer",
  },
  viewCol: { display: "flex", flexDirection: "column", gap: 14, minWidth: 0 },
  viewport: {
    position: "relative",
    height: 460,
    background: "radial-gradient(ellipse at 50% 30%, #131728 0%, #0a0d14 75%)",
    border: `1px solid ${C.border}`,
    borderRadius: 14,
    overflow: "hidden",
  },
  viewportCaption: {
    position: "absolute",
    left: 14,
    bottom: 12,
    fontSize: 11.5,
    color: C.textFaint,
    fontFamily: "'IBM Plex Mono', monospace",
    pointerEvents: "none",
  },
  legend: {
    position: "absolute",
    top: 12,
    right: 14,
    display: "flex",
    flexDirection: "column",
    gap: 5,
    background: "rgba(10,13,20,0.55)",
    border: `1px solid ${C.border}`,
    borderRadius: 9,
    padding: "8px 10px",
  },
  lowerGrid: {
    display: "grid",
    gridTemplateColumns: "1.05fr 0.95fr",
    gap: 14,
  },
  profileCard: {
    background: C.panel,
    border: `1px solid ${C.border}`,
    borderRadius: 12,
    padding: 14,
  },
  resultsCard: {
    background: C.panel,
    border: `1px solid ${C.border}`,
    borderRadius: 12,
    padding: 14,
    display: "flex",
    flexDirection: "column",
    gap: 3,
  },
  cardTitle: {
    fontFamily: "'Space Grotesk', sans-serif",
    fontSize: 13,
    fontWeight: 600,
    marginBottom: 8,
    textTransform: "uppercase",
    letterSpacing: "0.04em",
    color: C.textMuted,
  },
  cardCaption: { fontSize: 11, color: C.textFaint, marginTop: 8, lineHeight: 1.5 },
  formula: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 11.5,
    color: C.textMuted,
    background: C.panel2,
    border: `1px solid ${C.border}`,
    borderRadius: 8,
    padding: "8px 9px",
    marginBottom: 10,
    lineHeight: 1.5,
  },
  row: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "4px 0" },
  rowLabel: { fontSize: 12.5, color: C.textMuted },
  divider: { height: 1, background: C.border, margin: "10px 0" },
  errorOverlay: {
    position: "absolute",
    inset: 14,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    textAlign: "center",
    background: "rgba(10,13,20,0.9)",
    border: `1px solid rgba(240,102,94,0.3)`,
    borderRadius: 12,
    color: C.danger,
    fontSize: 14,
    padding: 24,
  },
};
