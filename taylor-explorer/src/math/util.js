// Tiny numeric helpers shared across the app.

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** Round to a grid (default 0.05): used by sliders and by dragging handles on a plot. */
export function snap(v, step = 0.05) {
  return Number((Math.round(v / step) * step).toFixed(6));
}
