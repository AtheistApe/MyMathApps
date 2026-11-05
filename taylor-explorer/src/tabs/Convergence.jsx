// Tab 2 — interval of convergence:
//   shaded interval (a − R, a + R), endpoint behaviour, high-degree polynomials that
//   hug f inside and blow up outside, and the partial sums S_k(x0) at a test point.

import { useMemo } from 'react';
import PlotCanvas from '../components/PlotCanvas.jsx';
import { CenterControl, DegreeControl, FunctionPicker, TestPointControl } from '../components/Controls.jsx';
import { useCenterTestHandles } from '../components/useHandles.js';
import { useAutoView } from '../components/useAutoView.js';
import { useFn, useStore, useTabView } from '../store.js';
import { COL } from '../theme.js';
import { drawDot, drawLine, drawTestPoint } from '../plot/draw.js';
import { coeffsOK, horner, partialSums } from '../math/taylor.js';
import { analyzeConvergence } from '../math/convergence.js';
import { fmtNum, MINUS, sub, sup } from '../math/numfmt.js';

const TAB = 'convergence';

/**
 * Shade the interval of convergence green and the rest red, then mark each endpoint:
 * closed dot = converges there, open dot = diverges, "?" = not known.
 */
function drawConvergenceBand(ctx, H, { R, lo, hi, ends }) {
  if (R === Infinity) {
    ctx.fillStyle = COL.goodFill;
    ctx.fillRect(H.left, H.top, H.plotW, H.plotH);
    return;
  }
  const inside = (px) => Math.max(H.left, Math.min(H.left + H.plotW, px));
  const x1 = inside(H.X(lo));
  const x2 = inside(H.X(hi));
  ctx.fillStyle = COL.badFill;
  ctx.fillRect(H.left, H.top, H.plotW, H.plotH);
  ctx.fillStyle = COL.goodFill;
  ctx.fillRect(x1, H.top, x2 - x1, H.plotH);

  for (const [x, side] of [[lo, 'left'], [hi, 'right']]) {
    const px = H.X(x);
    if (px < H.left - 4 || px > H.left + H.plotW + 4) continue;
    drawLine(ctx, px, H.top, px, H.top + H.plotH, { color: COL.good, width: 2, dash: [7, 5] });
    const state = ends?.[side];
    const py = H.top + H.plotH - 14;
    ctx.beginPath();
    ctx.arc(px, py, 7, 0, Math.PI * 2);
    ctx.fillStyle = state === 'converges' ? COL.good : '#fff';
    ctx.fill();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = state ? COL.good : COL.axis;
    ctx.stroke();
    if (!state) {
      ctx.fillStyle = COL.axis;
      ctx.font = 'bold 11px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('?', px, py + 0.5);
    }
  }
}

