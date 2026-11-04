// User-typed functions. math.js is used only to PARSE the text; Taylor coefficients come from
// truncated-power-series arithmetic in tps.js, which is instant and works to high degree.
// Only math.js's parser is built (tree-shaken) and it is loaded lazily, the first time a student
// uses the custom box, so everyone else never downloads it.

import { autoView } from './functions.js';
import { evalSeries, validate } from './tps.js';

let parserPromise = null;
const loadParser = () =>
  (parserPromise ??= import('mathjs').then(({ create, parseDependencies }) => create({ parseDependencies }).parse));

const MAX_DEGREE = 40;

export async function buildCustom(expr) {
  const text = expr.trim();
  if (!text) throw new Error('Type a function of x, for example exp(x)*cos(x).');
  const parse = await loadParser();

  let node;
  try {
    node = parse(text);
  } catch (err) {
    throw new Error(`Couldn't read that expression (${String(err.message).replace(/\s*\(char.*$/, '')}).`);
  }
  validate(node);

  const f = (x) => evalSeries(node, x, 0)[0];
  if (![0.5, 1.5, -0.5, 2.5, 0.1].some((x) => Number.isFinite(f(x)))) {
    throw new Error('That function has no real values near the origin. Check the formula.');
  }

  return {
    id: 'custom',
    label: text,
    custom: true,
    f,
    maxDegree: MAX_DEGREE,
    coeffs: (a, N) => evalSeries(node, a, N),
    radius: () => null, // unknown: the app shows an estimate from the coefficients
    endpoints: () => null,
    centerRange: [-3, 3],
    defaultView: autoView(f),
    note: '',
  };
}
