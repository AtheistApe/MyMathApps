// The two draggable handles every Taylor plot shares: the center a (sits on the curve)
// and the test point x0 (rides along the bottom edge with a dashed guide line).

import { useStore } from '../store.js';
import { COL } from '../theme.js';
import { snap } from '../math/util.js';

export function useCenterTestHandles(fn) {
  const a = useStore((s) => s.a);
  const x0 = useStore((s) => s.x0);
  const setA = useStore((s) => s.setA);
  const setX0 = useStore((s) => s.setX0);

  const fa = fn.f(a);
  const handles = [
    { id: 'a', x: a, y: fa, anchor: Number.isFinite(fa) ? undefined : 'bottom', color: COL.center, label: 'a' },
    { id: 'x0', x: x0, anchor: 'bottom', color: COL.test, label: 'x₀', guide: true },
  ];
  const onHandleDrag = (id, x) => (id === 'a' ? setA(x) : setX0(snap(x)));
  return { handles, onHandleDrag };
}
