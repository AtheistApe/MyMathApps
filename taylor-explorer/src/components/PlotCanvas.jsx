// A small, dependency-free interactive plot.
//  - mouse: drag to pan, wheel to zoom, double-click to reset
//      drag along an axis (or scroll over it) to stretch just that axis; Shift+wheel = x only, Alt+wheel = y only
//  - touch: one finger pans; two fingers pinch-zoom: side by side = stretch x, one above the other = stretch y,
//      diagonal = both; dragging along an axis also works
//  - toolbar buttons: zoom both axes, horizontal only, vertical only, reset
//  - draggable "handles" (e.g. the center a and test point x0) that slide horizontally
//  - on-screen + / − / reset buttons for people who prefer them
// The component is controlled: the parent owns `view` and passes `onView`.

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { COL } from '../theme.js';
import { niceTicks, tickLabel } from '../math/ticks.js';
import { sup } from '../math/numfmt.js';

const DEFAULT_MARGINS = { l: 56, r: 14, t: 12, b: 34 };
const HIT_RADIUS = 26; // generous for fingers
const MIN_SPAN = 1e-4;
const MAX_SPAN = 1e5;

function geometry(view, w, h, m) {
  const plotW = Math.max(10, w - m.l - m.r);
  const plotH = Math.max(10, h - m.t - m.b);
  const sx = plotW / (view.xmax - view.xmin);
  const sy = plotH / (view.ymax - view.ymin);
  return {
    left: m.l,
    top: m.t,
    plotW,
    plotH,
    X: (x) => m.l + (x - view.xmin) * sx,
    Y: (y) => m.t + (view.ymax - y) * sy,
    invX: (px) => view.xmin + (px - m.l) / sx,
    invY: (py) => view.ymax - (py - m.t) / sy,
  };
}

function zoomAxes(view, g, px, py, fx, fy, lockY) {
  const x = g.invX(px);
  const y = g.invY(py);
  let { xmin, xmax, ymin, ymax } = view;
  if (fx !== 1) {
    const a = x - (x - xmin) * fx;
    const b = x + (xmax - x) * fx;
    if (b - a > MIN_SPAN && b - a < MAX_SPAN) [xmin, xmax] = [a, b];
  }
  if (fy !== 1 && !lockY) {
    const a = y - (y - ymin) * fy;
    const b = y + (ymax - y) * fy;
    if (b - a > MIN_SPAN && b - a < MAX_SPAN) [ymin, ymax] = [a, b];
  }
  return { xmin, xmax, ymin, ymax };
}

/** Which part of the canvas a point is in: the plot, the x-axis strip, the y-axis strip, or elsewhere. */
function regionOf(p, g) {
  const inX = p.x >= g.left && p.x <= g.left + g.plotW;
  const inY = p.y >= g.top && p.y <= g.top + g.plotH;
  if (inX && inY) return 'plot';
  if (inX && p.y > g.top + g.plotH) return 'xaxis';
  if (inY && p.x < g.left) return 'yaxis';
  return 'corner';
}

function handlePixel(hd, g, h, m) {
  const px = g.X(hd.x);
  let py;
  if (hd.anchor === 'bottom') py = h - m.b - 16;
  else if (hd.anchor === 'top') py = m.t + 16;
  else py = g.Y(hd.y);
  return { px, py };
}

