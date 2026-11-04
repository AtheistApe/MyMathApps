// Pure geometry for the plot: data <-> pixel mapping, zooming, panning, hit regions.
// No React and no canvas here, so all of it can be tested in plain node.

export const DEFAULT_MARGINS = { l: 56, r: 14, t: 12, b: 34 };
export const MIN_SPAN = 1e-4;
export const MAX_SPAN = 1e5;

/** Mapping between data coordinates and canvas pixels for a view window. */
export function geometry(view, w, h, m) {
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

/**
 * Scale the x and/or y span about the data point under pixel (px, py).
 * fx, fy < 1 zoom in; 1 leaves that axis alone. An axis that would leave the allowed span is unchanged.
 */
export function zoomAxes(view, g, px, py, fx, fy, lockY) {
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

/** Move the window by (dx, dy) in data units. */
export function translate(view, dx, dy, lockY) {
  return {
    xmin: view.xmin + dx,
    xmax: view.xmax + dx,
    ymin: lockY ? view.ymin : view.ymin + dy,
    ymax: lockY ? view.ymax : view.ymax + dy,
  };
}

/** Which part of the canvas a point is in: 'plot', the 'xaxis' strip, the 'yaxis' strip, or 'corner'. */
export function regionOf(p, g) {
  const inX = p.x >= g.left && p.x <= g.left + g.plotW;
  const inY = p.y >= g.top && p.y <= g.top + g.plotH;
  if (inX && inY) return 'plot';
  if (inX && p.y > g.top + g.plotH) return 'xaxis';
  if (inY && p.x < g.left) return 'yaxis';
  return 'corner';
}

/** Pixel position of a handle: anchored to the bottom/top edge, or sitting on the curve at (x, y). */
export function handlePixel(hd, g, h, m) {
  const px = g.X(hd.x);
  let py;
  if (hd.anchor === 'bottom') py = h - m.b - 16;
  else if (hd.anchor === 'top') py = m.t + 16;
  else py = g.Y(hd.y);
  return { px, py };
}
