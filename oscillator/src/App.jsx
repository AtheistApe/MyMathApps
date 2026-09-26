import { useState, useEffect, useRef, useCallback } from "react";
import { Play, Pause, RotateCcw } from "lucide-react";

function Slider({ label, value, onChange, min, max, step, unit, disabled }) {
  return (
    <div className="slider-group">
      <div className="slider-label">
        <span className="slider-name">{label}</span>
        <span className="slider-value">{value.toFixed(2)} <span className="slider-unit">{unit}</span></span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="slider"
      />
    </div>
  );
}

export default function HarmonicOscillator() {
  // Parameters
  const [mass, setMass] = useState(1.0);
  const [k, setK] = useState(4.0);
  const [muS, setMuS] = useState(0.0);
  const [muK, setMuK] = useState(0.0);
  const [x0, setX0] = useState(2.0);
  const [v0, setV0] = useState(0.0);

  // Simulation state
  const [running, setRunning] = useState(false);
  const [x, setX] = useState(2.0);
  const [v, setV] = useState(0.0);
  const [t, setT] = useState(0);
  const [history, setHistory] = useState([{ t: 0, x: 2.0 }]);

  const g = 9.81;
  const animRef = useRef(null);
  const lastFrameRef = useRef(null);
  const stateRef = useRef({ x: 2.0, v: 0.0, t: 0, stuck: false });

  // Derivative function: returns dv/dt given current state
  // Handles kinetic friction; static handled separately
  const accel = useCallback((xVal, vVal) => {
    const springForce = -k * xVal;
    if (Math.abs(vVal) < 1e-6) {
      // At rest — check if static friction holds
      const maxStatic = muS * mass * g;
      if (Math.abs(springForce) <= maxStatic) return 0;
      // About to break free — kinetic friction opposes impending motion
      const dir = Math.sign(springForce);
      return (springForce - muK * mass * g * dir) / mass;
    }
    // Moving — kinetic friction opposes velocity
    const friction = -muK * mass * g * Math.sign(vVal);
    return (springForce + friction) / mass;
  }, [k, mass, muS, muK]);

  // RK4 step
  const step = useCallback((xVal, vVal, dt) => {
    const a1 = accel(xVal, vVal);
    const k1x = vVal;
    const k1v = a1;

    const a2 = accel(xVal + 0.5 * dt * k1x, vVal + 0.5 * dt * k1v);
    const k2x = vVal + 0.5 * dt * k1v;
    const k2v = a2;

    const a3 = accel(xVal + 0.5 * dt * k2x, vVal + 0.5 * dt * k2v);
    const k3x = vVal + 0.5 * dt * k2v;
    const k3v = a3;

    const a4 = accel(xVal + dt * k3x, vVal + dt * k3v);
    const k4x = vVal + dt * k3v;
    const k4v = a4;

    const newX = xVal + (dt / 6) * (k1x + 2 * k2x + 2 * k3x + k4x);
    const newV = vVal + (dt / 6) * (k1v + 2 * k2v + 2 * k3v + k4v);
    return [newX, newV];
  }, [accel]);

  // Animation loop
  useEffect(() => {
    if (!running) {
      lastFrameRef.current = null;
      return;
    }

    const tick = (timestamp) => {
      if (lastFrameRef.current === null) {
        lastFrameRef.current = timestamp;
        animRef.current = requestAnimationFrame(tick);
        return;
      }

      const realDt = Math.min((timestamp - lastFrameRef.current) / 1000, 0.05);
      lastFrameRef.current = timestamp;

      const subSteps = 8;
      const dt = realDt / subSteps;

      let { x: cx, v: cv, t: ct, stuck } = stateRef.current;

      for (let i = 0; i < subSteps; i++) {
        // Check stick condition before each substep
        const springForce = -k * cx;
        const maxStatic = muS * mass * g;
        const speedThresh = 0.01;

        if (Math.abs(cv) < speedThresh && Math.abs(springForce) <= maxStatic) {
          cv = 0;
          stuck = true;
        } else {
          stuck = false;
        }

        if (!stuck) {
          const [newX, newV] = step(cx, cv, dt);

          // Detect zero-crossing of velocity to check for sticking after step
          if (Math.sign(newV) !== Math.sign(cv) && cv !== 0) {
            // Velocity changed sign — block momentarily at rest
            const stopX = cx + (cv * dt) / 2; // approximate stopping position
            const stopSpring = -k * stopX;
            if (Math.abs(stopSpring) <= maxStatic) {
              cx = stopX;
              cv = 0;
              stuck = true;
            } else {
              cx = newX;
              cv = newV;
            }
          } else {
            cx = newX;
            cv = newV;
          }
        }

        ct += dt;
      }

      stateRef.current = { x: cx, v: cv, t: ct, stuck };
      setX(cx);
      setV(cv);
      setT(ct);
      setHistory((h) => {
        const newPoint = { t: ct, x: cx };
        // Cap history length and keep a rolling 12-second window
        const cutoff = ct - 12;
        const filtered = h.length > 0 && h[h.length - 1].t > ct ? [] : h;
        const updated = [...filtered, newPoint].filter((p) => p.t >= cutoff);
        return updated;
      });

      animRef.current = requestAnimationFrame(tick);
    };

    animRef.current = requestAnimationFrame(tick);
    return () => {
      if (animRef.current) cancelAnimationFrame(animRef.current);
    };
  }, [running, step, k, mass, muS, g]);

  // Reset
  const reset = () => {
    setRunning(false);
    setX(x0);
    setV(v0);
    setT(0);
    setHistory([{ t: 0, x: x0 }]);
    stateRef.current = { x: x0, v: v0, t: 0, stuck: false };
  };

  // When initial conditions change while paused, update display
  useEffect(() => {
    if (!running) {
      setX(x0);
      setV(v0);
      setT(0);
      setHistory([{ t: 0, x: x0 }]);
      stateRef.current = { x: x0, v: v0, t: 0, stuck: false };
    }
  }, [x0, v0, running]);

  // Energy
  const KE = 0.5 * mass * v * v;
  const PE = 0.5 * k * x * x;
  const E = KE + PE;

  // SVG geometry — wider physical range to accommodate large oscillations
  const sceneW = 720;
  const sceneH = 270;
  const equilibriumPx = sceneW * 0.62; // equilibrium position on screen
  const wallX = 60;
  const tableY = 180;
  const blockSize = 56;
  const pxPerMeter = 55;

  const blockX = equilibriumPx + x * pxPerMeter;
  const springStart = wallX + 8;
  const springEnd = blockX - blockSize / 2;
  const springLen = springEnd - springStart;

  // Spring coils
  const coils = 14;
  const coilAmp = 14;
  const springPath = (() => {
    if (springLen < 10) return `M ${springStart} ${tableY - blockSize / 2} L ${springEnd} ${tableY - blockSize / 2}`;
    const cy = tableY - blockSize / 2;
    let path = `M ${springStart} ${cy} L ${springStart + 10} ${cy}`;
    const coilSpan = springLen - 20;
    const segLen = coilSpan / (coils * 2);
    for (let i = 0; i < coils * 2; i++) {
      const xPos = springStart + 10 + (i + 0.5) * segLen;
      const yPos = cy + (i % 2 === 0 ? -coilAmp : coilAmp);
      path += ` L ${xPos} ${yPos}`;
    }
    path += ` L ${springEnd - 10} ${cy} L ${springEnd} ${cy}`;
    return path;
  })();

  // Graph geometry
  const graphW = 720;
  const graphH = 240;
  const graphPad = { top: 20, right: 20, bottom: 50, left: 70 };
  const plotW = graphW - graphPad.left - graphPad.right;
  const plotH = graphH - graphPad.top - graphPad.bottom;

  const tWindow = 12;
  const tMin = Math.max(0, t - tWindow);
  const tMax = tMin + tWindow;
  const xRange = Math.max(Math.abs(x0) * 1.5, 3, Math.abs(x) * 1.2);

  const tToPx = (tv) => graphPad.left + ((tv - tMin) / (tMax - tMin)) * plotW;
  const xToPx = (xv) => graphPad.top + plotH / 2 - (xv / xRange) * (plotH / 2);

  const trajectoryPath = history.length > 1
    ? "M " + history.map((p) => `${tToPx(p.t).toFixed(2)} ${xToPx(p.x).toFixed(2)}`).join(" L ")
    : "";

  return (
    <div className="oscillator-root">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600;9..144,700&family=JetBrains+Mono:wght@400;500&display=swap');

        .oscillator-root {
          --bg: #f4f1ea;
          --paper: #faf8f3;
          --ink: #1a1410;
          --ink-soft: #5c554c;
          --ink-faint: #a39c92;
          --rule: #d8d2c5;
          --accent: #8b1a1a;
          --accent-soft: #c14545;
          --spring: #2a4a3a;
          --block: #1a1410;
          --table: #c9bfa8;
          --grid: #e8e2d3;
          --plot: #1a1410;
          --marker: #8b1a1a;

          font-family: 'Fraunces', Georgia, serif;
          color: var(--ink);
          background: var(--bg);
          padding: 28px 24px;
          min-height: 100vh;
          box-sizing: border-box;
        }

        .oscillator-root * { box-sizing: border-box; }

        .container {
          max-width: 1180px;
          margin: 0 auto;
        }

        .header {
          display: flex;
          align-items: baseline;
          justify-content: space-between;
          padding-bottom: 14px;
          border-bottom: 1px solid var(--ink);
          margin-bottom: 4px;
        }

        .title {
          font-size: 32px;
          font-weight: 600;
          letter-spacing: -0.02em;
          margin: 0;
          font-style: italic;
        }

        .subtitle {
          font-family: 'JetBrains Mono', monospace;
          font-size: 11px;
          letter-spacing: 0.15em;
          text-transform: uppercase;
          color: var(--ink-soft);
        }

        .meta-row {
          display: flex;
          justify-content: space-between;
          font-family: 'JetBrains Mono', monospace;
          font-size: 10px;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          color: var(--ink-faint);
          padding: 6px 0 22px;
          border-bottom: 2px solid var(--ink);
        }

        .layout {
          display: grid;
          grid-template-columns: 1fr 320px;
          gap: 28px;
          margin-top: 22px;
        }

        @media (max-width: 960px) {
          .layout { grid-template-columns: 1fr; }
        }

        .scene-card, .graph-card {
          background: var(--paper);
          border: 1px solid var(--rule);
          padding: 18px;
          position: relative;
        }

        .card-label {
          font-family: 'JetBrains Mono', monospace;
          font-size: 10px;
          letter-spacing: 0.18em;
          text-transform: uppercase;
          color: var(--ink-soft);
          margin-bottom: 10px;
          display: flex;
          justify-content: space-between;
        }

        .scene-svg, .graph-svg {
          display: block;
          width: 100%;
          height: auto;
        }

        .controls-bar {
          display: flex;
          gap: 10px;
          margin-top: 14px;
          padding-top: 14px;
          border-top: 1px dashed var(--rule);
        }

        .btn {
          font-family: 'JetBrains Mono', monospace;
          font-size: 11px;
          letter-spacing: 0.15em;
          text-transform: uppercase;
          padding: 10px 18px;
          border: 1px solid var(--ink);
          background: var(--paper);
          color: var(--ink);
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          gap: 8px;
          transition: all 0.15s ease;
        }

        .btn:hover { background: var(--ink); color: var(--paper); }
        .btn-primary { background: var(--ink); color: var(--paper); }
        .btn-primary:hover { background: var(--accent); border-color: var(--accent); }

        .readout {
          margin-left: auto;
          display: flex;
          gap: 18px;
          align-items: center;
          font-family: 'JetBrains Mono', monospace;
          font-size: 11px;
          color: var(--ink-soft);
        }

        .readout-item .v { color: var(--ink); font-weight: 500; }

        .panel {
          background: var(--paper);
          border: 1px solid var(--rule);
          padding: 20px 18px;
        }

        .panel-title {
          font-family: 'JetBrains Mono', monospace;
          font-size: 10px;
          letter-spacing: 0.18em;
          text-transform: uppercase;
          color: var(--ink-soft);
          margin: 0 0 4px;
        }

        .panel-section {
          padding: 14px 0;
          border-bottom: 1px dashed var(--rule);
        }
        .panel-section:last-child { border-bottom: none; padding-bottom: 0; }
        .panel-section:first-of-type { padding-top: 8px; }

        .section-heading {
          font-size: 14px;
          font-weight: 600;
          font-style: italic;
          margin: 0 0 10px;
          letter-spacing: -0.01em;
        }

        .slider-group {
          margin-bottom: 12px;
        }
        .slider-group:last-child { margin-bottom: 0; }

        .slider-label {
          display: flex;
          justify-content: space-between;
          align-items: baseline;
          font-family: 'JetBrains Mono', monospace;
          font-size: 11px;
          margin-bottom: 6px;
          color: var(--ink-soft);
        }

        .slider-name { letter-spacing: 0.05em; }
        .slider-value { color: var(--ink); font-weight: 500; }
        .slider-unit { color: var(--ink-faint); font-size: 10px; }

        .slider {
          -webkit-appearance: none;
          appearance: none;
          width: 100%;
          height: 2px;
          background: var(--rule);
          outline: none;
          cursor: pointer;
        }
        .slider:disabled { opacity: 0.4; cursor: not-allowed; }

        .slider::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 14px;
          height: 14px;
          background: var(--ink);
          border-radius: 50%;
          cursor: pointer;
          border: 2px solid var(--paper);
          box-shadow: 0 0 0 1px var(--ink);
        }

        .slider::-moz-range-thumb {
          width: 14px;
          height: 14px;
          background: var(--ink);
          border-radius: 50%;
          cursor: pointer;
          border: 2px solid var(--paper);
          box-shadow: 0 0 0 1px var(--ink);
        }

        .energy-grid {
          display: grid;
          grid-template-columns: 1fr 1fr 1fr;
          gap: 8px;
          font-family: 'JetBrains Mono', monospace;
          font-size: 11px;
        }
        .energy-cell {
          padding: 6px 8px;
          background: var(--bg);
          border-left: 2px solid var(--ink);
        }
        .energy-cell .label { color: var(--ink-faint); font-size: 9px; letter-spacing: 0.1em; }
        .energy-cell .val { color: var(--ink); font-weight: 500; }

        .equation {
          font-family: 'Fraunces', serif;
          font-style: italic;
          font-size: 15px;
          text-align: center;
          padding: 6px 0;
          color: var(--ink);
        }

        .stuck-badge {
          display: inline-block;
          font-family: 'JetBrains Mono', monospace;
          font-size: 9px;
          letter-spacing: 0.15em;
          text-transform: uppercase;
          color: var(--accent);
          padding: 2px 6px;
          border: 1px solid var(--accent);
          margin-left: 8px;
        }
      `}</style>

      <div className="container">
        <div className="header">
          <h1 className="title">The Harmonic Oscillator</h1>
          <div className="subtitle">Math 252 · Differential Equations</div>
        </div>
        <div className="meta-row">
          <span>m·ẍ + μₖ·m·g·sgn(ẋ) + k·x = 0</span>
          <span>Spring · Mass · Friction · Time</span>
        </div>

        <div className="layout">
          <div>
            <div className="scene-card">
              <div className="card-label">
                <span>Fig. I — Block on Table</span>
                <span>x = {x.toFixed(3)} m {stateRef.current.stuck && running ? <span className="stuck-badge">static</span> : null}</span>
              </div>

              <svg viewBox={`0 0 ${sceneW} ${sceneH}`} className="scene-svg">
                <defs>
                  <pattern id="hatch" patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">
                    <line x1="0" y1="0" x2="0" y2="6" stroke="var(--ink-soft)" strokeWidth="1" />
                  </pattern>
                  <pattern id="tableHatch" patternUnits="userSpaceOnUse" width="8" height="8" patternTransform="rotate(45)">
                    <line x1="0" y1="0" x2="0" y2="8" stroke="var(--ink-soft)" strokeWidth="0.5" opacity="0.4" />
                  </pattern>
                </defs>

                {/* Ceiling/upper bound rule */}
                <line x1="0" y1="20" x2={sceneW} y2="20" stroke="var(--ink)" strokeWidth="0.5" opacity="0.3" />

                {/* Equilibrium line */}
                <line
                  x1={equilibriumPx}
                  y1={tableY - blockSize - 30}
                  x2={equilibriumPx}
                  y2={tableY + 12}
                  stroke="var(--accent)"
                  strokeWidth="0.5"
                  strokeDasharray="2 3"
                  opacity="0.7"
                />
                <text
                  x={equilibriumPx}
                  y={tableY - blockSize - 36}
                  textAnchor="middle"
                  fontFamily="JetBrains Mono"
                  fontSize="9"
                  fill="var(--accent)"
                  letterSpacing="0.1em"
                >
                  x = 0
                </text>

                {/* Wall */}
                <rect x={wallX - 20} y={tableY - 110} width="20" height="110" fill="url(#hatch)" />
                <line x1={wallX} y1={tableY - 110} x2={wallX} y2={tableY} stroke="var(--ink)" strokeWidth="2" />

                {/* Table top */}
                <line x1={wallX} y1={tableY} x2={sceneW - 10} y2={tableY} stroke="var(--ink)" strokeWidth="2" />
                <rect x={wallX} y={tableY} width={sceneW - wallX - 10} height="40" fill="url(#tableHatch)" />
                <line x1={wallX} y1={tableY + 40} x2={sceneW - 10} y2={tableY + 40} stroke="var(--ink)" strokeWidth="0.5" opacity="0.5" />

                {/* Spring */}
                <path
                  d={springPath}
                  stroke="var(--spring)"
                  strokeWidth="2"
                  fill="none"
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />

                {/* Block */}
                <g>
                  <rect
                    x={blockX - blockSize / 2}
                    y={tableY - blockSize}
                    width={blockSize}
                    height={blockSize}
                    fill="var(--block)"
                    stroke="var(--ink)"
                    strokeWidth="1"
                  />
                  <line
                    x1={blockX - blockSize / 2 + 4}
                    y1={tableY - blockSize + 4}
                    x2={blockX + blockSize / 2 - 4}
                    y2={tableY - blockSize + 4}
                    stroke="var(--paper)"
                    strokeWidth="0.5"
                    opacity="0.4"
                  />
                  <text
                    x={blockX}
                    y={tableY - blockSize / 2 + 4}
                    textAnchor="middle"
                    fontFamily="Fraunces"
                    fontStyle="italic"
                    fontSize="18"
                    fill="var(--paper)"
                  >
                    m
                  </text>
                </g>

                {/* Position indicator below */}
                <line
                  x1={blockX}
                  y1={tableY + 40}
                  x2={blockX}
                  y2={tableY + 56}
                  stroke="var(--accent)"
                  strokeWidth="1"
                />
                <circle cx={blockX} cy={tableY + 56} r="2" fill="var(--accent)" />

                {/* Ruler */}
                {[-4, -3, -2, -1, 0, 1, 2, 3, 4].map((tick) => {
                  const px = equilibriumPx + tick * pxPerMeter;
                  if (px < wallX + 20 || px > sceneW - 10) return null;
                  return (
                    <g key={tick}>
                      <line x1={px} y1={tableY + 50} x2={px} y2={tableY + 58} stroke="var(--ink)" strokeWidth="1" />
                      <text
                        x={px}
                        y={tableY + 72}
                        textAnchor="middle"
                        fontFamily="JetBrains Mono"
                        fontSize="13"
                        fontWeight="500"
                        fill="var(--ink)"
                      >
                        {tick}
                      </text>
                    </g>
                  );
                })}
              </svg>

              <div className="controls-bar">
                <button className="btn btn-primary" onClick={() => setRunning((r) => !r)}>
                  {running ? <Pause size={12} /> : <Play size={12} />}
                  {running ? "Pause" : "Release"}
                </button>
                <button className="btn" onClick={reset}>
                  <RotateCcw size={12} />
                  Reset
                </button>
                <div className="readout">
                  <div className="readout-item">t = <span className="v">{t.toFixed(2)} s</span></div>
                  <div className="readout-item">v = <span className="v">{v.toFixed(2)} m/s</span></div>
                </div>
              </div>
            </div>

            <div className="graph-card" style={{ marginTop: 20 }}>
              <div className="card-label">
                <span>Fig. II — Position vs Time</span>
                <span>x(t)</span>
              </div>
              <svg viewBox={`0 0 ${graphW} ${graphH}`} className="graph-svg">
                {/* Grid */}
                {[-1, -0.5, 0, 0.5, 1].map((frac) => {
                  const yv = frac * xRange;
                  const yPx = xToPx(yv);
                  return (
                    <g key={frac}>
                      <line
                        x1={graphPad.left}
                        y1={yPx}
                        x2={graphPad.left + plotW}
                        y2={yPx}
                        stroke={frac === 0 ? "var(--ink-soft)" : "var(--grid)"}
                        strokeWidth={frac === 0 ? "1" : "0.5"}
                        strokeDasharray={frac === 0 ? "" : "2 3"}
                      />
                      <text
                        x={graphPad.left - 10}
                        y={yPx + 4}
                        textAnchor="end"
                        fontFamily="JetBrains Mono"
                        fontSize="13"
                        fontWeight="500"
                        fill="var(--ink)"
                      >
                        {yv.toFixed(1)}
                      </text>
                    </g>
                  );
                })}

                {/* Time ticks */}
                {Array.from({ length: 7 }, (_, i) => {
                  const tv = tMin + (i / 6) * (tMax - tMin);
                  const xPx = tToPx(tv);
                  return (
                    <g key={i}>
                      <line
                        x1={xPx}
                        y1={graphPad.top}
                        x2={xPx}
                        y2={graphPad.top + plotH}
                        stroke="var(--grid)"
                        strokeWidth="0.5"
                        strokeDasharray="2 3"
                      />
                      <text
                        x={xPx}
                        y={graphPad.top + plotH + 20}
                        textAnchor="middle"
                        fontFamily="JetBrains Mono"
                        fontSize="13"
                        fontWeight="500"
                        fill="var(--ink)"
                      >
                        {tv.toFixed(1)}
                      </text>
                    </g>
                  );
                })}

                {/* Axis frame */}
                <rect
                  x={graphPad.left}
                  y={graphPad.top}
                  width={plotW}
                  height={plotH}
                  fill="none"
                  stroke="var(--ink)"
                  strokeWidth="1"
                />

                {/* Axis labels */}
                <text
                  x={graphPad.left + plotW / 2}
                  y={graphH - 6}
                  textAnchor="middle"
                  fontFamily="Fraunces"
                  fontStyle="italic"
                  fontSize="14"
                  fill="var(--ink)"
                >
                  t (seconds)
                </text>
                <text
                  x={18}
                  y={graphPad.top + plotH / 2}
                  textAnchor="middle"
                  fontFamily="Fraunces"
                  fontStyle="italic"
                  fontSize="14"
                  fill="var(--ink)"
                  transform={`rotate(-90, 18, ${graphPad.top + plotH / 2})`}
                >
                  x (meters)
                </text>

                {/* Trajectory */}
                {trajectoryPath && (
                  <path
                    d={trajectoryPath}
                    fill="none"
                    stroke="var(--plot)"
                    strokeWidth="1.5"
                    strokeLinejoin="round"
                    strokeLinecap="round"
                  />
                )}

                {/* Current position marker */}
                {t >= tMin && t <= tMax && (
                  <g>
                    <line
                      x1={tToPx(t)}
                      y1={graphPad.top}
                      x2={tToPx(t)}
                      y2={graphPad.top + plotH}
                      stroke="var(--marker)"
                      strokeWidth="0.5"
                      strokeDasharray="2 2"
                      opacity="0.6"
                    />
                    <circle
                      cx={tToPx(t)}
                      cy={xToPx(x)}
                      r="5"
                      fill="var(--marker)"
                      stroke="var(--paper)"
                      strokeWidth="2"
                    />
                  </g>
                )}
              </svg>
            </div>
          </div>

          {/* Control Panel */}
          <div className="panel">
            <div className="panel-section">
              <h3 className="section-heading">Initial Conditions</h3>
              <Slider
                label="position x₀"
                value={x0}
                onChange={setX0}
                min={-4}
                max={4}
                step={0.1}
                unit="m"
                disabled={running}
              />
              <Slider
                label="velocity v₀"
                value={v0}
                onChange={setV0}
                min={-5}
                max={5}
                step={0.1}
                unit="m/s"
                disabled={running}
              />
            </div>

            <div className="panel-section">
              <h3 className="section-heading">System</h3>
              <Slider
                label="mass m"
                value={mass}
                onChange={setMass}
                min={0.1}
                max={5}
                step={0.05}
                unit="kg"
              />
              <Slider
                label="spring constant k"
                value={k}
                onChange={setK}
                min={0.5}
                max={20}
                step={0.1}
                unit="N/m"
              />
            </div>

            <div className="panel-section">
              <h3 className="section-heading">Friction</h3>
              <Slider
                label="static μₛ"
                value={muS}
                onChange={(val) => { setMuS(val); if (muK > val) setMuK(val); }}
                min={0}
                max={1}
                step={0.01}
                unit=""
              />
              <Slider
                label="kinetic μₖ"
                value={muK}
                onChange={(val) => setMuK(Math.min(val, muS))}
                min={0}
                max={muS}
                step={0.01}
                unit=""
              />
              <div style={{ fontFamily: "JetBrains Mono", fontSize: 9, color: "var(--ink-faint)", marginTop: 8, letterSpacing: "0.05em" }}>
                μₖ ≤ μₛ enforced
              </div>
            </div>

            <div className="panel-section">
              <h3 className="section-heading">Energy</h3>
              <div className="energy-grid">
                <div className="energy-cell">
                  <div className="label">KE</div>
                  <div className="val">{KE.toFixed(2)}</div>
                </div>
                <div className="energy-cell">
                  <div className="label">PE</div>
                  <div className="val">{PE.toFixed(2)}</div>
                </div>
                <div className="energy-cell">
                  <div className="label">TOTAL</div>
                  <div className="val">{E.toFixed(2)}</div>
                </div>
              </div>
              <div style={{ fontFamily: "JetBrains Mono", fontSize: 9, color: "var(--ink-faint)", marginTop: 8, textAlign: "center" }}>
                Joules · ω = {Math.sqrt(k / mass).toFixed(2)} rad/s · T = {(2 * Math.PI * Math.sqrt(mass / k)).toFixed(2)} s
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
