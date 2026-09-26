import { useState, useRef, useEffect, useCallback } from "react";

/* ── math helpers exposed to the b(k) formula ── */
const _fCache = [1];
const factorial = (n) => {
  if (n < 0) return Infinity;
  n = Math.round(n);
  if (_fCache[n] !== undefined) return _fCache[n];
  for (let i = _fCache.length; i <= n; i++) _fCache[i] = _fCache[i - 1] * i;
  return _fCache[n];
};
const C = (n, r) => factorial(n) / (factorial(r) * factorial(n - r));

const MATH_ENV = { factorial, C, abs: Math.abs, pow: Math.pow, sqrt: Math.sqrt, PI: Math.PI, E: Math.E, log: Math.log, sin: Math.sin, cos: Math.cos, sign: Math.sign };
const MATH_KEYS = Object.keys(MATH_ENV);
const MATH_VALS = Object.values(MATH_ENV);

const evalCoeff = (formula, k) => {
  try {
    const fn = new Function("k", ...MATH_KEYS, "return " + formula);
    const v = fn(k, ...MATH_VALS);
    return Number.isFinite(v) ? v : NaN;
  } catch { return NaN; }
};

/* ── presets ── */
const PRESETS = [
  { name: "eˣ", formula: "1/factorial(k)", a: 1, l: 0, xr: [-4, 4], yr: [-2, 20], desc: "Σ xᵏ/k!" },
  { name: "1/(1−x)", formula: "1", a: 1, l: 0, xr: [-1.5, 1.5], yr: [-5, 5], desc: "Σ xᵏ, |x|<1" },
  { name: "sin x", formula: "(-1)**k/factorial(2*k+1)", a: 2, l: 1, xr: [-8, 8], yr: [-2, 2], desc: "Σ (−1)ᵏx²ᵏ⁺¹/(2k+1)!" },
  { name: "cos x", formula: "(-1)**k/factorial(2*k)", a: 2, l: 0, xr: [-8, 8], yr: [-2, 2], desc: "Σ (−1)ᵏx²ᵏ/(2k)!" },
  { name: "ln(1+x)", formula: "(-1)**k/(k+1)", a: 1, l: 1, xr: [-1.5, 1.5], yr: [-3, 2], desc: "Σ (−1)ᵏxᵏ⁺¹/(k+1), |x|≤1" },
  { name: "arctan x", formula: "(-1)**k/(2*k+1)", a: 2, l: 1, xr: [-2, 2], yr: [-2, 2], desc: "Σ (−1)ᵏx²ᵏ⁺¹/(2k+1), |x|≤1" },
];

