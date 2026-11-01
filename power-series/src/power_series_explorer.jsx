import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import katex from "katex";
import "katex/dist/katex.min.css";

/* ════════════════════════════════════════════════════════════════
   Pure helpers — no React, no state, no refs
   ════════════════════════════════════════════════════════════════ */

/* ── LaTeX rendering component ── */
function Tex({ children, display = false, style: sx }) {
  const html = useMemo(() => {
    try { return katex.renderToString(children || "", { throwOnError: false, displayMode: display }); }
    catch { return children || ""; }
  }, [children, display]);
  return <span style={sx} dangerouslySetInnerHTML={{ __html: html }} />;
}

/* ── math environment exposed to b(k) formulas ── */
const _fCache = [1];
const factorial = (n) => {
  if (n < 0) return Infinity;
  n = Math.round(n);
  if (_fCache[n] !== undefined) return _fCache[n];
  for (let i = _fCache.length; i <= n; i++) _fCache[i] = _fCache[i - 1] * i;
  return _fCache[n];
};
const C = (n, r) => factorial(n) / (factorial(r) * factorial(n - r));

const MATH_ENV = {
  factorial, C,
  abs: Math.abs, pow: Math.pow, sqrt: Math.sqrt,
  log: Math.log, sin: Math.sin, cos: Math.cos, sign: Math.sign,
  PI: Math.PI, E: Math.E,
};
const MATH_KEYS = Object.keys(MATH_ENV);
const MATH_VALS = Object.values(MATH_ENV);

/* ── cached coefficient evaluator ── */
let _cachedFormula = "";
let _cachedFn = null;

const evalCoeff = (formula, k) => {
  if (formula !== _cachedFormula) {
    _cachedFormula = formula;
    try { _cachedFn = new Function("k", ...MATH_KEYS, "return " + formula); }
    catch { _cachedFn = null; }
  }
  if (!_cachedFn) return NaN;
  try {
    const v = _cachedFn(k, ...MATH_VALS);
    return Number.isFinite(v) ? v : NaN;
  } catch { return NaN; }
};

/* ── single term: b(k) · (x−c)^(ak+l) ── */
const computeTerm = (formula, k, x, a, l, c) => {
  const bk = evalCoeff(formula, k);
  if (isNaN(bk)) return NaN;
  const exp = a * k + l;
  const term = bk * Math.pow(x - c, exp);
  return Number.isFinite(term) ? term : NaN;
};

/* ── formatting ── */
function fmtNum(v, digits = 2) {
  if (Math.abs(v) < 1e-12) return "0";
  if (Math.abs(v) >= 1e4 || (Math.abs(v) < 0.01 && Math.abs(v) > 0)) return v.toExponential(digits);
  return +v.toFixed(digits) + "";
}

function niceStep(range, targetPx) {
  const rough = range / (targetPx > 0 ? targetPx : 5);
  const mag = Math.pow(10, Math.floor(Math.log10(rough)));
  const norm = rough / mag;
  if (norm < 1.5) return mag;
  if (norm < 3.5) return 2 * mag;
  if (norm < 7.5) return 5 * mag;
  return 10 * mag;
}

/* ════════════════════════════════════════════════════════════════
   Canvas drawing helpers — pure functions taking ctx + geometry
   ════════════════════════════════════════════════════════════════ */

function drawGrid(ctx, W, H, xMn, xMx, yMn, yMx, x2p, y2p) {
  ctx.strokeStyle = "#1a2236";
  ctx.lineWidth = 0.5;
  const xStep = niceStep(xMx - xMn, W / 80);
  const yStep = niceStep(yMx - yMn, H / 60);
  for (let x = Math.ceil(xMn / xStep) * xStep; x <= xMx; x += xStep) {
    const px = x2p(x);
    ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, H); ctx.stroke();
  }
  for (let y = Math.ceil(yMn / yStep) * yStep; y <= yMx; y += yStep) {
    const py = y2p(y);
    ctx.beginPath(); ctx.moveTo(0, py); ctx.lineTo(W, py); ctx.stroke();
  }
  return { xStep, yStep };
}

function drawAxes(ctx, W, H, x2p, y2p) {
  ctx.strokeStyle = "#8899ab";
  ctx.lineWidth = 1.6;
  const ox = x2p(0), oy = y2p(0);
  if (ox >= 0 && ox <= W) { ctx.beginPath(); ctx.moveTo(ox, 0); ctx.lineTo(ox, H); ctx.stroke(); }
  if (oy >= 0 && oy <= H) { ctx.beginPath(); ctx.moveTo(0, oy); ctx.lineTo(W, oy); ctx.stroke(); }
  return { ox, oy };
}

