import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { ChevronDown, Download, Play, Pause, SkipBack, SkipForward, ChevronsRight, BookOpen } from 'lucide-react'
import {
  METHODS, METHOD_BY_ID, runMethod, referenceTrajectory, computeErrors,
  compileF, evalF, convergenceStudy,
} from './ode.js'
import { buildSVG, buildConvergenceSVG } from './svgExport.js'
import { PRESETS } from './presets.js'

// Each method gets a stable color in plots and the legend.
const METHOD_COLORS = {
  'fwd-euler':  '#c1432f',
  'heun':       '#2f6fc1',
  'rk4':        '#4a8a3a',
  'imp-euler':  '#a3578f',
  'ab4':        '#c98c2a',
  'am3':        '#3a8a8a',
}

export default function App() {
  // ----- ODE state -----
  const [expr, setExpr] = useState(PRESETS[2].f)  // logistic
  const [tMin, setTMin] = useState(PRESETS[2].tMin)
  const [tMax, setTMax] = useState(PRESETS[2].tMax)
  const [yMin, setYMin] = useState(PRESETS[2].yMin)
  const [yMax, setYMax] = useState(PRESETS[2].yMax)
  const [t0, setT0] = useState(PRESETS[2].t0)
  const [y0, setY0] = useState(PRESETS[2].y0)
  const [h, setH] = useState(PRESETS[2].h)
  const [exactFn, setExactFn] = useState(() => PRESETS[2].exact)
  const [presetName, setPresetName] = useState(PRESETS[2].name)
  const [presetOpen, setPresetOpen] = useState(false)

  // ----- Method selection -----
  const [activeMethods, setActiveMethods] = useState(['fwd-euler', 'rk4'])

  // ----- Display state -----
  const [showField, setShowField] = useState(true)
  const [density, setDensity] = useState(20)
  const [lengthMul, setLengthMul] = useState(0.7)
  const [showArrows, setShowArrows] = useState(false)
  const [showMarks, setShowMarks] = useState(true)
  const [errorScale, setErrorScale] = useState('linear') // 'linear' | 'log'
  const [hoverPt, setHoverPt] = useState(null)

  // ----- Playback state -----
  // playbackStep === null means "show everything" (the normal mode).
  // Otherwise it's an integer indicating how many steps each method has taken.
  const [playbackStep, setPlaybackStep] = useState(null)
  const [isPlaying, setIsPlaying] = useState(false)

  // ----- Convergence study state -----
  const [convStudy, setConvStudy] = useState(null)  // { study, exactWasUsed }
  const [convOpen, setConvOpen] = useState(false)

  // ----- Compile equation -----
  const compiled = useMemo(() => compileF(expr), [expr])

  // ----- Run methods + reference -----
  const trajectories = useMemo(() => {
    if (!compiled.code) return []
    return activeMethods.map(id => {
      const method = METHOD_BY_ID[id]
      const nodes = runMethod(method, compiled.code, t0, y0, h, tMax)
      return { id, method, nodes }
    })
  }, [compiled.code, activeMethods, t0, y0, h, tMax])

  // Maximum number of steps across all active trajectories — used to bound
  // the playback slider.
  const maxSteps = useMemo(() => {
    let m = 0
    trajectories.forEach(({ nodes }) => { if (nodes.length - 1 > m) m = nodes.length - 1 })
    return m
  }, [trajectories])

  // Trajectories actually rendered. When playback is active, slice each to
  // [0..playbackStep+1] so we see exactly playbackStep steps taken.
  const displayedTrajectories = useMemo(() => {
    if (playbackStep === null) return trajectories
    return trajectories.map(t => ({
      ...t,
      nodes: t.nodes.slice(0, Math.min(t.nodes.length, playbackStep + 1)),
    }))
  }, [trajectories, playbackStep])

  // Reset playback when configuration changes (so we don't sit at step 50
  // after switching to a preset with only 8 steps).
  useEffect(() => {
    if (playbackStep !== null && playbackStep > maxSteps) setPlaybackStep(maxSteps)
  }, [maxSteps, playbackStep])

  // Auto-advance during playback.
  useEffect(() => {
    if (!isPlaying || playbackStep === null) return
    if (playbackStep >= maxSteps) { setIsPlaying(false); return }
    const id = setTimeout(() => setPlaybackStep(s => Math.min((s ?? 0) + 1, maxSteps)), 500)
    return () => clearTimeout(id)
  }, [isPlaying, playbackStep, maxSteps])

  const reference = useMemo(() => {
    if (!compiled.code) return []
    return referenceTrajectory(compiled.code, t0, y0, tMax)
  }, [compiled.code, t0, y0, tMax])

  // For error plot: closed-form if available, else interpolate the RK4 ref.
  // Uses displayedTrajectories so error plot tracks playback too.
  const errorSeries = useMemo(() => {
    return displayedTrajectories.map(({ id, nodes }) => {
      let errs
      if (exactFn) {
        errs = nodes.map(n => Math.abs(n.y - exactFn(n.t, y0, t0)))
      } else {
        errs = computeErrors(nodes, reference)
      }
      return { id, ts: nodes.map(n => n.t), errs }
    })
  }, [displayedTrajectories, exactFn, reference, t0, y0])

  // ----- Canvas refs and sizing -----
  const fieldCanvasRef = useRef(null)
  const overlayCanvasRef = useRef(null)
  const errorCanvasRef = useRef(null)
  const containerRef = useRef(null)
  const [canvasSize, setCanvasSize] = useState({ w: 720, h: 480 })
  const ERROR_H = 180

  useEffect(() => {
    if (!containerRef.current) return
    const ro = new ResizeObserver(entries => {
      for (const entry of entries) {
        const w = Math.max(420, Math.floor(entry.contentRect.width))
        const h = Math.max(360, Math.floor(w * 0.55))
        setCanvasSize({ w, h })
      }
    })
    ro.observe(containerRef.current)
    return () => ro.disconnect()
  }, [])

  // ----- Coordinate transforms (main plot) -----
  const PAD_L = 56, PAD_R = 24, PAD_T = 24, PAD_B = 44
  const plotW = canvasSize.w - PAD_L - PAD_R
  const plotH = canvasSize.h - PAD_T - PAD_B

  const xToPx = useCallback(t => PAD_L + ((t - tMin) / (tMax - tMin)) * plotW, [tMin, tMax, plotW])
  const yToPx = useCallback(y => PAD_T + (1 - (y - yMin) / (yMax - yMin)) * plotH, [yMin, yMax, plotH])
  const pxToX = useCallback(px => tMin + ((px - PAD_L) / plotW) * (tMax - tMin), [tMin, tMax, plotW])
  const pxToY = useCallback(py => yMin + (1 - (py - PAD_T) / plotH) * (yMax - yMin), [yMin, yMax, plotH])

  // ----- Render main plot -----
  useEffect(() => {
    const cv = fieldCanvasRef.current
    if (!cv || !compiled.code) return
    const dpr = window.devicePixelRatio || 1
    cv.width = canvasSize.w * dpr
    cv.height = canvasSize.h * dpr
    cv.style.width = canvasSize.w + 'px'
    cv.style.height = canvasSize.h + 'px'
    const ctx = cv.getContext('2d')
    ctx.scale(dpr, dpr)
    ctx.clearRect(0, 0, canvasSize.w, canvasSize.h)

    ctx.fillStyle = '#faf6ec'
    ctx.fillRect(PAD_L, PAD_T, plotW, plotH)

    const tStep = niceStep(tMax - tMin)
    const yStep = niceStep(yMax - yMin)
    ctx.strokeStyle = '#e3dccb'
    ctx.lineWidth = 1
    ctx.beginPath()
    for (let t = Math.ceil(tMin / tStep) * tStep; t <= tMax + 1e-9; t += tStep) {
      const x = xToPx(t); ctx.moveTo(x, PAD_T); ctx.lineTo(x, PAD_T + plotH)
    }
    for (let y = Math.ceil(yMin / yStep) * yStep; y <= yMax + 1e-9; y += yStep) {
      const py = yToPx(y); ctx.moveTo(PAD_L, py); ctx.lineTo(PAD_L + plotW, py)
    }
    ctx.stroke()

    ctx.strokeStyle = '#bdb39c'
    ctx.lineWidth = 1.2
    if (tMin <= 0 && tMax >= 0) {
      const x0 = xToPx(0)
      ctx.beginPath(); ctx.moveTo(x0, PAD_T); ctx.lineTo(x0, PAD_T + plotH); ctx.stroke()
    }
    if (yMin <= 0 && yMax >= 0) {
      const y0Y = yToPx(0)
      ctx.beginPath(); ctx.moveTo(PAD_L, y0Y); ctx.lineTo(PAD_L + plotW, y0Y); ctx.stroke()
    }

    ctx.fillStyle = '#5a5347'
    ctx.font = "500 11px 'JetBrains Mono', monospace"
    ctx.textAlign = 'center'; ctx.textBaseline = 'top'
    for (let t = Math.ceil(tMin / tStep) * tStep; t <= tMax + 1e-9; t += tStep) {
      ctx.fillText(formatTick(t, tStep), xToPx(t), PAD_T + plotH + 6)
    }
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle'
    for (let y = Math.ceil(yMin / yStep) * yStep; y <= yMax + 1e-9; y += yStep) {
      ctx.fillText(formatTick(y, yStep), PAD_L - 8, yToPx(y))
    }

    // Slope field background — drawn lighter than the slope-field app since
    // it's secondary here; the numerical curves are the focus.
    if (showField) {
      const cellMin = Math.min(plotW / density, plotH / density)
      const segLen = cellMin * lengthMul
      ctx.strokeStyle = '#bdb39c'
      ctx.lineWidth = 1
      ctx.lineCap = 'round'
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
          ctx.beginPath()
          ctx.moveTo(cx - dx, cy - dy); ctx.lineTo(cx + dx, cy + dy)
          ctx.stroke()
          if (showArrows) {
            const ah = Math.min(3, segLen * 0.2)
            const tipX = cx + dx, tipY = cy + dy
            ctx.beginPath()
            ctx.moveTo(tipX, tipY)
            ctx.lineTo(tipX - ah * Math.cos(theta - 0.5), tipY - ah * Math.sin(theta - 0.5))
            ctx.moveTo(tipX, tipY)
            ctx.lineTo(tipX - ah * Math.cos(theta + 0.5), tipY - ah * Math.sin(theta + 0.5))
            ctx.stroke()
          }
        }
      }
    }

    // Reference solution
    if (reference.length > 1) {
      ctx.save()
      ctx.beginPath()
      ctx.rect(PAD_L, PAD_T, plotW, plotH)
      ctx.clip()
      ctx.strokeStyle = '#1a1715'
      ctx.lineWidth = 2.4
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.beginPath()
      reference.forEach(([t, y], i) => {
        const px = xToPx(t), py = yToPx(y)
        if (i === 0) ctx.moveTo(px, py)
        else ctx.lineTo(px, py)
      })
      ctx.stroke()
      ctx.restore()
    }

    ctx.strokeStyle = '#8a8170'
    ctx.lineWidth = 1.5
    ctx.strokeRect(PAD_L, PAD_T, plotW, plotH)

    ctx.fillStyle = '#1a1715'
    ctx.font = "italic 600 14px 'Fraunces', serif"
    ctx.textAlign = 'center'; ctx.textBaseline = 'top'
    ctx.fillText('t', PAD_L + plotW / 2, PAD_T + plotH + 22)
    ctx.save()
    ctx.translate(16, PAD_T + plotH / 2)
    ctx.rotate(-Math.PI / 2)
    ctx.fillText('y', 0, 0)
    ctx.restore()
  }, [compiled.code, tMin, tMax, yMin, yMax, density, lengthMul, showArrows, showField, reference, canvasSize, plotW, plotH, xToPx, yToPx])

  // ----- Render numerical trajectories + marks -----
  useEffect(() => {
    const cv = overlayCanvasRef.current
    if (!cv) return
    const dpr = window.devicePixelRatio || 1
    cv.width = canvasSize.w * dpr
    cv.height = canvasSize.h * dpr
    cv.style.width = canvasSize.w + 'px'
    cv.style.height = canvasSize.h + 'px'
    const ctx = cv.getContext('2d')
    ctx.scale(dpr, dpr)
    ctx.clearRect(0, 0, canvasSize.w, canvasSize.h)

    ctx.save()
    ctx.beginPath()
    ctx.rect(PAD_L, PAD_T, plotW, plotH)
    ctx.clip()

    displayedTrajectories.forEach(({ id, nodes }) => {
      const color = METHOD_COLORS[id] || '#5a5347'

      if (showMarks) {
        nodes.forEach((node, idx) => {
          if (idx === 0) return
          // When in playback mode, the very last node is the "current" step;
          // its marks render at full strength. Earlier steps render dimmed.
          const isCurrent = playbackStep !== null && idx === nodes.length - 1
          const dim = playbackStep !== null && !isCurrent
          drawMarks(ctx, node.marks, color, xToPx, yToPx, { dim })
        })
      }

      // Connecting segments
      ctx.strokeStyle = color
      ctx.lineWidth = 2
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.beginPath()
      nodes.forEach((node, i) => {
        const px = xToPx(node.t), py = yToPx(node.y)
        if (i === 0) ctx.moveTo(px, py)
        else ctx.lineTo(px, py)
      })
      ctx.stroke()

      // Nodes — square outline for bootstrap, filled circle for committed.
      nodes.forEach((node, idx) => {
        const px = xToPx(node.t), py = yToPx(node.y)
        const isCurrent = playbackStep !== null && idx === nodes.length - 1 && idx > 0
        if (node.bootstrapped) {
          ctx.fillStyle = '#faf6ec'
          ctx.strokeStyle = color
          ctx.lineWidth = isCurrent ? 2.2 : 1.5
          ctx.fillRect(px - 3, py - 3, 6, 6)
          ctx.strokeRect(px - 3, py - 3, 6, 6)
        } else {
          ctx.fillStyle = color
          ctx.beginPath()
          ctx.arc(px, py, isCurrent ? 4.5 : 3.5, 0, Math.PI * 2)
          ctx.fill()
          ctx.strokeStyle = '#faf6ec'
          ctx.lineWidth = isCurrent ? 1.5 : 1
          ctx.stroke()
          if (isCurrent) {
            // Glow ring around current node
            ctx.strokeStyle = color
            ctx.lineWidth = 1.5
            ctx.beginPath()
            ctx.arc(px, py, 8, 0, Math.PI * 2)
            ctx.stroke()
          }
        }
      })
    })
    ctx.restore()

    // IC marker on top
    const icPx = xToPx(t0), icPy = yToPx(y0)
    if (icPx >= PAD_L && icPx <= PAD_L + plotW && icPy >= PAD_T && icPy <= PAD_T + plotH) {
      ctx.fillStyle = '#1a1715'
      ctx.beginPath()
      ctx.arc(icPx, icPy, 5, 0, Math.PI * 2)
      ctx.fill()
      ctx.strokeStyle = '#faf6ec'
      ctx.lineWidth = 2
      ctx.stroke()
    }

    // Hover crosshair
    if (hoverPt) {
      ctx.save()
      ctx.beginPath()
      ctx.rect(PAD_L, PAD_T, plotW, plotH)
      ctx.clip()
      ctx.strokeStyle = 'rgba(26, 23, 21, 0.4)'
      ctx.setLineDash([2, 4])
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(hoverPt.px, PAD_T); ctx.lineTo(hoverPt.px, PAD_T + plotH)
      ctx.moveTo(PAD_L, hoverPt.py); ctx.lineTo(PAD_L + plotW, hoverPt.py)
      ctx.stroke()
      ctx.setLineDash([])
      ctx.restore()

      const labelText = `(${hoverPt.t.toFixed(2)}, ${hoverPt.y.toFixed(2)})`
      ctx.font = "600 11px 'JetBrains Mono', monospace"
      ctx.textAlign = 'left'; ctx.textBaseline = 'top'
      const tw = ctx.measureText(labelText).width
      let lx = hoverPt.px + 10, ly = hoverPt.py - 24
      if (lx + tw + 16 > PAD_L + plotW) lx = hoverPt.px - tw - 26
      if (ly < PAD_T + 4) ly = hoverPt.py + 12
      ctx.fillStyle = 'rgba(26, 23, 21, 0.92)'
      ctx.fillRect(lx, ly, tw + 12, 20)
      ctx.fillStyle = '#faf6ec'
      ctx.fillText(labelText, lx + 6, ly + 4)
    }
  }, [displayedTrajectories, showMarks, t0, y0, hoverPt, canvasSize, plotW, plotH, xToPx, yToPx, playbackStep])

  // ----- Render error plot -----
  useEffect(() => {
    const cv = errorCanvasRef.current
    if (!cv) return
    const dpr = window.devicePixelRatio || 1
    cv.width = canvasSize.w * dpr
    cv.height = ERROR_H * dpr
    cv.style.width = canvasSize.w + 'px'
    cv.style.height = ERROR_H + 'px'
    const ctx = cv.getContext('2d')
    ctx.scale(dpr, dpr)
    ctx.clearRect(0, 0, canvasSize.w, ERROR_H)

    const EPAD_L = 56, EPAD_R = 24, EPAD_T = 18, EPAD_B = 30
    const epW = canvasSize.w - EPAD_L - EPAD_R
    const epH = ERROR_H - EPAD_T - EPAD_B

    ctx.fillStyle = '#faf6ec'
    ctx.fillRect(EPAD_L, EPAD_T, epW, epH)

    // y-range across all error series
    let maxErr = 0, minErrPos = Infinity
    errorSeries.forEach(s => {
      s.errs.forEach(e => {
        if (e > maxErr) maxErr = e
        if (e > 0 && e < minErrPos) minErrPos = e
      })
    })
    if (maxErr === 0) maxErr = 1
    if (!isFinite(minErrPos)) minErrPos = maxErr * 1e-12

    const useLog = errorScale === 'log' && maxErr > 0
    const logLo = Math.log10(Math.max(minErrPos, maxErr * 1e-12))
    const logHi = Math.log10(maxErr) + 0.2

    const tToPxE = t => EPAD_L + ((t - tMin) / (tMax - tMin)) * epW
    const errToPxE = e => {
      if (useLog) {
        if (e <= 0) return EPAD_T + epH
        const v = Math.log10(e)
        return EPAD_T + (1 - (v - logLo) / (logHi - logLo)) * epH
      }
      return EPAD_T + (1 - e / (maxErr * 1.1)) * epH
    }

    ctx.strokeStyle = '#e3dccb'
    ctx.lineWidth = 1
    const tStep = niceStep(tMax - tMin)
    ctx.beginPath()
    for (let t = Math.ceil(tMin / tStep) * tStep; t <= tMax + 1e-9; t += tStep) {
      const x = tToPxE(t)
      ctx.moveTo(x, EPAD_T); ctx.lineTo(x, EPAD_T + epH)
    }
    if (useLog) {
      for (let lv = Math.ceil(logLo); lv <= Math.floor(logHi); lv++) {
        const py = errToPxE(Math.pow(10, lv))
        ctx.moveTo(EPAD_L, py); ctx.lineTo(EPAD_L + epW, py)
      }
    } else {
      for (let k = 0; k <= 4; k++) {
        const py = EPAD_T + (k / 4) * epH
        ctx.moveTo(EPAD_L, py); ctx.lineTo(EPAD_L + epW, py)
      }
    }
    ctx.stroke()

    ctx.fillStyle = '#5a5347'
    ctx.font = "500 10px 'JetBrains Mono', monospace"
    ctx.textAlign = 'center'; ctx.textBaseline = 'top'
    for (let t = Math.ceil(tMin / tStep) * tStep; t <= tMax + 1e-9; t += tStep) {
      ctx.fillText(formatTick(t, tStep), tToPxE(t), EPAD_T + epH + 4)
    }
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle'
    if (useLog) {
      for (let lv = Math.ceil(logLo); lv <= Math.floor(logHi); lv++) {
        ctx.fillText(`1e${lv}`, EPAD_L - 6, errToPxE(Math.pow(10, lv)))
      }
    } else {
      for (let k = 0; k <= 4; k++) {
        const e = (1 - k / 4) * maxErr * 1.1
        const py = EPAD_T + (k / 4) * epH
        ctx.fillText(e.toExponential(1), EPAD_L - 6, py)
      }
    }

    ctx.strokeStyle = '#8a8170'
    ctx.lineWidth = 1.2
    ctx.strokeRect(EPAD_L, EPAD_T, epW, epH)

    errorSeries.forEach(({ id, ts, errs }) => {
      const color = METHOD_COLORS[id] || '#5a5347'
      ctx.strokeStyle = color
      ctx.lineWidth = 2
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.beginPath()
      let started = false
      ts.forEach((t, i) => {
        const e = errs[i]
        if (useLog && e <= 0) { started = false; return }
        const px = tToPxE(t)
        const py = errToPxE(e)
        if (!started) { ctx.moveTo(px, py); started = true }
        else ctx.lineTo(px, py)
      })
      ctx.stroke()

      ctx.fillStyle = color
      ts.forEach((t, i) => {
        const e = errs[i]
        if (useLog && e <= 0) return
        ctx.beginPath()
        ctx.arc(tToPxE(t), errToPxE(e), 2.5, 0, Math.PI * 2)
        ctx.fill()
      })
    })

    ctx.fillStyle = '#1a1715'
    ctx.font = "600 11px 'JetBrains Mono', monospace"
    ctx.textAlign = 'left'; ctx.textBaseline = 'top'
    ctx.fillText(
      exactFn ? '|y_num − y_exact|  (analytic)' : '|y_num − y_RK4ref|  (RK4 reference)',
      EPAD_L, 2
    )
  }, [errorSeries, errorScale, tMin, tMax, exactFn, canvasSize.w])

  // ----- Click and hover handlers -----
  const handleClick = e => {
    const rect = overlayCanvasRef.current.getBoundingClientRect()
    const px = e.clientX - rect.left
    const py = e.clientY - rect.top
    if (px < PAD_L || px > PAD_L + plotW || py < PAD_T || py > PAD_T + plotH) return
    setT0(round(pxToX(px), 4))
    setY0(round(pxToY(py), 4))
  }

  const handleMouseMove = e => {
    const rect = overlayCanvasRef.current.getBoundingClientRect()
    const px = e.clientX - rect.left
    const py = e.clientY - rect.top
    if (px < PAD_L || px > PAD_L + plotW || py < PAD_T || py > PAD_T + plotH) {
      setHoverPt(null); return
    }
    setHoverPt({ px, py, t: pxToX(px), y: pxToY(py) })
  }

  const applyPreset = p => {
    setExpr(p.f)
    setTMin(p.tMin); setTMax(p.tMax); setYMin(p.yMin); setYMax(p.yMax)
    setT0(p.t0); setY0(p.y0); setH(p.h)
    setExactFn(() => p.exact)
    setPresetName(p.name)
    setPresetOpen(false)
  }

  // When the equation is edited freehand, drop the analytic exact (it's
  // only valid for the preset's exact form).
  useEffect(() => {
    const matched = PRESETS.find(p => p.name === presetName)
    if (!matched || expr !== matched.f) setExactFn(() => null)
    else setExactFn(() => matched.exact)
  }, [expr, presetName])

  const toggleMethod = id => {
    setActiveMethods(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    )
  }

  const nSteps = Math.max(1, Math.floor((tMax - t0) / Math.abs(h)))
  const currentPreset = PRESETS.find(p => p.name === presetName)
  const presetNote = currentPreset && expr === currentPreset.f ? currentPreset.note : null

  // ----- Export handlers -----

  const exportPlotSVG = () => {
    if (!compiled.code) return
    const svg = buildSVG({
      expr, tMin, tMax, yMin, yMax,
      density, lengthMul, showField, showArrows,
      compiled,
      reference,
      trajectories: displayedTrajectories,
      errorSeries, errorScale, exactFn,
      t0, y0,
      canvasSize, errorH: ERROR_H,
    })
    downloadSVG(svg, `numerical-methods-${slug(expr)}.svg`)
  }

  const exportConvergenceSVG = () => {
    if (!convStudy) return
    const svg = buildConvergenceSVG({
      study: convStudy.study, exactFn: convStudy.exactWasUsed,
    })
    if (svg) downloadSVG(svg, `convergence-${slug(expr)}.svg`)
  }

  // ----- Convergence study handler -----

  const runConvergence = () => {
    if (!compiled.code) return
    // Take the user's current h as the largest, halve five times → six h's.
    const h0 = Math.abs(h)
    const hList = [h0, h0 / 2, h0 / 4, h0 / 8, h0 / 16, h0 / 32]
    const study = convergenceStudy({
      methods: activeMethods.map(id => METHOD_BY_ID[id]),
      code: compiled.code,
      t0, y0, tEnd: tMax,
      hList, exactFn,
    })
    setConvStudy({ study, exactWasUsed: !!exactFn, hList })
    setConvOpen(true)
  }

  return (
    <div style={{ minHeight: '100vh', padding: '20px 24px 40px', maxWidth: 1400, margin: '0 auto' }}>
      <Header />
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 340px', gap: 22, marginTop: 18 }}>
        <div ref={containerRef} style={{
          display: 'flex', flexDirection: 'column', gap: 10,
          background: '#1a1715', padding: 12, borderRadius: 6,
          boxShadow: '0 18px 40px -20px rgba(26,23,21,0.5)',
        }}>
          <div style={{ position: 'relative', borderRadius: 4, overflow: 'hidden', background: '#faf6ec' }}>
            <canvas ref={fieldCanvasRef} style={{ display: 'block' }} />
            <canvas
              ref={overlayCanvasRef}
              onClick={handleClick}
              onMouseMove={handleMouseMove}
              onMouseLeave={() => setHoverPt(null)}
              style={{ display: 'block', position: 'absolute', top: 0, left: 0, cursor: 'crosshair' }}
            />
          </div>
          <div style={{ borderRadius: 4, overflow: 'hidden', background: '#faf6ec' }}>
            <canvas ref={errorCanvasRef} style={{ display: 'block' }} />
          </div>
          <Legend trajectories={trajectories} />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Panel>
            <PanelLabel>Equation</PanelLabel>
            <ExprInput expr={expr} setExpr={setExpr} compiled={compiled} />
            <div style={{ position: 'relative', marginTop: 10 }}>
              <button onClick={() => setPresetOpen(p => !p)} style={presetBtnStyle}>
                <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12 }}>PRESETS</span>
                <ChevronDown size={14} />
              </button>
              {presetOpen && (
                <div style={presetMenuStyle}>
                  {PRESETS.map(p => (
                    <button key={p.name} onClick={() => applyPreset(p)} style={presetItemStyle}>
                      <span style={{ fontWeight: 600, fontSize: 12 }}>{p.name}</span>
                      <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: '#7a7264' }}>
                        y′ = {p.f}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            {presetNote && (
              <div style={{
                marginTop: 8, padding: '8px 10px',
                background: '#faf6ec', border: '1px solid #d8d2c0', borderRadius: 3,
                fontSize: 11, color: '#5a5347', lineHeight: 1.45,
              }}>
                {presetNote}
              </div>
            )}
          </Panel>

          <Panel>
            <PanelLabel>Window</PanelLabel>
            <RangeRow label="t" min={tMin} max={tMax} setMin={setTMin} setMax={setTMax} />
            <RangeRow label="y" min={yMin} max={yMax} setMin={setYMin} setMax={setYMax} />
          </Panel>

          <Panel>
            <PanelLabel>Initial condition</PanelLabel>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '8px 8px', background: '#faf6ec',
              border: '1px solid #d8d2c0', borderRadius: 3,
            }}>
              <span style={{ fontFamily: "'Fraunces', serif", fontStyle: 'italic', fontSize: 13 }}>y(</span>
              <NumberCell value={t0} onChange={setT0} />
              <span style={{ fontFamily: "'Fraunces', serif", fontStyle: 'italic', fontSize: 13 }}>) =</span>
              <NumberCell value={y0} onChange={setY0} />
            </div>
            <div style={{ fontSize: 10, color: '#7a7264', marginTop: 6, fontStyle: 'italic' }}>
              Or click anywhere in the plot to set.
            </div>
          </Panel>

          <Panel>
            <PanelLabel>Methods</PanelLabel>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {METHODS.map(m => (
                <MethodToggle
                  key={m.id}
                  method={m}
                  active={activeMethods.includes(m.id)}
                  onToggle={() => toggleMethod(m.id)}
                />
              ))}
            </div>
          </Panel>

          <Panel>
            <PanelLabel>Step size</PanelLabel>
            <SliderRow
              label="h"
              value={h} min={0.005} max={Math.max(0.01, (tMax - t0) / 4)} step={0.005}
              onChange={setH}
              display={`${h.toFixed(3)} (${nSteps} steps)`}
            />
            <NumberRow label="h =" value={h} onChange={v => setH(Math.max(1e-6, v))} />
          </Panel>

          <Panel>
            <PanelLabel>Display</PanelLabel>
            <CheckRow label="Slope field background" checked={showField} onChange={setShowField} />
            {showField && (
              <>
                <SliderRow label="Density" value={density} min={6} max={40} step={1} onChange={setDensity} display={`${density}×${density}`} />
                <SliderRow label="Length" value={lengthMul} min={0.3} max={1.0} step={0.05} onChange={setLengthMul} display={lengthMul.toFixed(2)} />
                <CheckRow label="Direction arrows" checked={showArrows} onChange={setShowArrows} />
              </>
            )}
            <CheckRow label="Method scaffolding" checked={showMarks} onChange={setShowMarks} />
            <div style={{ fontSize: 10, color: '#7a7264', marginTop: 4, fontStyle: 'italic', lineHeight: 1.4 }}>
              When on, shows tangent lines (Euler), predictor steps (Heun),
              k-evaluations (RK4), Newton iterates (implicit), and history
              windows (multistep).
            </div>
          </Panel>

          <Panel>
            <PanelLabel>Error plot</PanelLabel>
            <div style={{ display: 'flex', gap: 6 }}>
              {[
                { v: 'linear', label: 'Linear' },
                { v: 'log', label: 'Log' },
              ].map(opt => (
                <button
                  key={opt.v}
                  onClick={() => setErrorScale(opt.v)}
                  style={{
                    ...segmentBtnStyle,
                    background: errorScale === opt.v ? '#1a1715' : 'transparent',
                    color: errorScale === opt.v ? '#faf6ec' : '#1a1715',
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <div style={{ fontSize: 10, color: '#7a7264', marginTop: 6, fontStyle: 'italic', lineHeight: 1.5 }}>
              {exactFn
                ? 'Errors against the analytic exact solution.'
                : 'No closed-form available; reference is RK4 with very small step.'}
            </div>
          </Panel>

          <Panel>
            <PanelLabel>Playback</PanelLabel>
            <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
              <button
                onClick={() => {
                  if (playbackStep === null) setPlaybackStep(0)
                  else { setPlaybackStep(null); setIsPlaying(false) }
                }}
                style={{
                  ...segmentBtnStyle,
                  background: playbackStep !== null ? '#1a1715' : 'transparent',
                  color: playbackStep !== null ? '#faf6ec' : '#1a1715',
                }}
              >
                {playbackStep === null ? 'Step mode' : 'Show all'}
              </button>
            </div>
            {playbackStep !== null && (
              <>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 8 }}>
                  <button
                    onClick={() => { setPlaybackStep(0); setIsPlaying(false) }}
                    style={iconBtnStyle} title="First step"
                  ><SkipBack size={14} /></button>
                  <button
                    onClick={() => setPlaybackStep(s => Math.max(0, (s ?? 0) - 1))}
                    style={iconBtnStyle} title="Previous step"
                  ><ChevronDown size={14} style={{ transform: 'rotate(90deg)' }} /></button>
                  <button
                    onClick={() => {
                      if (playbackStep >= maxSteps) setPlaybackStep(0)
                      setIsPlaying(p => !p)
                    }}
                    style={{
                      ...iconBtnStyle,
                      background: isPlaying ? '#1a1715' : '#faf6ec',
                      color: isPlaying ? '#faf6ec' : '#1a1715',
                    }}
                    title={isPlaying ? 'Pause' : 'Play'}
                  >
                    {isPlaying ? <Pause size={14} /> : <Play size={14} />}
                  </button>
                  <button
                    onClick={() => setPlaybackStep(s => Math.min(maxSteps, (s ?? 0) + 1))}
                    style={iconBtnStyle} title="Next step"
                  ><ChevronDown size={14} style={{ transform: 'rotate(-90deg)' }} /></button>
                  <button
                    onClick={() => { setPlaybackStep(maxSteps); setIsPlaying(false) }}
                    style={iconBtnStyle} title="Last step"
                  ><SkipForward size={14} /></button>
                </div>
                <SliderRow
                  label="step"
                  value={playbackStep ?? 0} min={0} max={maxSteps} step={1}
                  onChange={v => { setPlaybackStep(v); setIsPlaying(false) }}
                  display={`${playbackStep ?? 0} / ${maxSteps}`}
                />
                <div style={{ fontSize: 10, color: '#7a7264', fontStyle: 'italic', lineHeight: 1.4 }}>
                  Walks through node by node; the current step's scaffolding renders at full strength.
                </div>
              </>
            )}
          </Panel>

          <Panel>
            <PanelLabel>Convergence study</PanelLabel>
            <button onClick={runConvergence} style={primaryBtnStyle} title="Halve h six times and plot max error vs h">
              <ChevronsRight size={13} /> Run on selected methods
            </button>
            {convStudy && (
              <div style={{
                marginTop: 10, padding: '8px 10px',
                background: '#faf6ec', border: '1px solid #d8d2c0', borderRadius: 3,
              }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: "'JetBrains Mono', monospace", fontSize: 10 }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid #d8d2c0' }}>
                      <th style={{ textAlign: 'left', padding: '2px 4px' }}>method</th>
                      <th style={{ textAlign: 'right', padding: '2px 4px' }}>h₀ err</th>
                      <th style={{ textAlign: 'right', padding: '2px 4px' }}>h/32 err</th>
                      <th style={{ textAlign: 'right', padding: '2px 4px' }}>order</th>
                    </tr>
                  </thead>
                  <tbody>
                    {convStudy.study.map(s => {
                      const r = s.results.filter(x => x.maxErr > 0)
                      const order = r.length >= 2
                        ? Math.log(r[0].maxErr / r[r.length - 1].maxErr) / Math.log(r[0].h / r[r.length - 1].h)
                        : null
                      return (
                        <tr key={s.id}>
                          <td style={{ padding: '2px 4px', color: METHOD_COLORS[s.id] }}>{s.name}</td>
                          <td style={{ padding: '2px 4px', textAlign: 'right' }}>
                            {s.results[0].maxErr.toExponential(1)}
                          </td>
                          <td style={{ padding: '2px 4px', textAlign: 'right' }}>
                            {s.results[s.results.length - 1].maxErr.toExponential(1)}
                          </td>
                          <td style={{ padding: '2px 4px', textAlign: 'right', fontWeight: 600 }}>
                            {order !== null && isFinite(order) ? order.toFixed(2) : '—'}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
                <button onClick={exportConvergenceSVG} style={{ ...iconBtnStyle, marginTop: 8, width: '100%' }}>
                  <Download size={12} /> Convergence SVG
                </button>
              </div>
            )}
          </Panel>

          <Panel>
            <PanelLabel>Export</PanelLabel>
            <button onClick={exportPlotSVG} style={primaryBtnStyle}>
              <Download size={13} /> Plot + error SVG
            </button>
            <div style={{ fontSize: 10, color: '#7a7264', marginTop: 6, fontStyle: 'italic', lineHeight: 1.5 }}>
              Exports the current plot and error panel as a single SVG suitable for LaTeX.
            </div>
          </Panel>
        </div>
      </div>
    </div>
  )
}

// ============================================================================
// Mark renderers
// ============================================================================

function drawMarks(ctx, marks, color, xToPx, yToPx, opts = {}) {
  const a = opts.dim ? 0.4 : 1.0  // overall alpha multiplier for dim mode
  for (const m of marks) {
    if (m.kind === 'tangent') {
      ctx.strokeStyle = withAlpha(color, 0.4 * a)
      ctx.lineWidth = 1.2
      ctx.setLineDash([3, 3])
      ctx.beginPath()
      ctx.moveTo(xToPx(m.t0), yToPx(m.y0))
      ctx.lineTo(xToPx(m.t1), yToPx(m.y1))
      ctx.stroke()
      ctx.setLineDash([])
    }
    else if (m.kind === 'predictor') {
      ctx.strokeStyle = withAlpha(color, 0.5 * a)
      ctx.lineWidth = 1.4
      ctx.setLineDash([4, 3])
      ctx.beginPath()
      ctx.moveTo(xToPx(m.t0), yToPx(m.y0))
      ctx.lineTo(xToPx(m.t1), yToPx(m.y1))
      ctx.stroke()
      ctx.setLineDash([])
      ctx.fillStyle = withAlpha('#faf6ec', a)
      ctx.strokeStyle = withAlpha(color, a)
      ctx.lineWidth = 1.2
      ctx.beginPath()
      ctx.arc(xToPx(m.t1), yToPx(m.y1), 3, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()
    }
    else if (m.kind === 'slope-at') {
      const len = 12
      const cx = xToPx(m.t), cy = yToPx(m.y)
      ctx.strokeStyle = withAlpha(color, 0.6 * a)
      ctx.lineWidth = 1.2
      ctx.beginPath()
      ctx.moveTo(cx - len / 2, cy)
      ctx.lineTo(cx + len / 2, cy)
      ctx.stroke()
    }
    else if (m.kind === 'k-eval') {
      const cx = xToPx(m.t), cy = yToPx(m.y)
      ctx.strokeStyle = withAlpha(color, 0.6 * a)
      ctx.lineWidth = 1.2
      const r = 3
      ctx.beginPath()
      ctx.moveTo(cx - r, cy - r); ctx.lineTo(cx + r, cy + r)
      ctx.moveTo(cx + r, cy - r); ctx.lineTo(cx - r, cy + r)
      ctx.stroke()
      ctx.fillStyle = withAlpha(color, 0.9 * a)
      ctx.font = "600 9px 'JetBrains Mono', monospace"
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle'
      ctx.fillText(m.label, cx + 5, cy - 6)
    }
    else if (m.kind === 'newton-iterates') {
      const px = xToPx(m.tNext)
      ctx.strokeStyle = withAlpha(color, 0.3 * a)
      ctx.lineWidth = 0.8
      ctx.beginPath()
      m.iterates.forEach((y, i) => {
        const py = yToPx(y)
        if (i === 0) ctx.moveTo(px, py)
        else ctx.lineTo(px, py)
      })
      ctx.stroke()
      m.iterates.forEach((y, i) => {
        if (i === m.iterates.length - 1) return
        const py = yToPx(y)
        ctx.fillStyle = withAlpha('#faf6ec', a)
        ctx.strokeStyle = withAlpha(color, a)
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.arc(px, py, 2, 0, Math.PI * 2)
        ctx.fill()
        ctx.stroke()
      })
    }
    else if (m.kind === 'multistep-window') {
      ctx.strokeStyle = withAlpha(color, 0.25 * a)
      ctx.lineWidth = 6
      ctx.lineCap = 'round'
      ctx.beginPath()
      m.nodes.forEach((n, i) => {
        const px = xToPx(n.t), py = yToPx(n.y)
        if (i === 0) ctx.moveTo(px, py)
        else ctx.lineTo(px, py)
      })
      ctx.stroke()
    }
    else if (m.kind === 'pc-predict') {
      const px = xToPx(m.t), py = yToPx(m.y)
      ctx.fillStyle = withAlpha('#faf6ec', a)
      ctx.strokeStyle = withAlpha(color, 0.7 * a)
      ctx.lineWidth = 1.2
      ctx.fillRect(px - 3, py - 3, 6, 6)
      ctx.strokeRect(px - 3, py - 3, 6, 6)
    }
    else if (m.kind === 'pc-corrected') {
      const px = xToPx(m.tNext)
      m.iterates.forEach((y, i) => {
        if (i === 0 || i === m.iterates.length - 1) return
        const py = yToPx(y)
        ctx.fillStyle = withAlpha('#faf6ec', a)
        ctx.strokeStyle = withAlpha(color, a)
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.arc(px, py, 1.8, 0, Math.PI * 2)
        ctx.fill()
        ctx.stroke()
      })
    }
  }
}

function withAlpha(hex, alpha) {
  if (!hex.startsWith('#')) {
    // Already an rgba/named color — pass through
    return hex
  }
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

// ============================================================================
// Subcomponents
// ============================================================================

function Header() {
  return (
    <header style={{ display: 'flex', alignItems: 'baseline', gap: 16, borderBottom: '1px solid #1a1715', paddingBottom: 12 }}>
      <h1 style={{
        fontFamily: "'Fraunces', serif", fontWeight: 600, fontSize: 32, margin: 0,
        letterSpacing: '-0.02em', fontStyle: 'italic',
      }}>
        Numerical Methods
      </h1>
      <span style={{
        fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: '#5a5347',
        letterSpacing: '0.08em', textTransform: 'uppercase',
      }}>
        y′ = f(t, y) — Math 252
      </span>
      <div style={{ flex: 1 }} />
      <a
        href="./methods.html"
        target="_blank"
        rel="noopener noreferrer"
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          padding: '6px 12px',
          background: '#1a1715', color: '#faf6ec',
          border: 'none', borderRadius: 3,
          fontFamily: "'JetBrains Mono', monospace", fontSize: 11,
          fontWeight: 600, textDecoration: 'none',
          letterSpacing: '0.04em',
        }}
        title="Open the explanation document in a new tab"
      >
        <BookOpen size={13} /> How methods work
      </a>
      <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: '#7a7264' }}>
        College of San Mateo
      </span>
    </header>
  )
}

function Panel({ children }) {
  return (
    <div style={{
      background: '#fffdf6', border: '1px solid #d8d2c0', borderRadius: 4,
      padding: 12, boxShadow: '0 1px 0 #e8e2d0',
    }}>
      {children}
    </div>
  )
}

function PanelLabel({ children }) {
  return (
    <div style={{
      fontFamily: "'JetBrains Mono', monospace", fontSize: 10,
      letterSpacing: '0.12em', textTransform: 'uppercase',
      color: '#1a1715', fontWeight: 600, marginBottom: 8,
      display: 'flex', alignItems: 'center', gap: 8,
    }}>{children}</div>
  )
}

function ExprInput({ expr, setExpr, compiled }) {
  return (
    <div>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        background: '#faf6ec',
        border: `1.5px solid ${compiled.error ? '#c1432f' : '#1a1715'}`,
        borderRadius: 3, padding: '8px 10px',
      }}>
        <span style={{ fontFamily: "'Fraunces', serif", fontStyle: 'italic', fontWeight: 500, fontSize: 16 }}>y′ =</span>
        <input
          value={expr}
          onChange={e => setExpr(e.target.value)}
          spellCheck={false}
          style={{
            flex: 1, border: 'none', outline: 'none', background: 'transparent',
            fontFamily: "'JetBrains Mono', monospace", fontSize: 13, color: '#1a1715',
          }}
        />
      </div>
      {compiled.error && (
        <div style={{ marginTop: 6, fontSize: 11, color: '#c1432f', fontFamily: "'JetBrains Mono', monospace" }}>
          {compiled.error}
        </div>
      )}
    </div>
  )
}

function RangeRow({ label, min, max, setMin, setMax }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
      <span style={{ fontFamily: "'Fraunces', serif", fontStyle: 'italic', fontWeight: 500, fontSize: 14, width: 14 }}>{label}</span>
      <NumberCell value={min} onChange={setMin} />
      <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: '#7a7264' }}>→</span>
      <NumberCell value={max} onChange={setMax} />
    </div>
  )
}

