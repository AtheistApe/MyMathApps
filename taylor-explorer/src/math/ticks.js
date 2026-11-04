// "Nice" axis ticks

export function niceTicks(min, max, target = 6) {
  const span = max - min;
  if (!(span > 0) || !Number.isFinite(span)) return [];
  const raw = span / Math.max(2, target);
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = (norm < 1.5 ? 1 : norm < 3.5 ? 2 : norm < 7.5 ? 5 : 10) * mag;
  if (step < 8 * 2.22e-16 * Math.max(Math.abs(min), Math.abs(max))) return []; // below floating-point resolution
  // Index-based (t = first + i·step), so it terminates even when `step` is smaller than the
  // floating-point spacing at |min| (a view panned extremely far from the origin).
  const first = Math.ceil(min / step);
  const last = Math.floor(max / step + 1e-9);
  const out = [];
  for (let i = first; i <= last && out.length < 200; i++) out.push(Number((i * step).toPrecision(12)));
  return out;
}

export function tickLabel(t) {
  if (t === 0) return '0';
  const a = Math.abs(t);
  if (a >= 1e5 || a < 1e-3) return t.toExponential(0).replace('e+', 'e');
  return String(Number(t.toPrecision(6)));
}
