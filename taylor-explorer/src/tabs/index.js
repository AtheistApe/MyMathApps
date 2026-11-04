// TAB REGISTRY — the one place to plug in a new feature.
//
// To add a tab:
//   1. create src/tabs/MyFeature.jsx (default-export a React component)
//   2. import it here and add one line to TABS
// Every tab can use the shared state and widgets:
//   useFn(), useStore()           (src/store.js)  function, center a, degree n, test point x0
//   useTabView(tabId, fn)         pan/zoom window remembered per tab
//   <PlotCanvas/>                 pan/zoom/touch plot with draggable handles
//   <FunctionPicker/> <DegreeControl/> <CenterControl/> <TestPointControl/>   (components/Controls.jsx)
//
// Planned additions (see README): error bound / Lagrange, match-the-function challenge,
// "how many terms do I need?", series manipulation, partial sums & convergence tests.

import Explore from './Explore.jsx';
import Convergence from './Convergence.jsx';

export const TABS = [
  { id: 'explore', label: 'Taylor polynomials', component: Explore },
  { id: 'convergence', label: 'Interval of convergence', component: Convergence },
  // { id: 'errorbound', label: 'Error bound', component: ErrorBound },
  // { id: 'match', label: 'Match the function', component: MatchChallenge },
  // { id: 'howmany', label: 'How many terms?', component: HowManyTerms },
  // { id: 'manipulate', label: 'New series from old', component: SeriesManipulation },
];
