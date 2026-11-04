// Tab 1 — the central view:
//   f(x) and Tn(x) together, the live coefficient table, and the error |f − Tn|.

import { useCallback, useMemo, useState } from 'react';
import PlotCanvas from '../components/PlotCanvas.jsx';
import CoefficientTable from '../components/CoefficientTable.jsx';
import { CenterControl, DegreeControl, FunctionPicker, TestPointControl, Toggle } from '../components/Controls.jsx';
import { useFn, useStore, useTabView } from '../store.js';
import { COL } from '../theme.js';
import { coeffsOK, horner, partialSums } from '../math/taylor.js';
import { fmtNum, sub, MINUS } from '../math/numfmt.js';

const TAB = 'explore';
const MAX_EXPLORE_DEGREE = 30;
const ERR_FLOOR = 1e-17;

export default function Explore() {
  const fn = useFn();
  const a = useStore((s) => s.a);
  const nRaw = useStore((s) => s.n);
  const x0 = useStore((s) => s.x0);
  const setA = useStore((s) => s.setA);
  const setX0 = useStore((s) => s.setX0);
  const n = Math.min(nRaw, fn.maxDegree, MAX_EXPLORE_DEGREE);

  const [view, setView, resetView] = useTabView(TAB, fn);
  const [ghosts, setGhosts] = useState(true);
  const [shade, setShade] = useState(true);
  const [logErr, setLogErr] = useState(true);
  const [showEval, setShowEval] = useState(false);

  const coeffs = useMemo(() => fn.coeffs(a, fn.maxDegree), [fn, a]);
  const ok = coeffsOK(coeffs, n);

  const T = useCallback((x) => horner(coeffs, n, x - a), [coeffs, n, a]);
  const err = useCallback((x) => Math.abs(fn.f(x) - T(x)), [fn, T]);

  // ---- main plot --------------------------------------------------------
  const fa = fn.f(a);
  const handles = [
    { id: 'a', x: a, y: fa, anchor: Number.isFinite(fa) ? undefined : 'bottom', color: COL.center, label: 'a' },
    { id: 'x0', x: x0, anchor: 'bottom', color: COL.test, label: 'x₀', guide: true },
  ];
  const onHandle = (id, x) => (id === 'a' ? setA(x) : setX0(x));

  const drawMain = (ctx, H) => {
    const xs = H.samples(1.5);
    const fy = xs.map(fn.f);

    if (ok) {
      if (shade) {
        ctx.fillStyle = COL.errFill;
        for (let i = 0; i < xs.length; i++) {
          const t = horner(coeffs, n, xs[i] - a);
          if (!Number.isFinite(fy[i]) || !Number.isFinite(t)) continue;
          const y1 = H.Y(fy[i]);
          const y2 = H.Y(t);
          const top = Math.max(-1e4, Math.min(1e4, Math.min(y1, y2)));
          const bot = Math.max(-1e4, Math.min(1e4, Math.max(y1, y2)));
          ctx.fillRect(H.X(xs[i]) - 0.75, top, 1.5, bot - top);
        }
      }
      if (ghosts && n > 0) {
        const cols = xs.map((x) => partialSums(coeffs, n - 1, x - a));
        for (let k = 0; k < n; k++) {
          H.stroke(xs, cols.map((c) => c[k]), { color: COL.ghost, width: 1.25, alpha: 0.12 + 0.38 * ((k + 1) / n) });
        }
      }
    }

    H.stroke(xs, fy, { color: COL.fn, width: 3 });
    if (ok) H.stroke(xs, xs.map((x) => horner(coeffs, n, x - a)), { color: COL.poly, width: 2.5 });

    // test point: the two heights and the gap between them
    const f0 = fn.f(x0);
    const t0 = ok ? T(x0) : NaN;
    if (Number.isFinite(f0) && Number.isFinite(t0)) {
      ctx.strokeStyle = COL.err;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(H.X(x0), Math.max(-1e4, Math.min(1e4, H.Y(f0))));
      ctx.lineTo(H.X(x0), Math.max(-1e4, Math.min(1e4, H.Y(t0))));
      ctx.stroke();
    }
    for (const [y, color] of [[f0, COL.fn], [t0, COL.poly]]) {
      if (!Number.isFinite(y)) continue;
      ctx.beginPath();
      ctx.arc(H.X(x0), H.Y(y), 5, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#fff';
      ctx.stroke();
    }
  };

  // ---- error plot (shares the x-window with the main plot) ---------------------
  const errView = useMemo(() => {
    const N = 300;
    let maxErr = 0;
    if (ok) {
      for (let i = 0; i <= N; i++) {
        const e = Math.abs(fn.f(view.xmin + ((view.xmax - view.xmin) * i) / N) - horner(coeffs, n, view.xmin + ((view.xmax - view.xmin) * i) / N - a));
        if (Number.isFinite(e) && e > maxErr) maxErr = e;
      }
    }
    const hMain = view.ymax - view.ymin;
    if (logErr) {
      const top = maxErr > 0 ? Math.ceil(Math.log10(maxErr)) + 1 : -8;
      return { xmin: view.xmin, xmax: view.xmax, ymin: -17, ymax: Math.max(-4, Math.min(12, top)) };
    }
    const top = Math.max(1e-12, Math.min(maxErr, 3 * hMain));
    return { xmin: view.xmin, xmax: view.xmax, ymin: -0.04 * top, ymax: top * 1.05 };
  }, [fn, coeffs, n, a, ok, view.xmin, view.xmax, view.ymin, view.ymax, logErr]);

  const drawErr = (ctx, H) => {
    if (!ok) return;
    const xs = H.samples(1.5);
    const ys = xs.map((x) => {
      const e = err(x);
      if (!Number.isFinite(e)) return NaN;
      return logErr ? Math.log10(Math.max(e, ERR_FLOOR)) : e;
    });
    H.stroke(xs, ys, { color: COL.err, width: 2.5 });
    // dotted marker at the center
    ctx.save();
    ctx.setLineDash([2, 4]);
    ctx.strokeStyle = COL.center;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(H.X(a), H.top);
    ctx.lineTo(H.X(a), H.top + H.plotH);
    ctx.stroke();
    ctx.restore();
    const e0 = err(x0);
    if (Number.isFinite(e0)) {
      const y = logErr ? Math.log10(Math.max(e0, ERR_FLOOR)) : e0;
      ctx.beginPath();
      ctx.arc(H.X(x0), H.Y(y), 5.5, 0, Math.PI * 2);
      ctx.fillStyle = COL.err;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#fff';
      ctx.stroke();
    }
  };

  const onErrView = (v) => setView({ ...view, xmin: v.xmin, xmax: v.xmax });

  // ---- readout ------------------------------------------------------------------
  const f0 = fn.f(x0);
  const t0 = ok ? T(x0) : NaN;
  const e0 = Math.abs(f0 - t0);

  return (
    <div className="tab-grid">
      <section className="panel plots" aria-label="Plots">
        <div className="plot-title">
          <span><span className="key fn" />f(x)</span>
          <span><span className="key poly" />T{sub(n)}(x)</span>
          {ghosts && n > 0 && <span><span className="key ghost" />lower degrees</span>}
          {shade && <span><span className="key gap" />gap</span>}
        </div>
        <PlotCanvas
          view={view}
          onView={setView}
          onReset={resetView}
          draw={drawMain}
          handles={handles}
          onHandleDrag={onHandle}
          height={380}
          label={`Graph of f and its Taylor polynomial of degree ${n}`}
        />
        <div className="plot-title second">
          <span><span className="key err" />|f(x) {MINUS} T{sub(n)}(x)|</span>
          <Toggle checked={logErr} onChange={setLogErr}>log scale</Toggle>
        </div>
        <PlotCanvas
          view={errView}
          onView={onErrView}
          onReset={resetView}
          draw={drawErr}
          lockY
          yLog={logErr}
          height={190}
          buttons={false}
          label="Graph of the absolute error"
        />
        {logErr && <p className="hint tight">Error values below about 10⁻¹⁵ are limited by computer round-off.</p>}
        <p className="hint tight">Drag the plot to pan, pinch or scroll to zoom. Drag <b className="c-center">a</b> to move the center and <b className="c-test">x₀</b> to move the test point.</p>
      </section>

      <aside className="side">
        <section className="panel controls" aria-label="Controls">
          <FunctionPicker />
          <DegreeControl max={MAX_EXPLORE_DEGREE} />
          <CenterControl />
          <div className="toggles">
            <Toggle checked={ghosts} onChange={setGhosts}>Show lower degrees</Toggle>
            <Toggle checked={shade} onChange={setShade}>Shade the gap</Toggle>
          </div>
          {fn.note && <p className="hint">{fn.note}</p>}
        </section>

        <section className="panel readout" aria-label="Values at the test point">
          <TestPointControl />
          <dl>
            <div><dt>f(x₀)</dt><dd>{fmtNum(f0, 7)}</dd></div>
            <div><dt>T{sub(n)}(x₀)</dt><dd>{ok ? fmtNum(t0, 7) : '—'}</dd></div>
            <div className="err"><dt>error</dt><dd>{ok && Number.isFinite(e0) ? fmtNum(e0, 4) : '—'}</dd></div>
          </dl>
        </section>

        <section className="panel table-panel" aria-label="Coefficient table">
          <div className="panel-head">
            <h2>Where the coefficients come from</h2>
            <Toggle checked={showEval} onChange={setShowEval}>Evaluate at x₀</Toggle>
          </div>
          {ok ? (
            <CoefficientTable coeffs={coeffs} a={a} n={n} x0={x0} showEval={showEval} />
          ) : (
            <p className="msg error">
              f or one of its derivatives is undefined at a = {fmtNum(a, 4)}, so there is no Taylor polynomial here. Move the center.
            </p>
          )}
        </section>
      </aside>
    </div>
  );
}