function drawLabels(ctx, W, H, xMn, xMx, yMn, yMx, xStep, yStep, ox, oy, x2p, y2p) {
  ctx.fillStyle = "#a0b8d0";
  ctx.font = "12px 'Source Code Pro', Menlo, monospace";

  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  for (let x = Math.ceil(xMn / xStep) * xStep; x <= xMx; x += xStep) {
    if (Math.abs(x) < xStep * 0.01) continue;
    ctx.fillText(fmtNum(x), x2p(x), Math.min(Math.max(oy + 4, 2), H - 14));
  }

  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (let y = Math.ceil(yMn / yStep) * yStep; y <= yMx; y += yStep) {
    if (Math.abs(y) < yStep * 0.01) continue;
    ctx.fillText(fmtNum(y), Math.max(Math.min(ox - 6, W - 4), 36), y2p(y));
  }
}

function drawCurve(ctx, curveCache) {
  if (!curveCache || curveCache.length === 0) return;
  ctx.strokeStyle = "rgba(100,180,255,0.7)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  let started = false;
  for (const pt of curveCache) {
    if (pt === null) { started = false; continue; }
    if (!started) { ctx.moveTo(pt.px, pt.py); started = true; }
    else ctx.lineTo(pt.px, pt.py);
  }
  ctx.stroke();
}

