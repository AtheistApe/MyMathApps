// SVG export — mirrors the canvas rendering of the main plot and the
// error plot. Used by the "Export SVG" button and structured for use in
// LaTeX figure inclusion.

import { evalF } from './ode.js'

const METHOD_COLORS = {
  'fwd-euler':  '#c1432f',
  'heun':       '#2f6fc1',
  'rk4':        '#4a8a3a',
  'imp-euler':  '#a3578f',
  'ab4':        '#c98c2a',
  'am3':        '#3a8a8a',
}

export function buildSVG({
  expr, tMin, tMax, yMin, yMax,
  density, lengthMul, showField, showArrows,
  compiled, reference, trajectories, errorSeries, errorScale, exactFn,
  t0, y0, canvasSize, errorH,
}) {
  const PAD_L = 56, PAD_R = 24, PAD_T = 24, PAD_B = 44
  const W = canvasSize.w
  const HMain = canvasSize.h
  const plotW = W - PAD_L - PAD_R
  const plotH = HMain - PAD_T - PAD_B
  const ERR_GAP = 18
  const EPAD_L = 56, EPAD_R = 24, EPAD_T = 18, EPAD_B = 30
  const epW = W - EPAD_L - EPAD_R
  const epH = errorH - EPAD_T - EPAD_B
  const totalH = HMain + ERR_GAP + errorH

  const xToPx = t => PAD_L + ((t - tMin) / (tMax - tMin)) * plotW
  const yToPx = y => PAD_T + (1 - (y - yMin) / (yMax - yMin)) * plotH
  const tStep = niceStep(tMax - tMin)
  const yStep = niceStep(yMax - yMin)

  const parts = []
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${totalH}" width="${W}" height="${totalH}" font-family="Inter Tight, sans-serif">`)
  parts.push(`<rect width="${W}" height="${totalH}" fill="#faf6ec"/>`)

  // ---------- MAIN PLOT ----------
  parts.push(`<rect x="${PAD_L}" y="${PAD_T}" width="${plotW}" height="${plotH}" fill="#faf6ec"/>`)

  // Grid
  let g = ''
  for (let t = Math.ceil(tMin / tStep) * tStep; t <= tMax + 1e-9; t += tStep) {
    const x = xToPx(t)
    g += `<line x1="${x.toFixed(2)}" y1="${PAD_T}" x2="${x.toFixed(2)}" y2="${PAD_T + plotH}" stroke="#e3dccb"/>`
  }
  for (let y = Math.ceil(yMin / yStep) * yStep; y <= yMax + 1e-9; y += yStep) {
    const py = yToPx(y)
    g += `<line x1="${PAD_L}" y1="${py.toFixed(2)}" x2="${PAD_L + plotW}" y2="${py.toFixed(2)}" stroke="#e3dccb"/>`
  }
  parts.push(g)

  // Zero axes
  if (tMin <= 0 && tMax >= 0) {
    const x0 = xToPx(0)
    parts.push(`<line x1="${x0.toFixed(2)}" y1="${PAD_T}" x2="${x0.toFixed(2)}" y2="${PAD_T + plotH}" stroke="#bdb39c" stroke-width="1.2"/>`)
  }
  if (yMin <= 0 && yMax >= 0) {
    const y0Y = yToPx(0)
    parts.push(`<line x1="${PAD_L}" y1="${y0Y.toFixed(2)}" x2="${PAD_L + plotW}" y2="${y0Y.toFixed(2)}" stroke="#bdb39c" stroke-width="1.2"/>`)
  }

  // Slope field
  if (showField && compiled.code) {
    let f = ''
    const cellMin = Math.min(plotW / density, plotH / density)
    const segLen = cellMin * lengthMul
    for (let i = 0; i < density; i++) {
      for (let j = 0; j < density; j++) {
        const t = tMin + ((tMax - tMin) * (i + 0.5)) / density
        const y = yMin + ((yMax - yMin) * (j + 0.5)) / density
        const slope = evalF(compiled.code, t, y)
        if (!isFinite(slope)) continue
        const screenSlope = -slope * (plotH / (yMax - yMin)) / (plotW / (tMax - tMin))
        const theta = Math.atan(screenSlope)
        const cx = xToPx(t), cy = yToPx(y)
        const dx = (segLen / 2) * Math.cos(theta)
        const dy = (segLen / 2) * Math.sin(theta)
        f += `<line x1="${(cx - dx).toFixed(2)}" y1="${(cy - dy).toFixed(2)}" x2="${(cx + dx).toFixed(2)}" y2="${(cy + dy).toFixed(2)}" stroke="#bdb39c" stroke-width="1" stroke-linecap="round"/>`
        if (showArrows) {
          const ah = Math.min(3, segLen * 0.2)
          const tipX = cx + dx, tipY = cy + dy
          f += `<line x1="${tipX.toFixed(2)}" y1="${tipY.toFixed(2)}" x2="${(tipX - ah * Math.cos(theta - 0.5)).toFixed(2)}" y2="${(tipY - ah * Math.sin(theta - 0.5)).toFixed(2)}" stroke="#bdb39c" stroke-width="1" stroke-linecap="round"/>`
          f += `<line x1="${tipX.toFixed(2)}" y1="${tipY.toFixed(2)}" x2="${(tipX - ah * Math.cos(theta + 0.5)).toFixed(2)}" y2="${(tipY - ah * Math.sin(theta + 0.5)).toFixed(2)}" stroke="#bdb39c" stroke-width="1" stroke-linecap="round"/>`
        }
      }
    }
    parts.push(f)
  }

  // Reference solution
  if (reference.length > 1) {
    const d = reference.map(([t, y], i) => `${i === 0 ? 'M' : 'L'}${xToPx(t).toFixed(2)},${yToPx(y).toFixed(2)}`).join(' ')
    parts.push(`<path d="${d}" fill="none" stroke="#1a1715" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"/>`)
  }

  // Numerical trajectories
  trajectories.forEach(({ id, nodes }) => {
    const color = METHOD_COLORS[id] || '#5a5347'
    if (nodes.length > 1) {
      const d = nodes.map((n, i) => `${i === 0 ? 'M' : 'L'}${xToPx(n.t).toFixed(2)},${yToPx(n.y).toFixed(2)}`).join(' ')
      parts.push(`<path d="${d}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`)
    }
    nodes.forEach(node => {
      const px = xToPx(node.t).toFixed(2)
      const py = yToPx(node.y).toFixed(2)
      if (node.bootstrapped) {
        parts.push(`<rect x="${(parseFloat(px) - 3).toFixed(2)}" y="${(parseFloat(py) - 3).toFixed(2)}" width="6" height="6" fill="#faf6ec" stroke="${color}" stroke-width="1.5"/>`)
      } else {
        parts.push(`<circle cx="${px}" cy="${py}" r="3.5" fill="${color}" stroke="#faf6ec" stroke-width="1"/>`)
      }
    })
  })

  // IC marker
  parts.push(`<circle cx="${xToPx(t0).toFixed(2)}" cy="${yToPx(y0).toFixed(2)}" r="5" fill="#1a1715" stroke="#faf6ec" stroke-width="2"/>`)

  // Frame
  parts.push(`<rect x="${PAD_L}" y="${PAD_T}" width="${plotW}" height="${plotH}" fill="none" stroke="#8a8170" stroke-width="1.5"/>`)

  // Tick labels
  let labels = ''
  for (let t = Math.ceil(tMin / tStep) * tStep; t <= tMax + 1e-9; t += tStep) {
    labels += `<text x="${xToPx(t).toFixed(2)}" y="${(PAD_T + plotH + 16).toFixed(2)}" text-anchor="middle" font-family="JetBrains Mono, monospace" font-size="11" fill="#5a5347">${formatTick(t, tStep)}</text>`
  }
  for (let y = Math.ceil(yMin / yStep) * yStep; y <= yMax + 1e-9; y += yStep) {
    labels += `<text x="${(PAD_L - 8).toFixed(2)}" y="${(yToPx(y) + 4).toFixed(2)}" text-anchor="end" font-family="JetBrains Mono, monospace" font-size="11" fill="#5a5347">${formatTick(y, yStep)}</text>`
  }
  parts.push(labels)

  // Axis names
  parts.push(`<text x="${(PAD_L + plotW / 2).toFixed(2)}" y="${(PAD_T + plotH + 36).toFixed(2)}" text-anchor="middle" font-family="Fraunces, serif" font-style="italic" font-weight="600" font-size="14" fill="#1a1715">t</text>`)
  parts.push(`<text transform="translate(16, ${(PAD_T + plotH / 2).toFixed(2)}) rotate(-90)" text-anchor="middle" font-family="Fraunces, serif" font-style="italic" font-weight="600" font-size="14" fill="#1a1715">y</text>`)

  // Title
  parts.push(`<text x="${PAD_L}" y="${PAD_T - 8}" font-family="Fraunces, serif" font-style="italic" font-weight="600" font-size="14" fill="#1a1715">y′ = ${escapeXml(expr)}</text>`)

  // ---------- ERROR PLOT ----------
  const epOriginY = HMain + ERR_GAP

  parts.push(`<rect x="${EPAD_L}" y="${(epOriginY + EPAD_T).toFixed(2)}" width="${epW}" height="${epH}" fill="#faf6ec"/>`)

  let maxErr = 0, minErrPos = Infinity
  errorSeries.forEach(s => s.errs.forEach(e => {
    if (e > maxErr) maxErr = e
    if (e > 0 && e < minErrPos) minErrPos = e
  }))
  if (maxErr === 0) maxErr = 1
  if (!isFinite(minErrPos)) minErrPos = maxErr * 1e-12

  const useLog = errorScale === 'log' && maxErr > 0
  const logLo = Math.log10(Math.max(minErrPos, maxErr * 1e-12))
  const logHi = Math.log10(maxErr) + 0.2
  const tToPxE = t => EPAD_L + ((t - tMin) / (tMax - tMin)) * epW
  const errToPxE = e => {
    const yLocal = useLog
      ? (e <= 0 ? epH : (1 - (Math.log10(e) - logLo) / (logHi - logLo)) * epH)
      : (1 - e / (maxErr * 1.1)) * epH
    return epOriginY + EPAD_T + yLocal
  }

  // Error grid
  let eg = ''
  for (let t = Math.ceil(tMin / tStep) * tStep; t <= tMax + 1e-9; t += tStep) {
    const x = tToPxE(t)
    eg += `<line x1="${x.toFixed(2)}" y1="${(epOriginY + EPAD_T).toFixed(2)}" x2="${x.toFixed(2)}" y2="${(epOriginY + EPAD_T + epH).toFixed(2)}" stroke="#e3dccb"/>`
  }
  if (useLog) {
    for (let lv = Math.ceil(logLo); lv <= Math.floor(logHi); lv++) {
      const py = errToPxE(Math.pow(10, lv))
      eg += `<line x1="${EPAD_L}" y1="${py.toFixed(2)}" x2="${EPAD_L + epW}" y2="${py.toFixed(2)}" stroke="#e3dccb"/>`
    }
  } else {
    for (let k = 0; k <= 4; k++) {
      const py = epOriginY + EPAD_T + (k / 4) * epH
      eg += `<line x1="${EPAD_L}" y1="${py.toFixed(2)}" x2="${EPAD_L + epW}" y2="${py.toFixed(2)}" stroke="#e3dccb"/>`
    }
  }
  parts.push(eg)

  // Error series
  errorSeries.forEach(({ id, ts, errs }) => {
    const color = METHOD_COLORS[id] || '#5a5347'
    let pathD = ''
    let started = false
    ts.forEach((t, i) => {
      const e = errs[i]
      if (useLog && e <= 0) { started = false; return }
      const px = tToPxE(t).toFixed(2)
      const py = errToPxE(e).toFixed(2)
      pathD += `${started ? 'L' : 'M'}${px},${py} `
      started = true
    })
    if (pathD) parts.push(`<path d="${pathD.trim()}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`)
    ts.forEach((t, i) => {
      const e = errs[i]
      if (useLog && e <= 0) return
      parts.push(`<circle cx="${tToPxE(t).toFixed(2)}" cy="${errToPxE(e).toFixed(2)}" r="2.5" fill="${color}"/>`)
    })
  })

  // Error tick labels
  let elabels = ''
  for (let t = Math.ceil(tMin / tStep) * tStep; t <= tMax + 1e-9; t += tStep) {
    elabels += `<text x="${tToPxE(t).toFixed(2)}" y="${(epOriginY + EPAD_T + epH + 14).toFixed(2)}" text-anchor="middle" font-family="JetBrains Mono, monospace" font-size="10" fill="#5a5347">${formatTick(t, tStep)}</text>`
  }
  if (useLog) {
    for (let lv = Math.ceil(logLo); lv <= Math.floor(logHi); lv++) {
      elabels += `<text x="${(EPAD_L - 6).toFixed(2)}" y="${(errToPxE(Math.pow(10, lv)) + 3).toFixed(2)}" text-anchor="end" font-family="JetBrains Mono, monospace" font-size="10" fill="#5a5347">1e${lv}</text>`
    }
  } else {
    for (let k = 0; k <= 4; k++) {
      const e = (1 - k / 4) * maxErr * 1.1
      const py = epOriginY + EPAD_T + (k / 4) * epH
      elabels += `<text x="${(EPAD_L - 6).toFixed(2)}" y="${(py + 3).toFixed(2)}" text-anchor="end" font-family="JetBrains Mono, monospace" font-size="10" fill="#5a5347">${e.toExponential(1)}</text>`
    }
  }
  parts.push(elabels)

  parts.push(`<rect x="${EPAD_L}" y="${(epOriginY + EPAD_T).toFixed(2)}" width="${epW}" height="${epH}" fill="none" stroke="#8a8170" stroke-width="1.2"/>`)
  parts.push(`<text x="${EPAD_L}" y="${(epOriginY + 12).toFixed(2)}" font-family="JetBrains Mono, monospace" font-size="11" font-weight="600" fill="#1a1715">${exactFn ? '|y_num − y_exact|  (analytic)' : '|y_num − y_RK4ref|  (RK4 reference)'}</text>`)

  parts.push(`</svg>`)
  return parts.join('')
}

