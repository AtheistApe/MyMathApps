// Tab 2 — interval of convergence:
//   shaded interval (a − R, a + R), endpoint behaviour, high-degree polynomials that
//   hug f inside and blow up outside, and the partial sums S_k(x0) at a test point.

import { useMemo, useState } from 'react';
import PlotCanvas from '../components/PlotCanvas.jsx';
import { CenterControl, DegreeControl, FunctionPicker, TestPointControl } from '../components/Controls.jsx';
import { useFn, useStore, useTabView } from '../store.js';
import { COL } from '../theme.js';
import { coeffsOK, horner, partialSums, radiusEstimates } from '../math/taylor.js';
import { fmtNum, intervalText, MINUS, sub } from '../math/numfmt.js';

const TAB = 'convergence';

export default function Convergence() {
  const fn = useFn();
  const a = useStore((s) => s.a);
  const nRaw = useStore((s) => s.n);
  const x0 = useStore((s) => s.x0);
  const setA = useStore((s) => s.setA);
  const setX0 = useStore((s) => s.setX0);
  const N = fn.maxDegree;
  const n = Math.min(nRaw, N);

  const [view, setView, resetView] = useTabView(TAB, fn);
  const coeffs = useMemo(() => fn.coeffs(a, N), [fn, a, N]);
  const ok = coeffsOK(coeffs, N);

  // ---- radius of convergence: exact for presets, estimated for custom functions ----
  const exactR = fn.radius(a);
  const estimates = useMemo(() => (ok ? radiusEstimates(coeffs, N, 6) : []), [coeffs, N, ok]);
  const estR = estimates.length ? estimates[estimates.length - 1].est : NaN;
  const isExact = exactR !== null;
  const R = isExact ? exactR : estR;
  const ends = fn.endpoints(a); // { left, right } | null
  const lo = a - R;
  const hi = a + R;

  const dist = Math.abs(x0 - a);
  const eps = 1e-9 * Math.max(1, R);
  let verdict;
  if (!ok || !Number.isFinite(R)) verdict = { cls: 'none', text: 'No Taylor series at this center.' };
  else if (R === Infinity) verdict = { cls: 'in', text: 'The series converges for every x (R = ∞).' };
  else if (dist < R - eps) verdict = { cls: 'in', text: `|x₀ ${MINUS} a| < R: the series converges absolutely at x₀.` };
  else if (dist > R + eps) verdict = { cls: 'out', text: `|x₀ ${MINUS} a| > R: the series diverges at x₀. The terms don't even go to 0.` };
  else {
    const side = x0 > a ? ends?.right : ends?.left;
    verdict = {
      cls: 'edge',
      text:
        side === 'converges'
          ? 'x₀ is an endpoint, and the series converges there (check it with the alternating series test or comparison).'
          : side === 'diverges'
            ? 'x₀ is an endpoint, and the series diverges there.'
            : 'x₀ is an endpoint: the ratio test is inconclusive, so test this series directly.',
    };
  }

  // ---- main plot ------------------------------------------------------------------
  const fa = fn.f(a);
  const handles = [
    { id: 'a', x: a, y: fa, anchor: Number.isFinite(fa) ? undefined : 'bottom', color: COL.center, label: 'a' },
    { id: 'x0', x: x0, anchor: 'bottom', color: COL.test, label: 'x₀', guide: true },
  ];
  const onHandle = (id, x) => (id === 'a' ? setA(x) : setX0(x));

  const drawMain = (ctx, H) => {
    if (ok && R === Infinity) {
      ctx.fillStyle = COL.goodFill;
      ctx.fillRect(H.left, H.top, H.plotW, H.plotH);
    } else if (ok && Number.isFinite(R)) {
      const x1 = Math.max(H.left, Math.min(H.left + H.plotW, H.X(lo)));
      const x2 = Math.max(H.left, Math.min(H.left + H.plotW, H.X(hi)));
      ctx.fillStyle = COL.badFill;
      ctx.fillRect(H.left, H.top, H.plotW, H.plotH);
      ctx.fillStyle = COL.goodFill;
      ctx.fillRect(Number.isFinite(x1) ? x1 : H.left, H.top, (Number.isFinite(x2) ? x2 : H.left + H.plotW) - (Number.isFinite(x1) ? x1 : H.left), H.plotH);

      if (Number.isFinite(R)) {
        for (const [x, side] of [[lo, 'left'], [hi, 'right']]) {
          const px = H.X(x);
          if (px < H.left - 4 || px > H.left + H.plotW + 4) continue;
          ctx.save();
          ctx.strokeStyle = COL.good;
          ctx.lineWidth = 2;
          ctx.setLineDash([7, 5]);
          ctx.beginPath();
          ctx.moveTo(px, H.top);
          ctx.lineTo(px, H.top + H.plotH);
          ctx.stroke();
          ctx.restore();
          // closed dot = converges, open dot = diverges, "?" = not known
          const state = ends?.[side];
          const py = H.top + H.plotH - 14;
          ctx.beginPath();
          ctx.arc(px, py, 7, 0, Math.PI * 2);
          ctx.fillStyle = state === 'converges' ? COL.good : '#fff';
          ctx.fill();
          ctx.lineWidth = 2.5;
          ctx.strokeStyle = state === 'diverges' || state === 'converges' ? COL.good : COL.axis;
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
    }

    const xs = H.samples(1.5);
    H.stroke(xs, xs.map(fn.f), { color: COL.fn, width: 3 });
    if (ok) H.stroke(xs, xs.map((x) => horner(coeffs, n, x - a)), { color: COL.poly, width: 2.5 });

    const f0 = fn.f(x0);
    const t0 = ok ? horner(coeffs, n, x0 - a) : NaN;
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

  // ---- partial sums S_k(x0), k = 0..N -------------------------------------------------
  const sums = useMemo(() => (ok ? partialSums(coeffs, N, x0 - a) : []), [coeffs, N, x0, a, ok]);
  const target = fn.f(x0);
  const sig = `${fn.id}|${fn.label}|${a}|${x0}`;
  const [override, setOverride] = useState(null);
  const sumView = useMemo(() => {
    const center = Number.isFinite(target) ? target : sums.length ? sums[sums.length - 1] : 0;
    let dev = 0.5;
    for (const s of sums) if (Number.isFinite(s)) dev = Math.max(dev, Math.min(60, Math.abs(s - center)));
    dev = Math.min(dev, 60);
    return { xmin: -1.5, xmax: N + 1.5, ymin: center - dev * 1.1, ymax: center + dev * 1.1 };
  }, [sums, target, N]);
  const pView = override?.sig === sig ? override.v : sumView;

  const drawSums = (ctx, H) => {
    if (!ok) return;
    if (Number.isFinite(target)) {
      ctx.save();
      ctx.strokeStyle = COL.good;
      ctx.lineWidth = 2;
      ctx.setLineDash([8, 5]);
      ctx.beginPath();
      ctx.moveTo(H.left, H.Y(target));
      ctx.lineTo(H.left + H.plotW, H.Y(target));
      ctx.stroke();
      ctx.restore();
    }
    const ks = sums.map((_, k) => k);
    H.stroke(ks.slice(0, n + 1), sums.slice(0, n + 1), { color: COL.poly, width: 1.5, alpha: 0.55 });
    sums.forEach((s, k) => {
      if (!Number.isFinite(s)) return;
      const active = k <= n;
      ctx.beginPath();
      ctx.arc(H.X(k), H.Y(s), k === n ? 6 : 3.6, 0, Math.PI * 2);
      ctx.fillStyle = active ? COL.poly : '#c9ced9';
      ctx.fill();
      if (k === n) {
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#fff';
        ctx.stroke();
      }
    });
  };

  const intervalLabel = ok && Number.isFinite(R) ? intervalText(lo, hi, ends?.left === 'converges', ends?.right === 'converges') : '—';

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
          onHandleDrag={onHandle}
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
          onView={(v) => setOverride({ sig, v })}
          onReset={() => setOverride(null)}
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
            <div><dt>Radius of convergence</dt><dd>{R === Infinity ? '∞' : Number.isFinite(R) ? `${isExact ? '' : '≈ '}${fmtNum(R, 5)}` : '—'}</dd></div>
            <div><dt>Interval of convergence</dt><dd>{isExact || !Number.isFinite(R) ? intervalLabel : `≈ ${intervalLabel}`}</dd></div>
            <div><dt>|x₀ {MINUS} a| / R</dt><dd>{ok && Number.isFinite(R) && R > 0 ? fmtNum(dist / R, 4) : R === Infinity ? '0' : '—'}</dd></div>
          </dl>
          <p className={`verdict ${verdict.cls}`}>{verdict.text}</p>
          {!isExact && <p className="hint">R is estimated from the coefficients, and the endpoints can’t be classified automatically.</p>}
        </section>

        <section className="panel table-panel" aria-label="Estimating the radius from the coefficients">
          <div className="panel-head"><h2>Reading R from the coefficients</h2></div>
          <p className="hint">
            The ratio test says R = lim |c{sub('k')} / c{sub('k+1')}|. Because many series skip every other term, this table
            uses |c{sub('k')} / c{sub('k+2')}|<sup>1/2</sup>, which has the same limit.
          </p>
          {estimates.length ? (
            <div className="table-scroll short">
              <table className="coef-table">
                <thead><tr><th>k</th><th>|c{sub('k')} / c{sub('k+2')}|<sup>1/2</sup></th></tr></thead>
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
