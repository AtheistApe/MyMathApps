// Preset functions. Every preset provides exact Taylor coefficients about ANY center a,
// the radius of convergence R(a), and the behaviour at the endpoints of the interval.
//
// Interface (custom functions in customFunction.js implement the same one):
//   id, label, f(x)
//   coeffs(a, N)      -> [c_0 ... c_N]  with c_k = f^(k)(a)/k!
//   radius(a)         -> R (Infinity for entire functions) | null if unknown
//   endpoints(a)      -> { left: 'converges'|'diverges', right: ... } | null
//   centerRange       -> [lo, hi] allowed centers
//   defaultView       -> { xmin, xmax, ymin, ymax }
//   maxDegree         -> highest degree supported

const fact = [1];
for (let i = 1; i <= 170; i++) fact[i] = fact[i - 1] * i;

/** Taylor coefficients of 1/(1+x²) about a (stable recurrence). */
function recipOnePlusXSq(a, N) {
  const d0 = 1 + a * a;
  const d1 = 2 * a;
  const q = new Array(N + 1);
  q[0] = 1 / d0;
  if (N >= 1) q[1] = (-d1 * q[0]) / d0;
  for (let k = 2; k <= N; k++) q[k] = -(d1 * q[k - 1] + q[k - 2]) / d0;
  return q;
}

const both = (v) => ({ left: v, right: v });

