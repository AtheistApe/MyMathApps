import { useState, useRef, useEffect, useCallback } from "react";
import * as math from "mathjs";

const COLORS = {
  bg: "#0a0f1a",
  panel: "#111827",
  panelBorder: "#1e293b",
  axes: "#8899aa",
  gridLine: "#1e293b",
  curve: "#38bdf8",
  tangent: "#f472b6",
  point: "#fbbf24",
  intercept: "#34d399",
  text: "#e2e8f0",
  textDim: "#b0bec9",
  textMuted: "#8899aa",
  inputBg: "#0f172a",
  inputBorder: "#334155",
  inputFocus: "#38bdf8",
  accent: "#38bdf8",
  tableHeader: "#1e293b",
  tableRow: "#151f30",
  tableRowAlt: "#111827",
  buttonBg: "#1e3a5f",
  buttonHover: "#2563eb",
  formulaBg: "#0d1525",
};

const GRAPH_PADDING = { top: 30, right: 30, bottom: 50, left: 60 };

function safeEval(expr, x) {
  try {
    return math.evaluate(expr, { x, e: Math.E, pi: Math.PI, PI: Math.PI });
  } catch { return NaN; }
}

function numericalDerivative(expr, x, h = 1e-7) {
  const fp = safeEval(expr, x + h);
  const fm = safeEval(expr, x - h);
  if (!isFinite(fp) || !isFinite(fm)) return NaN;
  return (fp - fm) / (2 * h);
}

function niceTickStep(range, maxTicks = 10) {
  const rough = range / maxTicks;
  const mag = Math.pow(10, Math.floor(Math.log10(rough)));
  const norm = rough / mag;
  if (norm <= 1.5) return mag;
  if (norm <= 3) return 2 * mag;
  if (norm <= 7) return 5 * mag;
  return 10 * mag;
}

function generateTicks(min, max) {
  const step = niceTickStep(max - min);
  const start = Math.ceil(min / step) * step;
  const ticks = [];
  for (let v = start; v <= max + step * 0.001; v += step)
    ticks.push(parseFloat(v.toFixed(10)));
  return ticks;
}

function sub(n) {
  const s = "₀₁₂₃₄₅₆₇₈₉";
  return String(n).split("").map(d => s[parseInt(d)] || d).join("");
}

function formatNum(v) {
  if (Math.abs(v) < 1e-10) return "0";
  if (Math.abs(v) >= 1000 || (Math.abs(v) < 0.01 && v !== 0)) return v.toExponential(1);
  return parseFloat(v.toPrecision(6)).toString();
}

