// Canvas drawing helpers shared by every plot.

import { COL } from '../theme.js';
import { niceTicks, tickLabel } from '../math/ticks.js';
import { sup } from '../math/numfmt.js';
import { handlePixel } from './geometry.js';

/** Keep pixel coordinates in a sane range (the canvas misbehaves with astronomically large values). */
export const clampPx = (v, lim = 1e4) => Math.max(-lim, Math.min(lim, v));

/** A dot with a white ring (used for points on curves). */
export function drawDot(ctx, px, py, color, r = 5, ring = 2) {
  ctx.beginPath();
  ctx.arc(px, py, r, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  if (ring) {
    ctx.lineWidth = ring;
    ctx.strokeStyle = '#fff';
    ctx.stroke();
  }
}

/** A straight line with optional dash / alpha. */
export function drawLine(ctx, x1, y1, x2, y2, { color = COL.ink, width = 1.5, dash = [], alpha = 1 } = {}) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.globalAlpha = alpha;
  ctx.setLineDash(dash);
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  ctx.restore();
}

/** Background, grid lines, and tick labels. */
export function drawGrid(ctx, g, view, { yLog = false } = {}) {
  ctx.font = '12px system-ui, -apple-system, "Segoe UI", sans-serif';
  ctx.strokeStyle = COL.grid;
  ctx.lineWidth = 1;

  const xt = niceTicks(view.xmin, view.xmax, g.plotW / 80);
  let yt;
  if (yLog) {
    // ticks at integer powers of ten, thinned out when the plot is short
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

  ctx.fillStyle = COL.text;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (const t of xt) ctx.fillText(tickLabel(t), g.X(t), g.top + g.plotH + 6);
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (const t of yt) ctx.fillText(yLog ? `10${sup(t)}` : tickLabel(t), g.left - 7, g.Y(t));
}

/** The x = 0 and y = 0 axes (only where they are inside the window). */
export function drawOriginAxes(ctx, g, view, { yLog = false } = {}) {
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
}

/** Dashed guide lines for handles that ask for one (`guide: true`): vertical for x handles, horizontal for y handles. */
export function drawHandleGuides(ctx, g, handles) {
  for (const hd of handles) {
    if (!hd.guide) continue;
    const style = { color: hd.color, width: 1.5, dash: [5, 4], alpha: 0.55 };
    if (hd.axis === 'y') {
      const py = Math.round(g.Y(hd.y)) + 0.5;
      drawLine(ctx, g.left, py, g.left + g.plotW, py, style);
    } else {
      const px = Math.round(g.X(hd.x)) + 0.5;
      drawLine(ctx, px, g.top, px, g.top + g.plotH, style);
    }
  }
}

/** The draggable knobs themselves (drawn on top, outside the clip region). */
export function drawHandleKnobs(ctx, g, handles, height, margins) {
  for (const hd of handles) {
    const { px, py } = handlePixel(hd, g, height, margins);
    if (!Number.isFinite(px) || !Number.isFinite(py)) continue;
    if (px < g.left - 2 || px > g.left + g.plotW + 2 || py < g.top - 2 || py > g.top + g.plotH + 2) continue;
    drawDot(ctx, px, py, hd.color, 10, 3);
    if (hd.label) {
      ctx.font = 'italic 600 14px Georgia, "Times New Roman", serif';
      ctx.fillStyle = hd.color;
      ctx.textBaseline = 'bottom';
      if (hd.axis === 'y') {
        ctx.textAlign = 'right'; // keep the label inside the plot, to the left of the knob
        ctx.fillText(hd.label, px - 12, py - 8);
      } else {
        ctx.textAlign = 'left';
        ctx.fillText(hd.label, px + 12, py - 8);
      }
    }
  }
}

/**
 * Stroke y(x) samples, lifting the pen at gaps (NaN/∞) and at vertical asymptotes
 * (a sign change across a jump of more than two plot heights).
 */
export function strokePath(ctx, g, xs, ys, style = {}) {
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

/**
 * The marks every Taylor plot shares at the test point x0: the two heights f(x0) and Tn(x0)
 * as dots, and (optionally) the red segment between them showing the error.
 */
export function drawTestPoint(ctx, H, x0, f0, t0, { gap = false } = {}) {
  const px = H.X(x0);
  if (gap && Number.isFinite(f0) && Number.isFinite(t0)) {
    drawLine(ctx, px, clampPx(H.Y(f0)), px, clampPx(H.Y(t0)), { color: COL.err, width: 3 });
  }
  if (Number.isFinite(f0)) drawDot(ctx, px, H.Y(f0), COL.fn);
  if (Number.isFinite(t0)) drawDot(ctx, px, H.Y(t0), COL.poly);
}
