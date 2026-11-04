// Truncated power series (Taylor-coefficient arithmetic).
// A "series" is an array [u_0 ... u_N] of Taylor coefficients about the current center.
// Evaluating an expression with series arithmetic gives its Taylor coefficients directly:
// no symbolic differentiation (which is slow and can explode in size).

const zeros = (N) => new Array(N + 1).fill(0);
const nans = (N) => new Array(N + 1).fill(NaN);
const konst = (c, N) => {
  const s = zeros(N);
  s[0] = c;
  return s;
};
const isConst = (u) => {
  for (let k = 1; k < u.length; k++) if (u[k] !== 0) return false;
  return true;
};

export const add = (u, v) => u.map((x, k) => x + v[k]);
export const sub = (u, v) => u.map((x, k) => x - v[k]);
export const neg = (u) => u.map((x) => -x);
export const scale = (u, c) => u.map((x) => x * c);

export function mul(u, v) {
  const N = u.length - 1;
  const w = zeros(N);
  for (let i = 0; i <= N; i++) {
    if (u[i] === 0) continue;
    for (let j = 0; i + j <= N; j++) w[i + j] += u[i] * v[j];
  }
  return w;
}

export function div(u, v) {
  const N = u.length - 1;
  if (v[0] === 0 || Number.isNaN(v[0])) return nans(N);
  const q = zeros(N);
  for (let k = 0; k <= N; k++) {
    let s = u[k];
    for (let j = 1; j <= k; j++) s -= v[j] * q[k - j];
    q[k] = s / v[0];
  }
  return q;
}

function powInt(u, m) {
  const N = u.length - 1;
  if (m < 0) return div(konst(1, N), powInt(u, -m));
  let result = konst(1, N);
  let base = u;
  let e = m;
  while (e > 0) {
    if (e & 1) result = mul(result, base);
    e >>= 1;
    if (e) base = mul(base, base);
  }
  return result;
}

function powReal(u, alpha) {
  const N = u.length - 1;
  if (!(u[0] > 0)) return nans(N);
  const v = zeros(N);
  v[0] = Math.pow(u[0], alpha);
  for (let k = 1; k <= N; k++) {
    let s = 0;
    for (let j = 1; j <= k; j++) s += (alpha * j - (k - j)) * u[j] * v[k - j];
    v[k] = s / (k * u[0]);
  }
  return v;
}

export function pow(u, v) {
  const N = u.length - 1;
  if (isConst(v)) {
    const alpha = v[0];
    if (Number.isInteger(alpha) && Math.abs(alpha) <= 1000) return powInt(u, alpha);
    return powReal(u, alpha);
  }
  if (!(u[0] > 0)) return nans(N);
  return exp(mul(v, log(u)));
}

export function exp(u) {
  const N = u.length - 1;
  const v = zeros(N);
  v[0] = Math.exp(u[0]);
  for (let k = 1; k <= N; k++) {
    let s = 0;
    for (let j = 1; j <= k; j++) s += j * u[j] * v[k - j];
    v[k] = s / k;
  }
  return v;
}

export function log(u) {
  const N = u.length - 1;
  if (!(u[0] > 0)) return nans(N);
  const v = zeros(N);
  v[0] = Math.log(u[0]);
  for (let k = 1; k <= N; k++) {
    let s = 0;
    for (let j = 1; j < k; j++) s += j * v[j] * u[k - j];
    v[k] = (u[k] - s / k) / u[0];
  }
  return v;
}

function sinCos(u, hyper) {
  const N = u.length - 1;
  const s = zeros(N);
  const c = zeros(N);
  s[0] = hyper ? Math.sinh(u[0]) : Math.sin(u[0]);
  c[0] = hyper ? Math.cosh(u[0]) : Math.cos(u[0]);
  for (let k = 1; k <= N; k++) {
    let sa = 0;
    let sb = 0;
    for (let j = 1; j <= k; j++) {
      sa += j * u[j] * c[k - j];
      sb += j * u[j] * s[k - j];
    }
    s[k] = sa / k;
    c[k] = (hyper ? sb : -sb) / k;
  }
  return [s, c];
}
export const sin = (u) => sinCos(u, false)[0];
export const cos = (u) => sinCos(u, false)[1];
export const sinh = (u) => sinCos(u, true)[0];
export const cosh = (u) => sinCos(u, true)[1];

// tan and tanh satisfy t' = (1 ± t^2) u'
function tanLike(u, hyper) {
  const N = u.length - 1;
  const t = zeros(N);
  const w = zeros(N); // w = 1 ± t^2
  t[0] = hyper ? Math.tanh(u[0]) : Math.tan(u[0]);
  const sq = (m) => {
    let s = 0;
    for (let i = 0; i <= m; i++) s += t[i] * t[m - i];
    return s;
  };
  w[0] = 1 + (hyper ? -1 : 1) * sq(0);
  for (let k = 1; k <= N; k++) {
    let s = 0;
    for (let j = 1; j <= k; j++) s += j * u[j] * w[k - j];
    t[k] = s / k;
    w[k] = (k === 0 ? 1 : 0) + (hyper ? -1 : 1) * sq(k);
  }
  return t;
}
export const tan = (u) => tanLike(u, false);
export const tanh = (u) => tanLike(u, true);

