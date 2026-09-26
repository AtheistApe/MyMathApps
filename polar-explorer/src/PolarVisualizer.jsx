import React, { useState, useMemo, useEffect, useRef } from "react";
import { evaluate, parse } from "mathjs";

export default function PolarVisualizer() {
  const [mode, setMode] = useState("r_of_theta"); // "r_of_theta" or "theta_of_r"
  const [fnStr, setFnStr] = useState("2 + 2*cos(theta)"); // cardioid default
  const [tMin, setTMin] = useState("0");
  const [tMax, setTMax] = useState("2*pi");
  const [t, setT] = useState(0); // current slider value (theta or r)
  const [showGrid, setShowGrid] = useState(true);
  const [trailMode, setTrailMode] = useState("partial"); // "full", "partial", "none"
  const [animating, setAnimating] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [error, setError] = useState(null);
  const animRef = useRef(null);

  const indepVar = mode === "r_of_theta" ? "theta" : "r";
  const depVar = mode === "r_of_theta" ? "r" : "theta";

  // Parse tMin, tMax using mathjs so users can type "2*pi", "pi/2", etc.
  const { tMinNum, tMaxNum } = useMemo(() => {
    try {
      return {
        tMinNum: evaluate(tMin),
        tMaxNum: evaluate(tMax),
      };
    } catch {
      return { tMinNum: 0, tMaxNum: 2 * Math.PI };
    }
  }, [tMin, tMax]);

  // Compile function once per change
  const compiled = useMemo(() => {
    try {
      const node = parse(fnStr);
      const code = node.compile();
      // Test evaluation
      code.evaluate({ [indepVar]: 0 });
      setError(null);
      return code;
    } catch (e) {
      setError(e.message);
      return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fnStr, indepVar]);

  const f = (x) => {
    if (!compiled) return NaN;
    try {
      const v = compiled.evaluate({ [indepVar]: x });
      return typeof v === "number" ? v : NaN;
    } catch {
      return NaN;
    }
  };

  // Reset slider when range changes
  useEffect(() => {
    if (t < tMinNum || t > tMaxNum) setT(tMinNum);
  }, [tMinNum, tMaxNum]); // eslint-disable-line

  // Reset slider to start when mode or fn changes
  useEffect(() => {
    setT(tMinNum);
    // eslint-disable-next-line
  }, [mode, fnStr]);

  // Sample the curve
  const N = 600;
  const samples = useMemo(() => {
    const pts = [];
    if (!compiled || !isFinite(tMinNum) || !isFinite(tMaxNum)) return pts;
    for (let i = 0; i <= N; i++) {
      const x = tMinNum + ((tMaxNum - tMinNum) * i) / N;
      const y = f(x);
      pts.push({ t: x, v: y });
    }
    return pts;
    // eslint-disable-next-line
  }, [compiled, tMinNum, tMaxNum, mode]);

  // Current value of dependent variable
  const currentDep = f(t);

  // For polar plot: need (x, y) for each sample
  // If mode is r_of_theta: x = r cos(theta), y = r sin(theta), theta = s.t, r = s.v
  // If mode is theta_of_r: x = r cos(theta), y = r sin(theta), r = s.t, theta = s.v
  const polarPts = useMemo(() => {
    return samples.map((s) => {
      let r, th;
      if (mode === "r_of_theta") {
        r = s.v;
        th = s.t;
      } else {
        r = s.t;
        th = s.v;
      }
      if (!isFinite(r) || !isFinite(th)) return { x: NaN, y: NaN, t: s.t };
      return { x: r * Math.cos(th), y: r * Math.sin(th), t: s.t };
    });
  }, [samples, mode]);

  // Current polar point
  const currentPolar = useMemo(() => {
    let r, th;
    if (mode === "r_of_theta") {
      r = currentDep;
      th = t;
    } else {
      r = t;
      th = currentDep;
    }
    return {
      x: isFinite(r) && isFinite(th) ? r * Math.cos(th) : NaN,
      y: isFinite(r) && isFinite(th) ? r * Math.sin(th) : NaN,
      r,
      th,
    };
  }, [t, currentDep, mode]);

  // Determine rectangular plot extents
  const rectExtent = useMemo(() => {
    const vals = samples.map((s) => s.v).filter((v) => isFinite(v));
    if (vals.length === 0) return { vMin: -1, vMax: 1 };
    let vMin = Math.min(...vals);
    let vMax = Math.max(...vals);
    if (vMin === vMax) {
      vMin -= 1;
      vMax += 1;
    }
    const pad = 0.1 * (vMax - vMin);
    return { vMin: vMin - pad, vMax: vMax + pad };
  }, [samples]);

  // Determine polar plot extents (square, symmetric)
  const polarExtent = useMemo(() => {
    const xs = polarPts.map((p) => p.x).filter((v) => isFinite(v));
    const ys = polarPts.map((p) => p.y).filter((v) => isFinite(v));
    if (xs.length === 0) return 5;
    const m = Math.max(
      Math.max(...xs.map(Math.abs)),
      Math.max(...ys.map(Math.abs))
    );
    return Math.max(m * 1.15, 1);
  }, [polarPts]);

  // Animation
  useEffect(() => {
    if (!animating) {
      if (animRef.current) cancelAnimationFrame(animRef.current);
      return;
    }
    let last = performance.now();
    const step = (now) => {
      const dt = (now - last) / 1000;
      last = now;
      setT((prev) => {
        const span = tMaxNum - tMinNum;
        const next = prev + dt * speed * span * 0.25; // ~4s per full sweep at speed=1
        if (next > tMaxNum) return tMinNum + ((next - tMinNum) % span);
        return next;
      });
      animRef.current = requestAnimationFrame(step);
    };
    animRef.current = requestAnimationFrame(step);
    return () => {
      if (animRef.current) cancelAnimationFrame(animRef.current);
    };
  }, [animating, tMinNum, tMaxNum, speed]);

  // ======== Rectangular plot ========
  const RW = 460, RH = 440;
  const rectPad = { l: 55, r: 20, t: 20, b: 45 };
  const rectPlotW = RW - rectPad.l - rectPad.r;
  const rectPlotH = RH - rectPad.t - rectPad.b;

  const xToPx = (x) =>
    rectPad.l + ((x - tMinNum) / (tMaxNum - tMinNum)) * rectPlotW;
  const yToPx = (y) =>
    rectPad.t +
    ((rectExtent.vMax - y) / (rectExtent.vMax - rectExtent.vMin)) * rectPlotH;

  // Nice tick generator
  const niceTicks = (min, max, nTicks = 6) => {
    const range = max - min;
    const rough = range / nTicks;
    const pow = Math.pow(10, Math.floor(Math.log10(rough)));
    const norm = rough / pow;
    let step;
    if (norm < 1.5) step = 1 * pow;
    else if (norm < 3) step = 2 * pow;
    else if (norm < 7) step = 5 * pow;
    else step = 10 * pow;
    const ticks = [];
    const start = Math.ceil(min / step) * step;
    for (let v = start; v <= max + 1e-9; v += step) ticks.push(v);
    return ticks;
  };

  // π-aware ticks for angle axis
  const piTicks = (min, max) => {
    // find multiples of pi/6, pi/4, pi/2, pi
    const candidates = [Math.PI / 6, Math.PI / 4, Math.PI / 3, Math.PI / 2, Math.PI, 2 * Math.PI];
    const range = max - min;
    let step = Math.PI / 2;
    for (const c of candidates) {
      if (range / c <= 10 && range / c >= 3) {
        step = c;
        break;
      }
    }
    // fallback: if range is very large, use multiples of pi
    if (range / step > 12) step = Math.PI * Math.ceil(range / (12 * Math.PI));
    const ticks = [];
    const start = Math.ceil(min / step) * step;
    for (let v = start; v <= max + 1e-9; v += step) ticks.push(v);
    return { ticks, step };
  };

  const formatPi = (v, step) => {
    // Represent as fraction of pi
    const r = v / Math.PI;
    if (Math.abs(r) < 1e-9) return "0";
    // Try simple fractions
    for (const den of [1, 2, 3, 4, 6, 8, 12]) {
      const num = r * den;
      if (Math.abs(num - Math.round(num)) < 1e-6) {
        const n = Math.round(num);
        if (den === 1) {
          if (n === 1) return "π";
          if (n === -1) return "-π";
          return `${n}π`;
        }
        if (n === 1) return `π/${den}`;
        if (n === -1) return `-π/${den}`;
        return `${n}π/${den}`;
      }
    }
    return v.toFixed(2);
  };

  const indepIsAngle = mode === "r_of_theta";
  const depIsAngle = mode === "theta_of_r";

  // Horizontal axis of rect plot = independent variable
  const xTicks = indepIsAngle
    ? piTicks(tMinNum, tMaxNum)
    : { ticks: niceTicks(tMinNum, tMaxNum, 6), step: null };
  // Vertical axis of rect plot = dependent variable
  const yTicks = depIsAngle
    ? piTicks(rectExtent.vMin, rectExtent.vMax)
    : { ticks: niceTicks(rectExtent.vMin, rectExtent.vMax, 6), step: null };

  // Build rect curve path, breaking on NaN
  const rectPath = useMemo(() => {
    let d = "";
    let pen = false;
    for (const s of samples) {
      if (!isFinite(s.v)) {
        pen = false;
        continue;
      }
      const px = xToPx(s.t);
      const py = yToPx(s.v);
      if (!isFinite(py)) {
        pen = false;
        continue;
      }
      // Clip to plot area
      if (py < rectPad.t - 50 || py > rectPad.t + rectPlotH + 50) {
        pen = false;
        continue;
      }
      d += (pen ? " L" : " M") + px.toFixed(2) + "," + py.toFixed(2);
      pen = true;
    }
    return d;
    // eslint-disable-next-line
  }, [samples, tMinNum, tMaxNum, rectExtent]);

  // Partial trail on rect plot up to current t
  const rectTrailPath = useMemo(() => {
    if (trailMode !== "partial") return "";
    let d = "";
    let pen = false;
    for (const s of samples) {
      if (s.t > t) break;
      if (!isFinite(s.v)) {
        pen = false;
        continue;
      }
      const px = xToPx(s.t);
      const py = yToPx(s.v);
      d += (pen ? " L" : " M") + px.toFixed(2) + "," + py.toFixed(2);
      pen = true;
    }
    return d;
    // eslint-disable-next-line
  }, [samples, t, trailMode, tMinNum, tMaxNum, rectExtent]);

  // ======== Polar plot ========
  const PW = 460, PH = 440;
  const pPad = 25;
  const pSize = Math.min(PW, PH) - 2 * pPad;
  const cx = PW / 2;
  const cy = PH / 2;
  const pScale = pSize / (2 * polarExtent);

  const pxOf = (x) => cx + x * pScale;
  const pyOf = (y) => cy - y * pScale;

  const polarPath = useMemo(() => {
    let d = "";
    let pen = false;
    for (const p of polarPts) {
      if (!isFinite(p.x) || !isFinite(p.y)) {
        pen = false;
        continue;
      }
      const px = pxOf(p.x);
      const py = pyOf(p.y);
      d += (pen ? " L" : " M") + px.toFixed(2) + "," + py.toFixed(2);
      pen = true;
    }
    return d;
    // eslint-disable-next-line
  }, [polarPts, polarExtent]);

  const polarTrailPath = useMemo(() => {
    if (trailMode !== "partial") return "";
    let d = "";
    let pen = false;
    for (const p of polarPts) {
      if (p.t > t) break;
      if (!isFinite(p.x) || !isFinite(p.y)) {
        pen = false;
        continue;
      }
      const px = pxOf(p.x);
      const py = pyOf(p.y);
      d += (pen ? " L" : " M") + px.toFixed(2) + "," + py.toFixed(2);
      pen = true;
    }
    return d;
    // eslint-disable-next-line
  }, [polarPts, t, trailMode, polarExtent]);

  // Radial grid: circles at nice r values
  const polarRTicks = niceTicks(0, polarExtent, 5).filter((r) => r > 0);
  // Angular grid: every 30°
  const angTicks = [];
  for (let k = 0; k < 12; k++) angTicks.push((k * Math.PI) / 6);

  // Axis labels
  const xAxisLabel = indepIsAngle ? "θ" : "r";
  const yAxisLabel = depIsAngle ? "θ" : "r";

  const presets = [
    { name: "Cardioid", mode: "r_of_theta", fn: "2 + 2*cos(theta)", min: "0", max: "2*pi" },
    { name: "Limaçon (inner loop)", mode: "r_of_theta", fn: "1 + 2*cos(theta)", min: "0", max: "2*pi" },
    { name: "Rose (4 petals)", mode: "r_of_theta", fn: "3*cos(2*theta)", min: "0", max: "2*pi" },
    { name: "Rose (5 petals)", mode: "r_of_theta", fn: "3*sin(5*theta)", min: "0", max: "pi" },
    { name: "Lemniscate", mode: "r_of_theta", fn: "sqrt(abs(9*cos(2*theta)))", min: "0", max: "2*pi" },
    { name: "Archimedean spiral", mode: "r_of_theta", fn: "0.3*theta", min: "0", max: "6*pi" },
    { name: "Circle r=3", mode: "r_of_theta", fn: "3", min: "0", max: "2*pi" },
    { name: "Circle r=4sin(θ)", mode: "r_of_theta", fn: "4*sin(theta)", min: "0", max: "pi" },
    { name: "θ = r/2 (spiral)", mode: "theta_of_r", fn: "r/2", min: "0", max: "10" },
  ];

  const applyPreset = (p) => {
    setMode(p.mode);
    setFnStr(p.fn);
    setTMin(p.min);
    setTMax(p.max);
  };

  // Format current values
  const fmt = (v) => (isFinite(v) ? v.toFixed(3) : "—");

  return (
    <div className="w-full min-h-screen bg-slate-50 p-4">
      <div className="max-w-7xl mx-auto">
        <div className="mb-3">
          <h1 className="text-2xl font-semibold text-slate-800">
            Polar Curve Explorer
          </h1>
          <p className="text-sm text-slate-600">
            Connecting rectangular <span className="italic">{indepIsAngle ? "r vs θ" : "θ vs r"}</span> plots to polar curves
          </p>
        </div>

        {/* Controls */}
        <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-4 mb-4">
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
                placeholder={mode === "r_of_theta" ? "e.g. 2+2*cos(theta)" : "e.g. r/2"}
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

          {error && (
            <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1 mb-2">
              {error}
            </div>
          )}

          <div className="flex flex-wrap gap-2 mb-3">
            <span className="text-xs text-slate-500 self-center mr-1">Presets:</span>
            {presets.map((p) => (
              <button
                key={p.name}
                onClick={() => applyPreset(p)}
                className="px-2 py-1 text-xs bg-slate-100 hover:bg-indigo-100 text-slate-700 rounded border border-slate-200"
              >
                {p.name}
              </button>
            ))}
          </div>

          {/* Slider */}
          <div className="flex items-center gap-3">
            <div className="text-sm font-mono text-slate-700 w-16">
              {indepVar} =
            </div>
            <input
              type="range"
              min={tMinNum}
              max={tMaxNum}
              step={(tMaxNum - tMinNum) / 1000}
              value={t}
              onChange={(e) => setT(parseFloat(e.target.value))}
              className="flex-1 accent-indigo-600"
            />
            <div className="font-mono text-sm text-slate-800 w-24 text-right tabular-nums">
              {indepIsAngle ? formatPi(t, null) + " ≈ " + t.toFixed(2) : t.toFixed(3)}
            </div>
            <button
              onClick={() => setAnimating((a) => !a)}
              className="px-3 py-1.5 text-sm bg-indigo-600 text-white rounded hover:bg-indigo-700"
            >
              {animating ? "Pause" : "Play"}
            </button>
            <select
              value={speed}
              onChange={(e) => setSpeed(parseFloat(e.target.value))}
              className="text-sm border border-slate-300 rounded px-1 py-1"
            >
              <option value={0.25}>0.25×</option>
              <option value={0.5}>0.5×</option>
              <option value={1}>1×</option>
              <option value={2}>2×</option>
              <option value={4}>4×</option>
            </select>
          </div>

          {/* Display options */}
          <div className="flex flex-wrap gap-4 mt-3 text-sm">
            <label className="flex items-center gap-1">
              <input type="checkbox" checked={showGrid} onChange={(e) => setShowGrid(e.target.checked)} />
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
            <div className="ml-auto font-mono text-xs text-slate-600">
              ({indepVar}, {depVar}) = ({fmt(t)}, {fmt(currentDep)}) &nbsp;→&nbsp;
              (x, y) = ({fmt(currentPolar.x)}, {fmt(currentPolar.y)})
            </div>
          </div>
        </div>

        {/* Plots */}
        <div className="grid grid-cols-2 gap-4">
          {/* Rectangular plot */}
          <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-3">
            <div className="text-sm font-medium text-slate-700 mb-1 text-center">
              Rectangular plot: {yAxisLabel} vs {xAxisLabel}
            </div>
            <svg viewBox={`0 0 ${RW} ${RH}`} className="w-full h-auto">
              {/* Plot area background */}
              <rect
                x={rectPad.l}
                y={rectPad.t}
                width={rectPlotW}
                height={rectPlotH}
                fill="#fafbfc"
                stroke="#cbd5e1"
              />

              {/* Grid */}
              {showGrid &&
                xTicks.ticks.map((v, i) => (
                  <line
                    key={`xg${i}`}
                    x1={xToPx(v)}
                    x2={xToPx(v)}
                    y1={rectPad.t}
                    y2={rectPad.t + rectPlotH}
                    stroke="#e2e8f0"
                  />
                ))}
              {showGrid &&
                yTicks.ticks.map((v, i) => (
                  <line
                    key={`yg${i}`}
                    x1={rectPad.l}
                    x2={rectPad.l + rectPlotW}
                    y1={yToPx(v)}
                    y2={yToPx(v)}
                    stroke="#e2e8f0"
                  />
                ))}

              {/* Zero lines */}
              {rectExtent.vMin < 0 && rectExtent.vMax > 0 && (
                <line
                  x1={rectPad.l}
                  x2={rectPad.l + rectPlotW}
                  y1={yToPx(0)}
                  y2={yToPx(0)}
                  stroke="#94a3b8"
                  strokeWidth="1"
                />
              )}
              {tMinNum < 0 && tMaxNum > 0 && (
                <line
                  x1={xToPx(0)}
                  x2={xToPx(0)}
                  y1={rectPad.t}
                  y2={rectPad.t + rectPlotH}
                  stroke="#94a3b8"
                  strokeWidth="1"
                />
              )}

              {/* Ticks and labels */}
              {xTicks.ticks.map((v, i) => (
                <g key={`xt${i}`}>
                  <line
                    x1={xToPx(v)}
                    x2={xToPx(v)}
                    y1={rectPad.t + rectPlotH}
                    y2={rectPad.t + rectPlotH + 4}
                    stroke="#475569"
                  />
                  <text
                    x={xToPx(v)}
                    y={rectPad.t + rectPlotH + 16}
                    textAnchor="middle"
                    fontSize="11"
                    fill="#475569"
                    fontFamily="ui-monospace, monospace"
                  >
                    {indepIsAngle ? formatPi(v) : v.toFixed(v % 1 === 0 ? 0 : 2)}
                  </text>
                </g>
              ))}
              {yTicks.ticks.map((v, i) => (
                <g key={`yt${i}`}>
                  <line
                    x1={rectPad.l - 4}
                    x2={rectPad.l}
                    y1={yToPx(v)}
                    y2={yToPx(v)}
                    stroke="#475569"
                  />
                  <text
                    x={rectPad.l - 6}
                    y={yToPx(v) + 4}
                    textAnchor="end"
                    fontSize="11"
                    fill="#475569"
                    fontFamily="ui-monospace, monospace"
                  >
                    {depIsAngle ? formatPi(v) : v.toFixed(v % 1 === 0 ? 0 : 2)}
                  </text>
                </g>
              ))}

              {/* Axis labels */}
              <text
                x={rectPad.l + rectPlotW / 2}
                y={RH - 8}
                textAnchor="middle"
                fontSize="14"
                fontStyle="italic"
                fill="#334155"
              >
                {xAxisLabel}
              </text>
              <text
                x={15}
                y={rectPad.t + rectPlotH / 2}
                textAnchor="middle"
                fontSize="14"
                fontStyle="italic"
                fill="#334155"
                transform={`rotate(-90 15 ${rectPad.t + rectPlotH / 2})`}
              >
                {yAxisLabel}
              </text>

              {/* Full curve */}
              {trailMode !== "none" && (
                <path
                  d={rectPath}
                  fill="none"
                  stroke={trailMode === "partial" ? "#cbd5e1" : "#4f46e5"}
                  strokeWidth="2"
                />
              )}
              {/* Partial trail (drawn portion) */}
              {trailMode === "partial" && (
                <path
                  d={rectTrailPath}
                  fill="none"
                  stroke="#4f46e5"
                  strokeWidth="2.5"
                />
              )}

              {/* Guide lines to current point */}
              {isFinite(currentDep) && (
                <>
                  <line
                    x1={xToPx(t)}
                    x2={xToPx(t)}
                    y1={rectPad.t + rectPlotH}
                    y2={yToPx(currentDep)}
                    stroke="#dc2626"
                    strokeWidth="1"
                    strokeDasharray="3 3"
                  />
                  <line
                    x1={rectPad.l}
                    x2={xToPx(t)}
                    y1={yToPx(currentDep)}
                    y2={yToPx(currentDep)}
                    stroke="#dc2626"
                    strokeWidth="1"
                    strokeDasharray="3 3"
                  />
                  <circle
                    cx={xToPx(t)}
                    cy={yToPx(currentDep)}
                    r="5"
                    fill="#dc2626"
                    stroke="white"
                    strokeWidth="1.5"
                  />
                </>
              )}
            </svg>
          </div>

          {/* Polar plot */}
          <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-3">
            <div className="text-sm font-medium text-slate-700 mb-1 text-center">
              Polar plot: points (r, θ) in the plane
            </div>
            <svg viewBox={`0 0 ${PW} ${PH}`} className="w-full h-auto">
              {/* Radial circles */}
              {showGrid &&
                polarRTicks.map((r, i) => (
                  <circle
                    key={`rc${i}`}
                    cx={cx}
                    cy={cy}
                    r={r * pScale}
                    fill="none"
                    stroke="#e2e8f0"
                  />
                ))}
              {/* Angular lines */}
              {showGrid &&
                angTicks.map((a, i) => (
                  <line
                    key={`al${i}`}
                    x1={cx}
                    y1={cy}
                    x2={cx + polarExtent * pScale * Math.cos(a)}
                    y2={cy - polarExtent * pScale * Math.sin(a)}
                    stroke="#e2e8f0"
                  />
                ))}

              {/* Radial tick labels */}
              {showGrid &&
                polarRTicks.map((r, i) => (
                  <text
                    key={`rt${i}`}
                    x={cx + r * pScale + 3}
                    y={cy - 3}
                    fontSize="10"
                    fill="#64748b"
                    fontFamily="ui-monospace, monospace"
                  >
                    {r.toFixed(r % 1 === 0 ? 0 : 1)}
                  </text>
                ))}

              {/* Angle labels at standard positions */}
              {showGrid &&
                [
                  { a: 0, label: "0" },
                  { a: Math.PI / 2, label: "π/2" },
                  { a: Math.PI, label: "π" },
                  { a: (3 * Math.PI) / 2, label: "3π/2" },
                ].map((d, i) => (
                  <text
                    key={`alab${i}`}
                    x={cx + (polarExtent * pScale + 12) * Math.cos(d.a)}
                    y={cy - (polarExtent * pScale + 12) * Math.sin(d.a) + 4}
                    fontSize="11"
                    fill="#64748b"
                    textAnchor="middle"
                  >
                    {d.label}
                  </text>
                ))}

              {/* Main axes */}
              <line x1={pPad} y1={cy} x2={PW - pPad} y2={cy} stroke="#94a3b8" />
              <line x1={cx} y1={pPad} x2={cx} y2={PH - pPad} stroke="#94a3b8" />

              {/* Full polar curve */}
              {trailMode !== "none" && (
                <path
                  d={polarPath}
                  fill="none"
                  stroke={trailMode === "partial" ? "#cbd5e1" : "#4f46e5"}
                  strokeWidth="2"
                />
              )}
              {trailMode === "partial" && (
                <path
                  d={polarTrailPath}
                  fill="none"
                  stroke="#4f46e5"
                  strokeWidth="2.5"
                />
              )}

              {/* Current angle ray and radius arc */}
              {isFinite(currentPolar.x) && isFinite(currentPolar.y) && (
                <>
                  {/* Angle arc from positive x-axis to terminal side, with fill tint */}
                  {(() => {
                    const th = currentPolar.th;
                    const rArc = 32;
                    const sweep = th >= 0 ? 0 : 1; // SVG y-axis flipped
                    const endX = cx + rArc * Math.cos(th);
                    const endY = cy - rArc * Math.sin(th);
                    const largeArc = Math.abs(th) > Math.PI ? 1 : 0;
                    return (
                      <g>
                        {/* Filled wedge to emphasize the swept angle region */}
                        <path
                          d={`M ${cx} ${cy} L ${cx + rArc} ${cy} A ${rArc} ${rArc} 0 ${largeArc} ${sweep} ${endX} ${endY} Z`}
                          fill="#f59e0b"
                          fillOpacity="0.18"
                        />
                        {/* Arc stroke */}
                        <path
                          d={`M ${cx + rArc} ${cy} A ${rArc} ${rArc} 0 ${largeArc} ${sweep} ${endX} ${endY}`}
                          fill="none"
                          stroke="#d97706"
                          strokeWidth="3"
                        />
                      </g>
                    );
                  })()}

                  {/* Extension of terminal side (opposite ray): green dashed — only meaningful when r < 0 */}
                  <line
                    x1={cx}
                    y1={cy}
                    x2={cx + polarExtent * pScale * Math.cos(currentPolar.th + Math.PI)}
                    y2={cy - polarExtent * pScale * Math.sin(currentPolar.th + Math.PI)}
                    stroke="#059669"
                    strokeWidth="2.5"
                    strokeDasharray="8 5"
                  />

                  {/* Terminal side of angle θ: solid, emphasized — always the star of the show */}
                  <line
                    x1={cx}
                    y1={cy}
                    x2={cx + polarExtent * pScale * Math.cos(currentPolar.th)}
                    y2={cy - polarExtent * pScale * Math.sin(currentPolar.th)}
                    stroke="#d97706"
                    strokeWidth="3.5"
                  />

                  {/* Radius segment from origin to the actual point.
                      Color matches which ray it lies on: amber (terminal side) if r>0,
                      green (extension) if r<0. Drawn on top of the ray to emphasize it. */}
                  <line
                    x1={cx}
                    y1={cy}
                    x2={pxOf(currentPolar.x)}
                    y2={pyOf(currentPolar.y)}
                    stroke={currentPolar.r >= 0 ? "#b45309" : "#047857"}
                    strokeWidth="4.5"
                  />

                  {/* Origin dot */}
                  <circle cx={cx} cy={cy} r="3" fill="#475569" />

                  {/* Current point */}
                  <circle
                    cx={pxOf(currentPolar.x)}
                    cy={pyOf(currentPolar.y)}
                    r="6"
                    fill="#dc2626"
                    stroke="white"
                    strokeWidth="1.5"
                  />

                  {/* r label on radius */}
                  {isFinite(currentPolar.r) && Math.abs(currentPolar.r) > 0.1 && (
                    <text
                      x={(cx + pxOf(currentPolar.x)) / 2 + 8}
                      y={(cy + pyOf(currentPolar.y)) / 2 - 6}
                      fontSize="12"
                      fill="#dc2626"
                      fontFamily="ui-monospace, monospace"
                      fontWeight="600"
                    >
                      r = {currentPolar.r.toFixed(2)}
                    </text>
                  )}

                  {/* theta label near arc */}
                  <text
                    x={cx + 42 * Math.cos(currentPolar.th / 2)}
                    y={cy - 42 * Math.sin(currentPolar.th / 2) + 4}
                    fontSize="13"
                    fill="#b45309"
                    fontFamily="ui-monospace, monospace"
                    fontWeight="700"
                  >
                    θ
                  </text>
                </>
              )}
            </svg>
          </div>
        </div>

        <div className="mt-3 text-xs text-slate-500 bg-white rounded border border-slate-200 p-2">
          <strong className="text-slate-700">Teaching tip:</strong> Press <em>Play</em>
          {" "}and watch how the moving red point on the rectangular plot (where the height is <em>r</em>)
          corresponds to the orange terminal side sweeping around the polar plot at angle θ. When
          r &gt; 0 the point lies on the <em>solid</em> ray at distance r; when r &lt; 0 it jumps
          to the <em>dashed</em> extension at distance |r| on the opposite side of the origin.
        </div>
      </div>
    </div>
  );
}
