// Tiny numeric helpers shared across the app.

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** Round to a grid (default 0.05): used by sliders and by dragging handles on a plot. */
export function snap(v, step = 0.05) {
  return Number((Math.round(v / step) * step).toFixed(6));
}

/**
 * Cache a one-argument numeric function. Plots evaluate f at the same x values several times per frame
 * (main plot, error plot, readouts), which is wasteful for functions that are slow to evaluate.
 */
export function memoize1(fn, limit = 4096) {
  const cache = new Map();
  return (x) => {
    let v = cache.get(x);
    if (v === undefined) {
      v = fn(x);
      if (cache.size >= limit) cache.clear();
      cache.set(x, v);
    }
    return v;
  };
}
