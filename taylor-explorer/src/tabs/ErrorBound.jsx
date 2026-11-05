// Tab 3 — Taylor's Inequality (the Lagrange error bound).
//
// The student picks the interval (through the test point x0), looks at the plot of |f^(n+1)|, and tries
// to find M, a number that stays above that curve on the interval, by dragging the M line or typing a value.
// The app says whether the guess is too small, valid, or loose, and shows what bound it gives next to the
// actual error. "Reveal the true M" (enabled after a first guess) shows the exact maximum and where it occurs.

import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import PlotCanvas from '../components/PlotCanvas.jsx';
import { CenterControl, DegreeControl, FunctionPicker, TestPointControl, Toggle } from '../components/Controls.jsx';
import { useCenterTestHandles } from '../components/useHandles.js';
import { useAutoView } from '../components/useAutoView.js';
import { useFn, useStore } from '../store.js';
import { COL } from '../theme.js';
import { drawDot, drawLine } from '../plot/draw.js';
import { coeffsOK, errorInfo } from '../math/taylor.js';
import { viewFor } from '../math/functions.js';
import { boundValue, classifyM, derivativeFn, intervalFor, maxAbsOnInterval, roundUp } from '../math/errorbound.js';
import { fmtNum, MINUS, sub, sup } from '../math/numfmt.js';

const MAX_DEGREE = 30;

/** Green band for the interval (a thin line when the interval has no width yet). */
function shadeInterval(ctx, H, lo, hi) {
  const x1 = Math.max(H.left, Math.min(H.left + H.plotW, H.X(lo)));
  const x2 = Math.max(H.left, Math.min(H.left + H.plotW, H.X(hi)));
  ctx.fillStyle = COL.goodFill;
  ctx.fillRect(x1, H.top, Math.max(1, x2 - x1), H.plotH);
  for (const x of [lo, hi]) {
    const px = H.X(x);
    if (px >= H.left && px <= H.left + H.plotW) drawLine(ctx, px, H.top, px, H.top + H.plotH, { color: COL.good, width: 1.5, dash: [6, 4] });
  }
}

/** A plain-decimal rendering that parseFloat can read back (unlike fmtNum, which uses unicode). */
const plain = (v) => String(Number(v.toPrecision(6)));

/** Text box for M. Commits on blur / Enter; an empty box clears M. */
function MInput({ M, onCommit }) {
  const id = useId();
  const [text, setText] = useState(M == null ? '' : plain(M));
  useEffect(() => {
    setText(M == null ? '' : plain(M)); // follow the M line when it is dragged
  }, [M]);
  const commit = () => {
    if (text.trim() === '') return onCommit(null);
    const v = parseFloat(text);
    if (Number.isFinite(v) && v >= 0) return onCommit(v);
    return setText(M == null ? '' : plain(M));
  };
  return (
    <div className="field inline">
      <label htmlFor={id}>Your bound M</label>
      <input
        id={id}
        className="num"
        type="text"
        inputMode="text"
        enterKeyHint="done"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        placeholder="try a value"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
      />
    </div>
  );
}