function NumberRow({ label, value, onChange }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
      <span style={{ fontSize: 12, color: '#1a1715' }}>{label}</span>
      <NumberCell value={value} onChange={onChange} />
    </div>
  )
}

function NumberCell({ value, onChange }) {
  const [local, setLocal] = useState(String(value))
  useEffect(() => { setLocal(String(value)) }, [value])
  return (
    <input
      value={local}
      onChange={e => setLocal(e.target.value)}
      onBlur={() => {
        const n = Number(local)
        if (Number.isFinite(n)) onChange(n)
        else setLocal(String(value))
      }}
      onKeyDown={e => { if (e.key === 'Enter') e.target.blur() }}
      style={{
        flex: 1, background: '#faf6ec',
        border: '1px solid #d8d2c0', borderRadius: 2,
        padding: '4px 6px',
        fontFamily: "'JetBrains Mono', monospace", fontSize: 12,
        color: '#1a1715', outline: 'none', textAlign: 'center', minWidth: 0,
      }}
    />
  )
}

function SliderRow({ label, value, min, max, step, onChange, display }) {
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
        <span style={{ fontSize: 12, color: '#1a1715' }}>{label}</span>
        <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: '#5a5347' }}>{display}</span>
      </div>
      <input
        type="range"
        min={min} max={max} step={step} value={value}
        onChange={e => onChange(Number(e.target.value))}
        style={{ width: '100%', accentColor: '#1a1715' }}
      />
    </div>
  )
}

