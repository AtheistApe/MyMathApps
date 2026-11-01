/*
 * Power Series Explorer — Preset Series Definitions
 *
 * Edit this file to add, remove, or modify built-in presets.
 * Changes here don't affect the main app logic.
 *
 * Fields:
 *   name     — short label shown in the dropdown
 *   formula  — b(k) expression in terms of k
 *              available: factorial(n), C(n,r), pow, sqrt, abs,
 *                         log, sin, cos, sign, PI, E
 *   a        — exponent multiplier (series uses x^(a*k + l))
 *   l        — exponent shift
 *   c        — center of the series (optional, default 0)
 *   k0       — starting index (optional, default 0)
 *   xr       — [xMin, xMax] axis range
 *   yr       — [yMin, yMax] axis range
 *   desc     — plain-text description (shown in dropdown)
 *   tex      — LaTeX formula (rendered below dropdown)
 */

const PRESETS = [
  {
    name: "eˣ",
    formula: "1/factorial(k)",
    a: 1,
    l: 0,
    xr: [-4, 4],
    yr: [-2, 20],
    desc: "Σ xᵏ/k!",
    tex: "e^x = \\sum_{k=0}^{\\infty} \\frac{x^k}{k!}",
  },
  {
    name: "1/(1−x)",
    formula: "1",
    a: 1,
    l: 0,
    xr: [-1.5, 1.5],
    yr: [-5, 5],
    desc: "Σ xᵏ, |x|<1",
    tex: "\\frac{1}{1-x} = \\sum_{k=0}^{\\infty} x^k, \\;|x|<1",
  },
  {
    name: "sin x",
    formula: "(-1)**k/factorial(2*k+1)",
    a: 2,
    l: 1,
    xr: [-8, 8],
    yr: [-2, 2],
    desc: "Σ (−1)ᵏx²ᵏ⁺¹/(2k+1)!",
    tex: "\\sin x = \\sum_{k=0}^{\\infty} \\frac{(-1)^k}{(2k+1)!}\\,x^{2k+1}",
  },
  {
    name: "cos x",
    formula: "(-1)**k/factorial(2*k)",
    a: 2,
    l: 0,
    xr: [-8, 8],
    yr: [-2, 2],
    desc: "Σ (−1)ᵏx²ᵏ/(2k)!",
    tex: "\\cos x = \\sum_{k=0}^{\\infty} \\frac{(-1)^k}{(2k)!}\\,x^{2k}",
  },
  {
    name: "ln(1+x)",
    formula: "(-1)**k/(k+1)",
    a: 1,
    l: 1,
    xr: [-1.5, 1.5],
    yr: [-3, 2],
    desc: "Σ (−1)ᵏxᵏ⁺¹/(k+1), |x|≤1",
    tex: "\\ln(1+x) = \\sum_{k=0}^{\\infty} \\frac{(-1)^k}{k+1}\\,x^{k+1}, \\;|x|\\le 1",
  },
  {
    name: "arctan x",
    formula: "(-1)**k/(2*k+1)",
    a: 2,
    l: 1,
    xr: [-2, 2],
    yr: [-2, 2],
    desc: "Σ (−1)ᵏx²ᵏ⁺¹/(2k+1), |x|≤1",
    tex: "\\arctan x = \\sum_{k=0}^{\\infty} \\frac{(-1)^k}{2k+1}\\,x^{2k+1}, \\;|x|\\le 1",
  },
  {
    name: "Bessel J₀(x)",
    formula: "(-1)**k/(2**(2*k) * factorial(k)**2)",
    a: 2,
    l: 0,
    xr: [-20, 20],
    yr: [-2, 2],
    desc: "∑((−1)ᵏx²ᵏ)/(2²ᵏ(k!)²)",
    tex: "\J_0(x) = \\sum_{k=0}^{\\infty} \\frac{(-1)^k x^{2k}}{2^{2k} (k!)^2}",
  },
];

export default PRESETS;
