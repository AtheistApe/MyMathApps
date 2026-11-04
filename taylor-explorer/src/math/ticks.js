// "Nice" axis ticks

export function niceTicks(min, max, target = 6) {
  const span = max - min;
  if (!(span > 0)) return [];
  const raw = span / Math.max(2, target);
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = (norm < 1.5 ? 1 : norm < 3.5 ? 2 : norm < 7.5 ? 5 : 10) * mag;
  const out = [];
  for (let t = Math.ceil(min / step) * step; t <= max + step * 1e-9; t += step) out.push(Number(t.toPrecision(12)));
  return out;
}

export function tickLabel(t) {
  if (t === 0) return '0';
  const a = Math.abs(t);
  if (a >= 1e5 || a < 1e-3) return t.toExponential(0).replace('e+', 'e');
  return String(Number(t.toPrecision(6)));
}