/* ── main component ── */
export default function PowerSeriesExplorer() {
  const [formula, setFormula] = useState("1/factorial(k)");
  const [a, setA] = useState(1);
  const [l, setL] = useState(0);
  const [xMin, setXMin] = useState(-4);
  const [xMax, setXMax] = useState(4);
  const [yMin, setYMin] = useState(-2);
  const [yMax, setYMax] = useState(20);
  const [speed, setSpeed] = useState(150);
  const [showGraph, setShowGraph] = useState(false);
  const [maxTerms, setMaxTerms] = useState(500);
  const [redPoints, setRedPoints] = useState([]);
  const [statusText, setStatusText] = useState("Click on the plot to begin.");
  const [presetIdx, setPresetIdx] = useState(0);
  const [sideOpen, setSideOpen] = useState(true);
  const [batchCount, setBatchCount] = useState(30);

  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const animRef = useRef({ active: false, timer: null });
  const batchRef = useRef({ active: false, timer: null, dots: [] });
  const paramsRef = useRef({ formula, a, l, xMin, xMax, yMin, yMax, speed, maxTerms });
  const redPointsRef = useRef(redPoints);
  const showGraphRef = useRef(showGraph);
  const [canvasSize, setCanvasSize] = useState({ w: 800, h: 600 });

  useEffect(() => { paramsRef.current = { formula, a, l, xMin, xMax, yMin, yMax, speed, maxTerms }; }, [formula, a, l, xMin, xMax, yMin, yMax, speed, maxTerms]);
  useEffect(() => { redPointsRef.current = redPoints; }, [redPoints]);
  useEffect(() => { showGraphRef.current = showGraph; }, [showGraph]);

  /* ── coordinate transforms ── */
  const pToX = useCallback((px) => {
    const { xMin, xMax } = paramsRef.current;
    return xMin + (px / canvasSize.w) * (xMax - xMin);
  }, [canvasSize.w]);

  /* ── compute sum for a given x ── */
  const computeSum = useCallback((x, maxN = 500, requireConvergence = false) => {
    const { formula, a, l } = paramsRef.current;
    let s = 0, prevS = 0, converged = false;
    for (let k = 0; k <= maxN; k++) {
      const bk = evalCoeff(formula, k);
      if (isNaN(bk)) break;
      const exp = a * k + l;
      let term = bk * Math.pow(x, exp);
      if (!Number.isFinite(term)) break;
      prevS = s;
      s += term;
      if (!Number.isFinite(s)) return NaN;
      if (k >= 2 && Math.abs(s - prevS) < 1e-12 * (Math.abs(s) + 1e-15)) { converged = true; break; }
    }
    if (requireConvergence && !converged) return NaN;
    return Number.isFinite(s) ? s : NaN;
  }, []);

  /* ── find interval of convergence by sampling ── */
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
    /* shrink slightly inward to avoid boundary issues */
    const margin = (hi - lo) * 0.02;
    return [lo + margin, hi - margin];
  }, [computeSum]);

  /* ── drawing ── */
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

    const x2p = (x) => ((x - xMn) / (xMx - xMn)) * W;
    const y2p = (y) => H - ((y - yMn) / (yMx - yMn)) * H;

    /* grid */
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

    /* axes */
    ctx.strokeStyle = "#8899ab";
    ctx.lineWidth = 1.6;
    const ox = x2p(0), oy = y2p(0);
    if (ox >= 0 && ox <= W) { ctx.beginPath(); ctx.moveTo(ox, 0); ctx.lineTo(ox, H); ctx.stroke(); }
    if (oy >= 0 && oy <= H) { ctx.beginPath(); ctx.moveTo(0, oy); ctx.lineTo(W, oy); ctx.stroke(); }

    /* axis labels */
    ctx.fillStyle = "#a0b8d0";
    ctx.font = "12px 'Source Code Pro', Menlo, monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    for (let x = Math.ceil(xMn / xStep) * xStep; x <= xMx; x += xStep) {
      if (Math.abs(x) < xStep * 0.01) continue;
      const px = x2p(x);
      const labelY = Math.min(Math.max(oy + 4, 2), H - 14);
      ctx.fillText(fmtNum(x), px, labelY);
    }
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (let y = Math.ceil(yMn / yStep) * yStep; y <= yMx; y += yStep) {
      if (Math.abs(y) < yStep * 0.01) continue;
      const py = y2p(y);
      const labelX = Math.max(Math.min(ox - 6, W - 4), 36);
      ctx.fillText(fmtNum(y), labelX, py);
    }

    /* full graph */
    if (showGraphRef.current) {
      ctx.strokeStyle = "rgba(100,180,255,0.7)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      let started = false;
      const samples = Math.max(W * 2, 600);
      for (let i = 0; i <= samples; i++) {
        const x = xMn + (i / samples) * (xMx - xMn);
        const y = computeSum(x, 500, true);
        if (isNaN(y) || !Number.isFinite(y) || y < yMn - (yMx - yMn) * 2 || y > yMx + (yMx - yMn) * 2) {
          started = false; continue;
        }
        const px = x2p(x), py = y2p(y);
        if (!started) { ctx.moveTo(px, py); started = true; }
        else ctx.lineTo(px, py);
      }
      ctx.stroke();
    }

    /* red dots (converged points) */
    const pts = redPointsRef.current;
    for (const pt of pts) {
      const px = x2p(pt.x), py = y2p(pt.y);
      if (px < -10 || px > W + 10 || py < -10 || py > H + 10) continue;
      ctx.save();
      ctx.shadowColor = "#ff4444";
      ctx.shadowBlur = 10;
      ctx.fillStyle = "#ff4444";
      ctx.beginPath();
      ctx.arc(px, py, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    /* yellow animated dots — single or batch */
    if (yellowDots && yellowDots.length > 0) {
      const isBatch = yellowDots.length > 1;
      for (const dot of yellowDots) {
        const px = Math.max(-20, Math.min(W + 20, x2p(dot.x)));
        const py = Math.max(-20, Math.min(H + 20, y2p(dot.y)));
        ctx.save();
        ctx.shadowColor = "#ffd700";
        ctx.shadowBlur = isBatch ? 10 : 18;
        ctx.fillStyle = "#ffd700";
        ctx.beginPath();
        ctx.arc(px, py, isBatch ? 4 : 6, 0, Math.PI * 2);
        ctx.fill();
        if (!isBatch) {
          ctx.shadowBlur = 0;
          ctx.strokeStyle = "rgba(255,215,0,0.4)";
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(px, py, 11, 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.restore();
      }
    }
  }, [canvasSize, computeSum]);

  /* ── single-point animation (click) ── */
  const startAnimation = useCallback((xClick) => {
    if (animRef.current.timer) clearTimeout(animRef.current.timer);
    if (batchRef.current.timer) clearTimeout(batchRef.current.timer);
    animRef.current.active = true;
    batchRef.current.active = false;

    let sum = 0, k = 0, prevSum = null;
    const { yMin: yMn, yMax: yMx } = paramsRef.current;
    const H = canvasSize.h;
    const pixelSize = (yMx - yMn) / H;

    const step = () => {
      if (!animRef.current.active) return;
      const p = paramsRef.current;
      const bk = evalCoeff(p.formula, k);
      if (isNaN(bk)) {
        animRef.current.active = false;
        setStatusText(`b(${k}) is undefined. Stopped.`);
        draw();
        return;
      }
      const exp = p.a * k + p.l;
      let term = bk * Math.pow(xClick, exp);
      if (!Number.isFinite(term)) term = 0;
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

      const converged = k >= 2 && Math.abs(sum - prevSum) < pixelSize;
      if (converged || k >= p.maxTerms) {
        animRef.current.active = false;
        const newPt = { x: xClick, y: sum, terms: k + 1 };
        setRedPoints((prev) => [...prev, newPt]);
        redPointsRef.current = [...redPointsRef.current, newPt];
        setStatusText(converged
          ? `Converged at x = ${fmtNum(xClick, 4)}  →  f(x) ≈ ${fmtNum(sum, 6)}  (${k + 1} terms)`
          : `Max terms (${p.maxTerms}) reached at x = ${fmtNum(xClick, 4)}  →  Sₖ ≈ ${fmtNum(sum, 6)}`);
        setTimeout(() => draw(), 20);
        return;
      }
      k++;
      animRef.current.timer = setTimeout(step, p.speed);
    };
    step();
  }, [canvasSize, draw]);

  /* ── batch animation (dance) ── */
  const startBatchAnimation = useCallback(() => {
    if (animRef.current.timer) clearTimeout(animRef.current.timer);
    if (batchRef.current.timer) clearTimeout(batchRef.current.timer);
    animRef.current.active = false;
    batchRef.current.active = true;

    const interval = findConvergenceInterval();
    if (!interval) {
      setStatusText("Could not detect an interval of convergence in the visible x range.");
      return;
    }

    const [lo, hi] = interval;
    const n = Math.max(1, Math.min(200, batchCount));
    const { yMin: yMn, yMax: yMx } = paramsRef.current;
    const H = canvasSize.h;
    const pixelSize = (yMx - yMn) / H;

    /* initialize dots at random x values */
    const dots = [];
    for (let i = 0; i < n; i++) {
      dots.push({ x: lo + Math.random() * (hi - lo), sum: 0, k: 0, prevSum: 0, done: false });
    }
    batchRef.current.dots = dots;
    let stepCount = 0;

    setStatusText(`Dancing ${n} points in [${fmtNum(lo, 3)}, ${fmtNum(hi, 3)}] …`);

    const step = () => {
      if (!batchRef.current.active) return;
      const p = paramsRef.current;
      const justFinished = [];

      for (const dot of dots) {
        if (dot.done) continue;
        const bk = evalCoeff(p.formula, dot.k);
        if (isNaN(bk)) { dot.done = true; continue; }
        const exp = p.a * dot.k + p.l;
        let term = bk * Math.pow(dot.x, exp);
        if (!Number.isFinite(term)) term = 0;
        dot.prevSum = dot.sum;
        dot.sum += term;
        if (!Number.isFinite(dot.sum)) { dot.done = true; continue; }
        const converged = dot.k >= 2 && Math.abs(dot.sum - dot.prevSum) < pixelSize;
        if (converged || dot.k >= p.maxTerms) {
          dot.done = true;
          justFinished.push({ x: dot.x, y: dot.sum, terms: dot.k + 1 });
        }
        dot.k++;
      }

      /* add converged dots as red points */
      if (justFinished.length > 0) {
        setRedPoints((prev) => [...prev, ...justFinished]);
        redPointsRef.current = [...redPointsRef.current, ...justFinished];
      }

      const yellowDots = dots.filter(d => !d.done).map(d => ({ x: d.x, y: d.sum }));
      stepCount++;
      const doneCount = dots.filter(d => d.done).length;
      setStatusText(`Dancing ${n} points  |  step ${stepCount}  |  ${doneCount}/${n} converged`);
      draw(yellowDots);

      if (yellowDots.length === 0) {
        batchRef.current.active = false;
        setStatusText(`All ${n} points converged in [${fmtNum(lo, 3)}, ${fmtNum(hi, 3)}].`);
        setTimeout(() => draw(), 20);
        return;
      }
      batchRef.current.timer = setTimeout(step, p.speed);
    };
    step();
  }, [canvasSize, draw, batchCount, findConvergenceInterval]);

  /* ── handle click on canvas ── */
  const handleCanvasClick = useCallback((e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const px = e.clientX - rect.left;
    startAnimation(pToX(px));
  }, [pToX, startAnimation]);

  /* ── resize observer ── */
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

  useEffect(() => { draw(); }, [canvasSize, redPoints, showGraph, xMin, xMax, yMin, yMax, draw]);

  /* clear on param change */
  useEffect(() => {
    if (animRef.current.timer) clearTimeout(animRef.current.timer);
    if (batchRef.current.timer) clearTimeout(batchRef.current.timer);
    animRef.current.active = false;
    batchRef.current.active = false;
    setRedPoints([]);
    redPointsRef.current = [];
    setStatusText("Click on the plot to begin.");
  }, [formula, a, l]);

  const loadPreset = (idx) => {
    const p = PRESETS[idx];
    if (!p) return;
    setPresetIdx(idx);
    setFormula(p.formula);
    setA(p.a);
    setL(p.l);
    setXMin(p.xr[0]); setXMax(p.xr[1]);
    setYMin(p.yr[0]); setYMax(p.yr[1]);
  };

  const displayFormula = (() => {
    let exp = "";
    if (a === 1 && l === 0) exp = "k";
    else if (a === 1 && l !== 0) exp = `k+${l}`;
    else if (a !== 1 && l === 0) exp = `${a}k`;
    else exp = `${a}k+${l}`;
    return `Σ  b(k) · x^(${exp})    k = 0, 1, 2, …`;
  })();

  const stopAll = () => {
    if (animRef.current.timer) clearTimeout(animRef.current.timer);
    if (batchRef.current.timer) clearTimeout(batchRef.current.timer);
    animRef.current.active = false;
    batchRef.current.active = false;
    setStatusText("Animation stopped.");
    draw();
  };

  return (
    <div style={{ display: "flex", height: "100vh", width: "100vw", fontFamily: "'Nunito', 'Segoe UI', sans-serif", background: "#080c14", color: "#c9d4e2", overflow: "hidden" }}>
      {/* ── sidebar ── */}
      <div style={{
        width: sideOpen ? 290 : 0, minWidth: sideOpen ? 290 : 0,
        transition: "width 0.25s, min-width 0.25s",
        background: "#0d1220", borderRight: "1px solid #1c2640",
        overflow: "hidden", display: "flex", flexDirection: "column"
      }}>
        <div style={{ padding: "14px 16px", overflowY: "auto", flex: 1 }}>
          <div style={{ fontSize: 15, fontWeight: 700, letterSpacing: 0.5, marginBottom: 2, color: "#e8edf5" }}>Power Series Explorer</div>
          <div style={{ fontFamily: "monospace", fontSize: 13, color: "#7b8faa", marginBottom: 14 }}>{displayFormula}</div>

          <Label>Preset</Label>
          <select value={presetIdx} onChange={(e) => loadPreset(+e.target.value)} style={selStyle}>
            {PRESETS.map((p, i) => <option key={i} value={i}>{p.name} — {p.desc}</option>)}
          </select>

          <Label>b(k) — coefficient formula in terms of k</Label>
          <input value={formula} onChange={(e) => setFormula(e.target.value)} style={inputStyle} spellCheck={false} />
          <div style={{ fontSize: 10, color: "#4e6280", marginTop: 2, marginBottom: 8 }}>
            Available: factorial(n), C(n,r), pow, sqrt, abs, log, sin, cos, PI, E
          </div>

          <div style={{ display: "flex", gap: 10, marginBottom: 10 }}>
            <div style={{ flex: 1 }}>
              <Label>a (exponent multiplier)</Label>
              <input type="number" value={a} onChange={(e) => setA(+e.target.value)} style={inputStyle} step={1} />
            </div>
            <div style={{ flex: 1 }}>
              <Label>l (exponent shift)</Label>
              <input type="number" value={l} onChange={(e) => setL(+e.target.value)} style={inputStyle} step={1} />
            </div>
          </div>

          <Label>x range</Label>
          <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
            <input type="number" value={xMin} onChange={(e) => setXMin(+e.target.value)} style={{ ...inputStyle, flex: 1 }} step={0.5} />
            <span style={{ color: "#4e6280", alignSelf: "center" }}>to</span>
            <input type="number" value={xMax} onChange={(e) => setXMax(+e.target.value)} style={{ ...inputStyle, flex: 1 }} step={0.5} />
          </div>
          <Label>y range</Label>
          <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
            <input type="number" value={yMin} onChange={(e) => setYMin(+e.target.value)} style={{ ...inputStyle, flex: 1 }} step={0.5} />
            <span style={{ color: "#4e6280", alignSelf: "center" }}>to</span>
            <input type="number" value={yMax} onChange={(e) => setYMax(+e.target.value)} style={{ ...inputStyle, flex: 1 }} step={0.5} />
          </div>

          <Label>Animation delay: {speed} ms</Label>
          <input type="range" min={20} max={800} value={speed} onChange={(e) => setSpeed(+e.target.value)}
            style={{ width: "100%", accentColor: "#5b8dd9", marginBottom: 12 }} />

          <Label>Max terms</Label>
          <input type="number" value={maxTerms} onChange={(e) => setMaxTerms(Math.max(10, +e.target.value))} style={{ ...inputStyle, marginBottom: 12 }} min={10} max={5000} />

          <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", marginBottom: 14, fontSize: 13 }}>
            <input type="checkbox" checked={showGraph} onChange={(e) => setShowGraph(e.target.checked)} style={{ accentColor: "#5b8dd9" }} />
            Reveal full graph
          </label>

          {/* ── batch dance section ── */}
          <div style={{ borderTop: "1px solid #1c2640", paddingTop: 12, marginTop: 4, marginBottom: 12 }}>
            <Label>Batch animate (dance)</Label>
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 4 }}>
              <input type="number" value={batchCount} onChange={(e) => setBatchCount(Math.max(1, Math.min(200, +e.target.value)))}
                style={{ ...inputStyle, flex: "0 0 60px", textAlign: "center" }} min={1} max={200} />
              <span style={{ fontSize: 12, color: "#6b8ab0", whiteSpace: "nowrap" }}>points</span>
              <button onClick={startBatchAnimation} style={{
                ...btnStyle, flex: "1 1 auto",
                background: "linear-gradient(135deg, #1a2a10, #1a3318)", borderColor: "#2d5a1e",
                color: "#8dcc6a", letterSpacing: 0.5
              }}>
                Dance!
              </button>
            </div>
            <div style={{ fontSize: 10, color: "#4e6280", marginTop: 4 }}>
              Picks random x values in the interval of convergence and animates all partial sums simultaneously.
            </div>
          </div>

          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => { setRedPoints([]); redPointsRef.current = []; stopAll(); setStatusText("Cleared."); setTimeout(() => draw(), 20); }} style={btnStyle}>Clear Points</button>
            <button onClick={stopAll} style={{ ...btnStyle, background: "#2a1a1a", borderColor: "#5a2020" }}>Stop</button>
          </div>
        </div>

        <div style={{ padding: "10px 16px", background: "#0a0e18", borderTop: "1px solid #1c2640", fontSize: 12, fontFamily: "monospace", color: "#88a0be", minHeight: 38, lineHeight: 1.5 }}>
          {statusText}
        </div>
      </div>

      {/* ── toggle sidebar ── */}
      <button onClick={() => setSideOpen(!sideOpen)} style={{
        position: "absolute", top: 8, left: sideOpen ? 296 : 6, zIndex: 10,
        background: "#151d2e", border: "1px solid #1c2640", color: "#6b8ab0",
        width: 28, height: 28, borderRadius: 6, cursor: "pointer", fontSize: 14,
        display: "flex", alignItems: "center", justifyContent: "center",
        transition: "left 0.25s"
      }}>{sideOpen ? "◂" : "▸"}</button>

      {/* ── canvas area ── */}
      <div ref={containerRef} style={{ flex: 1, position: "relative", cursor: "crosshair" }}>
        <canvas ref={canvasRef} onClick={handleCanvasClick}
          style={{ width: canvasSize.w, height: canvasSize.h, display: "block" }} />
        {redPoints.length > 0 && (
          <div style={{
            position: "absolute", top: 10, right: 14, background: "rgba(255,68,68,0.15)",
            border: "1px solid rgba(255,68,68,0.3)", borderRadius: 8, padding: "4px 10px",
            fontSize: 12, fontFamily: "monospace", color: "#ff8888"
          }}>
            {redPoints.length} point{redPoints.length !== 1 ? "s" : ""} plotted
          </div>
        )}
      </div>
    </div>
  );
}