export default function ErrorBound() {
  const fn = useFn();
  const a = useStore((s) => s.a);
  const nRaw = useStore((s) => s.n);
  const x0 = useStore((s) => s.x0);
  const n = Math.min(nRaw, fn.maxDegree - 1, MAX_DEGREE);
  const order = n + 1; // the derivative the bound needs
  const dName = `f${sup(`(${order})`)}`;

  const [symmetric, setSymmetric] = useState(true);
  const [showCurve, setShowCurve] = useState(true);
  const [logScale, setLogScale] = useState(true);

  // ---- the math ------------------------------------------------------------
  const deriv = useMemo(() => derivativeFn(fn, order), [fn, order]);
  const { lo, hi, d } = intervalFor(a, x0, symmetric);
  const truth = useMemo(() => maxAbsOnInterval(deriv, lo, hi), [deriv, lo, hi]);
  const coeffs = useMemo(() => fn.coeffs(a, fn.maxDegree), [fn, a]);
  const ok = coeffsOK(coeffs, n);
  const errAt = useCallback((x) => errorInfo(fn.f(x), coeffs, n, x - a), [fn, coeffs, n, a]);

  // ---- the student's guess (forgotten when the problem changes) ---------------------
  const problem = `${fn.id}|${fn.label}|${n}|${a}|${symmetric}`;
  const [guess, setGuess] = useState({ problem: '', M: null, revealed: false });
  const current = guess.problem === problem ? guess : { problem, M: null, revealed: false };
  const { M, revealed } = current;
  const setM = (v) => setGuess({ problem, M: v, revealed: current.revealed });
  const reveal = () => setGuess({ problem, M: Number.isFinite(truth.M) ? roundUp(truth.M) : M, revealed: true });
  const startOver = () => setGuess({ problem, M: null, revealed: false });

  const noInterval = d < 1e-12;
  const status = classifyM(M, truth);
  const bound = M != null ? boundValue(M, d, n) : null;
  const actual = ok ? errAt(x0) : null;
  const boundAt = useCallback((x) => (M == null ? NaN : boundValue(M, Math.abs(x - a), n)), [M, a, n]);

  // ---- top plot: |f^(n+1)|. Its window depends only on f and n, so it stays put while you drag things. ---------
  const autoTop = useMemo(() => {
    const base = viewFor(fn);
    const vals = [];
    for (let i = 0; i <= 240; i++) {
      const v = Math.abs(deriv(base.xmin + ((base.xmax - base.xmin) * i) / 240));
      if (Number.isFinite(v)) vals.push(v);
    }
    vals.sort((p, q) => p - q);
    let top = vals.length ? vals[Math.floor(0.97 * (vals.length - 1))] : 1; // robust against poles
    if (!(top > 1e-9)) top = 1;
    top *= 1.3;
    return { xmin: base.xmin, xmax: base.xmax, ymin: -0.06 * top, ymax: top };
  }, [fn, deriv]);
  const [view, setView, resetView] = useAutoView(`${fn.id}|${fn.label}|${n}`, autoTop);

  const { handles: centerAndTest, onHandleDrag: dragCenterOrTest } = useCenterTestHandles(fn, { centerOnCurve: false });
  const mHandle = {
    id: 'M',
    axis: 'y',
    y: M ?? 0.8 * view.ymax,
    color: M == null ? COL.axis : COL.bound,
    label: M == null ? 'M ?' : 'M',
    guide: M != null,
  };
  const handles = [...centerAndTest, mHandle];
  const onHandleDrag = (id, v) => (id === 'M' ? setM(Math.max(0, v)) : dragCenterOrTest(id, v));

  const drawTop = (ctx, H) => {
    shadeInterval(ctx, H, lo, hi);
    if (showCurve) {
      const xs = H.samples(2);
      const ys = xs.map((x) => Math.abs(deriv(x)));
      const inside = ys.map((v, i) => (xs[i] >= lo && xs[i] <= hi ? v : NaN));
      H.stroke(xs, ys, { color: COL.deriv, width: 2, alpha: 0.35 });
      H.stroke(xs, inside, { color: COL.deriv, width: 3 });
      if (M != null) H.stroke(xs, inside.map((v) => (v > M ? v : NaN)), { color: COL.err, width: 4.5 }); // where M is too small
    }
    if (revealed && !truth.unbounded) {
      drawDot(ctx, H.X(truth.at), H.Y(truth.M), COL.good, 6);
      ctx.font = 'italic 600 13px Georgia, "Times New Roman", serif';
      ctx.fillStyle = COL.good;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'bottom';
      ctx.fillText('max', H.X(truth.at) + 9, H.Y(truth.M) - 6);
    }
  };

  // ---- bottom plot: the actual error and the bound (x window shared with the top plot) ----------------
  const bottomView = useMemo(() => {
    let top = 0;
    if (ok && hi > lo) {
      for (let i = 0; i <= 160; i++) {
        const x = lo + ((hi - lo) * i) / 160;
        for (const v of [errAt(x).err, boundAt(x)]) if (Number.isFinite(v) && v > top) top = v;
      }
    }
    if (logScale) {
      const t = top > 0 ? Math.ceil(Math.log10(top)) + 1 : -8;
      return { xmin: view.xmin, xmax: view.xmax, ymin: -17, ymax: Math.max(-4, Math.min(12, t)) };
    }
    const t = Math.max(1e-12, top);
    return { xmin: view.xmin, xmax: view.xmax, ymin: -0.04 * t, ymax: 1.1 * t };
  }, [ok, lo, hi, errAt, boundAt, view.xmin, view.xmax, logScale]);

  const drawBottom = (ctx, H) => {
    shadeInterval(ctx, H, lo, hi);
    drawLine(ctx, H.X(a), H.top, H.X(a), H.top + H.plotH, { color: COL.center, width: 1.5, dash: [2, 4] });
    const toY = (v) => (logScale ? (v > 0 ? Math.log10(v) : NaN) : v);
    const xs = H.samples(1.5);
    if (M != null) {
      const bs = xs.map((x) => toY(boundAt(x)));
      H.stroke(xs, bs, { color: COL.bound, width: 2, alpha: 0.4, dash: [6, 4] }); // the formula outside the interval: no guarantee there
      H.stroke(xs, bs.map((v, i) => (xs[i] >= lo && xs[i] <= hi ? v : NaN)), { color: COL.bound, width: 3 });
      const b0 = toY(boundAt(x0));
      if (Number.isFinite(b0)) drawDot(ctx, H.X(x0), H.Y(b0), COL.bound, 5.5);
    }
    if (ok) {
      H.stroke(xs, xs.map((x) => { const e = errAt(x); return logScale ? Math.log10(e.shown) : e.err; }), { color: COL.err, width: 2.5 });
      const e0 = errAt(x0);
      if (Number.isFinite(e0.err)) drawDot(ctx, H.X(x0), H.Y(logScale ? Math.log10(e0.shown) : e0.err), COL.err, 5.5);
    }
  };
  const onBottomView = (v) => setView({ ...view, xmin: v.xmin, xmax: v.xmax });

  // ---- words ---------------------------------------------------------------------------------------------------
  const feedback = (() => {
    if (!ok) return null;
    if (noInterval) return { cls: 'none', text: 'x₀ is at the center a, so there is no interval yet. Move x₀ away from a.' };
    switch (status.kind) {
      case 'unbounded':
        return { cls: 'out', text: `No finite M exists: f or ${dName} is undefined or unbounded somewhere on this interval (near x ≈ ${fmtNum(truth.at, 3)}). Try a smaller x₀${symmetric ? ', or tick “Symmetric interval” off to use only the stretch between a and x₀' : ''}.` };
      case 'exact':
        return { cls: 'in', text: `${dName} is 0 on this interval, so T${sub(n)} is exactly f there. Any M ≥ 0 works.` };
      case 'none':
        return { cls: 'none', text: `Drag the M line above the curve, or type a value. M must stay above |${dName}| on the whole green interval. Aim for the smallest M you can justify.` };
      case 'small':
        return { cls: 'out', text: showCurve ? 'Too small: the curve rises above your M (shown in red), so this bound is not guaranteed.' : `Too small: |${dName}| gets bigger than your M somewhere on the interval, so this bound is not guaranteed.` };
      case 'loose':
        return { cls: 'edge', text: 'A valid bound, but a loose one: a much smaller M also works (yours is more than 10 times too big). Try lowering it.' };
      default:
        return { cls: 'in', text: status.ratio < 1.1 ? 'A valid bound, and nearly the best possible M.' : 'A valid bound: |' + dName + '| ≤ M on the whole interval. Can you make it smaller?' };
    }
  })();
  const intervalText = noInterval ? '—' : `[${fmtNum(lo, 4)}, ${fmtNum(hi, 4)}]`;
  const errorBeatsBound = bound != null && actual && Number.isFinite(actual.err) && actual.err > bound * (1 + 1e-9);

  return (
    <div className="tab-grid">
      <section className="panel plots" aria-label="Plots">
        <div className="plot-title">
          <span><span className="key deriv" />|{dName}(x)|</span>
          <span><span className="key good" />the interval</span>
          <span><span className="key bound" />your M</span>
          <Toggle checked={showCurve} onChange={setShowCurve}>show the curve</Toggle>
        </div>
        <PlotCanvas
          view={view}
          onView={setView}
          onReset={resetView}
          draw={drawTop}
          handles={handles}
          onHandleDrag={onHandleDrag}
          height={340}
          label={`Graph of the absolute value of the derivative of order ${order}, with a draggable line for M`}
        />
        <p className="hint tight">
          Drag the line labelled <b className="c-bound">M</b> up or down (or type a value). Drag <b className="c-test">x₀</b> to change the interval
          and <b className="c-center">a</b> to move the center.
        </p>

        <div className="plot-title second">
          <span><span className="key err" />actual error |f(x) {MINUS} T{sub(n)}(x)|</span>
          <span><span className="key bound" />bound M|x {MINUS} a|{sup(order)}/{order}!</span>
          <Toggle checked={logScale} onChange={setLogScale}>log scale</Toggle>
        </div>
        <PlotCanvas
          view={bottomView}
          onView={onBottomView}
          onReset={resetView}
          draw={drawBottom}
          lockY
          yLog={logScale}
          height={230}
          buttons={false}
          label="Graph of the actual error and the error bound"
        />
        <p className="hint tight">The bound is only guaranteed on the green interval; outside it the dashed curve is just the formula. A valid M keeps the bound above the error.</p>
      </section>

      <aside className="side">
        <section className="panel theorem" aria-label="Taylor's Inequality">
          <p>
            <b>Taylor’s Inequality.</b> If |{dName}(t)| ≤ M for every t in the interval, then for every x in it
          </p>
          <p className="formula">|R{sub(n)}(x)| = |f(x) {MINUS} T{sub(n)}(x)| ≤ M|x {MINUS} a|{sup(order)} / {order}!</p>
        </section>

        <section className="panel controls" aria-label="Controls">
          <FunctionPicker />
          <DegreeControl max={MAX_DEGREE} />
          <CenterControl />
          <div className="toggles">
            <Toggle checked={symmetric} onChange={setSymmetric}>Symmetric interval |x {MINUS} a| ≤ d</Toggle>
          </div>
          <p className="hint">
            d = |x₀ {MINUS} a|. Untick the box to use only the stretch between a and x₀ (the exact setting of the Lagrange form).
          </p>
        </section>

        <section className="panel readout" aria-label="Your bound">
          <TestPointControl />
          <MInput M={M} onCommit={setM} />
          <div className="m-actions">
            <button
              type="button"
              className="btn primary"
              onClick={reveal}
              disabled={M == null || status.kind === 'unbounded' || noInterval}
              title={M == null ? 'Make a guess first' : 'Show the exact largest value'}
            >
              Reveal the true M
            </button>
            <button type="button" className="btn" onClick={startOver} disabled={M == null && !revealed}>Start over</button>
          </div>

          <dl className="wide">
            <div><dt>Interval</dt><dd>{intervalText}</dd></div>
            <div><dt>True M = max |{dName}|</dt><dd>{revealed && !truth.unbounded ? fmtNum(truth.M, 6) : revealed ? 'none (unbounded)' : 'reveal to see'}</dd></div>
            <div><dt>Bound for |x {MINUS} a| = d</dt><dd>{bound != null && !noInterval ? fmtNum(bound, 5) : '—'}</dd></div>
            <div className="err"><dt>Actual error at x₀</dt><dd>{actual && Number.isFinite(actual.err) ? (actual.err < actual.floor ? `< ${fmtNum(actual.floor, 2)}` : fmtNum(actual.err, 5)) : '—'}</dd></div>
          </dl>

          {M != null && !noInterval && (
            <p className="formula small">
              M·d{sup(order)} / {order}! = {fmtNum(M, 4)} × {fmtNum(d, 4)}{sup(order)} / {order}! = {fmtNum(bound, 5)}
            </p>
          )}
          {feedback && <p className={`verdict ${feedback.cls}`}>{feedback.text}</p>}
          {bound != null && actual && Number.isFinite(actual.err) && !noInterval && (
            <p className={`verdict ${errorBeatsBound ? 'out' : 'in'}`}>
              {errorBeatsBound
                ? 'The actual error is bigger than this bound, so this M cannot be a valid bound.'
                : 'The actual error is below the bound, as Taylor’s Inequality promises for a valid M.'}
            </p>
          )}
          {revealed && !truth.unbounded && (
            <p className="hint">
              The largest value of |{dName}| on {intervalText} is {fmtNum(truth.M, 6)}, reached at x ≈ {fmtNum(truth.at, 4)}. The M shown above is that value rounded up.
            </p>
          )}
          {!ok && <p className="msg error">f or one of its derivatives is undefined at a = {fmtNum(a, 4)}. Move the center.</p>}
        </section>
      </aside>
    </div>
  );
}
