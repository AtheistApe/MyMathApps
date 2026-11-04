// Shared control widgets used by every tab. All of them read/write the shared store.

import { useEffect, useId, useState } from 'react';
import { PRESETS } from '../math/functions.js';
import { useFn, useStore } from '../store.js';
import { fmtNum, sub } from '../math/numfmt.js';

export function FunctionPicker() {
  const fnId = useStore((s) => s.fnId);
  const custom = useStore((s) => s.custom);
  const selectPreset = useStore((s) => s.selectPreset);
  const activateCustom = useStore((s) => s.activateCustom);
  const setCustomExpr = useStore((s) => s.setCustomExpr);
  const selectId = useId();
  const [wantsCustom, setWantsCustom] = useState(false); // "Your own function…" chosen, but not built yet
  const [text, setText] = useState(custom.expr);
  const showCustom = wantsCustom || fnId === 'custom';

  const onSelect = (e) => {
    const v = e.target.value;
    setWantsCustom(v === 'custom');
    if (v === 'custom') activateCustom();
    else selectPreset(v);
  };

  const apply = (e) => {
    e.preventDefault();
    setCustomExpr(text);
  };

  return (
    <div className="field">
      <label htmlFor={selectId}>Function f(x)</label>
      <select id={selectId} value={showCustom ? 'custom' : fnId} onChange={onSelect}>
        {PRESETS.map((p) => (
          <option key={p.id} value={p.id}>{p.label}</option>
        ))}
        <option value="custom">Your own function…</option>
      </select>
      {showCustom && (
        <form className="custom-row" onSubmit={apply}>
          <input
            type="text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            aria-label="Custom function of x"
            placeholder="e.g. sin(x)/(2 - x)"
          />
          <button type="submit" className="btn primary" disabled={custom.status === 'loading'}>
            {custom.status === 'loading' ? 'Loading…' : 'Use'}
          </button>
        </form>
      )}
      {showCustom && custom.status === 'error' && <p className="msg error">{custom.error}</p>}
      {showCustom && custom.status !== 'error' && (
        <p className="hint">Use x, + − * / ^, and functions like sin, cos, exp, log, sqrt, atan. It must be smooth at the center; a removable gap such as sin(x)/x at 0 is fine.</p>
      )}
    </div>
  );
}

function Stepper({ value, min, max, step, onChange, label, format = (v) => String(v), symbol, extra }) {
  const id = useId();
  const dec = () => onChange(Math.max(min, +(value - step).toFixed(6)));
  const inc = () => onChange(Math.min(max, +(value + step).toFixed(6)));
  return (
    <div className="field">
      <div className="field-head">
        <label htmlFor={id}>{label}</label>
        <span className="value">{symbol} = {format(value)}</span>
      </div>
      <div className="stepper">
        <button type="button" className="btn round" onClick={dec} disabled={value <= min} aria-label={`Decrease ${label}`}>−</button>
        <input
          id={id}
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(parseFloat(e.target.value))}
        />
        <button type="button" className="btn round" onClick={inc} disabled={value >= max} aria-label={`Increase ${label}`}>+</button>
        {extra}
      </div>
    </div>
  );
}

export function DegreeControl({ max }) {
  const fn = useFn();
  const n = useStore((s) => s.n);
  const setN = useStore((s) => s.setN);
  const top = Math.min(max ?? fn.maxDegree, fn.maxDegree);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    if (!playing) return undefined;
    const id = setInterval(() => {
      const cur = useStore.getState().n;
      if (cur >= top) setPlaying(false);
      else useStore.getState().setN(cur + 1);
    }, 700);
    return () => clearInterval(id);
  }, [playing, top]);

  const play = () => {
    if (playing) return setPlaying(false);
    if (n >= top) setN(0);
    setPlaying(true);
  };

  return (
    <Stepper
      label="Degree"
      symbol="n"
      value={Math.min(n, top)}
      min={0}
      max={top}
      step={1}
      onChange={(v) => { setPlaying(false); setN(v); }}
      extra={
        <button type="button" className="btn play" onClick={play} aria-label={playing ? 'Pause' : 'Play: raise the degree automatically'}>
          {playing ? '❚❚' : '▶'}
        </button>
      }
    />
  );
}

export function CenterControl() {
  const fn = useFn();
  const a = useStore((s) => s.a);
  const setA = useStore((s) => s.setA);
  const [lo, hi] = fn.centerRange;
  return (
    <Stepper
      label="Center"
      symbol="a"
      value={a}
      min={lo}
      max={hi}
      step={0.05}
      format={(v) => fmtNum(v, 4)}
      onChange={setA}
    />
  );
}

/** Numeric box for x0 (the test point). */
export function TestPointControl() {
  const x0 = useStore((s) => s.x0);
  const setX0 = useStore((s) => s.setX0);
  const inputId = useId();
  const [text, setText] = useState(String(x0));
  useEffect(() => {
    setText(String(x0)); // follow changes made by dragging the handle on a plot
  }, [x0]);
  const commit = () => {
    const v = parseFloat(text);
    if (Number.isFinite(v)) setX0(v);
    else setText(String(x0));
  };
  return (
    <div className="field inline">
      <label htmlFor={inputId}>Test point x{sub(0)}</label>
      <input
        id={inputId}
        className="num"
        type="text"
        inputMode="decimal"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
      />
    </div>
  );
}

export function Toggle({ checked, onChange, children }) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{children}</span>
    </label>
  );
}
