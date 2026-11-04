// A small, dependency-free interactive plot. The component is controlled: the parent owns `view`
// ({xmin, xmax, ymin, ymax}) and passes `onView`. See plot/useGestures.js for the gestures.
//
//   draw(ctx, H)   called every render, clipped to the plot area. H has the pixel mapping (H.X, H.Y,
//                  H.invX, H.invY, H.left/top/plotW/plotH) plus helpers:
//                    H.samples(step)        pixel-spaced x values
//                    H.stroke(xs, ys, style) draw a curve (gaps and asymptotes handled)
//                    H.curve(f, style)       sample f and draw it
//   handles        [{id, x, y | anchor:'bottom'|'top', color, label, guide}] draggable horizontally
//   onHandleDrag   (id, x) => void
//   lockY          pan/zoom only horizontally (y is set by the parent)
//   yLog           the y values are log10 values: label the axis 10^k

import { useLayoutEffect, useRef, useState } from 'react';
import { COL } from '../theme.js';
import { DEFAULT_MARGINS, geometry, zoomAxes } from '../plot/geometry.js';
import { drawGrid, drawHandleGuides, drawHandleKnobs, drawOriginAxes, strokePath } from '../plot/draw.js';
import { usePlotGestures } from '../plot/useGestures.js';

const ZOOM_IN = 0.75;
const ZOOM_OUT = 1 / 0.75;

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

  // the gesture listeners are attached once and read the latest props from here
  const live = useRef({});
  live.current = { view, onView, onReset, handles, onHandleDrag, lockY, w, height, margins };
  usePlotGestures(canvasRef, live, setCursor);

  // ---- follow the container width ------------------------------------------
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return undefined;
    const update = () => setW(Math.max(200, Math.floor(el.clientWidth)));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ---- draw (every render: the parent re-renders when anything on the plot changes) ----
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const pw = Math.round(w * dpr);
    const ph = Math.round(height * dpr);
    // assigning width/height reallocates the bitmap, so only do it when the size really changed
    if (canvas.width !== pw) canvas.width = pw;
    if (canvas.height !== ph) canvas.height = ph;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const g = geometry(view, w, height, margins);
    ctx.fillStyle = COL.bg;
    ctx.fillRect(0, 0, w, height);
    drawGrid(ctx, g, view, { yLog });

    ctx.save();
    ctx.beginPath();
    ctx.rect(g.left, g.top, g.plotW, g.plotH);
    ctx.clip();
    drawOriginAxes(ctx, g, view, { yLog });
    const H = {
      ...g,
      view,
      samples: (step = 1.5) => {
        const n = Math.max(2, Math.ceil(g.plotW / step));
        return Array.from({ length: n + 1 }, (_, i) => view.xmin + ((view.xmax - view.xmin) * i) / n);
      },
      stroke: (xs, ys, style) => strokePath(ctx, g, xs, ys, style),
      curve: (f, style, step = 1.5) => {
        const xs = H.samples(step);
        strokePath(ctx, g, xs, xs.map(f), style);
      },
    };
    draw?.(ctx, H);
    drawHandleGuides(ctx, g, handles);
    ctx.restore();

    ctx.strokeStyle = COL.axis;
    ctx.lineWidth = 1;
    ctx.strokeRect(g.left + 0.5, g.top + 0.5, g.plotW, g.plotH);
    drawHandleKnobs(ctx, g, handles, height, margins);
  });

  // axes: 'both' | 'x' | 'y'; factor < 1 zooms in
  const zoom = (axes, factor) => () => {
    const g = geometry(view, w, height, margins);
    const fx = axes === 'y' ? 1 : factor;
    const fy = axes === 'x' ? 1 : factor;
    onView?.(zoomAxes(view, g, g.left + g.plotW / 2, g.top + g.plotH / 2, fx, fy, lockY));
  };

  return (
    <div className="plot-block">
      <div className="plot-wrap" ref={wrapRef} style={{ height }}>
        <canvas
          ref={canvasRef}
          tabIndex={0}
          role="img"
          aria-label={`${label}. Arrow keys pan, plus and minus zoom, 0 resets the view.`}
          style={{ cursor, touchAction: 'none' }}
        />
      </div>
      {buttons && <PlotToolbar zoom={zoom} onReset={onReset} lockY={lockY} />}
    </div>
  );
}

function PlotToolbar({ zoom, onReset, lockY }) {
  const group = (name, axes, inTitle, outTitle) => (
    <span className="tb-group">
      <span className="tb-label">{name}</span>
      <button type="button" className="tb-btn" onClick={zoom(axes, ZOOM_IN)} aria-label={inTitle} title={inTitle}>+</button>
      <button type="button" className="tb-btn" onClick={zoom(axes, ZOOM_OUT)} aria-label={outTitle} title={outTitle}>−</button>
    </span>
  );
  return (
    <div className="plot-toolbar" role="group" aria-label="Zoom and stretch the plot">
      {group('Zoom', 'both', 'Zoom in', 'Zoom out')}
      {group('Horizontal', 'x', 'Stretch horizontally (zoom in on x)', 'Squeeze horizontally (zoom out on x)')}
      {!lockY && group('Vertical', 'y', 'Stretch vertically (zoom in on y)', 'Squeeze vertically (zoom out on y)')}
      {onReset && (
        <>
          <span className="tb-spacer" />
          <button type="button" className="tb-btn text" onClick={onReset} title="Reset the view">Reset view</button>
        </>
      )}
    </div>
  );
}
