// The live coefficient table: for each k shows f^(k)(a), k!, c_k = f^(k)(a)/k!, and the term.
// Optionally adds the term value and running total at the test point x0.

import { useEffect, useRef } from 'react';
import { describeCoef, factorialBig, fmtDeriv, fmtNum, factorial, polynomialText, powerText, sub, sup, termText } from '../math/numfmt.js';
import { partialSums } from '../math/taylor.js';

const factText = (k) => (k <= 20 ? String(factorialBig(k)) : fmtNum(factorial(k), 4));

export default function CoefficientTable({ coeffs, a, n, x0, showEval, decimal = false }) {
  const box = useRef(null);
  useEffect(() => {
    if (box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [n]);

  const h = x0 - a;
  const sums = showEval ? partialSums(coeffs, n, h) : null;
  const aText = a === 0 ? '0' : fmtNum(a, 4);

  const rows = [];
  for (let k = 0; k <= n; k++) {
    const c = coeffs[k];
    const co = describeCoef(c, k, decimal);
    const d = c * factorial(k);
    rows.push(
      <tr key={k} className={k === n ? 'newest' : undefined}>
        <td className="k">{k}</td>
        <td>{fmtDeriv(d)}</td>
        <td>{factText(k)}</td>
        <td className="coef">{co.text}</td>
        <td className="term">{termText(co, a, k)}</td>
        {showEval && <td>{fmtNum(c * Math.pow(h, k), 5)}</td>}
        {showEval && <td>{fmtNum(sums[k], 6)}</td>}
      </tr>,
    );
  }

  return (
    <div className="coef-block">
      <p className="poly-line">
        <span className="lhs">T{sub(n)}(x) =</span> {polynomialText(coeffs, a, n, decimal)}
      </p>
      <div className="table-scroll" ref={box}>
        <table className="coef-table">
          <thead>
            <tr>
              <th>k</th>
              <th>f{sup('(k)')}({aText})</th>
              <th>k!</th>
              <th>c{sub('k')} = f{sup('(k)')}({aText}) / k!</th>
              <th>c{sub('k')}{powerText(a, 1)}{sup('k')}</th>
              {showEval && <th>term at x{sub(0)}</th>}
              {showEval && <th>T{sub('k')}(x{sub(0)})</th>}
            </tr>
          </thead>
          <tbody>{rows}</tbody>
        </table>
      </div>
    </div>
  );
}