export default function Convergence() {
  const fn = useFn();
  const a = useStore((s) => s.a);
  const nRaw = useStore((s) => s.n);
  const x0 = useStore((s) => s.x0);
  const N = fn.maxDegree;
  const n = Math.min(nRaw, N);

  const [view, setView, resetView] = useTabView(TAB, fn);
  const { handles, onHandleDrag } = useCenterTestHandles(fn);
  const coeffs = useMemo(() => fn.coeffs(a, N), [fn, a, N]);
  const ok = coeffsOK(coeffs, N);
  const info = analyzeConvergence({ fn, a, x0, coeffs, N, ok });
  const { R, isExact, exactR, rows: estimates, step, verdict } = info;
  const judgedEntire = !isExact && info.entire;

  // ---- main plot ------------------------------------------------------------------
  const drawMain = (ctx, H) => {
    if (ok && !Number.isNaN(R)) drawConvergenceBand(ctx, H, info);
    const xs = H.samples(1.5);
    H.stroke(xs, xs.map(fn.f), { color: COL.fn, width: 3 });
    if (ok) H.stroke(xs, xs.map((x) => horner(coeffs, n, x - a)), { color: COL.poly, width: 2.5 });
    drawTestPoint(ctx, H, x0, fn.f(x0), ok ? horner(coeffs, n, x0 - a) : NaN);
  };

  // ---- partial sums S_k(x0), k = 0..N -------------------------------------------------
  const sums = useMemo(() => (ok ? partialSums(coeffs, N, x0 - a) : []), [coeffs, N, x0, a, ok]);
  const target = fn.f(x0);
  const sig = `${fn.id}|${fn.label}|${a}|${x0}`;
  const sumView = useMemo(() => {
    const center = Number.isFinite(target) ? target : sums.length ? sums[sums.length - 1] : 0;
    let dev = 0.5;
    for (const s of sums) if (Number.isFinite(s)) dev = Math.max(dev, Math.min(60, Math.abs(s - center)));
    dev = Math.min(dev, 60);
    return { xmin: -1.5, xmax: N + 1.5, ymin: center - dev * 1.1, ymax: center + dev * 1.1 };
  }, [sums, target, N]);
  const [pView, setPView, resetPView] = useAutoView(sig, sumView);

  const drawSums = (ctx, H) => {
    if (!ok) return;
    if (Number.isFinite(target)) {
      drawLine(ctx, H.left, H.Y(target), H.left + H.plotW, H.Y(target), { color: COL.good, width: 2, dash: [8, 5] });
    }
    const ks = sums.map((_, k) => k);
    H.stroke(ks.slice(0, n + 1), sums.slice(0, n + 1), { color: COL.poly, width: 1.5, alpha: 0.55 });
    sums.forEach((sum, k) => {
      if (!Number.isFinite(sum)) return;
      if (k === n) drawDot(ctx, H.X(k), H.Y(sum), COL.poly, 6);
      else drawDot(ctx, H.X(k), H.Y(sum), k < n ? COL.poly : '#c9ced9', 3.6, 0);
    });
  };

  // how the readout shows R, the interval, and |x0 − a| / R
  const known = ok && !Number.isNaN(R);
  const approx = isExact || info.terminates || judgedEntire || !known ? '' : '≈ ';
  const radiusText = !known ? '—' : R === Infinity ? '∞' : `${approx}${fmtNum(R, 5)}`;
  const ratioText = !known ? '—' : R === Infinity ? '0' : R > 0 ? fmtNum(info.dist / R, 4) : '—';

  return (
    <div className="tab-grid">
      <section className="panel plots" aria-label="Plots">
        <div className="plot-title">
          <span><span className="key fn" />f(x)</span>
          <span><span className="key poly" />T{sub(n)}(x)</span>
          <span><span className="key good" />interval of convergence</span>
        </div>
        <PlotCanvas
          view={view}
          onView={setView}
          onReset={resetView}
          draw={drawMain}
          handles={handles}
          onHandleDrag={onHandleDrag}
          height={360}
          label="Graph showing the interval of convergence"
        />
        <p className="hint tight">
          Green band: where the series converges. Filled dot = converges at that endpoint, open dot = diverges.
          Raise <b>n</b> and watch T{sub('n')} settle onto f inside the band while it flies away outside.
        </p>

        <div className="plot-title second">
          <span><span className="key poly" />partial sums S{sub('k')}(x₀) = T{sub('k')}(x₀)</span>
          {Number.isFinite(target) && <span><span className="key good dashed" />f(x₀)</span>}
        </div>
        <PlotCanvas
          view={pView}
          onView={setPView}
          onReset={resetPView}
          draw={drawSums}
          height={230}
          label="Partial sums at the test point"
        />
        <p className="hint tight">Horizontal axis: k. Vertical axis: the sum of the first k + 1 terms at x₀.</p>
      </section>

      <aside className="side">
        <section className="panel controls" aria-label="Controls">
          <FunctionPicker />
          <DegreeControl />
          <CenterControl />
          {fn.note && <p className="hint">{fn.note}</p>}
        </section>

        <section className="panel readout" aria-label="Convergence at the test point">
          <TestPointControl />
          <dl className="wide">
            <div><dt>Radius of convergence</dt><dd>{radiusText}</dd></div>
            <div><dt>Interval of convergence</dt><dd>{approx}{info.interval}</dd></div>
            <div><dt>|x₀ {MINUS} a| / R</dt><dd>{ratioText}</dd></div>
          </dl>
          <p className={`verdict ${verdict.cls}`}>{verdict.text}</p>
          {!isExact && !info.terminates && !judgedEntire && <p className="hint">R is estimated from the coefficients, and the endpoints can’t be classified automatically.</p>}
          {judgedEntire && <p className="hint">The estimates keep growing as k grows, which is what happens when the series converges for every x. This is judged from the coefficients, not proved.</p>}
        </section>

        <section className="panel table-panel" aria-label="Estimating the radius from the coefficients">
          <div className="panel-head"><h2>Reading R from the coefficients</h2></div>
          <p className="hint">
            The ratio test says R = lim |c{sub('k')} / c{sub('k+1')}|. Many series skip terms (sin x has every other coefficient
            zero), so this table compares coefficients {step} places apart, |c{sub('k')} / c{sub(`k+${step}`)}|{sup(`1/${step}`)}, which has the same limit.
          </p>
          {estimates.length ? (
            <div className="table-scroll short">
              <table className="coef-table">
                <thead><tr><th>k</th><th>|c{sub('k')} / c{sub(`k+${step}`)}|{sup(`1/${step}`)}</th></tr></thead>
                <tbody>
                  {estimates.map((r) => (
                    <tr key={r.k}><td className="k">{r.k}</td><td>{fmtNum(r.est, 6)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="msg">No usable coefficients at this center.</p>
          )}
          {isExact && Number.isFinite(exactR) && estimates.length > 0 && (
            <p className="hint">Exact R = {fmtNum(exactR, 6)}. The estimates creep toward it as k grows.</p>
          )}
        </section>
      </aside>
    </div>
  );
}