function Label({ children }) {
  return <div style={{ fontSize: 11, fontWeight: 600, color: "#7b8faa", marginBottom: 3, letterSpacing: 0.3, textTransform: "uppercase" }}>{children}</div>;
}

const inputStyle = {
  width: "100%", boxSizing: "border-box",
  background: "#111827", border: "1px solid #1e2d44", borderRadius: 6,
  color: "#d0daea", padding: "6px 8px", fontSize: 13,
  fontFamily: "'Source Code Pro', Menlo, monospace", outline: "none"
};
const selStyle = { ...inputStyle, marginBottom: 12, cursor: "pointer" };
const btnStyle = {
  flex: 1, padding: "7px 0", borderRadius: 6, border: "1px solid #1e2d44",
  background: "#111827", color: "#8ea8c8", cursor: "pointer", fontSize: 12,
  fontWeight: 600, letterSpacing: 0.3
};

function niceStep(range, targetPx) {
  const rough = range / (targetPx > 0 ? targetPx : 5);
  const mag = Math.pow(10, Math.floor(Math.log10(rough)));
  const norm = rough / mag;
  let step;
  if (norm < 1.5) step = 1;
  else if (norm < 3.5) step = 2;
  else if (norm < 7.5) step = 5;
  else step = 10;
  return step * mag;
}

function fmtNum(v, digits = 2) {
  if (Math.abs(v) < 1e-12) return "0";
  if (Math.abs(v) >= 1e4 || (Math.abs(v) < 0.01 && Math.abs(v) > 0)) return v.toExponential(digits);
  return +v.toFixed(digits) + "";
}
