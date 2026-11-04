// Shared app state (Zustand). Everything the tabs have in common lives here:
// which function, the center a, the degree n, and the test point x0.
// Per-tab view windows (pan/zoom) are kept here too so they survive switching tabs.

import { create } from 'zustand';
import { useMemo } from 'react';
import { presetById, viewFor } from './math/functions.js';
import { buildCustom } from './math/customFunction.js';
import { clamp, snap } from './math/taylor.js';

const DEFAULT_CUSTOM = 'exp(x)*cos(x)';

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
  setX0: (x) => set({ x0: snap(x) }),

  setView: (tab, view) => set((s) => ({ views: { ...s.views, [tab]: view } })),
  resetView: (tab) =>
    set((s) => {
      const views = { ...s.views };
      delete views[tab];
      return { views };
    }),

  selectPreset: (id) => {
    const fn = presetById(id);
    set((s) => ({
      fnId: id,
      a: clamp(s.a, fn.centerRange[0], fn.centerRange[1]),
      n: Math.min(s.n, fn.maxDegree),
      views: {},
    }));
  },

  useCustomIfReady: () => {
    const { custom } = get();
    if (custom.fn) set({ fnId: 'custom', views: {} });
  },

  setCustomExpr: async (expr) => {
    set((s) => ({ custom: { ...s.custom, expr, status: 'loading', error: '' } }));
    try {
      const fn = await buildCustom(expr);
      set((s) => ({
        custom: { expr, fn, status: 'ok', error: '' },
        fnId: 'custom',
        a: clamp(s.a, fn.centerRange[0], fn.centerRange[1]),
        n: Math.min(s.n, fn.maxDegree),
        views: {},
      }));
    } catch (err) {
      set((s) => ({ custom: { ...s.custom, expr, status: 'error', error: String(err.message || err) } }));
    }
  },
}));

function currentFn(s) {
  return s.fnId === 'custom' && s.custom.fn ? s.custom.fn : presetById(s.fnId);
}

/** The active function object. */
export function useFn() {
  const fnId = useStore((s) => s.fnId);
  const custom = useStore((s) => s.custom.fn);
  return fnId === 'custom' && custom ? custom : presetById(fnId);
}

/** [view, setView, resetView] for one tab, falling back to the function's default window. */
export function useTabView(tabId, fn) {
  const stored = useStore((s) => s.views[tabId]);
  const setView = useStore((s) => s.setView);
  const resetView = useStore((s) => s.resetView);
  const def = useMemo(() => viewFor(fn), [fn]);
  return [stored ?? def, (v) => setView(tabId, v), () => resetView(tabId)];
}