export default function NewtonsMethod() {
  const [funcExpr, setFuncExpr] = useState("x^3 - 2*x - 5");
  const [xMinStr, setXMinStr] = useState("-3");
  const [xMaxStr, setXMaxStr] = useState("5");
  const [iterations, setIterations] = useState([]);
  const [isActive, setIsActive] = useState(false);
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const [canvasSize, setCanvasSize] = useState({ w: 600, h: 450 });

  const xMinUser = isNaN(parseFloat(xMinStr)) ? -5 : parseFloat(xMinStr);
  const xMaxUser = isNaN(parseFloat(xMaxStr)) ? 5 : parseFloat(xMaxStr);

  // After 3+ iterates, zoom x-axis to span the last 3 iterates
  // Include both x-intercepts (xn) and tangency points (fromX) for visible iterations
  let xMin = xMinUser, xMax = xMaxUser;
  const visibleIters = iterations.length >= 3 ? iterations.slice(-3) : iterations;
  if (iterations.length >= 3) {
    const xVals = [];
    for (const it of visibleIters) {
      if (isFinite(it.xn)) xVals.push(it.xn);
      if (it.fromX !== undefined && isFinite(it.fromX)) xVals.push(it.fromX);
    }
    const lo = Math.min(...xVals);
    const hi = Math.max(...xVals);
    const span = hi - lo || 1e-10;
    const pad = span * 0.3;
    xMin = lo - pad;
    xMax = hi + pad;
  }

  // Expand x-range for any visible point that falls outside
  for (const it of visibleIters) {
    const pad = (xMax - xMin) * 0.08 || 0.5;
    if (isFinite(it.xn)) {
      if (it.xn < xMin) xMin = it.xn - pad;
      if (it.xn > xMax) xMax = it.xn + pad;
    }
    if (it.fromX !== undefined && isFinite(it.fromX)) {
      if (it.fromX < xMin) xMin = it.fromX - pad;
      if (it.fromX > xMax) xMax = it.fromX + pad;
    }
  }

  const computeYRange = useCallback(() => {
    let yMin = Infinity, yMax = -Infinity;
    for (let i = 0; i <= 500; i++) {
      const y = safeEval(funcExpr, xMin + (i / 500) * (xMax - xMin));
      if (isFinite(y)) { yMin = Math.min(yMin, y); yMax = Math.max(yMax, y); }
    }
    // Include f(xn) and tangency points (fromY) for visible iterates
    for (const it of visibleIters) {
      if (isFinite(it.xn)) {
        const fy = safeEval(funcExpr, it.xn);
        if (isFinite(fy)) { yMin = Math.min(yMin, fy); yMax = Math.max(yMax, fy); }
      }
      if (it.fromY !== undefined && isFinite(it.fromY)) {
        yMin = Math.min(yMin, it.fromY);
        yMax = Math.max(yMax, it.fromY);
      }
    }
    // Always include y=0 so the x-axis is visible
    yMin = Math.min(yMin, 0);
    yMax = Math.max(yMax, 0);
    if (!isFinite(yMin)) return { yMin: -10, yMax: 10 };
    const pad = (yMax - yMin) * 0.15 || 2;
    return { yMin: yMin - pad, yMax: yMax + pad };
  }, [funcExpr, xMin, xMax, iterations]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      const w = Math.max(380, entries[0].contentRect.width);
      setCanvasSize({ w, h: Math.max(300, Math.round(w * 0.72)) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const stepNewton = useCallback(() => {
    if (iterations.length === 0) return;
    const xn = iterations[iterations.length - 1].xn;
    const fxn = safeEval(funcExpr, xn);
    const fpxn = numericalDerivative(funcExpr, xn);
    if (!isFinite(fxn) || !isFinite(fpxn) || Math.abs(fpxn) < 1e-14) return;
    const xNext = xn - fxn / fpxn;
    if (!isFinite(xNext)) return;
    setIterations(prev => [...prev, { n: prev.length, xn: xNext, fromX: xn, fromY: fxn, slope: fpxn }]);
  }, [iterations, funcExpr]);

  useEffect(() => {
    if (!isActive || iterations.length === 0) return;
    const handler = e => { if (e.key === "Enter") { e.preventDefault(); stepNewton(); } };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isActive, stepNewton]);

  // Draw canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = canvasSize.w * dpr;
    canvas.height = canvasSize.h * dpr;
    const ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);
    const W = canvasSize.w, H = canvasSize.h;
    const { yMin, yMax } = computeYRange();
    const p = GRAPH_PADDING, gw = W - p.left - p.right, gh = H - p.top - p.bottom;

    const toC = (x, y) => [p.left + ((x - xMin) / (xMax - xMin)) * gw, p.top + ((yMax - y) / (yMax - yMin)) * gh];

    ctx.fillStyle = COLORS.panel;
    ctx.fillRect(0, 0, W, H);

    ctx.save();
    ctx.beginPath(); ctx.rect(p.left, p.top, gw, gh); ctx.clip();

    // Grid
    ctx.strokeStyle = COLORS.gridLine; ctx.lineWidth = 0.5;
    for (const xt of generateTicks(xMin, xMax)) { const [cx] = toC(xt, 0); ctx.beginPath(); ctx.moveTo(cx, p.top); ctx.lineTo(cx, p.top + gh); ctx.stroke(); }
    for (const yt of generateTicks(yMin, yMax)) { const [, cy] = toC(0, yt); ctx.beginPath(); ctx.moveTo(p.left, cy); ctx.lineTo(p.left + gw, cy); ctx.stroke(); }

    // Axes
    ctx.strokeStyle = COLORS.axes; ctx.lineWidth = 1.2;
    if (yMin <= 0 && yMax >= 0) { const [, ay] = toC(0, 0); ctx.beginPath(); ctx.moveTo(p.left, ay); ctx.lineTo(p.left + gw, ay); ctx.stroke(); }
    if (xMin <= 0 && xMax >= 0) { const [ax] = toC(0, 0); ctx.beginPath(); ctx.moveTo(ax, p.top); ctx.lineTo(ax, p.top + gh); ctx.stroke(); }

    // Curve
    ctx.strokeStyle = COLORS.curve; ctx.lineWidth = 2.5; ctx.beginPath();
    let started = false;
    const samples = Math.max(600, gw * 2);
    for (let i = 0; i <= samples; i++) {
      const x = xMin + (i / samples) * (xMax - xMin);
      const y = safeEval(funcExpr, x);
      if (!isFinite(y) || y < yMin - 100 || y > yMax + 100) { started = false; continue; }
      const [cx, cy] = toC(x, y);
      if (!started) { ctx.moveTo(cx, cy); started = true; } else ctx.lineTo(cx, cy);
    }
    ctx.stroke();

    // Tangent lines (dashed)
    for (let i = 1; i < iterations.length; i++) {
      const { fromX, fromY, slope } = iterations[i];
      if (!isFinite(slope) || !isFinite(fromY)) continue;
      const tanY = x => fromY + slope * (x - fromX);
      const ext = (xMax - xMin);
      const isLatest = (i === iterations.length - 1);
      ctx.save();
      ctx.strokeStyle = isLatest ? "#ff85b8" : COLORS.tangent;
      ctx.lineWidth = isLatest ? 2.2 : 1.2;
      ctx.setLineDash(isLatest ? [10, 5] : [6, 5]);
      ctx.globalAlpha = isLatest ? 1.0 : Math.max(0.50, 0.80 - (iterations.length - 1 - i) * 0.1);
      const [x1c, y1c] = toC(xMin - ext, tanY(xMin - ext));
      const [x2c, y2c] = toC(xMax + ext, tanY(xMax + ext));
      ctx.beginPath(); ctx.moveTo(x1c, y1c); ctx.lineTo(x2c, y2c); ctx.stroke();
      ctx.restore();
    }

    // Points on curve + x-intercepts + vertical connecting lines
    for (let i = 0; i < iterations.length; i++) {
      const fx = safeEval(funcExpr, iterations[i].xn);

      // Vertical dotted line from x-intercept to point on curve
      if (isFinite(fx) && Math.abs(fx) > 1e-14) {
        ctx.save(); ctx.strokeStyle = "#8bb8e8"; ctx.lineWidth = 1.2;
        ctx.setLineDash([4, 4]); ctx.globalAlpha = 0.85;
        const [vx1, vy1] = toC(iterations[i].xn, 0);
        const [vx2, vy2] = toC(iterations[i].xn, fx);
        ctx.beginPath(); ctx.moveTo(vx1, vy1); ctx.lineTo(vx2, vy2); ctx.stroke();
        ctx.restore();
      }

      // Point on curve
      if (isFinite(fx)) {
        const [px, py] = toC(iterations[i].xn, fx);
        ctx.fillStyle = COLORS.point; ctx.beginPath(); ctx.arc(px, py, 5, 0, Math.PI * 2); ctx.fill();
      }
      if (yMin <= 0 && yMax >= 0) {
        const [ix, iy] = toC(iterations[i].xn, 0);
        ctx.fillStyle = COLORS.intercept; ctx.beginPath(); ctx.arc(ix, iy, 4, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = COLORS.textDim; ctx.font = "bold 15px 'JetBrains Mono', monospace";
        ctx.textAlign = "center"; ctx.fillText(`x${sub(i)}`, ix, iy + 16);
      }
    }
    ctx.restore();

    // Tick labels — always include xMin and xMax as endpoints
    ctx.fillStyle = COLORS.textDim; ctx.font = "11px 'JetBrains Mono', monospace"; ctx.textAlign = "center";
    const xTickSet = new Set();
    const xTicks = generateTicks(xMin, xMax);
    const allXTicks = [xMin, ...xTicks.filter(t => Math.abs(t - xMin) > (xMax - xMin) * 0.04 && Math.abs(t - xMax) > (xMax - xMin) * 0.04), xMax];
    for (const xt of allXTicks) {
      if (xTickSet.has(xt)) continue; xTickSet.add(xt);
      const [cx] = toC(xt, 0);
      const align = (xt === xMin) ? "left" : (xt === xMax) ? "right" : "center";
      ctx.textAlign = align;
      ctx.fillText(formatNum(xt), cx, H - p.bottom + 20);
    }
    ctx.textAlign = "right";
    for (const yt of generateTicks(yMin, yMax)) { const [, cy] = toC(0, yt); ctx.fillText(formatNum(yt), p.left - 10, cy + 4); }

    ctx.fillStyle = COLORS.textMuted; ctx.font = "12px 'JetBrains Mono', monospace"; ctx.textAlign = "center";
    ctx.fillText("x", p.left + gw / 2, H - 6);
    ctx.save(); ctx.translate(14, p.top + gh / 2); ctx.rotate(-Math.PI / 2); ctx.fillText("f(x)", 0, 0); ctx.restore();
  }, [canvasSize, funcExpr, xMin, xMax, iterations, computeYRange]);

  function handleCanvasClick(e) {
    const rect = canvasRef.current.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const gw = canvasSize.w - GRAPH_PADDING.left - GRAPH_PADDING.right;
    const x0 = xMin + ((cx - GRAPH_PADDING.left) / gw) * (xMax - xMin);
    if (x0 < xMin || x0 > xMax) return;
    const fx0 = safeEval(funcExpr, x0);
    const fpx0 = numericalDerivative(funcExpr, x0);
    setIterations([{ n: 0, xn: x0, fromX: x0, fromY: fx0, slope: fpx0 }]);
    setIsActive(true);
  }

  function handleReset() { setIterations([]); setIsActive(false); }

  return (
    <div style={{
      minHeight: "100vh", background: COLORS.bg, color: COLORS.text,
      fontFamily: "'JetBrains Mono', 'Fira Code', monospace", padding: "16px 20px", boxSizing: "border-box",
    }}>
      <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;500;600;700&family=Playfair+Display:ital,wght@0,700;1,700&display=swap" rel="stylesheet" />

      {/* Header + Formula */}
      <div style={{ textAlign: "center", marginBottom: 14 }}>
        <h1 style={{
          fontFamily: "'Playfair Display', serif", fontSize: "clamp(22px, 4vw, 30px)", fontWeight: 700,
          background: `linear-gradient(135deg, ${COLORS.curve}, ${COLORS.tangent})`,
          WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", margin: "0 0 10px",
        }}>Newton's Method</h1>

        <div style={{
          display: "inline-flex", alignItems: "center", gap: 4,
          padding: "8px 22px", background: COLORS.formulaBg,
          border: `1px solid ${COLORS.panelBorder}`, borderRadius: 8,
          fontSize: 19, color: COLORS.text,
        }}>
          <span style={{ color: COLORS.accent, fontWeight: 600, fontStyle: "italic" }}>x</span>
          <span style={{ color: COLORS.textDim, fontSize: 12, position: "relative", top: 5 }}>n+1</span>
          <span style={{ color: COLORS.textMuted, margin: "0 6px" }}>=</span>
          <span style={{ color: COLORS.accent, fontWeight: 600, fontStyle: "italic" }}>x</span>
          <span style={{ color: COLORS.textDim, fontSize: 12, position: "relative", top: 5 }}>n</span>
          <span style={{ color: COLORS.textMuted, margin: "0 8px" }}>−</span>
          <span style={{ display: "inline-flex", flexDirection: "column", alignItems: "center" }}>
            <span style={{ borderBottom: `2px solid ${COLORS.textMuted}`, paddingBottom: 3, marginBottom: 3, color: COLORS.tangent, fontWeight: 500 }}>
              <span style={{ fontStyle: "italic" }}>f</span>(<span style={{ fontStyle: "italic" }}>x</span><span style={{ fontSize: 11, position: "relative", top: 3 }}>n</span>)
            </span>
            <span style={{ color: COLORS.curve, fontWeight: 500 }}>
              <span style={{ fontStyle: "italic" }}>f</span>′(<span style={{ fontStyle: "italic" }}>x</span><span style={{ fontSize: 11, position: "relative", top: 3 }}>n</span>)
            </span>
          </span>
        </div>
      </div>

      {/* Controls */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, justifyContent: "center", marginBottom: 16, alignItems: "flex-end" }}>
        <InputField label="f(x)" value={funcExpr} onChange={v => { setFuncExpr(v); handleReset(); }} width="260px" />
        <InputField label="x min" value={xMinStr} onChange={v => { setXMinStr(v); handleReset(); }} width="90px" />
        <InputField label="x max" value={xMaxStr} onChange={v => { setXMaxStr(v); handleReset(); }} width="90px" />
        <button onClick={handleReset} style={{
          background: COLORS.buttonBg, color: COLORS.text, border: `1px solid ${COLORS.inputBorder}`,
          borderRadius: 6, padding: "8px 18px", fontSize: 13, cursor: "pointer", fontFamily: "inherit",
        }}
          onMouseEnter={e => e.target.style.background = COLORS.buttonHover}
          onMouseLeave={e => e.target.style.background = COLORS.buttonBg}
        >Reset</button>
        {isActive && (
          <button onClick={stepNewton} style={{
            background: COLORS.tangent, color: "#0a0f1a", border: "none",
            borderRadius: 6, padding: "8px 18px", fontSize: 13, cursor: "pointer",
            fontFamily: "inherit", fontWeight: 600,
          }}>Step ↵</button>
        )}
      </div>

      {/* Main: graph left, table right */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "1fr 260px",
        gap: 20,
        maxWidth: 1100,
        margin: "0 auto",
      }}>
        {/* Graph column */}
        <div ref={containerRef} style={{ minWidth: 0 }}>
          <div style={{
            background: COLORS.panel, border: `1px solid ${COLORS.panelBorder}`,
            borderRadius: 10, overflow: "hidden", position: "relative",
          }}>
            <canvas ref={canvasRef} width={canvasSize.w} height={canvasSize.h}
              style={{ width: "100%", height: "auto", cursor: "crosshair", display: "block" }}
              onClick={handleCanvasClick}
            />
            <div style={{
              position: "absolute", bottom: 14, left: "50%", transform: "translateX(-50%)",
              background: "rgba(0,0,0,0.75)", color: isActive ? COLORS.tangent : COLORS.textDim,
              padding: "5px 14px", borderRadius: 20, fontSize: 11, whiteSpace: "nowrap", pointerEvents: "none",
            }}>
              {isActive ? "Press Enter to iterate  │  Click to restart" : "Click on the graph to choose x₀"}
            </div>
          </div>
          {/* Legend */}
          <div style={{ display: "flex", gap: 16, justifyContent: "center", marginTop: 8, fontSize: 11, color: COLORS.textDim, flexWrap: "wrap" }}>
            <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <span style={{ width: 16, height: 3, background: COLORS.curve, display: "inline-block", borderRadius: 2 }} /> f(x)
            </span>
            <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <span style={{ width: 16, height: 0, borderTop: `2px dashed ${COLORS.tangent}`, display: "inline-block" }} /> tangent
            </span>
            <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <span style={{ width: 7, height: 7, background: COLORS.point, borderRadius: "50%", display: "inline-block" }} /> (xₙ, f(xₙ))
            </span>
            <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <span style={{ width: 7, height: 7, background: COLORS.intercept, borderRadius: "50%", display: "inline-block" }} /> xₙ
            </span>
          </div>
        </div>

        {/* Table column */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
          <div style={{
            background: COLORS.panel, border: `1px solid ${COLORS.panelBorder}`,
            borderRadius: 10, overflow: "hidden",
          }}>
            <div style={{
              padding: "10px 14px", borderBottom: `1px solid ${COLORS.panelBorder}`,
              fontSize: 12, fontWeight: 600, color: COLORS.accent, letterSpacing: "0.5px",
            }}>ITERATIONS</div>
            <div style={{ overflowY: "auto", maxHeight: 380 }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ background: COLORS.tableHeader }}>
                    <th style={{ padding: "8px 12px", textAlign: "center", color: COLORS.textDim, fontWeight: 500, borderBottom: `1px solid ${COLORS.panelBorder}`, width: 40 }}>
                      <em>n</em>
                    </th>
                    <th style={{ padding: "8px 12px", textAlign: "left", color: COLORS.textDim, fontWeight: 500, borderBottom: `1px solid ${COLORS.panelBorder}` }}>
                      <em>x</em><sub style={{ fontSize: 10 }}>n</sub>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {iterations.length === 0 ? (
                    <tr><td colSpan={2} style={{
                      padding: "36px 12px", textAlign: "center", color: COLORS.textMuted, fontSize: 12, fontStyle: "italic",
                    }}>Click graph to start</td></tr>
                  ) : iterations.map((it, i) => (
                    <tr key={i} style={{ background: i % 2 === 0 ? COLORS.tableRow : COLORS.tableRowAlt }}>
                      <td style={{ padding: "7px 12px", textAlign: "center", color: COLORS.textDim, borderBottom: `1px solid ${COLORS.panelBorder}` }}>{it.n}</td>
                      <td style={{
                        padding: "7px 12px", textAlign: "left",
                        color: i === iterations.length - 1 ? COLORS.accent : COLORS.text,
                        fontWeight: i === iterations.length - 1 ? 600 : 400,
                        borderBottom: `1px solid ${COLORS.panelBorder}`,
                        fontVariantNumeric: "tabular-nums", fontSize: 12,
                      }}>{it.xn.toFixed(10)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Convergence card */}
          {iterations.length > 1 && (
            <div style={{
              background: COLORS.panel, border: `1px solid ${COLORS.panelBorder}`,
              borderRadius: 10, padding: "10px 14px", fontSize: 12, color: COLORS.textDim, lineHeight: 1.7,
            }}>
              <div style={{ color: COLORS.text, fontWeight: 600, marginBottom: 4, fontSize: 11, letterSpacing: "0.5px" }}>CONVERGENCE</div>
              <div>x{sub(iterations.length - 1)} = {iterations[iterations.length - 1].xn.toFixed(10)}</div>
              <div>f(x{sub(iterations.length - 1)}) = {safeEval(funcExpr, iterations[iterations.length - 1].xn).toExponential(4)}</div>
              {iterations.length > 2 && (
                <div style={{ marginTop: 2, color: COLORS.intercept }}>
                  |Δx| = {Math.abs(iterations[iterations.length - 1].xn - iterations[iterations.length - 2].xn).toExponential(4)}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function InputField({ label, value, onChange, width }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <label style={{ fontSize: 11, color: COLORS.textMuted, fontWeight: 500, letterSpacing: "0.5px" }}>{label}</label>
      <input type="text" value={value} onChange={e => onChange(e.target.value)}
        style={{
          background: COLORS.inputBg, border: `1px solid ${COLORS.inputBorder}`,
          borderRadius: 6, padding: "8px 12px", color: COLORS.text, fontSize: 14,
          fontFamily: "inherit", width, outline: "none", transition: "border-color 0.2s",
        }}
        onFocus={e => e.target.style.borderColor = COLORS.inputFocus}
        onBlur={e => e.target.style.borderColor = COLORS.inputBorder}
        onKeyDown={e => e.stopPropagation()}
      />
    </div>
  );
}