export const PRESETS = [
  {
    id: 'exp',
    label: 'eˣ',
    f: Math.exp,
    coeffs: (a, N) => {
      const e = Math.exp(a);
      return Array.from({ length: N + 1 }, (_, k) => e / fact[k]);
    },
    radius: () => Infinity,
    endpoints: () => null,
    centerRange: [-3, 3],
    defaultView: { xmin: -5, xmax: 5, ymin: -4, ymax: 14 },
    note: 'Entire function: the series converges for every x.',
  },
  {
    id: 'sin',
    label: 'sin x',
    f: Math.sin,
    coeffs: (a, N) => {
      const s = Math.sin(a);
      const c = Math.cos(a);
      const cyc = [s, c, -s, -c];
      return Array.from({ length: N + 1 }, (_, k) => cyc[k % 4] / fact[k]);
    },
    radius: () => Infinity,
    endpoints: () => null,
    centerRange: [-3, 3],
    defaultView: { xmin: -8, xmax: 8, ymin: -3, ymax: 3 },
    note: 'Entire function: the series converges for every x.',
  },
  {
    id: 'cos',
    label: 'cos x',
    f: Math.cos,
    coeffs: (a, N) => {
      const s = Math.sin(a);
      const c = Math.cos(a);
      const cyc = [c, -s, -c, s];
      return Array.from({ length: N + 1 }, (_, k) => cyc[k % 4] / fact[k]);
    },
    radius: () => Infinity,
    endpoints: () => null,
    centerRange: [-3, 3],
    defaultView: { xmin: -8, xmax: 8, ymin: -3, ymax: 3 },
    note: 'Entire function: the series converges for every x.',
  },
  {
    id: 'geom',
    label: '1/(1 − x)',
    f: (x) => 1 / (1 - x),
    coeffs: (a, N) => {
      const r = 1 / (1 - a);
      const c = new Array(N + 1);
      c[0] = r;
      for (let k = 1; k <= N; k++) c[k] = c[k - 1] * r;
      return c;
    },
    radius: (a) => Math.abs(1 - a),
    endpoints: () => both('diverges'),
    centerRange: [-3, 3],
    defaultView: { xmin: -3, xmax: 3, ymin: -5, ymax: 6 },
    note: 'The geometric series. f blows up at x = 1, which limits the radius.',
  },
  {
    id: 'lorentz',
    label: '1/(1 + x²)',
    f: (x) => 1 / (1 + x * x),
    coeffs: (a, N) => recipOnePlusXSq(a, N),
    radius: (a) => Math.sqrt(1 + a * a),
    endpoints: () => both('diverges'),
    centerRange: [-3, 3],
    defaultView: { xmin: -4, xmax: 4, ymin: -1.5, ymax: 2 },
    note: 'Smooth on the whole real line, yet R = 1 at a = 0. The trouble is at x = ±i.',
  },
  {
    id: 'ln',
    label: 'ln(1 + x)',
    f: (x) => (x > -1 ? Math.log(1 + x) : NaN),
    coeffs: (a, N) => {
      const r = 1 / (1 + a);
      const c = new Array(N + 1);
      c[0] = Math.log(1 + a);
      let p = 1;
      for (let k = 1; k <= N; k++) {
        p *= r;
        c[k] = (k % 2 === 1 ? 1 : -1) * p / k;
      }
      return c;
    },
    radius: (a) => 1 + a,
    endpoints: () => ({ left: 'diverges', right: 'converges' }),
    centerRange: [-0.9, 4],
    defaultView: { xmin: -1.5, xmax: 4, ymin: -4, ymax: 3 },
    note: 'At a = 0: converges at x = 1 (alternating harmonic), diverges at x = −1 (harmonic).',
  },
  {
    id: 'atan',
    label: 'arctan x',
    f: Math.atan,
    coeffs: (a, N) => {
      const q = recipOnePlusXSq(a, N);
      const c = new Array(N + 1);
      c[0] = Math.atan(a);
      for (let k = 1; k <= N; k++) c[k] = q[k - 1] / k;
      return c;
    },
    radius: (a) => Math.sqrt(1 + a * a),
    endpoints: () => both('converges'),
    centerRange: [-3, 3],
    defaultView: { xmin: -4, xmax: 4, ymin: -2.5, ymax: 2.5 },
    note: 'Like 1/(1 + x²), R = 1 at a = 0, but here both endpoints converge.',
  },
  {
    id: 'sqrt',
    label: '√(1 + x)',
    f: (x) => (x >= -1 ? Math.sqrt(1 + x) : NaN),
    coeffs: (a, N) => {
      const s = Math.sqrt(1 + a);
      const r = 1 / (1 + a);
      const c = new Array(N + 1);
      let b = 1; // binomial(1/2, k)
      let p = 1; // r^k
      c[0] = s;
      for (let k = 1; k <= N; k++) {
        b = (b * (0.5 - k + 1)) / k;
        p *= r;
        c[k] = b * s * p;
      }
      return c;
    },
    radius: (a) => 1 + a,
    endpoints: () => both('converges'),
    centerRange: [-0.9, 4],
    defaultView: { xmin: -1.5, xmax: 5, ymin: -1, ymax: 3.5 },
    note: 'A binomial series: converges at both endpoints.',
  },
  {
    id: 'gauss',
    label: 'e^(−x²)',
    f: (x) => Math.exp(-x * x),
    coeffs: (a, N) => {
      const c = new Array(N + 1);
      c[0] = Math.exp(-a * a);
      if (N >= 1) c[1] = -2 * a * c[0];
      for (let k = 1; k < N; k++) c[k + 1] = (-2 * a * c[k] - 2 * c[k - 1]) / (k + 1);
      return c;
    },
    radius: () => Infinity,
    endpoints: () => null,
    centerRange: [-3, 3],
    defaultView: { xmin: -4, xmax: 4, ymin: -1.5, ymax: 2 },
    note: 'Entire, but you need many terms before the polynomial settles down far from the center.',
  },
  {
    id: 'tan',
    label: 'tan x',
    f: Math.tan,
    coeffs: (a, N) => {
      const t = new Array(N + 1);
      t[0] = Math.tan(a);
      for (let k = 0; k < N; k++) {
        let s = k === 0 ? 1 : 0;
        for (let i = 0; i <= k; i++) s += t[i] * t[k - i];
        t[k + 1] = s / (k + 1);
      }
      return t;
    },
    radius: (a) => {
      const m = Math.round((a - Math.PI / 2) / Math.PI);
      let best = Infinity;
      for (let j = m - 1; j <= m + 1; j++) best = Math.min(best, Math.abs(Math.PI / 2 + j * Math.PI - a));
      return best;
    },
    endpoints: () => both('diverges'),
    centerRange: [-3, 3],
    defaultView: { xmin: -4, xmax: 4, ymin: -6, ymax: 6 },
    note: 'R = π/2 at a = 0: the nearest vertical asymptote sets the radius.',
  },
].map((p) => ({ maxDegree: 40, custom: false, ...p }));

export const presetById = (id) => PRESETS.find((p) => p.id === id) ?? PRESETS[0];

/** Pick a reasonable viewing window for a function we know nothing about. */
export function autoView(f, xmin = -5, xmax = 5) {
  const ys = [];
  for (let i = 0; i <= 400; i++) {
    const y = f(xmin + ((xmax - xmin) * i) / 400);
    if (Number.isFinite(y) && Math.abs(y) < 1e6) ys.push(y);
  }
  if (ys.length < 10) return { xmin, xmax, ymin: -5, ymax: 5 };
  ys.sort((p, q) => p - q);
  let lo = ys[Math.floor(ys.length * 0.04)];
  let hi = ys[Math.ceil(ys.length * 0.96) - 1];
  if (hi - lo < 0.5) {
    const mid = (hi + lo) / 2;
    lo = mid - 0.5;
    hi = mid + 0.5;
  }
  const pad = (hi - lo) * 0.2;
  return { xmin, xmax, ymin: lo - pad, ymax: hi + pad };
}

export const viewFor = (fn) => fn.defaultView ?? autoView(fn.f);