export default function PlotCanvas({
  view,
  onView,
  onReset,
  draw,
  handles = [],
  onHandleDrag,
  lockY = false,
  yLog = false,
  height = 340,
  margins = DEFAULT_MARGINS,
  label = 'Interactive plot',
  buttons = true,
}) {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const [w, setW] = useState(640);
  const [cursor, setCursor] = useState('grab');
  const ptr = useRef({ pts: new Map(), mode: null, handleId: null, prevMid: null, prevDist: 0, prevDx: 0, prevDy: 0, anchor: null });
  const live = useRef({});
  live.current = { view, onView, onReset, handles, onHandleDrag, lockY, w, height, margins };

  // ---- size -------------------------------------------------------------
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return undefined;
    const update = () => setW(Math.max(200, Math.floor(el.clientWidth)));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ---- drawing ------------------------------------------------------------
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${height}px`;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const m = margins;
    const g = geometry(view, w, height, m);

    ctx.fillStyle = COL.bg;
    ctx.fillRect(0, 0, w, height);

    // grid + tick labels
    ctx.font = '12px system-ui, -apple-system, "Segoe UI", sans-serif';
    ctx.fillStyle = COL.text;
    ctx.strokeStyle = COL.grid;
    ctx.lineWidth = 1;
    const xt = niceTicks(view.xmin, view.xmax, g.plotW / 80);
    let yt;
    if (yLog) {
      const lo = Math.ceil(view.ymin);
      const hi = Math.floor(view.ymax);
      const stepE = Math.max(1, Math.ceil((hi - lo) / (g.plotH / 38)));
      yt = [];
      for (let e = lo; e <= hi; e += stepE) yt.push(e);
    } else {
      yt = niceTicks(view.ymin, view.ymax, g.plotH / 46);
    }
    ctx.beginPath();
    for (const t of xt) {
      const px = Math.round(g.X(t)) + 0.5;
      ctx.moveTo(px, g.top);
      ctx.lineTo(px, g.top + g.plotH);
    }
    for (const t of yt) {
      const py = Math.round(g.Y(t)) + 0.5;
      ctx.moveTo(g.left, py);
      ctx.lineTo(g.left + g.plotW, py);
    }
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (const t of xt) ctx.fillText(tickLabel(t), g.X(t), g.top + g.plotH + 6);
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (const t of yt) {
      const text = yLog ? `10${sup(t)}` : tickLabel(t);
      ctx.fillText(text, g.left - 7, g.Y(t));
    }

    // user drawing, clipped to the plot area
    ctx.save();
    ctx.beginPath();
    ctx.rect(g.left, g.top, g.plotW, g.plotH);
    ctx.clip();

    // axes through the origin
    ctx.strokeStyle = COL.axis;
    ctx.lineWidth = 1.25;
    ctx.beginPath();
    if (view.xmin < 0 && view.xmax > 0) {
      const px = Math.round(g.X(0)) + 0.5;
      ctx.moveTo(px, g.top);
      ctx.lineTo(px, g.top + g.plotH);
    }
    if (!yLog && view.ymin < 0 && view.ymax > 0) {
      const py = Math.round(g.Y(0)) + 0.5;
      ctx.moveTo(g.left, py);
      ctx.lineTo(g.left + g.plotW, py);
    }
    ctx.stroke();

    const H = {
      ...g,
      view,
      samples: (step = 1.5) => {
        const n = Math.max(2, Math.ceil(g.plotW / step));
        return Array.from({ length: n + 1 }, (_, i) => view.xmin + ((view.xmax - view.xmin) * i) / n);
      },
      stroke: (xs, ys, style = {}) => strokePath(ctx, g, xs, ys, style),
      curve: (f, style = {}, step = 1.5) => {
        const xs = H.samples(step);
        strokePath(ctx, g, xs, xs.map(f), style);
      },
    };
    draw?.(ctx, H);

    // dashed guides for handles
    for (const hd of handles) {
      if (!hd.guide) continue;
      ctx.save();
      ctx.strokeStyle = hd.color;
      ctx.globalAlpha = 0.55;
      ctx.setLineDash([5, 4]);
      ctx.lineWidth = 1.5;
      const px = Math.round(g.X(hd.x)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(px, g.top);
      ctx.lineTo(px, g.top + g.plotH);
      ctx.stroke();
      ctx.restore();
    }
    ctx.restore();

    // plot frame
    ctx.strokeStyle = COL.axis;
    ctx.lineWidth = 1;
    ctx.strokeRect(g.left + 0.5, g.top + 0.5, g.plotW, g.plotH);

    // handle knobs
    for (const hd of handles) {
      const { px, py } = handlePixel(hd, g, height, m);
      if (!Number.isFinite(px) || !Number.isFinite(py)) continue;
      if (px < g.left - 2 || px > g.left + g.plotW + 2 || py < g.top - 2 || py > g.top + g.plotH + 2) continue;
      ctx.beginPath();
      ctx.arc(px, py, 10, 0, Math.PI * 2);
      ctx.fillStyle = hd.color;
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#fff';
      ctx.stroke();
      if (hd.label) {
        ctx.font = 'italic 600 14px Georgia, "Times New Roman", serif';
        ctx.fillStyle = hd.color;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'bottom';
        ctx.fillText(hd.label, px + 12, py - 8);
      }
    }
  });

  // ---- interaction ---------------------------------------------------------
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    const local = (e) => {
      const r = canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const geo = () => {
      const { view, w, height, margins } = live.current;
      return geometry(view, w, height, margins);
    };
    const hit = (p) => {
      const { handles, height, margins } = live.current;
      const g = geo();
      let best = null;
      let bestD = HIT_RADIUS;
      for (const hd of handles) {
        const { px, py } = handlePixel(hd, g, height, margins);
        const d = Math.hypot(px - p.x, py - p.y);
        if (d <= bestD) {
          best = hd;
          bestD = d;
        }
      }
      return best;
    };

    const down = (e) => {
      canvas.setPointerCapture?.(e.pointerId);
      const s = ptr.current;
      const p = local(e);
      s.pts.set(e.pointerId, p);
      if (s.pts.size === 1) {
        const hd = hit(p);
        const region = regionOf(p, geo());
        if (hd) {
          s.mode = 'handle';
          s.handleId = hd.id;
          setCursor('grabbing');
          live.current.onHandleDrag?.(hd.id, geo().invX(p.x));
        } else if (region === 'xaxis') {
          s.mode = 'axisX';
          s.anchor = p;
          setCursor('ew-resize');
        } else if (region === 'yaxis' && !live.current.lockY) {
          s.mode = 'axisY';
          s.anchor = p;
          setCursor('ns-resize');
        } else {
          s.mode = 'pan';
          setCursor('grabbing');
        }
      } else if (s.pts.size === 2) {
        s.mode = 'pinch';
        const [a, b] = [...s.pts.values()];
        s.prevMid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        s.prevDist = Math.hypot(a.x - b.x, a.y - b.y);
        s.prevDx = Math.abs(a.x - b.x);
        s.prevDy = Math.abs(a.y - b.y);
      }
    };

    const move = (e) => {
      const s = ptr.current;
      const p = local(e);
      if (!s.pts.has(e.pointerId)) {
        if (e.pointerType === 'mouse') {
          const region = regionOf(p, geo());
          if (hit(p)) setCursor('ew-resize');
          else if (region === 'xaxis') setCursor('ew-resize');
          else if (region === 'yaxis' && !live.current.lockY) setCursor('ns-resize');
          else setCursor('grab');
        }
        return;
      }
      const prev = s.pts.get(e.pointerId);
      s.pts.set(e.pointerId, p);
      const { view, onView, lockY } = live.current;
      const g = geo();
      if (s.mode === 'handle') {
        live.current.onHandleDrag?.(s.handleId, g.invX(p.x));
      } else if (s.mode === 'pan') {
        const dx = ((p.x - prev.x) * (view.xmax - view.xmin)) / g.plotW;
        const dy = ((p.y - prev.y) * (view.ymax - view.ymin)) / g.plotH;
        onView?.({
          xmin: view.xmin - dx,
          xmax: view.xmax - dx,
          ymin: lockY ? view.ymin : view.ymin + dy,
          ymax: lockY ? view.ymax : view.ymax + dy,
        });
      } else if (s.mode === 'axisX') {
        const f = Math.exp(-(p.x - prev.x) * 0.006); // drag right = zoom in
        onView?.(zoomAxes(view, g, s.anchor.x, 0, f, 1, lockY));
      } else if (s.mode === 'axisY') {
        const f = Math.exp((p.y - prev.y) * 0.006); // drag up = zoom in
        onView?.(zoomAxes(view, g, 0, s.anchor.y, 1, f, lockY));
      } else if (s.mode === 'pinch' && s.pts.size >= 2) {
        const [a, b] = [...s.pts.values()];
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        const dx = Math.abs(a.x - b.x);
        const dy = Math.abs(a.y - b.y);
        // fingers side by side -> stretch x only; one above the other -> y only; diagonal -> both
        const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
        let fx = 1;
        let fy = 1;
        if (angle < 28) {
          if (dx > 8 && s.prevDx > 8) fx = s.prevDx / dx;
        } else if (angle > 62) {
          if (dy > 8 && s.prevDy > 8) fy = s.prevDy / dy;
        } else if (dist > 8 && s.prevDist > 8) {
          fx = s.prevDist / dist;
          fy = fx;
        }
        const nv = zoomAxes(view, g, mid.x, mid.y, fx, fy, lockY);
        // follow the movement of the midpoint
        const g2 = geometry(nv, live.current.w, live.current.height, live.current.margins);
        const mx = ((mid.x - s.prevMid.x) * (nv.xmax - nv.xmin)) / g2.plotW;
        const my = ((mid.y - s.prevMid.y) * (nv.ymax - nv.ymin)) / g2.plotH;
        onView?.({
          xmin: nv.xmin - mx,
          xmax: nv.xmax - mx,
          ymin: lockY ? nv.ymin : nv.ymin + my,
          ymax: lockY ? nv.ymax : nv.ymax + my,
        });
        s.prevMid = mid;
        s.prevDist = dist;
        s.prevDx = dx;
        s.prevDy = dy;
      }
    };

    const up = (e) => {
      const s = ptr.current;
      s.pts.delete(e.pointerId);
      canvas.releasePointerCapture?.(e.pointerId);
      if (s.pts.size === 0) {
        s.mode = null;
        s.handleId = null;
        setCursor('grab');
      } else if (s.pts.size === 1) {
        s.mode = 'pan'; // finger lifted during a pinch: carry on panning with the other one
      }
    };

    const wheel = (e) => {
      e.preventDefault();
      const { view, onView, lockY } = live.current;
      const p = local(e);
      const g = geo();
      const unit = e.deltaMode === 1 ? 16 : 1;
      const raw = (e.deltaY !== 0 ? e.deltaY : e.deltaX) * unit; // Shift+wheel may arrive as deltaX
      const k = e.ctrlKey ? 0.01 : 0.0016;
      const factor = Math.exp(Math.max(-60, Math.min(60, raw)) * k);
      const region = regionOf(p, g);
      let fx = factor;
      let fy = factor;
      if (region === 'xaxis' || e.shiftKey) fy = 1;
      else if (region === 'yaxis' || e.altKey) fx = 1;
      onView?.(zoomAxes(view, g, p.x, p.y, fx, fy, lockY));
    };

    const dbl = () => live.current.onReset?.();

    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('wheel', wheel, { passive: false });
    canvas.addEventListener('dblclick', dbl);
    return () => {
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up);
      canvas.removeEventListener('pointercancel', up);
      canvas.removeEventListener('wheel', wheel);
      canvas.removeEventListener('dblclick', dbl);
    };
  }, []);

  const zoomBy = (fx, fy) => () => {
    const g = geometry(view, w, height, margins);
    onView?.(zoomAxes(view, g, g.left + g.plotW / 2, g.top + g.plotH / 2, fx, fy, lockY));
  };
  const IN = 0.75;
  const OUT = 1 / 0.75;

  return (
    <div className="plot-block">
      <div className="plot-wrap" ref={wrapRef} style={{ height }}>
        <canvas ref={canvasRef} role="img" aria-label={label} style={{ cursor, touchAction: 'none' }} />
      </div>
      {buttons && (
        <div className="plot-toolbar" role="group" aria-label="Zoom and stretch the plot">
          <span className="tb-group">
            <span className="tb-label">Zoom</span>
            <button type="button" className="tb-btn" onClick={zoomBy(IN, IN)} aria-label="Zoom in" title="Zoom in">+</button>
            <button type="button" className="tb-btn" onClick={zoomBy(OUT, OUT)} aria-label="Zoom out" title="Zoom out">−</button>
          </span>
          <span className="tb-group">
            <span className="tb-label">Horizontal</span>
            <button type="button" className="tb-btn" onClick={zoomBy(IN, 1)} aria-label="Stretch horizontally (zoom in on x)" title="Stretch horizontally">+</button>
            <button type="button" className="tb-btn" onClick={zoomBy(OUT, 1)} aria-label="Squeeze horizontally (zoom out on x)" title="Squeeze horizontally">−</button>
          </span>
          {!lockY && (
            <span className="tb-group">
              <span className="tb-label">Vertical</span>
              <button type="button" className="tb-btn" onClick={zoomBy(1, IN)} aria-label="Stretch vertically (zoom in on y)" title="Stretch vertically">+</button>
              <button type="button" className="tb-btn" onClick={zoomBy(1, OUT)} aria-label="Squeeze vertically (zoom out on y)" title="Squeeze vertically">−</button>
            </span>
          )}
          {onReset && (
            <>
              <span className="tb-spacer" />
              <button type="button" className="tb-btn text" onClick={onReset} title="Reset the view">Reset view</button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** Stroke y(x) samples, lifting the pen at gaps (NaN) and at vertical asymptotes. */
function strokePath(ctx, g, xs, ys, style) {
  ctx.save();
  ctx.strokeStyle = style.color ?? COL.ink;
  ctx.lineWidth = style.width ?? 2;
  ctx.globalAlpha = style.alpha ?? 1;
  ctx.setLineDash(style.dash ?? []);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  const limit = g.plotH * 30;
  ctx.beginPath();
  let pen = false;
  let prevY = 0;
  let prevPy = 0;
  for (let i = 0; i < xs.length; i++) {
    const y = ys[i];
    if (!Number.isFinite(y)) {
      pen = false;
      continue;
    }
    const raw = g.Y(y);
    const px = g.X(xs[i]);
    if (pen && Math.sign(y) !== Math.sign(prevY) && Math.abs(raw - prevPy) > g.plotH * 2) pen = false;
    const py = Math.max(-limit, Math.min(g.top + g.plotH + limit, raw));
    if (pen) ctx.lineTo(px, py);
    else ctx.moveTo(px, py);
    pen = true;
    prevY = y;
    prevPy = raw;
  }
  ctx.stroke();
  ctx.restore();
}
