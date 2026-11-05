// Mouse, touch, wheel and keyboard interaction for PlotCanvas.
//
//  handles slide along x (a, x0) or, with axis: 'y', along y (the M line); they are grabbed where touched
//  mouse   drag = pan · wheel = zoom (Shift: x only, Alt: y only, over an axis: that axis) · drag along an axis
//  touch   one finger = pan · two fingers: side by side = stretch x, one above the other = stretch y, diagonal = both
//  keys    arrows pan · + / − zoom · 0 or Home resets (the canvas is focusable for keyboard users)
//
// `live` is a ref that always holds the latest props, so the listeners can be attached once.

import { useEffect, useRef } from 'react';
import { geometry, handlePixel, regionOf, translate, zoomAxes } from './geometry.js';

const HIT_RADIUS = 26; // generous, for fingers
const AXIS_DRAG_RATE = 0.006;
const PINCH_X_MAX_ANGLE = 28; // fingers closer to horizontal than this: stretch x only
const PINCH_Y_MIN_ANGLE = 62; // fingers closer to vertical than this: stretch y only

export function usePlotGestures(canvasRef, live, setCursor) {
  const state = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    const s = {
      pts: new Map(),
      mode: null, // 'handle' | 'pan' | 'axisX' | 'axisY' | 'pinch'
      handleId: null,
      handleAxis: 'x',
      handleOffset: 0,
      anchor: null,
      prevMid: null,
      prevDist: 0,
      prevDx: 0,
      prevDy: 0,
    };
    state.current = s;

    const local = (e) => {
      const r = canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const geo = () => {
      const { view, w, height, margins } = live.current;
      return geometry(view, w, height, margins);
    };
    // Apply a new view immediately (so the next event builds on it) and tell the parent.
    const commit = (v) => {
      live.current.view = v;
      live.current.onView?.(v);
    };
    const hitHandle = (p) => {
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
    const hoverCursor = (p) => {
      const region = regionOf(p, geo());
      const hd = hitHandle(p);
      if (hd) return hd.axis === 'y' ? 'ns-resize' : 'ew-resize';
      if (region === 'xaxis') return 'ew-resize';
      if (region === 'yaxis' && !live.current.lockY) return 'ns-resize';
      return 'grab';
    };

    // ---- pointer ---------------------------------------------------------
    const down = (e) => {
      canvas.setPointerCapture?.(e.pointerId);
      const p = local(e);
      s.pts.set(e.pointerId, p);
      if (s.pts.size === 1) {
        const g = geo();
        const hd = hitHandle(p);
        const region = regionOf(p, g);
        if (hd) {
          s.mode = 'handle';
          s.handleId = hd.id;
          s.handleAxis = hd.axis === 'y' ? 'y' : 'x';
          s.handleOffset = s.handleAxis === 'y' ? hd.y - g.invY(p.y) : hd.x - g.invX(p.x); // grab it where you touched it: no jump
          setCursor('grabbing');
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
      const p = local(e);
      if (!s.pts.has(e.pointerId)) {
        if (e.pointerType === 'mouse') setCursor(hoverCursor(p));
        return;
      }
      const prev = s.pts.get(e.pointerId);
      s.pts.set(e.pointerId, p);
      const { view, lockY, onHandleDrag } = live.current;
      const g = geo();
      const spanX = view.xmax - view.xmin;
      const spanY = view.ymax - view.ymin;

      if (s.mode === 'handle') {
        onHandleDrag?.(s.handleId, (s.handleAxis === 'y' ? g.invY(p.y) : g.invX(p.x)) + s.handleOffset);
      } else if (s.mode === 'pan') {
        commit(translate(view, (-(p.x - prev.x) * spanX) / g.plotW, ((p.y - prev.y) * spanY) / g.plotH, lockY));
      } else if (s.mode === 'axisX') {
        commit(zoomAxes(view, g, s.anchor.x, 0, Math.exp(-(p.x - prev.x) * AXIS_DRAG_RATE), 1, lockY)); // right = zoom in
      } else if (s.mode === 'axisY') {
        commit(zoomAxes(view, g, 0, s.anchor.y, 1, Math.exp((p.y - prev.y) * AXIS_DRAG_RATE), lockY)); // up = zoom in
      } else if (s.mode === 'pinch' && s.pts.size >= 2) {
        const [a, b] = [...s.pts.values()];
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        const dx = Math.abs(a.x - b.x);
        const dy = Math.abs(a.y - b.y);
        const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
        let fx = 1;
        let fy = 1;
        if (angle < PINCH_X_MAX_ANGLE) {
          if (dx > 8 && s.prevDx > 8) fx = s.prevDx / dx;
        } else if (angle > PINCH_Y_MIN_ANGLE) {
          if (dy > 8 && s.prevDy > 8) fy = s.prevDy / dy;
        } else if (dist > 8 && s.prevDist > 8) {
          fx = s.prevDist / dist;
          fy = fx;
        }
        const zoomed = zoomAxes(view, g, mid.x, mid.y, fx, fy, lockY);
        // then follow the movement of the midpoint
        commit(
          translate(
            zoomed,
            (-(mid.x - s.prevMid.x) * (zoomed.xmax - zoomed.xmin)) / g.plotW,
            ((mid.y - s.prevMid.y) * (zoomed.ymax - zoomed.ymin)) / g.plotH,
            lockY,
          ),
        );
        s.prevMid = mid;
        s.prevDist = dist;
        s.prevDx = dx;
        s.prevDy = dy;
      }
    };

    const up = (e) => {
      s.pts.delete(e.pointerId);
      canvas.releasePointerCapture?.(e.pointerId);
      if (s.pts.size === 0) {
        s.mode = null;
        s.handleId = null;
        setCursor('grab');
      } else if (s.pts.size === 1) {
        s.mode = 'pan'; // one finger lifted during a pinch: carry on panning with the other
      }
    };

    // ---- wheel ------------------------------------------------------------------
    const wheel = (e) => {
      e.preventDefault();
      const { view, lockY } = live.current;
      const p = local(e);
      const g = geo();
      const unit = e.deltaMode === 1 ? 16 : 1;
      const raw = (e.deltaY !== 0 ? e.deltaY : e.deltaX) * unit; // Shift+wheel can arrive as deltaX
      const factor = Math.exp(Math.max(-60, Math.min(60, raw)) * (e.ctrlKey ? 0.01 : 0.0016));
      const region = regionOf(p, g);
      let fx = factor;
      let fy = factor;
      if (region === 'xaxis' || e.shiftKey) fy = 1;
      else if (region === 'yaxis' || e.altKey) fx = 1;
      commit(zoomAxes(view, g, p.x, p.y, fx, fy, lockY));
    };

    // ---- keyboard -------------------------------------------------------------------
    const key = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const { view, lockY } = live.current;
      const g = geo();
      const dx = (view.xmax - view.xmin) * 0.1;
      const dy = (view.ymax - view.ymin) * 0.1;
      const cx = g.left + g.plotW / 2;
      const cy = g.top + g.plotH / 2;
      switch (e.key) {
        case 'ArrowLeft': commit(translate(view, -dx, 0, lockY)); break;
        case 'ArrowRight': commit(translate(view, dx, 0, lockY)); break;
        case 'ArrowUp': commit(translate(view, 0, dy, lockY)); break;
        case 'ArrowDown': commit(translate(view, 0, -dy, lockY)); break;
        case '+': case '=': commit(zoomAxes(view, g, cx, cy, 0.8, 0.8, lockY)); break;
        case '-': case '_': commit(zoomAxes(view, g, cx, cy, 1.25, 1.25, lockY)); break;
        case '0': case 'Home': live.current.onReset?.(); break;
        default: return;
      }
      e.preventDefault();
    };

    const dbl = () => live.current.onReset?.();

    const listeners = [
      ['pointerdown', down],
      ['pointermove', move],
      ['pointerup', up],
      ['pointercancel', up],
      ['dblclick', dbl],
      ['keydown', key],
    ];
    for (const [type, fn] of listeners) canvas.addEventListener(type, fn);
    canvas.addEventListener('wheel', wheel, { passive: false });
    return () => {
      for (const [type, fn] of listeners) canvas.removeEventListener(type, fn);
      canvas.removeEventListener('wheel', wheel);
    };
  }, [canvasRef, live, setCursor]);
}
