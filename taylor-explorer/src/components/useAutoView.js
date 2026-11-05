// A pan/zoom window for plots whose natural window depends on the problem (not just on the function).
// `auto` is the window to use until the user pans or zooms; their change is remembered only while `sig`
// (a string describing the problem) stays the same, so a new problem starts from a fresh window.

import { useCallback, useState } from 'react';

export function useAutoView(sig, auto) {
  const [override, setOverride] = useState(null);
  const view = override?.sig === sig ? override.view : auto;
  const set = useCallback((v) => setOverride({ sig, view: v }), [sig]);
  const reset = useCallback(() => setOverride(null), []);
  return [view, set, reset];
}
