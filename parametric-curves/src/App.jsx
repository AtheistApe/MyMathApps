import { useState, useEffect, useRef, useCallback, useMemo } from "react";

const DEFAULT_X = "2*cos(t)";
const DEFAULT_Y = "sin(2*t)";
const DEFAULT_T_MIN = 0;
const DEFAULT_T_MAX = 2 * Math.PI;
const STEPS = 500;
const PADDING = 40;
const TICK_SIZE = 5;

function safeEval(expr, t) {
  try {
    const fn = new Function(
      "t",
      "sin", "cos", "tan", "abs", "sqrt", "log", "exp", "pow",
      "PI", "E", "asin", "acos", "atan", "atan2", "sinh", "cosh", "tanh",
      "floor", "ceil", "round", "sign", "min", "max",
      `return (${expr});`
    );
    return fn(
      t,
      Math.sin, Math.cos, Math.tan, Math.abs, Math.sqrt, Math.log, Math.exp, Math.pow,
      Math.PI, Math.E, Math.asin, Math.acos, Math.atan, Math.atan2, Math.sinh, Math.cosh, Math.tanh,
      Math.floor, Math.ceil, Math.round, Math.sign, Math.min, Math.max
    );
  } catch {
    return NaN;
  }
}

function niceRange(min, max) {
  if (!isFinite(min) || !isFinite(max) || min === max) {
    return { min: min - 1, max: max + 1, step: 0.5 };
  }
  const range = max - min;
  const rawStep = range / 6;
  const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const candidates = [1, 2, 2.5, 5, 10];
  let step = candidates.find(c => c * mag >= rawStep) * mag;
  return {
    min: Math.floor(min / step) * step,
    max: Math.ceil(max / step) * step,
    step,
  };
}

function getTicks(rng) {
  const ticks = [];
  const decimals = rng.step < 1 ? Math.ceil(-Math.log10(rng.step)) : 0;
  for (let v = rng.min; v <= rng.max + rng.step * 0.01; v += rng.step) {
    ticks.push(+v.toFixed(decimals + 1));
  }
  return ticks;
}

function formatTick(v) {
  if (Math.abs(v) < 1e-10) return "0";
  if (Math.abs(v) < 0.01 || Math.abs(v) >= 10000) return v.toExponential(1);
  const s = v.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
  return s;
}

