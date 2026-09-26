// Smoke-test the SVG export builders by calling them with a realistic input
// and verifying the output is well-formed SVG with the expected structure.

import {
  forwardEuler, rk4, runMethod, referenceTrajectory, computeErrors,
  compileF, convergenceStudy, METHODS,
} from '../src/ode.js'
import { buildSVG, buildConvergenceSVG } from '../src/svgExport.js'
import fs from 'fs'

let pass = 0, fail = 0
const log = (name, ok, detail) => {
  if (ok) { pass++; console.log(`  PASS  ${name}`) }
  else { fail++; console.log(`  FAIL  ${name}${detail ? '  — ' + detail : ''}`) }
}

console.log('\n=== SVG export smoke tests ===')

const { code } = compileF('y * (1 - y)')
const exactFn = (t, y0, t0) => 1 / (1 + ((1 - y0) / y0) * Math.exp(-(t - t0)))
const t0 = 0, y0 = 0.1, tEnd = 8, h = 0.5
const tMin = 0, tMax = 8, yMin = -0.1, yMax = 1.2

const trajectories = ['fwd-euler', 'rk4'].map(id => {
  const method = METHODS.find(m => m.id === id)
  return { id, method, nodes: runMethod(method, code, t0, y0, h, tEnd) }
})
const reference = referenceTrajectory(code, t0, y0, tEnd)
const errorSeries = trajectories.map(({ id, nodes }) => ({
  id, ts: nodes.map(n => n.t),
  errs: nodes.map(n => Math.abs(n.y - exactFn(n.t, y0, t0))),
}))

const svg = buildSVG({
  expr: 'y * (1 - y)',
  tMin, tMax, yMin, yMax,
  density: 20, lengthMul: 0.7,
  showField: true, showArrows: false,
  compiled: { code }, reference, trajectories,
  errorSeries, errorScale: 'log', exactFn,
  t0, y0,
  canvasSize: { w: 800, h: 480 }, errorH: 180,
})

fs.writeFileSync('/tmp/smoke_export.svg', svg)
log('SVG starts with <svg', svg.startsWith('<svg '))
log('SVG closes', svg.endsWith('</svg>'))
log('Contains slope field strokes', svg.includes('stroke="#bdb39c"'))
log('Contains reference path', svg.match(/<path[^>]*stroke="#1a1715"[^>]*stroke-width="2.4"/) !== null)
log('Contains forward Euler color', svg.includes('#c1432f'))
log('Contains RK4 color', svg.includes('#4a8a3a'))
log('Contains IC marker (filled black circle)', svg.match(/<circle[^>]*r="5"[^>]*fill="#1a1715"/) !== null)
log('Has axis tick labels', svg.includes('JetBrains Mono'))
log('Has axis names t and y', svg.includes('>t<') && svg.includes('>y<'))
log('Has equation title', svg.includes('y′ ='))
log('Has error plot title', svg.includes('|y_num'))
log('Has log-axis labels (1e-X)', svg.match(/1e-?\d/) !== null)
log('Reasonable size', svg.length > 5000 && svg.length < 5_000_000, `length=${svg.length}`)

console.log('\n=== Convergence SVG ===')

const study = convergenceStudy({
  methods: ['fwd-euler', 'heun', 'rk4'].map(id => METHODS.find(m => m.id === id)),
  code, t0, y0, tEnd: 1.0,
  hList: [0.4, 0.2, 0.1, 0.05, 0.025, 0.0125],
  exactFn,
})
const convSvg = buildConvergenceSVG({ study, exactFn: true })
fs.writeFileSync('/tmp/smoke_convergence.svg', convSvg)

log('Convergence SVG starts well', convSvg.startsWith('<svg '))
log('Convergence SVG closes', convSvg.endsWith('</svg>'))
log('Has reference slope lines (h^p)', convSvg.includes('h^1') && convSvg.includes('h^4'))
log('Has all three method colors',
  convSvg.includes('#c1432f') && convSvg.includes('#2f6fc1') && convSvg.includes('#4a8a3a'))
log('Has step size axis label', convSvg.includes('step size h'))
log('Has empirical-order legend entries', convSvg.match(/~h\^/) !== null)

console.log(`\n=== ${pass} passed, ${fail} failed ===`)
process.exit(fail > 0 ? 1 : 0)