function drawRedDots(ctx, W, H, pts, x2p, y2p) {
  ctx.shadowColor = "#ff4444";
  ctx.shadowBlur = 10;
  ctx.fillStyle = "#ff4444";
  for (const pt of pts) {
    const px = x2p(pt.x), py = y2p(pt.y);
    if (px < -10 || px > W + 10 || py < -10 || py > H + 10) continue;
    ctx.beginPath();
    ctx.arc(px, py, 4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.shadowBlur = 0;
}

function drawYellowDots(ctx, W, dots, x2p, y2p) {
  if (!dots || dots.length === 0) return;
  const isBatch = dots.length > 1;
  const radius = isBatch ? 4 : 6;
  ctx.shadowColor = "#ffd700";
  ctx.shadowBlur = isBatch ? 10 : 18;
  ctx.fillStyle = "#ffd700";
  for (const dot of dots) {
    const px = Math.max(-20, Math.min(W + 20, x2p(dot.x)));
    const py = Math.max(-20, Math.min(W + 20, y2p(dot.y)));
    ctx.beginPath();
    ctx.arc(px, py, radius, 0, Math.PI * 2);
    ctx.fill();
  }
  if (!isBatch && dots.length === 1) {
    ctx.shadowBlur = 0;
    ctx.strokeStyle = "rgba(255,215,0,0.4)";
    ctx.lineWidth = 2;
    const px = Math.max(-20, Math.min(W + 20, x2p(dots[0].x)));
    const py = Math.max(-20, Math.min(W + 20, y2p(dots[0].y)));
    ctx.beginPath();
    ctx.arc(px, py, 11, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.shadowBlur = 0;
}

/* ════════════════════════════════════════════════════════════════
   Presets
   ════════════════════════════════════════════════════════════════ */

const PRESETS = [
  { name: "eˣ", formula: "1/factorial(k)", a: 1, l: 0, xr: [-4, 4], yr: [-2, 20],
    desc: "Σ xᵏ/k!",
    tex: "e^x = \\sum_{k=0}^{\\infty} \\frac{x^k}{k!}" },
  { name: "1/(1−x)", formula: "1", a: 1, l: 0, xr: [-1.5, 1.5], yr: [-5, 5],
    desc: "Σ xᵏ, |x|<1",
    tex: "\\frac{1}{1-x} = \\sum_{k=0}^{\\infty} x^k, \\;|x|<1" },
  { name: "sin x", formula: "(-1)**k/factorial(2*k+1)", a: 2, l: 1, xr: [-8, 8], yr: [-2, 2],
    desc: "Σ (−1)ᵏx²ᵏ⁺¹/(2k+1)!",
    tex: "\\sin x = \\sum_{k=0}^{\\infty} \\frac{(-1)^k}{(2k+1)!}\\,x^{2k+1}" },
  { name: "cos x", formula: "(-1)**k/factorial(2*k)", a: 2, l: 0, xr: [-8, 8], yr: [-2, 2],
    desc: "Σ (−1)ᵏx²ᵏ/(2k)!",
    tex: "\\cos x = \\sum_{k=0}^{\\infty} \\frac{(-1)^k}{(2k)!}\\,x^{2k}" },
  { name: "ln(1+x)", formula: "(-1)**k/(k+1)", a: 1, l: 1, xr: [-1.5, 1.5], yr: [-3, 2],
    desc: "Σ (−1)ᵏxᵏ⁺¹/(k+1), |x|≤1",
    tex: "\\ln(1+x) = \\sum_{k=0}^{\\infty} \\frac{(-1)^k}{k+1}\\,x^{k+1}, \\;|x|\\le 1" },
  { name: "arctan x", formula: "(-1)**k/(2*k+1)", a: 2, l: 1, xr: [-2, 2], yr: [-2, 2],
    desc: "Σ (−1)ᵏx²ᵏ⁺¹/(2k+1), |x|≤1",
    tex: "\\arctan x = \\sum_{k=0}^{\\infty} \\frac{(-1)^k}{2k+1}\\,x^{2k+1}, \\;|x|\\le 1" },
];

/* ════════════════════════════════════════════════════════════════
   localStorage helpers
   ════════════════════════════════════════════════════════════════ */

const STORAGE_KEY = "powerSeriesExplorer_savedSeries";
const loadSaved = () => {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; }
  catch { return []; }
};
const persistSaved = (list) => {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(list)); } catch {}
};

/* ════════════════════════════════════════════════════════════════
   Shared style constants
   ════════════════════════════════════════════════════════════════ */

const inputStyle = {
  width: "100%", boxSizing: "border-box",
  background: "#111827", border: "1px solid #1e2d44", borderRadius: 6,
  color: "#d0daea", padding: "6px 8px", fontSize: 13,
  fontFamily: "'Source Code Pro', Menlo, monospace", outline: "none",
};
const selStyle = { ...inputStyle, marginBottom: 12, cursor: "pointer" };
const btnStyle = {
  flex: 1, padding: "7px 0", borderRadius: 6, border: "1px solid #1e2d44",
  background: "#111827", color: "#8ea8c8", cursor: "pointer", fontSize: 12,
  fontWeight: 600, letterSpacing: 0.3,
};
const dangerBtnStyle = { ...btnStyle, background: "#2a1a1a", borderColor: "#5a2020" };
const danceBtnStyle = {
  ...btnStyle, flex: "1 1 auto",
  background: "linear-gradient(135deg, #1a2a10, #1a3318)",
  borderColor: "#2d5a1e", color: "#8dcc6a", letterSpacing: 0.5,
};
const cursorStyle = {
  position: "absolute", pointerEvents: "none",
  background: "rgba(10,14,24,0.88)", border: "1px solid #2a3a54",
  borderRadius: 5, padding: "3px 7px",
  fontSize: 11, fontFamily: "'Source Code Pro', Menlo, monospace",
  color: "#a0b8d0", whiteSpace: "nowrap",
};
const badgeStyle = {
  position: "absolute", top: 10, right: 14, background: "rgba(255,68,68,0.15)",
  border: "1px solid rgba(255,68,68,0.3)", borderRadius: 8, padding: "4px 10px",
  fontSize: 12, fontFamily: "monospace", color: "#ff8888",
};
const statusBarStyle = {
  padding: "10px 16px", background: "#0a0e18", borderTop: "1px solid #1c2640",
  fontSize: 12, fontFamily: "monospace", color: "#88a0be", minHeight: 38, lineHeight: 1.5,
};

/* ════════════════════════════════════════════════════════════════
   Small UI components
   ════════════════════════════════════════════════════════════════ */

function Label({ children }) {
  return <div style={{ fontSize: 11, fontWeight: 600, color: "#7b8faa", marginBottom: 3, letterSpacing: 0.3, textTransform: "uppercase" }}>{children}</div>;
}

function NumInput({ value, onChange, style: sx, step, ...rest }) {
  const [text, setText] = useState(String(value));
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current !== document.activeElement) setText(String(value));
  }, [value]);
  const handle = (e) => {
    const raw = e.target.value;
    setText(raw);
    const n = Number(raw);
    if (raw !== "" && raw !== "-" && raw !== "." && raw !== "-." && Number.isFinite(n)) onChange(n);
  };
  const onBlur = () => {
    const n = Number(text);
    if (!Number.isFinite(n)) { setText(String(value)); return; }
    onChange(n);
    setText(String(n));
  };
  return <input ref={ref} value={text} onChange={handle} onBlur={onBlur} style={sx} inputMode="decimal" {...rest} />;
}

/* ════════════════════════════════════════════════════════════════
   Main component
   ════════════════════════════════════════════════════════════════ */

