import { motion } from 'framer-motion';
import { HOLDERS, REASON_LABEL } from '@pc/shared';
import { bank, wallet } from '../api';
import { HolderCard } from '../components/HolderCard';
import { RegistryTree } from '../components/RegistryTree';
import { Button, Card, Chip, Hash, Icon, Note, ScreenHeader } from '../components/ui';
import { useApp, useStudy } from '../store';

export function CredentialsScreen() {
  const { policy, registry, holders, run, busy, results, setResults, refreshHolders } = useApp();
  const study = useStudy();
  const ids = study.holders;
  const symbol = study.policy.asset.symbol;
  const deposits = study.policy.asset.type === 'tokenised-deposit';
  const issued = !!registry;
  const passesDone = Object.keys(results.passes).length === ids.length;

  const issue = () =>
    run('issue', async () => {
      await bank.issueCredentials();
      for (const id of ids) await wallet.sync(id);
      await refreshHolders();
    });

  const provePasses = () =>
    run('passes', async () => {
      for (const id of ids) {
        const r = await wallet.receivePass(id);
        setResults((s) => ({ passes: { ...s.passes, [id]: r } }));
        await refreshHolders();
      }
    });

  const subscribe = () =>
    run('subscribe', async () => {
      for (const [id, amount] of study.issuance) await bank.subscribe(id, amount);
      setResults({ subscribed: true });
    });

  if (!policy) {
    return (
      <div className="screen">
        <ScreenHeader kicker="Layer 2 · Eligibility credentials" title="Issue credentials" lede="Publish the policy first (previous step)." />
      </div>
    );
  }

  return (
    <div className="screen">
      <ScreenHeader
        kicker="Layer 2 · Eligibility credentials"
        title={deposits ? 'Issue credentials that each bank carries itself' : 'Issue credentials that clients carry themselves'}
        lede="Attributes stay in each holder's wallet. On-chain there is only one root: proof that a valid set exists, not who is in it."
      />

      <div className="grid-2" style={{ marginBottom: 20 }}>
        <Card title="Issuer's credential registry" aside={registry ? <Chip tone="mint">Root on-chain · epoch {registry.epoch}</Chip> : undefined}>
          <RegistryTree registry={registry} />
          {!issued && (
            <div style={{ marginTop: 14 }}>
              <Button busy={busy.issue} onClick={issue}>
                {deposits ? 'Onboard counterparties and issue credentials' : 'KYC clients and issue credentials'}
              </Button>
            </div>
          )}
        </Card>

        <Card title="What is public vs private">
          <div className="stack small">
            <div className="row" style={{ alignItems: 'flex-start' }}>
              <Chip tone="blue">On-chain</Chip>
              <span>
                One 32-byte root: <Hash value={registry?.root} />
              </span>
            </div>
            <div className="row" style={{ alignItems: 'flex-start' }}>
              <Chip tone="grey">Issuer only</Chip>
              <span>KYC files and the full tree of credential commitments.</span>
            </div>
            <div className="row" style={{ alignItems: 'flex-start' }}>
              <Chip tone="mint">Holder only</Chip>
              <span>Their own attributes, a random secret, and their path in the tree.</span>
            </div>
            <Note style={{ margin: '6px 0 0' }}>
              Each leaf is a Poseidon2 hash of salt, address, country, investor class and expiry. Without the salt, the leaf reveals nothing, even though
              the set of possible countries and classes is small.
            </Note>
          </div>
        </Card>
      </div>

      <div className="card-title">{deposits ? 'Bank wallets' : 'Holder wallets'}</div>
      <div className="holders" style={{ marginBottom: 20 }}>
        {holders.map((h) => {
          const r = results.passes[h.id];
          return (
            <HolderCard
              key={h.id}
              holder={h}
              footer={
                r && (
                  <motion.div className="pass-line" initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={{ color: r.ok ? 'var(--mint)' : 'var(--red)' }}>
                    <span style={{ flex: 'none', marginTop: 1 }}>{r.ok ? Icon.check : Icon.cross}</span>
                    <span>{r.ok ? `Pass proven in ${((r.proof?.provingMs ?? 0) / 1000).toFixed(2)}s` : `No proof possible: ${REASON_LABEL[r.reason].toLowerCase()}`}</span>
                  </motion.div>
                )
              }
            />
          );
        })}
      </div>

      <div className="row" style={{ gap: 12 }}>
        <Button busy={busy.passes} disabled={!issued || passesDone} onClick={provePasses}>
          1 · Holders prove eligibility
        </Button>
        <Button
          variant={passesDone && !results.subscribed ? 'primary' : 'ghost'}
          busy={busy.subscribe}
          disabled={!passesDone || results.subscribed}
          onClick={subscribe}
          title={study.issuance.map(([id, amount]) => `${HOLDERS[id].name} ${Number(amount).toLocaleString('en-GB')}`).join(' · ')}
        >
          2 · {deposits ? 'Issue deposit tokens' : 'Subscribe units'}
        </Button>
      </div>
      {passesDone && !results.subscribed && (
        <div className="small" style={{ marginTop: 12, color: 'var(--accent-text)', fontWeight: 600 }}>
          {HOLDERS[study.roles.ineligible].name} has no receive pass and cannot be issued {symbol}.
        </div>
      )}
    </div>
  );
}