export default function ParametricCurves() {
  const [xExpr, setXExpr] = useState(DEFAULT_X);
  const [yExpr, setYExpr] = useState(DEFAULT_Y);
  const [tMinStr, setTMinStr] = useState("0");
  const [tMaxStr, setTMaxStr] = useState("2*PI");

  const [appliedX, setAppliedX] = useState(DEFAULT_X);
  const [appliedY, setAppliedY] = useState(DEFAULT_Y);
  const [appliedTMin, setAppliedTMin] = useState(DEFAULT_T_MIN);
  const [appliedTMax, setAppliedTMax] = useState(DEFAULT_T_MAX);

  const [tParam, setTParam] = useState(0);
  const [error, setError] = useState("");
  const [animating, setAnimating] = useState(false);
  const [uniformScale, setUniformScale] = useState(false);
  const animRef = useRef(null);

  const parseTBound = (s) => {
    try {
      const fn = new Function("PI", "E", `return (${s});`);
      return fn(Math.PI, Math.E);
    } catch { return NaN; }
  };

  const handleApply = () => {
    const tMin = parseTBound(tMinStr);
    const tMax = parseTBound(tMaxStr);
    if (!isFinite(tMin) || !isFinite(tMax) || tMin >= tMax) {
      setError("Invalid t range"); return;
    }
    const testX = safeEval(xExpr, tMin);
    const testY = safeEval(yExpr, tMin);
    if (!isFinite(testX)) { setError("Invalid x(t) expression"); return; }
    if (!isFinite(testY)) { setError("Invalid y(t) expression"); return; }
    setError("");
    setAppliedX(xExpr);
    setAppliedY(yExpr);
    setAppliedTMin(tMin);
    setAppliedTMax(tMax);
    setTParam(0);
  };

  const data = useMemo(() => {
    const pts = [];
    let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity;
    for (let i = 0; i <= STEPS; i++) {
      const t = appliedTMin + (appliedTMax - appliedTMin) * i / STEPS;
      const x = safeEval(appliedX, t);
      const y = safeEval(appliedY, t);
      if (isFinite(x) && isFinite(y)) {
        pts.push({ t, x, y });
        xMin = Math.min(xMin, x); xMax = Math.max(xMax, x);
        yMin = Math.min(yMin, y); yMax = Math.max(yMax, y);
      }
    }
    return {
      pts,
      xRange: niceRange(xMin, xMax),
      yRange: niceRange(yMin, yMax),
      tRange: niceRange(appliedTMin, appliedTMax),
    };
  }, [appliedX, appliedY, appliedTMin, appliedTMax]);

  const currentT = appliedTMin + (appliedTMax - appliedTMin) * tParam;
  const curX = safeEval(appliedX, currentT);
  const curY = safeEval(appliedY, currentT);

  const tracePoints = useMemo(() => {
    return data.pts.filter(p => p.t <= currentT + 1e-10);
  }, [data.pts, currentT]);

  useEffect(() => {
    if (!animating) { cancelAnimationFrame(animRef.current); return; }
    let start = null;
    const duration = 5000;
    const startParam = tParam;
    const tick = (ts) => {
      if (!start) start = ts;
      const progress = Math.min((ts - start) / duration, 1);
      setTParam(startParam + (1 - startParam) * progress);
      if (progress < 1) animRef.current = requestAnimationFrame(tick);
      else setAnimating(false);
    };
    animRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animRef.current);
  }, [animating]);

  // Layout
  const xySize = 340;
  const sideW = 200;
  const botH = 200;
  const gap = 12;

  // Compute XY plane ranges (possibly uniform)
  const { xyXRange, xyYRange } = useMemo(() => {
    if (!uniformScale) return { xyXRange: data.xRange, xyYRange: data.yRange };
    // Use the same step for both axes
    const step = Math.max(data.xRange.step, data.yRange.step);
    // Determine how many steps each axis needs (use the larger count)
    const xSteps = Math.ceil((data.xRange.max - data.xRange.min) / step);
    const ySteps = Math.ceil((data.yRange.max - data.yRange.min) / step);
    const maxSteps = Math.max(xSteps, ySteps);
    // Center each axis and expand to maxSteps * step
    const xMid = (data.xRange.max + data.xRange.min) / 2;
    const yMid = (data.yRange.max + data.yRange.min) / 2;
    const halfSpan = maxSteps * step / 2;
    return {
      xyXRange: { min: Math.round((xMid - halfSpan) / step) * step, max: Math.round((xMid + halfSpan) / step) * step, step },
      xyYRange: { min: Math.round((yMid - halfSpan) / step) * step, max: Math.round((yMid + halfSpan) / step) * step, step },
    };
  }, [data, uniformScale]);

  const mapXY = (x, y) => ({
    sx: PADDING + (x - xyXRange.min) / (xyXRange.max - xyXRange.min) * (xySize - 2 * PADDING),
    sy: (xySize - PADDING) - (y - xyYRange.min) / (xyYRange.max - xyYRange.min) * (xySize - 2 * PADDING),
  });

  const mapYT = (t, y) => ({
    sx: PADDING + (t - data.tRange.min) / (data.tRange.max - data.tRange.min) * (sideW - 2 * PADDING),
    sy: (xySize - PADDING) - (y - xyYRange.min) / (xyYRange.max - xyYRange.min) * (xySize - 2 * PADDING),
  });

  const mapXT = (x, t) => ({
    sx: PADDING + (x - xyXRange.min) / (xyXRange.max - xyXRange.min) * (xySize - 2 * PADDING),
    sy: PADDING + (t - data.tRange.min) / (data.tRange.max - data.tRange.min) * (botH - 2 * PADDING),
  });

  const xyTraceD = tracePoints.map((p, i) => {
    const { sx, sy } = mapXY(p.x, p.y);
    return (i === 0 ? "M" : "L") + sx + "," + sy;
  }).join(" ");

  const ytFullD = data.pts.map((p, i) => {
    const { sx, sy } = mapYT(p.t, p.y);
    return (i === 0 ? "M" : "L") + sx + "," + sy;
  }).join(" ");

  const ytTraceD = tracePoints.map((p, i) => {
    const { sx, sy } = mapYT(p.t, p.y);
    return (i === 0 ? "M" : "L") + sx + "," + sy;
  }).join(" ");

  const xtFullD = data.pts.map((p, i) => {
    const { sx, sy } = mapXT(p.x, p.t);
    return (i === 0 ? "M" : "L") + sx + "," + sy;
  }).join(" ");

  const xtTraceD = tracePoints.map((p, i) => {
    const { sx, sy } = mapXT(p.x, p.t);
    return (i === 0 ? "M" : "L") + sx + "," + sy;
  }).join(" ");

  const curXY = mapXY(curX, curY);
  const curYT = mapYT(currentT, curY);
  const curXT = mapXT(curX, currentT);

  const axisSty = { stroke: "#7a8a9a", strokeWidth: 1 };
  const gridSty = { stroke: "#e0e4e8", strokeWidth: 0.5 };
  const tickLbl = { fontSize: 9, fill: "#6b7886", textAnchor: "middle", fontFamily: "'JetBrains Mono', monospace" };
  const faintCurve = { fill: "none", strokeWidth: 1.5, opacity: 0.2 };
  const brightCurve = { fill: "none", strokeWidth: 2.5, strokeLinecap: "round" };

  const xyColor = "#e85d75";
  const ytColor = "#4a90d9";
  const xtColor = "#2eb872";

  const handleKeyDown = useCallback((e) => {
    if (e.key === "ArrowRight") setTParam(p => Math.min(1, p + 0.005));
    if (e.key === "ArrowLeft") setTParam(p => Math.max(0, p - 0.005));
  }, []);

  return (
    <div style={{
      background: "#f7f8fa",
      minHeight: "100vh",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      padding: "20px 10px",
      fontFamily: "'IBM Plex Sans', 'Segoe UI', sans-serif",
    }}>
      <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />

      <h1 style={{ fontSize: 22, fontWeight: 600, color: "#2a3544", margin: "0 0 4px", letterSpacing: "-0.3px" }}>
        Parametric Curve Explorer
      </h1>
      <p style={{ fontSize: 12, color: "#8899aa", margin: "0 0 16px" }}>Math 252 — Second Semester Calculus</p>

      {/* Input controls */}
      <div style={{
        display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center",
        background: "#fff", padding: "12px 16px", borderRadius: 10,
        boxShadow: "0 1px 4px rgba(0,0,0,0.06)", marginBottom: 16, maxWidth: 700,
      }}>
        <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 13, fontWeight: 500, color: "#2a3544" }}>
          <span style={{ color: xtColor, fontWeight: 600 }}>x(t) =</span>
          <input value={xExpr} onChange={e => setXExpr(e.target.value)}
            style={{ width: 140, padding: "4px 8px", borderRadius: 6, border: "1px solid #d0d5dd", fontSize: 13, fontFamily: "'JetBrains Mono', monospace" }}
            onKeyDown={e => e.key === "Enter" && handleApply()} />
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 13, fontWeight: 500, color: "#2a3544" }}>
          <span style={{ color: ytColor, fontWeight: 600 }}>y(t) =</span>
          <input value={yExpr} onChange={e => setYExpr(e.target.value)}
            style={{ width: 140, padding: "4px 8px", borderRadius: 6, border: "1px solid #d0d5dd", fontSize: 13, fontFamily: "'JetBrains Mono', monospace" }}
            onKeyDown={e => e.key === "Enter" && handleApply()} />
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 13, fontWeight: 500, color: "#2a3544" }}>
          t ∈ [
          <input value={tMinStr} onChange={e => setTMinStr(e.target.value)}
            style={{ width: 55, padding: "4px 6px", borderRadius: 6, border: "1px solid #d0d5dd", fontSize: 13, fontFamily: "'JetBrains Mono', monospace", textAlign: "center" }}
            onKeyDown={e => e.key === "Enter" && handleApply()} />
          ,
          <input value={tMaxStr} onChange={e => setTMaxStr(e.target.value)}
            style={{ width: 55, padding: "4px 6px", borderRadius: 6, border: "1px solid #d0d5dd", fontSize: 13, fontFamily: "'JetBrains Mono', monospace", textAlign: "center" }}
            onKeyDown={e => e.key === "Enter" && handleApply()} />
          ]
        </label>
        <button onClick={handleApply} style={{
          padding: "5px 16px", borderRadius: 6, border: "none",
          background: "#2a3544", color: "#fff", fontSize: 13, fontWeight: 500, cursor: "pointer",
        }}>Plot</button>
        <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, fontWeight: 500, color: "#6b7886", cursor: "pointer" }}>
          <input type="checkbox" checked={uniformScale} onChange={e => setUniformScale(e.target.checked)}
            style={{ accentColor: "#2a3544" }} />
          1:1 aspect
        </label>
        {error && <div style={{ color: "#d44", fontSize: 12, width: "100%", textAlign: "center" }}>{error}</div>}
      </div>

      {/* Graphs */}
      <div style={{ display: "flex", gap: gap, alignItems: "flex-start" }}>
        {/* Left: y(t) graph */}
        <div>
          <svg width={sideW} height={xySize} style={{ background: "#fff", borderRadius: 8, boxShadow: "0 1px 3px rgba(0,0,0,0.05)" }}>
            {/* Grid */}
            {getTicks(data.tRange).map(v => {
              const { sx } = mapYT(v, 0);
              return <line key={"tg"+v} x1={sx} y1={PADDING} x2={sx} y2={xySize-PADDING} {...gridSty} />;
            })}
            {getTicks(xyYRange).map(v => {
              const { sy } = mapYT(0, v);
              return <line key={"yg"+v} x1={PADDING} y1={sy} x2={sideW-PADDING} y2={sy} {...gridSty} />;
            })}
            {/* Axes */}
            <line x1={PADDING} y1={xySize-PADDING} x2={sideW-PADDING} y2={xySize-PADDING} {...axisSty} />
            <line x1={sideW-PADDING} y1={xySize-PADDING} x2={sideW-PADDING} y2={PADDING} {...axisSty} />
            {/* Tick labels */}
            {getTicks(data.tRange).map(v => {
              const { sx } = mapYT(v, 0);
              return <text key={"tt"+v} x={sx} y={xySize-PADDING+14} {...tickLbl}>{formatTick(v)}</text>;
            })}
            {getTicks(xyYRange).map(v => {
              const { sy } = mapYT(0, v);
              return <text key={"yt"+v} x={sideW-PADDING+4} y={sy+3} {...tickLbl} textAnchor="start" fontSize={8}>{formatTick(v)}</text>;
            })}
            {/* Axis labels */}
            <text x={sideW/2} y={xySize - 6} textAnchor="middle" fontSize={11} fill="#6b7886" fontWeight={500}>t</text>
            <text x={sideW-10} y={PADDING-8} textAnchor="end" fontSize={11} fill={ytColor} fontWeight={600}>y</text>
            {/* Curve */}
            <path d={ytFullD} stroke={ytColor} {...faintCurve} />
            <path d={ytTraceD} stroke={ytColor} {...brightCurve} />
            {/* Current point */}
            {isFinite(curYT.sx) && <>
              <circle cx={curYT.sx} cy={curYT.sy} r={5} fill={ytColor} stroke="#fff" strokeWidth={2} />
              {/* Dashed line to xy plane */}
              <line x1={curYT.sx} y1={curYT.sy} x2={sideW} y2={curYT.sy}
                stroke={xyColor} strokeWidth={1.2} strokeDasharray="4 3" opacity={0.7} />
            </>}
            <text x={PADDING+2} y={PADDING-6} fontSize={11} fill={ytColor} fontWeight={600} fontFamily="'JetBrains Mono', monospace">y(t)</text>
          </svg>
        </div>

        {/* Center column */}
        <div style={{ display: "flex", flexDirection: "column", gap: gap }}>
          {/* XY plane */}
          <svg width={xySize} height={xySize} style={{ background: "#fff", borderRadius: 8, boxShadow: "0 1px 3px rgba(0,0,0,0.05)" }}>
            {/* Grid */}
            {getTicks(xyXRange).map(v => {
              const { sx } = mapXY(v, 0);
              return <line key={"xg"+v} x1={sx} y1={PADDING} x2={sx} y2={xySize-PADDING} {...gridSty} />;
            })}
            {getTicks(xyYRange).map(v => {
              const { sy } = mapXY(0, v);
              return <line key={"yg"+v} x1={PADDING} y1={sy} x2={xySize-PADDING} y2={sy} {...gridSty} />;
            })}
            {/* Axes */}
            <line x1={PADDING} y1={xySize-PADDING} x2={xySize-PADDING} y2={xySize-PADDING} {...axisSty} />
            <line x1={PADDING} y1={xySize-PADDING} x2={PADDING} y2={PADDING} {...axisSty} />
            {/* Ticks */}
            {getTicks(xyXRange).map(v => {
              const { sx } = mapXY(v, 0);
              return <text key={"xt"+v} x={sx} y={xySize-PADDING+14} {...tickLbl}>{formatTick(v)}</text>;
            })}
            {getTicks(xyYRange).map(v => {
              const { sy } = mapXY(0, v);
              return <text key={"yl"+v} x={PADDING-6} y={sy+3} {...tickLbl} textAnchor="end" fontSize={8}>{formatTick(v)}</text>;
            })}
            <text x={xySize-PADDING+6} y={xySize-PADDING+4} fontSize={11} fill="#6b7886" fontWeight={500}>x</text>
            <text x={PADDING-6} y={PADDING-8} fontSize={11} fill="#6b7886" fontWeight={500} textAnchor="end">y</text>
            {/* Curve */}
            <path d={xyTraceD.length > 1 ? xyTraceD : ""} stroke={xyColor} {...brightCurve} />
            {/* Dashed lines from side panels */}
            {isFinite(curXY.sx) && <>
              {/* From y(t) graph (horizontal) */}
              <line x1={0} y1={curXY.sy} x2={curXY.sx} y2={curXY.sy}
                stroke={ytColor} strokeWidth={1.2} strokeDasharray="4 3" opacity={0.5} />
              {/* From x(t) graph (vertical) */}
              <line x1={curXY.sx} y1={xySize} x2={curXY.sx} y2={curXY.sy}
                stroke={xtColor} strokeWidth={1.2} strokeDasharray="4 3" opacity={0.5} />
              <circle cx={curXY.sx} cy={curXY.sy} r={6} fill={xyColor} stroke="#fff" strokeWidth={2} />
            </>}
            <text x={xySize/2} y={PADDING-10} textAnchor="middle" fontSize={12} fill={xyColor} fontWeight={600}
              fontFamily="'JetBrains Mono', monospace">
              (x(t), y(t))
            </text>
          </svg>

          {/* Bottom: x(t) graph — t axis points DOWN */}
          <svg width={xySize} height={botH} style={{ background: "#fff", borderRadius: 8, boxShadow: "0 1px 3px rgba(0,0,0,0.05)" }}>
            {/* Grid */}
            {getTicks(xyXRange).map(v => {
              const { sx } = mapXT(v, 0);
              return <line key={"xg2"+v} x1={sx} y1={PADDING} x2={sx} y2={botH-PADDING} {...gridSty} />;
            })}
            {getTicks(data.tRange).map(v => {
              const { sy } = mapXT(0, v);
              return <line key={"tg2"+v} x1={PADDING} y1={sy} x2={xySize-PADDING} y2={sy} {...gridSty} />;
            })}
            {/* Axes */}
            <line x1={PADDING} y1={PADDING} x2={xySize-PADDING} y2={PADDING} {...axisSty} />
            <line x1={PADDING} y1={PADDING} x2={PADDING} y2={botH-PADDING} {...axisSty} />
            {/* Ticks */}
            {getTicks(xyXRange).map(v => {
              const { sx } = mapXT(v, 0);
              return <text key={"xl2"+v} x={sx} y={PADDING-8} {...tickLbl}>{formatTick(v)}</text>;
            })}
            {getTicks(data.tRange).map(v => {
              const { sy } = mapXT(0, v);
              return <text key={"tl2"+v} x={PADDING-6} y={sy+3} {...tickLbl} textAnchor="end" fontSize={8}>{formatTick(v)}</text>;
            })}
            <text x={xySize-PADDING+6} y={PADDING+4} fontSize={11} fill="#6b7886" fontWeight={500}>x</text>
            <text x={PADDING-6} y={botH-PADDING+4} fontSize={11} fill="#6b7886" fontWeight={500} textAnchor="end">t</text>
            {/* Curve */}
            <path d={xtFullD} stroke={xtColor} {...faintCurve} />
            <path d={xtTraceD} stroke={xtColor} {...brightCurve} />
            {/* Current point */}
            {isFinite(curXT.sx) && <>
              <circle cx={curXT.sx} cy={curXT.sy} r={5} fill={xtColor} stroke="#fff" strokeWidth={2} />
              <line x1={curXT.sx} y1={0} x2={curXT.sx} y2={curXT.sy}
                stroke={xyColor} strokeWidth={1.2} strokeDasharray="4 3" opacity={0.7} />
            </>}
            <text x={xySize/2} y={botH-8} textAnchor="middle" fontSize={11} fill={xtColor} fontWeight={600}
              fontFamily="'JetBrains Mono', monospace">x(t)</text>
          </svg>
        </div>
      </div>

      {/* Slider & controls */}
      <div style={{
        marginTop: 16, display: "flex", alignItems: "center", gap: 12,
        background: "#fff", padding: "10px 20px", borderRadius: 10,
        boxShadow: "0 1px 4px rgba(0,0,0,0.06)", maxWidth: 580,
      }}
        tabIndex={0} onKeyDown={handleKeyDown}
      >
        <span style={{ fontSize: 13, fontWeight: 500, color: "#2a3544", fontFamily: "'JetBrains Mono', monospace", minWidth: 120 }}>
          t = {currentT.toFixed(3)}
        </span>
        <input type="range" min={0} max={1} step={0.001} value={tParam}
          onChange={e => setTParam(+e.target.value)}
          style={{ flex: 1, accentColor: "#2a3544", minWidth: 200 }} />
        <button onClick={() => { setTParam(0); setAnimating(true); }} style={{
          padding: "4px 14px", borderRadius: 6, border: "1px solid #d0d5dd",
          background: animating ? "#e85d75" : "#f7f8fa", color: animating ? "#fff" : "#2a3544",
          fontSize: 12, fontWeight: 500, cursor: "pointer",
        }}>{animating ? "Playing…" : "▶ Animate"}</button>
      </div>

      {/* Info readout */}
      <div style={{
        marginTop: 8, fontSize: 12, fontFamily: "'JetBrains Mono', monospace",
        color: "#6b7886", display: "flex", gap: 20, justifyContent: "center",
      }}>
        <span style={{ color: xtColor }}>x({currentT.toFixed(2)}) = {isFinite(curX) ? curX.toFixed(4) : "—"}</span>
        <span style={{ color: ytColor }}>y({currentT.toFixed(2)}) = {isFinite(curY) ? curY.toFixed(4) : "—"}</span>
        <span style={{ color: xyColor }}>({isFinite(curX) ? curX.toFixed(3) : "—"}, {isFinite(curY) ? curY.toFixed(3) : "—"})</span>
      </div>

      <p style={{ fontSize: 11, color: "#aab4c0", marginTop: 12, textAlign: "center", maxWidth: 500 }}>
        Use arrow keys ← → to step through t. Supports: sin, cos, tan, sqrt, log, exp, pow, abs, PI, E, asin, acos, atan, sinh, cosh, tanh.
      </p>
    </div>
  );
}