// Build a separate convergence study SVG (log-log error vs h).
export function buildConvergenceSVG({ study, exactFn, width = 600, height = 400 }) {
  const PAD_L = 70, PAD_R = 24, PAD_T = 30, PAD_B = 50
  const plotW = width - PAD_L - PAD_R
  const plotH = height - PAD_T - PAD_B

  let allH = [], allErr = []
  study.forEach(s => s.results.forEach(r => {
    if (r.h > 0 && r.maxErr > 0 && isFinite(r.maxErr)) {
      allH.push(r.h); allErr.push(r.maxErr)
    }
  }))
  if (allH.length === 0) return null

  const logHLo = Math.log10(Math.min(...allH)) - 0.1
  const logHHi = Math.log10(Math.max(...allH)) + 0.1
  const logELo = Math.log10(Math.min(...allErr)) - 0.5
  const logEHi = Math.log10(Math.max(...allErr)) + 0.5

  const xToPx = h => PAD_L + ((Math.log10(h) - logHLo) / (logHHi - logHLo)) * plotW
  const yToPx = e => PAD_T + (1 - (Math.log10(e) - logELo) / (logEHi - logELo)) * plotH

  const parts = []
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" font-family="Inter Tight, sans-serif">`)
  parts.push(`<rect width="${width}" height="${height}" fill="#faf6ec"/>`)
  parts.push(`<rect x="${PAD_L}" y="${PAD_T}" width="${plotW}" height="${plotH}" fill="#fffdf6"/>`)

  // Grid
  let grid = ''
  for (let lv = Math.ceil(logHLo); lv <= Math.floor(logHHi); lv++) {
    const x = xToPx(Math.pow(10, lv))
    grid += `<line x1="${x.toFixed(2)}" y1="${PAD_T}" x2="${x.toFixed(2)}" y2="${PAD_T + plotH}" stroke="#e3dccb"/>`
  }
  for (let lv = Math.ceil(logELo); lv <= Math.floor(logEHi); lv++) {
    const py = yToPx(Math.pow(10, lv))
    grid += `<line x1="${PAD_L}" y1="${py.toFixed(2)}" x2="${PAD_L + plotW}" y2="${py.toFixed(2)}" stroke="#e3dccb"/>`
  }
  parts.push(grid)

  // Reference slope lines (h^1, h^2, h^4) anchored at top-right
  const refOrders = [1, 2, 4]
  const anchorH = Math.pow(10, logHHi - 0.05)
  const anchorE = Math.pow(10, logEHi - 0.3)
  refOrders.forEach(p => {
    const h2 = Math.pow(10, logHLo + 0.05)
    const e2 = anchorE * Math.pow(h2 / anchorH, p)
    if (Math.log10(e2) > logELo && Math.log10(e2) < logEHi) {
      parts.push(`<line x1="${xToPx(anchorH).toFixed(2)}" y1="${yToPx(anchorE).toFixed(2)}" x2="${xToPx(h2).toFixed(2)}" y2="${yToPx(e2).toFixed(2)}" stroke="#bdb39c" stroke-width="1" stroke-dasharray="3,3"/>`)
      parts.push(`<text x="${xToPx(h2).toFixed(2)}" y="${(yToPx(e2) - 4).toFixed(2)}" font-family="JetBrains Mono, monospace" font-size="10" fill="#7a7264">h^${p}</text>`)
    }
  })

  // Per-method points + line
  study.forEach(s => {
    const color = METHOD_COLORS[s.id] || '#5a5347'
    const pts = s.results.filter(r => r.maxErr > 0 && isFinite(r.maxErr))
    if (pts.length > 1) {
      const d = pts.map((r, i) => `${i === 0 ? 'M' : 'L'}${xToPx(r.h).toFixed(2)},${yToPx(r.maxErr).toFixed(2)}`).join(' ')
      parts.push(`<path d="${d}" fill="none" stroke="${color}" stroke-width="2.2" stroke-linejoin="round"/>`)
    }
    pts.forEach(r => {
      parts.push(`<circle cx="${xToPx(r.h).toFixed(2)}" cy="${yToPx(r.maxErr).toFixed(2)}" r="3.5" fill="${color}" stroke="#faf6ec" stroke-width="1.2"/>`)
    })
  })

  // Frame
  parts.push(`<rect x="${PAD_L}" y="${PAD_T}" width="${plotW}" height="${plotH}" fill="none" stroke="#8a8170" stroke-width="1.5"/>`)

  // Tick labels
  let lab = ''
  for (let lv = Math.ceil(logHLo); lv <= Math.floor(logHHi); lv++) {
    lab += `<text x="${xToPx(Math.pow(10, lv)).toFixed(2)}" y="${(PAD_T + plotH + 16).toFixed(2)}" text-anchor="middle" font-family="JetBrains Mono, monospace" font-size="11" fill="#5a5347">10${superscript(lv)}</text>`
  }
  for (let lv = Math.ceil(logELo); lv <= Math.floor(logEHi); lv++) {
    lab += `<text x="${(PAD_L - 8).toFixed(2)}" y="${(yToPx(Math.pow(10, lv)) + 4).toFixed(2)}" text-anchor="end" font-family="JetBrains Mono, monospace" font-size="11" fill="#5a5347">10${superscript(lv)}</text>`
  }
  parts.push(lab)

  parts.push(`<text x="${(PAD_L + plotW / 2).toFixed(2)}" y="${(PAD_T + plotH + 38).toFixed(2)}" text-anchor="middle" font-family="Fraunces, serif" font-style="italic" font-weight="600" font-size="14" fill="#1a1715">step size h</text>`)
  parts.push(`<text transform="translate(20, ${(PAD_T + plotH / 2).toFixed(2)}) rotate(-90)" text-anchor="middle" font-family="Fraunces, serif" font-style="italic" font-weight="600" font-size="14" fill="#1a1715">max |error|</text>`)

  // Title
  parts.push(`<text x="${PAD_L}" y="${(PAD_T - 10).toFixed(2)}" font-family="JetBrains Mono, monospace" font-size="11" font-weight="600" fill="#1a1715">Convergence study${exactFn ? ' (analytic)' : ' (RK4 reference)'}</text>`)

  // Legend with empirical orders
  let legY = PAD_T + 14
  study.forEach(s => {
    const color = METHOD_COLORS[s.id] || '#5a5347'
    const r = s.results.filter(x => x.maxErr > 0)
    let orderText = ''
    if (r.length >= 2) {
      const lo = r[r.length - 1], hi = r[0]
      const order = Math.log(hi.maxErr / lo.maxErr) / Math.log(hi.h / lo.h)
      orderText = ` (~h^${order.toFixed(2)})`
    }
    parts.push(`<line x1="${(PAD_L + plotW - 200).toFixed(2)}" y1="${legY}" x2="${(PAD_L + plotW - 180).toFixed(2)}" y2="${legY}" stroke="${color}" stroke-width="2.2"/>`)
    parts.push(`<text x="${(PAD_L + plotW - 174).toFixed(2)}" y="${(legY + 4).toFixed(2)}" font-family="JetBrains Mono, monospace" font-size="10" fill="#1a1715">${escapeXml(s.name)}${orderText}</text>`)
    legY += 14
  })

  parts.push(`</svg>`)
  return parts.join('')
}

function niceStep(span) {
  const raw = span / 8
  const exp = Math.floor(Math.log10(raw))
  const base = raw / Math.pow(10, exp)
  let nice
  if (base < 1.5) nice = 1
  else if (base < 3.5) nice = 2
  else if (base < 7.5) nice = 5
  else nice = 10
  return nice * Math.pow(10, exp)
}

function formatTick(v, step) {
  if (Math.abs(v) < step * 1e-6) return '0'
  const decimals = Math.max(0, -Math.floor(Math.log10(step)) + (step < 1 ? 1 : 0))
  return v.toFixed(decimals)
}

function escapeXml(s) {
  return String(s).replace(/[<>&'"]/g, c => ({
    '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;',
  }[c]))
}

function superscript(n) {
  const map = { '-': '⁻', '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹' }
  return String(n).split('').map(c => map[c] || c).join('')
}
