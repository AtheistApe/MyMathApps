import { useEffect, useState } from 'react';
import { TABS } from './tabs/index.js';
import { APP_TITLE, COURSE_LABEL } from './config.js';

const fromHash = () => {
  const id = window.location.hash.replace('#', '');
  return TABS.some((t) => t.id === id) ? id : TABS[0].id;
};

export default function App() {
  const [tabId, setTabId] = useState(fromHash);

  useEffect(() => {
    const onHash = () => setTabId(fromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const choose = (id) => {
    setTabId(id);
    window.history.replaceState(null, '', `#${id}`);
  };

  // arrow keys move between tabs (the standard keyboard pattern for a tab bar)
  const onTabKey = (e) => {
    const i = TABS.findIndex((t) => t.id === tabId);
    const next = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: TABS.length - 1 }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    const id = TABS[(next + TABS.length) % TABS.length].id;
    choose(id);
    document.getElementById(`tab-${id}`)?.focus();
  };

  const Active = TABS.find((t) => t.id === tabId).component;

  return (
    <div className="app">
      <header className="app-header">
        <div className="titles">
          <h1>{APP_TITLE}</h1>
          <p>{COURSE_LABEL}</p>
        </div>
        {TABS.length > 1 && (
          <nav className="tabs" role="tablist" aria-label="Sections" onKeyDown={onTabKey}>
            {TABS.map((t) => (
              <button
                key={t.id}
                id={`tab-${t.id}`}
                role="tab"
                aria-selected={t.id === tabId}
                aria-controls="tab-panel"
                tabIndex={t.id === tabId ? 0 : -1}
                className={t.id === tabId ? 'tab active' : 'tab'}
                onClick={() => choose(t.id)}
              >
                {t.label}
              </button>
            ))}
          </nav>
        )}
      </header>
      <main id="tab-panel" role="tabpanel" aria-labelledby={`tab-${tabId}`}>
        <Active />
      </main>
    </div>
  );
}
