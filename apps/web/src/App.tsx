import { useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { bank } from './api';
import { Button, Icon } from './components/ui';
import { AuditScreen } from './screens/AuditScreen';
import { CredentialsScreen } from './screens/CredentialsScreen';
import { Overview } from './screens/Overview';
import { PolicyScreen } from './screens/PolicyScreen';
import { RecapScreen } from './screens/RecapScreen';
import { RevocationScreen } from './screens/RevocationScreen';
import { TransferScreen } from './screens/TransferScreen';
import { SCREENS, connectEvents, useApp } from './store';

const VIEWS = [Overview, PolicyScreen, CredentialsScreen, TransferScreen, RevocationScreen, AuditScreen, RecapScreen];

/** Progress is derived from live system state, so it survives a page reload. */
function useCompletion(): boolean[] {
  const { policy, registry, holders, decisions, batches } = useApp();
  const funded = holders.some((h) => h.balance !== '0.00');
  const settled = decisions.some((d) => d.outcome === 0);
  const revoked = !!registry?.members.some((m) => m.status === 'revoked');
  return [true, !!policy, !!registry && funded, settled, revoked, batches.length > 0, batches.length > 0];
}

function Rail() {
  const { screen, go, technical, toggleTechnical, connected, proofSystem, reset, busy, run } = useApp();
  const done = useCompletion();
  return (
    <nav className="rail">
      <div className="brand">
        <svg width="28" height="28" viewBox="0 0 32 32" aria-hidden>
          <polygon points="16,2 28,9 28,23 16,30 4,23 4,9" fill="#c8641e" stroke="#f4efe6" strokeWidth="2" />
          <path d="M11 16.5l3.5 3.5 6.5-7.5" stroke="#fff" strokeWidth="2.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <div>
          <div className="brand-name">Provable Compliance</div>
          <div className="brand-sub">From enforcement to evidence</div>
        </div>
      </div>

      <div className="steps">
        {SCREENS.map((s, i) => (
          <button key={s.title} className={`step${screen === i ? ' active' : ''}${done[i] && i > 0 && screen !== i ? ' done' : ''}`} onClick={() => go(i)}>
            <span className="step-num">{done[i] && i > 0 && screen !== i ? Icon.check : i}</span>
            <span>
              <div className="step-title">{s.title}</div>
              <div className="step-layer">{s.layer}</div>
            </span>
          </button>
        ))}
      </div>

      <div className="rail-foot">
        <div className="toggle" onClick={toggleTechnical} role="switch" aria-checked={technical}>
          Technical detail
          <span className={`switch${technical ? ' on' : ''}`} />
        </div>
        <div className="badge-line">
          <span className={`dot${connected ? '' : ' off'}`} />
          {connected ? 'Local chain connected' : 'Connecting…'}
        </div>
        {proofSystem && (
          <div className="badge-line">
            <span className="dot" style={{ background: proofSystem === 'ultrahonk' ? '#7d9cff' : 'var(--coral)' }} />
            {proofSystem === 'ultrahonk' ? 'UltraHonk ZK proofs (BN254)' : 'Development proofs (circuit only)'}
          </div>
        )}
        <Button variant="ghost" size="sm" busy={busy.reset} onClick={() => run('reset', reset)}>
          Reset demo
        </Button>
        <div className="tiny muted">
          <kbd>←</kbd> <kbd>→</kbd> to move between steps
        </div>
      </div>
    </nav>
  );
}

export function App() {
  const { screen, go, error, hydrate, refreshHolders, caseId } = useApp();

  useEffect(() => {
    void bank.state().then(hydrate).catch((e: Error) => useApp.setState({ error: e.message }));
    void refreshHolders().catch(() => undefined);
    return connectEvents();
  }, [hydrate, refreshHolders, caseId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === 'ArrowRight') go(useApp.getState().screen + 1);
      if (e.key === 'ArrowLeft') go(useApp.getState().screen - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go]);

  const View = VIEWS[screen];
  return (
    <div className="shell">
      <Rail />
      <main className="main">
        {error && (
          <div className="banner" role="alert">
            {error}
          </div>
        )}
        <AnimatePresence mode="wait">
          <motion.div key={`${caseId}-${screen}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
            <View />
          </motion.div>
        </AnimatePresence>
        <div className="screen">
          <div className="foot-nav">
            <Button variant="ghost" disabled={screen === 0} onClick={() => go(screen - 1)}>
              Back
            </Button>
            {screen < SCREENS.length - 1 && (
              <Button variant="ghost" onClick={() => go(screen + 1)}>
                Next: {SCREENS[screen + 1].title} {Icon.arrow}
              </Button>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
