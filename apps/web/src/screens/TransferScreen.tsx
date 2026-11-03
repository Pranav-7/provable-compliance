import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { HOLDERS, type Route } from '@pc/shared';
import { wallet } from '../api';
import { HolderCard } from '../components/HolderCard';
import { ProofPanel } from '../components/ProofPanel';
import { Button, Card, Icon, ResultLine, ScreenHeader } from '../components/ui';
import { useApp, useStudy } from '../store';

function Elapsed({ running }: { running: boolean }) {
  const [ms, setMs] = useState(0);
  useEffect(() => {
    if (!running) return;
    const start = performance.now();
    const t = setInterval(() => setMs(performance.now() - start), 50);
    return () => clearInterval(t);
  }, [running]);
  return <span className="mono">{(ms / 1000).toFixed(1)}s</span>;
}

export function TransferScreen() {
  const { holders, run, busy, results, setResults, results: { subscribed } } = useApp();
  const study = useStudy();
  const { sender, receiver } = study.roles;
  const [S, R] = [HOLDERS[sender].name, HOLDERS[receiver].name];
  const symbol = study.policy.asset.symbol;
  const [amount, setAmount] = useState(study.transferAmount);
  const [route, setRoute] = useState<Route>('compliant-node');
  const result = results.transfer;
  const from = holders.find((h) => h.id === sender);
  const to = holders.find((h) => h.id === receiver);

  const send = () =>
    run('transfer', async () => {
      const r = await wallet.transfer({ from: sender, to: receiver, amount, route });
      setResults({ transfer: r });
    });

  return (
    <div className="screen">
      <ScreenHeader
        kicker="Layer 3 · Proof at transfer"
        title="A compliant transfer carries its own proof"
        lede={`The node screens it as today. The token then verifies ${S}'s proof before a single unit moves.`}
      />

      {!subscribed && (
        <div className="banner">
          Complete the previous step first so that {S} holds {symbol} and {R} has a receive pass.
        </div>
      )}

      <div className="grid-2 transfer-grid" style={{ marginBottom: 20, gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1.2fr) minmax(0, 1fr)' }}>
        {from && <HolderCard holder={from} />}
        <Card>
          <div className="stack">
            <div className="row">
              <strong>{S}</strong>
              {Icon.arrow}
              <strong>{R}</strong>
            </div>
            <label className="small muted">
              Amount ({symbol})
              <input
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                style={{ display: 'block', marginTop: 4, width: '100%', padding: '9px 12px', border: '1px solid var(--line)', borderRadius: 7, font: 'inherit', fontSize: 18, fontWeight: 600, background: 'var(--surface)', color: 'var(--ink)' }}
              />
            </label>
            <div className="row small">
              <span className="muted">Route</span>
              {(['compliant-node', 'direct'] as Route[]).map((r) => (
                <button key={r} className={`country ${route === r ? 'on' : ''}`} onClick={() => setRoute(r)}>
                  {study.routeLabels[r]}
                </button>
              ))}
            </div>
            <Button busy={busy.transfer} disabled={!subscribed} onClick={send}>
              Generate proof and send
            </Button>
            {busy.transfer && (
              <motion.div className="result info" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                <span className="spinner" />
                <div>
                  <strong>Proving on {S}&apos;s device, then submitting</strong>
                  <Elapsed running={!!busy.transfer} />
                </div>
              </motion.div>
            )}
            {result && !busy.transfer && <ResultLine result={result} okText={`Settled on-chain · proof verified by the token contract`} />}
          </div>
        </Card>
        {to && <HolderCard holder={to} />}
      </div>

      {result?.proof && (
        <ProofPanel
          proof={result.proof}
          holder={S}
          statement={`“I hold a current credential from this bank. My country and investor class meet policy v${study.policy.version}. This proof is bound to this exact transfer to ${R}.”`}
        />
      )}
    </div>
  );
}