function CheckRow({ label, checked, onChange }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#1a1715', cursor: 'pointer', marginTop: 4 }}>
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} style={{ accentColor: '#1a1715' }} />
      {label}
    </label>
  )
}

function MethodToggle({ method, active, onToggle }) {
  const color = METHOD_COLORS[method.id] || '#5a5347'
  return (
    <button
      onClick={onToggle}
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '6px 8px',
        background: active ? '#faf6ec' : 'transparent',
        border: `1.5px solid ${active ? color : '#d8d2c0'}`,
        borderRadius: 3, cursor: 'pointer', textAlign: 'left',
      }}
      title={`${method.name} · order ${method.order}${method.multistep ? ` · ${method.steps}-step` : ''}`}
    >
      <span style={{
        width: 14, height: 14, borderRadius: '50%',
        background: active ? color : '#faf6ec',
        border: `1.5px solid ${color}`, flexShrink: 0,
      }} />
      <span style={{ flex: 1, fontSize: 12, color: '#1a1715', fontWeight: active ? 600 : 500 }}>
        {method.name}
      </span>
      <span style={{
        fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: '#7a7264',
      }}>
        O(h{toSuper(method.order)})
      </span>
    </button>
  )
}

function Legend({ trajectories }) {
  return (
    <div style={{
      display: 'flex', flexWrap: 'wrap', gap: 14,
      padding: '6px 8px',
      fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: '#d8d2c0',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ width: 14, height: 2, background: '#faf6ec' }} />
        <span>reference</span>
      </div>
      {trajectories.map(({ id, method, nodes }) => (
        <div key={id} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 14, height: 2, background: METHOD_COLORS[id] }} />
          <span style={{ color: '#faf6ec' }}>{method.name}</span>
          <span style={{ color: '#7a7264' }}>· {nodes.length - 1} steps</span>
        </div>
      ))}
    </div>
  )
}