export default function PowerSeriesExplorer() {
  /* ── series parameters ── */
  const [formula, setFormula] = useState("1/factorial(k)");
  const [a, setA] = useState(1);
  const [l, setL] = useState(0);
  const [c, setC] = useState(0);
  const [k0, setK0] = useState(0);

  /* ── view parameters ── */
  const [xMin, setXMin] = useState(-4);
  const [xMax, setXMax] = useState(4);
  const [yMin, setYMin] = useState(-2);
  const [yMax, setYMax] = useState(20);

  /* ── animation / UI state ── */
  const [speed, setSpeed] = useState(150);
  const [showGraph, setShowGraph] = useState(false);
  const [maxTerms, setMaxTerms] = useState(500);
  const [redPoints, setRedPoints] = useState([]);
  const [statusText, setStatusText] = useState("Click on the plot to begin.");
  const [presetIdx, setPresetIdx] = useState(0);
  const [sideOpen, setSideOpen] = useState(true);
  const [batchCount, setBatchCount] = useState(30);
  const [cursor, setCursor] = useState(null);
  const [canvasSize, setCanvasSize] = useState({ w: 800, h: 600 });

  /* ── saved series ── */
  const [savedSeries, setSavedSeries] = useState(loadSaved);
  const [saveName, setSaveName] = useState("");
  const [selectedSaved, setSelectedSaved] = useState(-1);

  /* ── refs ── */
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const animRef = useRef({ active: false, timer: null });
  const batchRef = useRef({ active: false, timer: null });
  const paramsRef = useRef({ formula, a, l, c, k0, xMin, xMax, yMin, yMax, speed, maxTerms });
  const redPointsRef = useRef(redPoints);
  const showGraphRef = useRef(showGraph);
  const curveCacheRef = useRef(null);

  /* ── keep refs in sync ── */
  useEffect(() => {
    paramsRef.current = { formula, a, l, c, k0, xMin, xMax, yMin, yMax, speed, maxTerms };
    curveCacheRef.current = null; /* invalidate curve cache when params change */
  }, [formula, a, l, c, k0, xMin, xMax, yMin, yMax, speed, maxTerms]);

  useEffect(() => { redPointsRef.current = redPoints; }, [redPoints]);
  useEffect(() => { showGraphRef.current = showGraph; }, [showGraph]);

  /* ════════════════════════════════════════════════════════════
     Shared helpers
     ════════════════════════════════════════════════════════════ */

  const cancelAnimations = useCallback(() => {
    if (animRef.current.timer) clearTimeout(animRef.current.timer);
    if (batchRef.current.timer) clearTimeout(batchRef.current.timer);
    animRef.current.active = false;
    batchRef.current.active = false;
  }, []);

  const addRedPoints = useCallback((newPts) => {
    const arr = Array.isArray(newPts) ? newPts : [newPts];
    setRedPoints((prev) => [...prev, ...arr]);
    redPointsRef.current = [...redPointsRef.current, ...arr];
  }, []);

  const applySeriesParams = useCallback((obj) => {
    setFormula(obj.formula);
    setA(obj.a);
    setL(obj.l);
    setC(obj.c || 0);
    setK0(obj.k0 || 0);
    setXMin(obj.xr[0]); setXMax(obj.xr[1]);
    setYMin(obj.yr[0]); setYMax(obj.yr[1]);
  }, []);

  /* ════════════════════════════════════════════════════════════
     Series computation
     ════════════════════════════════════════════════════════════ */

  const computeSum = useCallback((x, maxN = 500, requireConvergence = false) => {
    const { formula, a, l, c, k0 } = paramsRef.current;
    let s = 0, prevS = 0, converged = false;
    for (let k = k0; k <= maxN + k0; k++) {
      const term = computeTerm(formula, k, x, a, l, c);
      if (isNaN(term)) break;
      prevS = s;
      s += term;
      if (!Number.isFinite(s)) return NaN;
      if (k - k0 >= 2 && Math.abs(s - prevS) < 1e-12 * (Math.abs(s) + 1e-15)) {
        converged = true;
        break;
      }
    }
    if (requireConvergence && !converged) return NaN;
    return Number.isFinite(s) ? s : NaN;
  }, []);

  const findConvergenceInterval = useCallback(() => {
    const { xMin: xMn, xMax: xMx } = paramsRef.current;
    const samples = 200;
    let lo = null, hi = null;
    for (let i = 0; i <= samples; i++) {
      const x = xMn + (i / samples) * (xMx - xMn);
      const y = computeSum(x, 300, true);
      if (!isNaN(y) && Number.isFinite(y)) {
        if (lo === null) lo = x;
        hi = x;
      }
    }
    if (lo === null) return null;
    const margin = (hi - lo) * 0.02;
    return [lo + margin, hi - margin];
  }, [computeSum]);

  /* ── build / retrieve cached curve for full graph ── */
  const getCurveCache = useCallback((W, H) => {
    if (curveCacheRef.current) return curveCacheRef.current;
    const { xMin: xMn, xMax: xMx, yMin: yMn, yMax: yMx } = paramsRef.current;
    const x2p = (x) => ((x - xMn) / (xMx - xMn)) * W;
    const y2p = (y) => H - ((y - yMn) / (yMx - yMn)) * H;
    const samples = Math.max(W * 2, 600);
    const pts = [];
    for (let i = 0; i <= samples; i++) {
      const x = xMn + (i / samples) * (xMx - xMn);
      const y = computeSum(x, 500, true);
      if (isNaN(y) || !Number.isFinite(y) || y < yMn - (yMx - yMn) * 2 || y > yMx + (yMx - yMn) * 2) {
        pts.push(null);
      } else {
        pts.push({ px: x2p(x), py: y2p(y) });
      }
    }
    curveCacheRef.current = pts;
    return pts;
  }, [computeSum]);

  /* ════════════════════════════════════════════════════════════
     Drawing
     ════════════════════════════════════════════════════════════ */

  const draw = useCallback((yellowDots = null) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const W = canvasSize.w, H = canvasSize.h;
    const { xMin: xMn, xMax: xMx, yMin: yMn, yMax: yMx } = paramsRef.current;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    /* background */
    ctx.fillStyle = "#0b0f1a";
    ctx.fillRect(0, 0, W, H);

    /* coordinate transforms */
    const x2p = (x) => ((x - xMn) / (xMx - xMn)) * W;
    const y2p = (y) => H - ((y - yMn) / (yMx - yMn)) * H;

    /* grid, axes, labels */
    const { xStep, yStep } = drawGrid(ctx, W, H, xMn, xMx, yMn, yMx, x2p, y2p);
    const { ox, oy } = drawAxes(ctx, W, H, x2p, y2p);
    drawLabels(ctx, W, H, xMn, xMx, yMn, yMx, xStep, yStep, ox, oy, x2p, y2p);

    /* full graph (cached) */
    if (showGraphRef.current) {
      drawCurve(ctx, getCurveCache(W, H));
    }

    /* dots */
    ctx.save();
    drawRedDots(ctx, W, H, redPointsRef.current, x2p, y2p);
    ctx.restore();

    ctx.save();
    drawYellowDots(ctx, W, yellowDots, x2p, y2p);
    ctx.restore();
  }, [canvasSize, getCurveCache]);

  /* ════════════════════════════════════════════════════════════
     Single-point animation (click)
     ════════════════════════════════════════════════════════════ */

  const startAnimation = useCallback((xClick) => {
    cancelAnimations();
    animRef.current.active = true;

    let sum = 0, k = paramsRef.current.k0, prevSum = null;
    const { yMin: yMn, yMax: yMx } = paramsRef.current;
    const pixelSize = (yMx - yMn) / canvasSize.h;

    const step = () => {
      if (!animRef.current.active) return;
      const p = paramsRef.current;

      const term = computeTerm(p.formula, k, xClick, p.a, p.l, p.c);
      if (isNaN(term)) {
        animRef.current.active = false;
        setStatusText(`b(${k}) is undefined. Stopped.`);
        draw();
        return;
      }

      prevSum = sum;
      sum += term;

      if (!Number.isFinite(sum)) {
        animRef.current.active = false;
        setStatusText(`Series diverges at x = ${fmtNum(xClick)} (overflow at k=${k}).`);
        draw();
        return;
      }

      setStatusText(`x = ${fmtNum(xClick, 4)}  |  k = ${k}  |  Sₖ = ${fmtNum(sum, 6)}`);
      draw([{ x: xClick, y: sum }]);

      const nTerms = k - p.k0 + 1;
      const converged = nTerms >= 3 && Math.abs(sum - prevSum) < pixelSize;
      if (converged || nTerms >= p.maxTerms) {
        animRef.current.active = false;
        addRedPoints({ x: xClick, y: sum, terms: nTerms });
        setStatusText(converged
          ? `Converged at x = ${fmtNum(xClick, 4)}  →  f(x) ≈ ${fmtNum(sum, 6)}  (${nTerms} terms)`
          : `Max terms (${p.maxTerms}) reached at x = ${fmtNum(xClick, 4)}  →  Sₖ ≈ ${fmtNum(sum, 6)}`);
        setTimeout(() => draw(), 20);
        return;
      }
      k++;
      animRef.current.timer = setTimeout(step, p.speed);
    };
    step();
  }, [canvasSize, draw, cancelAnimations, addRedPoints]);

  /* ════════════════════════════════════════════════════════════
     Batch animation (dance)
     ════════════════════════════════════════════════════════════ */

  const startBatchAnimation = useCallback(() => {
    cancelAnimations();
    batchRef.current.active = true;

    const interval = findConvergenceInterval();
    if (!interval) {
      setStatusText("Could not detect an interval of convergence in the visible x range.");
      return;
    }

    const [lo, hi] = interval;
    const n = Math.max(1, Math.min(200, batchCount));
    const { yMin: yMn, yMax: yMx, k0: startK } = paramsRef.current;
    const pixelSize = (yMx - yMn) / canvasSize.h;

    const dots = [];
    for (let i = 0; i < n; i++) {
      dots.push({ x: lo + Math.random() * (hi - lo), sum: 0, k: startK, prevSum: 0, done: false });
    }
    let stepCount = 0;

    setStatusText(`Dancing ${n} points in [${fmtNum(lo, 3)}, ${fmtNum(hi, 3)}] …`);

    const step = () => {
      if (!batchRef.current.active) return;
      const p = paramsRef.current;
      const justFinished = [];
      const yellowDots = [];
      let activeCount = 0;

      for (const dot of dots) {
        if (dot.done) continue;

        const term = computeTerm(p.formula, dot.k, dot.x, p.a, p.l, p.c);
        if (isNaN(term)) { dot.done = true; continue; }

        dot.prevSum = dot.sum;
        dot.sum += term;
        if (!Number.isFinite(dot.sum)) { dot.done = true; continue; }

        const nTerms = dot.k - p.k0 + 1;
        const converged = nTerms >= 3 && Math.abs(dot.sum - dot.prevSum) < pixelSize;
        if (converged || nTerms >= p.maxTerms) {
          dot.done = true;
          justFinished.push({ x: dot.x, y: dot.sum, terms: nTerms });
        } else {
          yellowDots.push({ x: dot.x, y: dot.sum });
          activeCount++;
        }
        dot.k++;
      }

      if (justFinished.length > 0) addRedPoints(justFinished);

      stepCount++;
      const doneCount = n - activeCount;
      setStatusText(`Dancing ${n} points  |  step ${stepCount}  |  ${doneCount}/${n} converged`);
      draw(yellowDots);

      if (activeCount === 0) {
        batchRef.current.active = false;
        setStatusText(`All ${n} points converged in [${fmtNum(lo, 3)}, ${fmtNum(hi, 3)}].`);
        setTimeout(() => draw(), 20);
        return;
      }
      batchRef.current.timer = setTimeout(step, p.speed);
    };
    step();
  }, [canvasSize, draw, batchCount, findConvergenceInterval, cancelAnimations, addRedPoints]);

  /* ════════════════════════════════════════════════════════════
     Event handlers
     ════════════════════════════════════════════════════════════ */

  const handleCanvasClick = useCallback((e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const { xMin, xMax } = paramsRef.current;
    startAnimation(xMin + (px / canvasSize.w) * (xMax - xMin));
  }, [canvasSize, startAnimation]);

  const handleMouseMove = useCallback((e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const { xMin, xMax, yMin, yMax } = paramsRef.current;
    setCursor({
      px, py,
      x: xMin + (px / canvasSize.w) * (xMax - xMin),
      y: yMax - (py / canvasSize.h) * (yMax - yMin),
    });
  }, [canvasSize]);

  const handleMouseLeave = useCallback(() => setCursor(null), []);

  /* ════════════════════════════════════════════════════════════
     Save / load / delete custom series
     ════════════════════════════════════════════════════════════ */

  const saveCurrent = () => {
    const name = saveName.trim();
    if (!name) { setStatusText("Enter a name to save the series."); return; }
    const entry = { name, formula, a, l, c, k0, xr: [xMin, xMax], yr: [yMin, yMax] };
    const updated = savedSeries.filter(s => s.name !== name).concat(entry);
    updated.sort((a, b) => a.name.localeCompare(b.name));
    setSavedSeries(updated);
    persistSaved(updated);
    setSaveName("");
    setStatusText(`Saved "${name}".`);
  };

  const loadSavedSeries = (idx) => {
    const s = savedSeries[idx];
    if (!s) return;
    setSelectedSaved(idx);
    applySeriesParams(s);
    setStatusText(`Loaded "${s.name}".`);
  };

  const deleteSaved = () => {
    if (selectedSaved < 0 || selectedSaved >= savedSeries.length) return;
    const name = savedSeries[selectedSaved].name;
    const updated = savedSeries.filter((_, i) => i !== selectedSaved);
    setSavedSeries(updated);
    persistSaved(updated);
    setSelectedSaved(-1);
    setStatusText(`Deleted "${name}".`);
  };

  const loadPreset = (idx) => {
    const p = PRESETS[idx];
    if (!p) return;
    setPresetIdx(idx);
    applySeriesParams(p);
  };

  /* ════════════════════════════════════════════════════════════
     Effects
     ════════════════════════════════════════════════════════════ */

  /* resize observer */
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) setCanvasSize({ w: Math.round(width), h: Math.round(height) });
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /* redraw on view changes */
  useEffect(() => { draw(); }, [canvasSize, redPoints, showGraph, xMin, xMax, yMin, yMax, draw]);

  /* clear on series param change */
  useEffect(() => {
    cancelAnimations();
    setRedPoints([]);
    redPointsRef.current = [];
    setStatusText("Click on the plot to begin.");
  }, [formula, a, l, c, k0, cancelAnimations]);

  /* invalidate curve cache on canvas resize */
  useEffect(() => { curveCacheRef.current = null; }, [canvasSize]);

  /* ════════════════════════════════════════════════════════════
     Derived values
     ════════════════════════════════════════════════════════════ */

  const displayFormulaTex = useMemo(() => {
    let exp = "";
    if (a === 1 && l === 0) exp = "k";
    else if (a === 1 && l !== 0) exp = `k+${l}`;
    else if (a !== 1 && l === 0) exp = `${a}k`;
    else exp = `${a}k+${l}`;
    const xPart = c === 0 ? "x" : c > 0 ? `(x-${c})` : `(x+${-c})`;
    return `\\sum_{k=${k0}}^{\\infty} b(k)\\,${xPart}^{${exp}}`;
  }, [a, l, c, k0]);

  const stopAll = useCallback(() => {
    cancelAnimations();
    setStatusText("Animation stopped.");
    draw();
  }, [cancelAnimations, draw]);

  const clearAll = useCallback(() => {
    setRedPoints([]);
    redPointsRef.current = [];
    stopAll();
    setStatusText("Cleared.");
    setTimeout(() => draw(), 20);
  }, [stopAll, draw]);

  /* ════════════════════════════════════════════════════════════
     Render
     ════════════════════════════════════════════════════════════ */

  return (
    <div style={{ display: "flex", height: "100vh", width: "100vw", fontFamily: "'Nunito', 'Segoe UI', sans-serif", background: "#080c14", color: "#c9d4e2", overflow: "hidden" }}>

      {/* ── sidebar ── */}
      <div style={{
        width: sideOpen ? 290 : 0, minWidth: sideOpen ? 290 : 0,
        transition: "width 0.25s, min-width 0.25s",
        background: "#0d1220", borderRight: "1px solid #1c2640",
        overflow: "hidden", display: "flex", flexDirection: "column",
      }}>
        <div style={{ padding: "14px 16px", overflowY: "auto", flex: 1 }}>
          <div style={{ fontSize: 15, fontWeight: 700, letterSpacing: 0.5, marginBottom: 6, color: "#e8edf5" }}>Power Series Explorer</div>
          <div style={{ marginBottom: 12, padding: "6px 0", borderBottom: "1px solid #1c2640" }}>
            <Tex style={{ color: "#a0b8d0", fontSize: 14 }}>{displayFormulaTex}</Tex>
          </div>

          <Label>Preset</Label>
          <select value={presetIdx} onChange={(e) => loadPreset(+e.target.value)} style={selStyle}>
            {PRESETS.map((p, i) => <option key={i} value={i}>{p.name} — {p.desc}</option>)}
          </select>
          {PRESETS[presetIdx]?.tex && (
            <div style={{ marginTop: -6, marginBottom: 10, padding: "5px 8px", background: "#0a0e18", borderRadius: 6, border: "1px solid #1c2640" }}>
              <Tex style={{ color: "#c9d4e2", fontSize: 13 }}>{PRESETS[presetIdx].tex}</Tex>
            </div>
          )}

          {/* saved series */}
          <div style={{ borderTop: "1px solid #1c2640", paddingTop: 10, marginBottom: 10 }}>
            <Label>My saved series</Label>
            {savedSeries.length > 0 ? (
              <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
                <select value={selectedSaved} onChange={(e) => loadSavedSeries(+e.target.value)}
                  style={{ ...selStyle, marginBottom: 0, flex: 1 }}>
                  <option value={-1}>— select —</option>
                  {savedSeries.map((s, i) => <option key={i} value={i}>{s.name}</option>)}
                </select>
                <button onClick={deleteSaved} disabled={selectedSaved < 0}
                  style={{ ...btnStyle, flex: "0 0 auto", padding: "5px 8px", fontSize: 11, opacity: selectedSaved < 0 ? 0.3 : 1, background: "#2a1a1a", borderColor: "#5a2020", color: "#cc7777" }}>
                  Del
                </button>
              </div>
            ) : (
              <div style={{ fontSize: 11, color: "#4e6280", marginBottom: 6 }}>No saved series yet.</div>
            )}
            <div style={{ display: "flex", gap: 6 }}>
              <input value={saveName} onChange={(e) => setSaveName(e.target.value)} placeholder="Name…"
                onKeyDown={(e) => { if (e.key === "Enter") saveCurrent(); }}
                style={{ ...inputStyle, flex: 1, fontSize: 12 }} />
              <button onClick={saveCurrent} style={{ ...btnStyle, flex: "0 0 auto", padding: "5px 10px", fontSize: 11, background: "#0f1f2e", borderColor: "#1e3a5a", color: "#6baadd" }}>
                Save
              </button>
            </div>
          </div>

          <Label>b(k) — coefficient formula in terms of k</Label>
          <input value={formula} onChange={(e) => setFormula(e.target.value)} style={inputStyle} spellCheck={false} />
          <div style={{ fontSize: 10, color: "#4e6280", marginTop: 2, marginBottom: 8 }}>
            Available: factorial(n), C(n,r), pow, sqrt, abs, log, sin, cos, PI, E
          </div>

          <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
            <div style={{ flex: "1 1 45%" }}>
              <Label>a (exponent multiplier)</Label>
              <NumInput value={a} onChange={setA} style={inputStyle} />
            </div>
            <div style={{ flex: "1 1 45%" }}>
              <Label>l (exponent shift)</Label>
              <NumInput value={l} onChange={setL} style={inputStyle} />
            </div>
            <div style={{ flex: "1 1 45%" }}>
              <Label>c (center)</Label>
              <NumInput value={c} onChange={setC} style={inputStyle} />
            </div>
            <div style={{ flex: "1 1 45%" }}>
              <Label>k₀ (start index)</Label>
              <NumInput value={k0} onChange={(v) => setK0(Math.round(v))} style={inputStyle} />
            </div>
          </div>

          <Label>x range</Label>
          <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
            <NumInput value={xMin} onChange={setXMin} style={{ ...inputStyle, flex: 1 }} />
            <span style={{ color: "#4e6280", alignSelf: "center" }}>to</span>
            <NumInput value={xMax} onChange={setXMax} style={{ ...inputStyle, flex: 1 }} />
          </div>
          <Label>y range</Label>
          <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
            <NumInput value={yMin} onChange={setYMin} style={{ ...inputStyle, flex: 1 }} />
            <span style={{ color: "#4e6280", alignSelf: "center" }}>to</span>
            <NumInput value={yMax} onChange={setYMax} style={{ ...inputStyle, flex: 1 }} />
          </div>

          <Label>Animation delay: {speed} ms</Label>
          <input type="range" min={20} max={800} value={speed} onChange={(e) => setSpeed(+e.target.value)}
            style={{ width: "100%", accentColor: "#5b8dd9", marginBottom: 12 }} />

          <Label>Max terms</Label>
          <NumInput value={maxTerms} onChange={(v) => setMaxTerms(Math.max(10, Math.round(v)))} style={{ ...inputStyle, marginBottom: 12 }} />

          <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", marginBottom: 14, fontSize: 13 }}>
            <input type="checkbox" checked={showGraph} onChange={(e) => setShowGraph(e.target.checked)} style={{ accentColor: "#5b8dd9" }} />
            Reveal full graph
          </label>

          {/* batch dance */}
          <div style={{ borderTop: "1px solid #1c2640", paddingTop: 12, marginTop: 4, marginBottom: 12 }}>
            <Label>Batch animate (dance)</Label>
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 4 }}>
              <NumInput value={batchCount} onChange={(v) => setBatchCount(Math.max(1, Math.min(200, Math.round(v))))}
                style={{ ...inputStyle, flex: "0 0 60px", textAlign: "center" }} />
              <span style={{ fontSize: 12, color: "#6b8ab0", whiteSpace: "nowrap" }}>points</span>
              <button onClick={startBatchAnimation} style={danceBtnStyle}>Dance!</button>
            </div>
            <div style={{ fontSize: 10, color: "#4e6280", marginTop: 4 }}>
              Picks random x values in the interval of convergence and animates all partial sums simultaneously.
            </div>
          </div>

          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={clearAll} style={btnStyle}>Clear Points</button>
            <button onClick={stopAll} style={dangerBtnStyle}>Stop</button>
          </div>
        </div>

        <div style={statusBarStyle}>{statusText}</div>
      </div>

      {/* ── toggle sidebar ── */}
      <button onClick={() => setSideOpen(!sideOpen)} style={{
        position: "absolute", top: 8, left: sideOpen ? 296 : 6, zIndex: 10,
        background: "#151d2e", border: "1px solid #1c2640", color: "#6b8ab0",
        width: 28, height: 28, borderRadius: 6, cursor: "pointer", fontSize: 14,
        display: "flex", alignItems: "center", justifyContent: "center",
        transition: "left 0.25s",
      }}>{sideOpen ? "◂" : "▸"}</button>

      {/* ── canvas area ── */}
      <div ref={containerRef} style={{ flex: 1, position: "relative", cursor: "crosshair" }}>
        <canvas ref={canvasRef} onClick={handleCanvasClick}
          onMouseMove={handleMouseMove} onMouseLeave={handleMouseLeave}
          style={{ width: canvasSize.w, height: canvasSize.h, display: "block" }} />
        {cursor && (
          <div style={{ ...cursorStyle, left: cursor.px + 14, top: cursor.py - 28 }}>
            {fmtNum(cursor.x, 3)}, {fmtNum(cursor.y, 3)}
          </div>
        )}
        {redPoints.length > 0 && (
          <div style={badgeStyle}>
            {redPoints.length} point{redPoints.length !== 1 ? "s" : ""} plotted
          </div>
        )}
      </div>
    </div>
  );
}
