// Tab 1 — the central view:
//   f(x) and Tn(x) together, the live coefficient table, and the error |f − Tn|.

import { useCallback, useMemo, useState } from 'react';
import PlotCanvas from '../components/PlotCanvas.jsx';
import CoefficientTable from '../components/CoefficientTable.jsx';
import { CenterControl, DegreeControl, FunctionPicker, TestPointControl, Toggle } from '../components/Controls.jsx';
import { useCenterTestHandles } from '../components/useHandles.js';
import { useFn, useStore, useTabView } from '../store.js';
import { COL } from '../theme.js';
import { clampPx, drawDot, drawLine, drawTestPoint } from '../plot/draw.js';
import { coeffsOK, errorInfo, horner, partialSumsGrid } from '../math/taylor.js';
import { describeCoef, fmtNum, sub, MINUS } from '../math/numfmt.js';

const TAB = 'explore';
const MAX_EXPLORE_DEGREE = 30;

export default function Explore() {
  const fn = useFn();
  const a = useStore((s) => s.a);
  const nRaw = useStore((s) => s.n);
  const x0 = useStore((s) => s.x0);
  const n = Math.min(nRaw, fn.maxDegree, MAX_EXPLORE_DEGREE);

  const [view, setView, resetView] = useTabView(TAB, fn);
  const { handles, onHandleDrag } = useCenterTestHandles(fn);
  const [ghosts, setGhosts] = useState(true);
  const [shade, setShade] = useState(true);
  const [logErr, setLogErr] = useState(true);
  const [showEval, setShowEval] = useState(false);
  const [decimals, setDecimals] = useState(false);

  const coeffs = useMemo(() => fn.coeffs(a, fn.maxDegree), [fn, a]);
  const ok = coeffsOK(coeffs, n);
  const T = useCallback((x) => horner(coeffs, n, x - a), [coeffs, n, a]);
  // Are exact fractions possible for these coefficients at all? (Not when, say, e^x is expanded about a = 0.5.)
  const fractionsPossible = ok && coeffs.slice(0, n + 1).some((c, k) => c !== 0 && describeCoef(c, k).kind === 'frac');
  // |f − Tn| at x, with the round-off floor (see errorInfo)
  const errAt = useCallback((x) => errorInfo(fn.f(x), coeffs, n, x - a), [fn, coeffs, n, a]);

  // ---- main plot --------------------------------------------------------
  const drawMain = (ctx, H) => {
    const xs = H.samples(1.5);
    const fy = xs.map(fn.f);
    const ty = ok ? xs.map(T) : null;

    if (ok && shade) {
      ctx.fillStyle = COL.errFill;
      for (let i = 0; i < xs.length; i++) {
        if (!Number.isFinite(fy[i]) || !Number.isFinite(ty[i])) continue;
        const y1 = clampPx(H.Y(fy[i]));
        const y2 = clampPx(H.Y(ty[i]));
        ctx.fillRect(H.X(xs[i]) - 0.75, Math.min(y1, y2), 1.5, Math.abs(y1 - y2));
      }
    }
    if (ok && ghosts && n > 0) {
      // the lower-degree polynomials T0 … T(n-1), fainter the lower they are
      const rows = partialSumsGrid(coeffs, n - 1, xs, a);
      rows.forEach((row, k) => H.stroke(xs, row, { color: COL.ghost, width: 1.25, alpha: 0.12 + 0.38 * ((k + 1) / n) }));
    }

    H.stroke(xs, fy, { color: COL.fn, width: 3 });
    if (ok) H.stroke(xs, ty, { color: COL.poly, width: 2.5 });
    drawTestPoint(ctx, H, x0, fn.f(x0), ok ? T(x0) : NaN, { gap: true });
  };

  // ---- error plot (shares the x-window with the main plot) ---------------------
  const errView = useMemo(() => {
    let maxErr = 0;
    if (ok) {
      const N = 300;
      for (let i = 0; i <= N; i++) {
        const { err } = errAt(view.xmin + ((view.xmax - view.xmin) * i) / N);
        if (Number.isFinite(err) && err > maxErr) maxErr = err;
      }
    }
    if (logErr) {
      const top = maxErr > 0 ? Math.ceil(Math.log10(maxErr)) + 1 : -8;
      return { xmin: view.xmin, xmax: view.xmax, ymin: -17, ymax: Math.max(-4, Math.min(12, top)) };
    }
    const top = Math.max(1e-12, Math.min(maxErr, 3 * (view.ymax - view.ymin)));
    return { xmin: view.xmin, xmax: view.xmax, ymin: -0.04 * top, ymax: top * 1.05 };
  }, [errAt, ok, view.xmin, view.xmax, view.ymin, view.ymax, logErr]);

  const drawErr = (ctx, H) => {
    if (!ok) return;
    const value = (x) => {
      const { err, shown } = errAt(x);
      return logErr ? Math.log10(shown) : err;
    };
    const xs = H.samples(1.5);
    H.stroke(xs, xs.map(value), { color: COL.err, width: 2.5 });
    drawLine(ctx, H.X(a), H.top, H.X(a), H.top + H.plotH, { color: COL.center, width: 1.5, dash: [2, 4] }); // the center
    const y0 = value(x0);
    if (Number.isFinite(y0)) drawDot(ctx, H.X(x0), H.Y(y0), COL.err, 5.5);
  };

  const onErrView = (v) => setView({ ...view, xmin: v.xmin, xmax: v.xmax });

  // ---- readout ------------------------------------------------------------------
  const f0 = fn.f(x0);
  const t0 = ok ? T(x0) : NaN;
  const e0 = ok ? errAt(x0) : null;
  // an error smaller than the round-off floor is reported as "< floor" instead of a meaningless digit string
  const errorText =
    e0 && Number.isFinite(e0.err) ? (e0.err < e0.floor ? `< ${fmtNum(e0.floor, 2)}` : fmtNum(e0.err, 4)) : '—';

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
          onHandleDrag={onHandleDrag}
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
        {logErr && <p className="hint tight">The flat part at the bottom is the computer’s round-off limit (about 10⁻¹⁶): the true error there is smaller than the computer can measure.</p>}
        <p className="hint tight">
          Drag the plot to pan; scroll or pinch to zoom. To stretch just one direction, drag along an axis (or scroll over it),
          or pinch with your fingers side by side (horizontal) or one above the other (vertical).
          Drag <b className="c-center">a</b> to move the center and <b className="c-test">x₀</b> to move the test point.
        </p>
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
            <div className="err"><dt>error</dt><dd>{errorText}</dd></div>
          </dl>
        </section>

        <section className="panel table-panel" aria-label="Coefficient table">
          <div className="panel-head">
            <h2>Where the coefficients come from</h2>
            <div className="toggles tight">
              <Toggle checked={decimals} onChange={setDecimals}>Show decimals</Toggle>
              <Toggle checked={showEval} onChange={setShowEval}>Evaluate at x₀</Toggle>
            </div>
          </div>
          {ok && !fractionsPossible && !decimals && n > 0 && (
            <p className="hint note">
              {a !== 0
                ? `About a = ${fmtNum(a, 4)} these coefficients are irrational numbers, so they can only be shown as decimals. Set a = 0 to see exact fractions.`
                : 'These coefficients have no simple exact fraction, so they are shown as decimals.'}
            </p>
          )}
          {ok ? (
            <CoefficientTable coeffs={coeffs} a={a} n={n} x0={x0} showEval={showEval} decimal={decimals} />
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