// ============================================================================
// Helpers
// ============================================================================

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

function round(v, places) {
  const m = Math.pow(10, places)
  return Math.round(v * m) / m
}

function toSuper(n) {
  return String(n).split('').map(c => '⁰¹²³⁴⁵⁶⁷⁸⁹'[+c] || c).join('')
}

function downloadSVG(svgString, filename) {
  const blob = new Blob([svgString], { type: 'image/svg+xml' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

function slug(s) {
  return s.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'plot'
}

// ============================================================================
// Styles
// ============================================================================

const presetBtnStyle = {
  width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  background: 'transparent', border: '1px solid #1a1715', borderRadius: 3,
  padding: '6px 10px', cursor: 'pointer', color: '#1a1715', fontWeight: 600,
}
const presetMenuStyle = {
  position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0,
  background: '#fffdf6', border: '1px solid #1a1715', borderRadius: 3,
  zIndex: 10, maxHeight: 320, overflowY: 'auto',
  boxShadow: '0 12px 24px -10px rgba(26,23,21,0.3)',
}
const presetItemStyle = {
  width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'flex-start',
  padding: '8px 10px', background: 'transparent', border: 'none',
  borderBottom: '1px solid #ece5d2', cursor: 'pointer', textAlign: 'left',
  gap: 2, color: '#1a1715',
}
const segmentBtnStyle = {
  flex: 1, border: '1px solid #1a1715', borderRadius: 3,
  padding: '4px 8px', fontSize: 11,
  fontFamily: "'JetBrains Mono', monospace", cursor: 'pointer', fontWeight: 600,
}
const primaryBtnStyle = {
  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
  width: '100%', background: '#1a1715', color: '#faf6ec',
  border: 'none', borderRadius: 3, padding: '8px 10px',
  fontFamily: "'JetBrains Mono', monospace", fontSize: 11, fontWeight: 600,
  cursor: 'pointer',
}
const iconBtnStyle = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 4,
  background: '#faf6ec', color: '#1a1715',
  border: '1px solid #1a1715', borderRadius: 3, padding: '5px 8px',
  fontFamily: "'JetBrains Mono', monospace", fontSize: 11,
  cursor: 'pointer', minWidth: 28,
}
