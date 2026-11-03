import { motion, AnimatePresence } from 'framer-motion';
import { HOLDERS, type ActionResult, type CaseConfig } from '@pc/shared';
import { bank, wallet } from '../api';
import { HashText } from '../components/HashText';
import { RegistryTree } from '../components/RegistryTree';
import { Button, Card, Chip, Icon, ResultLine, ScreenHeader } from '../components/ui';
import { useApp, useStudy, type ScreenResults } from '../store';

type AttemptKey = keyof ScreenResults['attempts'];

interface Attempt {
  key: AttemptKey;
  n: string;
  title: string;
  detail: string;
  run: () => Promise<ActionResult>;
}

function attemptsFor(study: CaseConfig): Attempt[] {
  const { sanctioned, sender } = study.roles;
  const name = HOLDERS[sanctioned].name;
  const amount = study.tradingDay[3].amount;
  const own = study.id === 'interbank' ? `${name}'s own node` : 'her own node';
  return [
    {
      key: 'node',
      n: '1',
      title: "Through the issuing bank's compliant node",
      detail: 'Reuses its old proof. The primary control screens first.',
      run: () => wallet.transfer({ from: sanctioned, to: sender, amount, route: 'compliant-node', mode: 'stale' }),
    },
    {
      key: 'direct',
      n: '2',
      title: study.id === 'interbank' ? `Through ${own}` : 'Directly to the chain',
      detail: `Same old proof, sent from ${own}. The issuing bank's node is not in the path.`,
      run: () => wallet.transfer({ from: sanctioned, to: sender, amount, route: 'direct', mode: 'stale' }),
    },
    {
      key: 'fresh',
      n: '3',
      title: 'Building a fresh proof against the current registry',
      detail: 'Tries to prove membership of the new root.',
      run: () => wallet.transfer({ from: sanctioned, to: sender, amount, route: 'direct', mode: 'fresh' }),
    },
  ];
}

export function RevocationScreen() {
  const { registry, previousRegistry, holders, run, busy, results, setResults } = useApp();
  const study = useStudy();
  const { sanctioned, sender, receiver, ineligible } = study.roles;
  const name = HOLDERS[sanctioned].name;
  const symbol = study.policy.asset.symbol;
  const ATTEMPTS = attemptsFor(study);
  const target = holders.find((h) => h.id === sanctioned);
  const revoked = target?.credentialStatus === 'revoked' || registry?.members.find((m) => m.holderId === sanctioned)?.status === 'revoked';

  const sanction = () =>
    run('revoke', async () => {
      await bank.revoke(sanctioned, 'Added to sanctions list 2026-10-31');
      await wallet.sync(sanctioned);
      for (const id of [sender, receiver]) {
        const r = await wallet.receivePass(id);
        setResults((s) => ({ passRefresh: { ...s.passRefresh, [id]: r } }));
      }
    });

  const attempt = (key: AttemptKey, fn: () => Promise<ActionResult>) =>
    run(`attempt-${key}`, async () => {
      const r = await fn();
      setResults((s) => ({ attempts: { ...s.attempts, [key]: r } }));
    });

  return (
    <div className="screen">
      <ScreenHeader
        kicker="Layer 3 · A second, independent check"
        tone="coral"
        title={`${name} is sanctioned. Can ${study.id === 'client' ? 'she' : 'it'} still move ${symbol}?`}
        lede="Revoking the credential changes the root. The node blocks the first attempt; the token blocks it on every other route."
      />

      <div className="grid-2" style={{ marginBottom: 22 }}>
        <Card title="Credential registry" aside={revoked ? <Chip tone="red">{name} revoked</Chip> : undefined}>
          <RegistryTree registry={registry} highlight={sanctioned} />
          {!revoked && (
            <div style={{ marginTop: 14 }}>
              <Button variant="danger" busy={busy.revoke} disabled={!registry} onClick={sanction}>
                Sanction {name}
              </Button>
            </div>
          )}
        </Card>

        <Card title="What changed on-chain">
          {revoked && previousRegistry ? (
            <div className="stack small">
              <div>
                <div className="tiny muted">Previous root (epoch {previousRegistry.epoch})</div>
                <div className="mono" style={{ wordBreak: 'break-all', textDecoration: 'line-through', color: 'var(--grey-2)' }}>
                  {previousRegistry.root}
                </div>
              </div>
              <div>
                <div className="tiny muted">Current root (epoch {registry?.epoch})</div>
                <HashText value={registry!.root} className="mono" />
              </div>
              <div style={{ marginTop: 6 }}>
                Other holders re-prove against the new root:
                <AnimatePresence>
                  {[sender, receiver].map((id) =>
                    results.passRefresh[id] ? (
                      <motion.div key={id} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} style={{ color: 'var(--mint)', fontWeight: 600, marginTop: 4 }}>
                        {Icon.check} {HOLDERS[id].name} refreshed in {((results.passRefresh[id]!.proof?.provingMs ?? 0) / 1000).toFixed(2)}s
                      </motion.div>
                    ) : null,
                  )}
                </AnimatePresence>
              </div>
            </div>
          ) : (
            <p className="muted small">Sanction {name} to see the registry root change.</p>
          )}
        </Card>
      </div>

      {revoked && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
          <div className="card-title">
            {name} tries three ways to move {Number(study.tradingDay[3].amount).toLocaleString('en-GB')} {symbol}
          </div>
          <div className="stack">
            {ATTEMPTS.map((a) => {
              const r = results.attempts[a.key];
              return (
                <div className="attempt" key={a.key}>
                  <div className="attempt-head">
                    <span className="attempt-n">{a.n}</span>
                    <div>
                      <div style={{ fontWeight: 700 }}>{a.title}</div>
                      <div className="small muted">{a.detail}</div>
                    </div>
                    <span className="spacer" />
                    <Button variant="ghost" size="sm" busy={busy[`attempt-${a.key}`]} onClick={() => attempt(a.key, a.run)}>
                      {r ? 'Try again' : 'Try'}
                    </Button>
                  </div>
                  {r && <ResultLine result={r} />}
                  {r && a.key === 'direct' && !r.ok && (
                    <motion.div className="callout" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2 }}>
                      The issuing bank&apos;s node was not in this path. The token applied the same rule, and the attempt is still on the record.
                    </motion.div>
                  )}
                  {r && a.key === 'fresh' && !r.ok && (
                    <div className="small muted">The attributes are still in the wallet, but they are no longer in the current root.</div>
                  )}
                </div>
              );
            })}

            <div className="attempt">
              <div className="attempt-head">
                <span className="attempt-n">D</span>
                <div>
                  <div style={{ fontWeight: 700 }}>
                    {HOLDERS[ineligible].name}, {HOLDERS[ineligible].role.toLowerCase()}, submits anyway
                  </div>
                  <div className="small muted">No valid proof exists, so it sends arbitrary bytes.</div>
                </div>
                <span className="spacer" />
                <Button
                  variant="ghost"
                  size="sm"
                  busy={busy['attempt-ineligible']}
                  onClick={() =>
                    attempt('ineligible', () => wallet.transfer({ from: ineligible, to: sender, amount: study.tradingDay[2].amount, route: 'compliant-node', mode: 'forged' }))
                  }
                >
                  {results.attempts.ineligible ? 'Try again' : 'Try'}
                </Button>
              </div>
              {results.attempts.ineligible && <ResultLine result={results.attempts.ineligible} />}
            </div>
          </div>
        </motion.div>
      )}
    </div>
  );
}