// v' = u' / w  (atan: w = 1 + u^2,  asin: w = sqrt(1 - u^2))
function integrateOverW(u, w, v0) {
  const N = u.length - 1;
  const v = zeros(N);
  v[0] = v0;
  if (!(Math.abs(w[0]) > 0)) return nans(N);
  for (let k = 1; k <= N; k++) {
    let s = 0;
    for (let j = 1; j < k; j++) s += j * v[j] * w[k - j];
    v[k] = (u[k] - s / k) / w[0];
  }
  return v;
}
export const atan = (u) => integrateOverW(u, add(konst(1, u.length - 1), mul(u, u)), Math.atan(u[0]));
export function asin(u) {
  const N = u.length - 1;
  const inside = sub(konst(1, N), mul(u, u));
  return integrateOverW(u, powReal(inside, 0.5), Math.asin(u[0]));
}
export const acos = (u) => sub(konst(Math.PI / 2, u.length - 1), asin(u));

export const sqrt = (u) => powReal(u, 0.5);
export function cbrt(u) {
  if (u[0] < 0) return neg(powReal(neg(u), 1 / 3));
  return powReal(u, 1 / 3);
}
export function abs(u) {
  if (u[0] > 0) return u;
  if (u[0] < 0) return neg(u);
  return nans(u.length - 1);
}

const ONE_ARG = {
  sin, cos, tan, sinh, cosh, tanh, exp, log, ln: log, sqrt, cbrt, abs, atan, asin, acos,
  sec: (u) => div(konst(1, u.length - 1), cos(u)),
  csc: (u) => div(konst(1, u.length - 1), sin(u)),
  cot: (u) => div(cos(u), sin(u)),
  log10: (u) => scale(log(u), 1 / Math.LN10),
  log2: (u) => scale(log(u), 1 / Math.LN2),
};

const CONSTANTS = { pi: Math.PI, PI: Math.PI, e: Math.E, E: Math.E, tau: 2 * Math.PI };

export const SUPPORTED_FUNCTIONS = Object.keys(ONE_ARG);

/** Throws a friendly Error if the parsed expression uses something we can't handle. */
export function validate(node) {
  switch (node.type) {
    case 'ConstantNode':
      if (typeof node.value !== 'number') throw new Error('Only numbers, x, and functions of x are allowed.');
      return;
    case 'ParenthesisNode':
      return validate(node.content);
    case 'SymbolNode':
      if (node.name !== 'x' && !(node.name in CONSTANTS)) throw new Error(`Unknown symbol “${node.name}”. Use x as the variable.`);
      return;
    case 'OperatorNode':
      if (!['add', 'subtract', 'multiply', 'divide', 'pow', 'unaryMinus', 'unaryPlus'].includes(node.fn)) {
        throw new Error(`The operator “${node.op}” isn't supported.`);
      }
      node.args.forEach(validate);
      return;
    case 'FunctionNode': {
      const name = node.fn?.name ?? node.name;
      const ok = name in ONE_ARG && node.args.length === 1;
      const logBase = name === 'log' && node.args.length === 2;
      if (!ok && !logBase) throw new Error(`The function “${name}” isn't supported. Try ${SUPPORTED_FUNCTIONS.slice(0, 9).join(', ')}, …`);
      node.args.forEach(validate);
      return;
    }
    default:
      throw new Error('That expression uses syntax this app doesn’t support.');
  }
}

/** Taylor coefficients [c_0..c_N] of the expression about x = a. */
export function evalSeries(node, a, N) {
  const go = (nd) => {
    switch (nd.type) {
      case 'ConstantNode':
        return konst(nd.value, N);
      case 'ParenthesisNode':
        return go(nd.content);
      case 'SymbolNode': {
        if (nd.name === 'x') {
          const s = zeros(N);
          s[0] = a;
          if (N >= 1) s[1] = 1;
          return s;
        }
        return konst(CONSTANTS[nd.name], N);
      }
      case 'OperatorNode': {
        const [p, q] = nd.args.map(go);
        switch (nd.fn) {
          case 'add': return add(p, q);
          case 'subtract': return sub(p, q);
          case 'multiply': return mul(p, q);
          case 'divide': return div(p, q);
          case 'pow': return pow(p, q);
          case 'unaryMinus': return neg(p);
          default: return p;
        }
      }
      case 'FunctionNode': {
        const name = nd.fn?.name ?? nd.name;
        if (nd.args.length === 2) return div(log(go(nd.args[0])), log(go(nd.args[1])));
        return ONE_ARG[name](go(nd.args[0]));
      }
      default:
        return nans(N);
    }
  };
  return go(node);
}
