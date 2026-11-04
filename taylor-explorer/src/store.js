// Shared app state (Zustand). Everything the tabs have in common lives here:
// which function, the center a, the degree n, and the test point x0.
// Per-tab view windows (pan/zoom) are kept here too so they survive switching tabs.

import { create } from 'zustand';
import { useCallback, useMemo } from 'react';
import { presetById, viewFor } from './math/functions.js';
import { buildCustom } from './math/customFunction.js';
import { clamp, snap } from './math/util.js';

const DEFAULT_CUSTOM = 'exp(x)*cos(x)';

// Building a custom function is asynchronous (the parser loads the first time). If the student picks something
// else while it is loading, that later choice must win, so each request gets a number and stale ones are dropped.
let customRequest = 0;

export const useStore = create((set, get) => ({
  fnId: 'exp',
  custom: { expr: DEFAULT_CUSTOM, fn: null, status: 'idle', error: '' },
  a: 0,
  n: 3,
  x0: 1,
  views: {}, // { [tabId]: {xmin,xmax,ymin,ymax} }

  setN: (n) => set({ n: Math.round(n) }),
  setA: (a) => {
    const fn = currentFn(get());
    const [lo, hi] = fn.centerRange;
    set({ a: clamp(snap(a), lo, hi) });
  },
  setX0: (x) => set({ x0: x }), // exactly what was typed; dragging on a plot snaps before calling this

  setView: (tab, view) => set((s) => ({ views: { ...s.views, [tab]: view } })),
  resetView: (tab) =>
    set((s) => {
      const views = { ...s.views };
      delete views[tab];
      return { views };
    }),

  selectPreset: (id) => {
    const fn = presetById(id);
    customRequest++; // cancels a custom function that is still being built
    set((s) => ({
      fnId: id,
      a: clamp(s.a, fn.centerRange[0], fn.centerRange[1]),
      n: Math.min(s.n, fn.maxDegree),
      views: {},
      custom: s.custom.status === 'loading' ? { ...s.custom, status: 'idle' } : s.custom,
    }));
  },

  /** Switch to the student's own function if one has already been built. */
  activateCustom: () => {
    customRequest++;
    set((s) => ({
      ...(s.custom.fn ? { fnId: 'custom', views: {} } : {}),
      custom: s.custom.status === 'loading' ? { ...s.custom, status: 'idle' } : s.custom,
    }));
  },

  setCustomExpr: async (expr) => {
    const mine = ++customRequest;
    set((s) => ({ custom: { ...s.custom, expr, status: 'loading', error: '' } }));
    try {
      const fn = await buildCustom(expr);
      if (mine !== customRequest) return; // superseded while loading
      set((s) => ({
        custom: { expr, fn, status: 'ok', error: '' },
        fnId: 'custom',
        a: clamp(s.a, fn.centerRange[0], fn.centerRange[1]),
        n: Math.min(s.n, fn.maxDegree),
        views: {},
      }));
    } catch (err) {
      if (mine !== customRequest) return;
      set((s) => ({ custom: { ...s.custom, expr, status: 'error', error: String(err.message || err) } }));
    }
  },
}));

function currentFn(s) {
  return s.fnId === 'custom' && s.custom.fn ? s.custom.fn : presetById(s.fnId);
}

/** The active function object. */
export const useFn = () => useStore(currentFn);

/** [view, setView, resetView] for one tab, falling back to the function's default window. */
export function useTabView(tabId, fn) {
  const stored = useStore((s) => s.views[tabId]);
  const setView = useStore((s) => s.setView);
  const resetView = useStore((s) => s.resetView);
  const def = useMemo(() => viewFor(fn), [fn]);
  const set = useCallback((v) => setView(tabId, v), [setView, tabId]);
  const reset = useCallback(() => resetView(tabId), [resetView, tabId]);
  return [stored ?? def, set, reset];
}
