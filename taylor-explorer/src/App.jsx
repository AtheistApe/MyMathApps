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

  const Active = TABS.find((t) => t.id === tabId).component;

  return (
    <div className="app">
      <header className="app-header">
        <div className="titles">
          <h1>{APP_TITLE}</h1>
          <p>{COURSE_LABEL}</p>
        </div>
        {TABS.length > 1 && (
          <nav className="tabs" role="tablist" aria-label="Sections">
            {TABS.map((t) => (
              <button
                key={t.id}
                role="tab"
                aria-selected={t.id === tabId}
                className={t.id === tabId ? 'tab active' : 'tab'}
                onClick={() => choose(t.id)}
              >
                {t.label}
              </button>
            ))}
          </nav>
        )}
      </header>
      <main>
        <Active />
      </main>
    </div>
  );
}
