import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Channel,
  DecisionTree,
  HOLDERS,
  Outcome,
  REASON_LABEL,
  Reason,
  decisionLeaf,
  formatUnits,
  type AuditRecordProof,
  type DecisionDTO,
} from '@pc/shared';
import { bank, chainClient, DECISION_LOG_ANCHOR_ABI, wallet } from '../api';
import { AuditorPanel } from '../components/AuditorPanel';
import { DecisionTreeView } from '../components/DecisionTreeView';
import { Button, Card, Chip, Hash, Icon, ScreenHeader } from '../components/ui';
import { useApp, useStudy } from '../store';

const nameOf = (d: DecisionDTO, side: 'from' | 'to') => {
  const id = side === 'from' ? d.fromId : d.toId;
  return id ? HOLDERS[id].name : (side === 'from' ? d.from : d.to).slice(0, 8);
};

function LogRow({ d, selected, disclosed, onClick }: { d: DecisionDTO; selected: boolean; disclosed: boolean; onClick: () => void }) {
  const ok = d.outcome === Outcome.Settled;
  return (
    <motion.div layout initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} className={`log-row${selected ? ' selected' : ''}`} onClick={onClick}>
      <span className="seq">#{d.seq}</span>
      <span>
        <strong>{nameOf(d, 'from')}</strong> → {nameOf(d, 'to')} · {formatUnits(BigInt(d.amount))}
        <span className="tiny muted"> · {d.channel === Channel.CompliantNode ? 'issuer node' : 'other route'}</span>
        {!disclosed && <span className="tiny muted"> · {ok ? 'settled' : REASON_LABEL[d.reason].toLowerCase()}</span>}
      </span>
      {ok ? <Chip tone="mint">Settled</Chip> : <Chip tone="red">Blocked</Chip>}
    </motion.div>
  );
}

export function AuditScreen() {
  const { decisions, batches, run, busy, results, setResults, technical } = useApp();
  const study = useStudy();
  const symbol = study.policy.asset.symbol;
  const sanctionedName = HOLDERS[study.roles.sanctioned].name;
  const [proof, setProof] = useState<AuditRecordProof | null>(null);
  const [verified, setVerified] = useState<{ ok: boolean; block: bigint } | null>(null);
  const [tampered, setTampered] = useState(false);

  const latest = batches.at(-1) ?? null;
  const pending = decisions.filter((d) => d.batchId === null);
  const showingPending = pending.length > 0 || !latest;
  const batchDecisions = useMemo(
    () => (proof ? decisions.filter((d) => d.batchId === proof.batch.batchId) : latest ? decisions.filter((d) => d.batchId === latest.batchId) : []),
    [decisions, latest, proof],
  );

  const levels: string[][] = proof
    ? proof.levels
    : showingPending
      ? [pending.map((d) => d.leaf)]
      : (results.anchorLevels ?? [batchDecisions.map((d) => d.leaf)]);
  const treeDecisions = proof || !showingPending ? batchDecisions : pending;

  const tradingDay = () =>
    run('trading', async () => {
      const r = await wallet.tradingDay();
      setResults({ tradingDay: r });
      await bank.sync();
    });

  const anchor = () =>
    run('anchor', async () => {
      setProof(null);
      setVerified(null);
      setTampered(false);
      const r = await bank.anchor();
      setResults({ anchorLevels: r.levels });
    });

  const select = (seq: number) =>
    run('proof', async () => {
      const d = decisions.find((x) => x.seq === seq);
      if (!d || d.batchId === null) return;
      setVerified(null);
      setTampered(false);
      setProof(await bank.recordProof(seq));
    });

  const recomputedLeaf = proof
    ? decisionLeaf({
        ...proof.record,
        amount: BigInt(proof.record.amount),
        nonce: BigInt(proof.record.nonce),
        ...(tampered ? { outcome: proof.record.outcome === Outcome.Blocked ? Outcome.Settled : Outcome.Blocked, reason: Reason.None } : {}),
      })
    : null;
  const matches = proof && recomputedLeaf ? DecisionTree.verify(recomputedLeaf, proof.siblings, proof.batch.root) : false;

  const verifyOnChain = () =>
    run('verify', async () => {
      if (!proof || !recomputedLeaf) return;
      const client = chainClient();
      const block = await client.getBlockNumber({ cacheTime: 0 });
      const ok = await client.readContract({
        address: (await bank.state()).deployment.contracts.decisionLogAnchor,
        abi: DECISION_LOG_ANCHOR_ABI,
        functionName: 'verifyRecord',
        args: [BigInt(proof.batch.batchId), recomputedLeaf, proof.siblings],
      });
      setVerified({ ok, block });
    });

  const sanctionedDirect = decisions.find((d) => d.fromId === study.roles.sanctioned && d.channel === Channel.Direct && d.batchId !== null);

  return (
    <div className="screen">
      <ScreenHeader
        kicker="Layer 4 · Tamper-evident record"
        tone="mint"
        title="Every decision, provable one at a time"
        lede="Every decision, settled or blocked, becomes a leaf under one anchored root. An auditor checks one record without seeing the others."
      />

      <div className="row" style={{ marginBottom: 16, gap: 12 }}>
        <Button busy={busy.trading} disabled={!!results.tradingDay} onClick={tradingDay}>
          Run a trading day
        </Button>
        <Button variant="ghost" busy={busy.anchor} disabled={pending.length === 0} onClick={anchor}>
          {Icon.chain} Publish root on-chain{pending.length ? ` (${pending.length} new)` : ''}
        </Button>
        {busy.trading && <span className="small muted">{study.tradingDay.length} transfers across both routes, each with its own proof…</span>}
      </div>

      <div className="grid-2-wide" style={{ marginBottom: 20 }}>
        <Card
          title={showingPending ? `Decision log · ${pending.length} not yet anchored` : `Batch ${latest!.batchId} · ${latest!.count} decisions`}
          aside={
            !showingPending && latest ? (
              <Chip tone="mint">Root anchored · block {latest.blockNumber}</Chip>
            ) : (
              <span className="tiny muted">
                <span style={{ color: 'var(--mint)' }}>■</span> settled <span style={{ color: 'var(--red)', marginLeft: 6 }}>■</span> blocked
              </span>
            )
          }
        >
          {levels[0]?.length ? (
            <DecisionTreeView
              key={`${showingPending ? 'pending' : `batch-${proof?.batch.batchId ?? latest?.batchId}`}`}
              levels={levels}
              decisions={treeDecisions}
              built={!showingPending || !!proof}
              selected={proof ? proof.record.seq - proof.batch.firstSeq : null}
              pathIndices={proof?.pathIndices}
              tampered={tampered && !matches}
              onSelect={(i) => !showingPending && select(treeDecisions[i].seq)}
            />
          ) : (
            <p className="muted small">No decisions yet. Run a trading day, or go back and make transfers.</p>
          )}
          {!showingPending && latest && (
            <div className="small" style={{ marginTop: 8 }}>
              <span className="muted">Anchored root </span>
              <Hash value={latest.root} chars={10} />
              {!proof && <span className="muted"> · click any leaf to audit it</span>}
            </div>
          )}
        </Card>

        <Card title="Bank's decision log" aside={<span className="tiny muted">{decisions.length} decisions</span>}>
          <div className="log">
            <AnimatePresence initial={false}>
              {[...decisions].reverse().map((d) => (
                <LogRow key={d.seq} d={d} selected={proof?.record.seq === d.seq} disclosed={false} onClick={() => d.batchId !== null && select(d.seq)} />
              ))}
            </AnimatePresence>
          </div>
        </Card>
      </div>

      {!showingPending && latest && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
          <Card
            title="Step 1 · Is the record exactly as anchored?"
            aside={
              sanctionedDirect && proof?.record.seq !== sanctionedDirect.seq ? (
                <Button size="sm" variant="ghost" onClick={() => select(sanctionedDirect.seq)}>
                  Audit {sanctionedName}&apos;s attempt via {study.routeLabels.direct.toLowerCase()}
                </Button>
              ) : undefined
            }
          >
            {!proof ? (
              <p className="muted small">Pick a record from the tree or the log. The auditor receives that record and a short path of hashes, nothing else.</p>
            ) : (
              <div className="grid-2">
                <div>
                  <div className="small muted" style={{ marginBottom: 8 }}>
                    Disclosed record #{proof.record.seq}
                  </div>
                  <dl className="kv">
                    <dt>From → to</dt>
                    <dd>
                      {nameOf(proof.record, 'from')} → {nameOf(proof.record, 'to')}
                    </dd>
                    <dt>Amount</dt>
                    <dd>
                      {formatUnits(BigInt(proof.record.amount))} {symbol}
                    </dd>
                    <dt>Route</dt>
                    <dd>{study.routeLabels[proof.record.channel === Channel.CompliantNode ? 'compliant-node' : 'direct']}</dd>
                    <dt>Outcome</dt>
                    <dd>
                      {tampered ? (
                        <span style={{ color: 'var(--red)', fontWeight: 700 }}>
                          {proof.record.outcome === Outcome.Blocked ? 'Settled (altered)' : 'Blocked (altered)'}
                        </span>
                      ) : proof.record.outcome === Outcome.Settled ? (
                        'Settled'
                      ) : (
                        `Blocked: ${REASON_LABEL[proof.record.reason]}`
                      )}
                    </dd>
                    <dt>Policy</dt>
                    <dd>
                      v{proof.record.policyVersion} · <Hash value={proof.record.policyHash} />
                    </dd>
                    <dt>Registry root</dt>
                    <dd>
                      <Hash value={proof.record.registryRoot} />
                    </dd>
                    {technical && (
                      <>
                        <dt>Proof hash</dt>
                        <dd>
                          <Hash value={proof.record.proofHash} />
                        </dd>
                        <dt>Audit envelope hash</dt>
                        <dd>
                          <Hash value={proof.record.envelopeHash} />
                        </dd>
                        <dt>Tx reference</dt>
                        <dd>
                          <Hash value={proof.record.txRef} />
                        </dd>
                      </>
                    )}
                  </dl>
                </div>
                <div className="stack">
                  <div className="small">
                    <span className="muted">Path to root: </span>
                    {proof.siblings.length} sibling hashes (
                    {proof.batch.count - 1} other records stay undisclosed)
                  </div>
                  <div className="small">
                    <span className="muted">Recomputed leaf: </span>
                    <Hash value={recomputedLeaf} />
                  </div>
                  <div className={`result ${matches ? 'ok' : 'bad'}`}>
                    <span>{matches ? Icon.check : Icon.cross}</span>
                    <div>
                      <strong>{matches ? 'Record matches the anchored root' : 'Root mismatch: this record was altered'}</strong>
                      <span className="small">Checked locally from the record and its path alone.</span>
                    </div>
                  </div>
                  <div className="row">
                    <Button busy={busy.verify} onClick={verifyOnChain}>
                      Verify against on-chain root
                    </Button>
                    <Button variant="ghost" onClick={() => (setTampered((t) => !t), setVerified(null))}>
                      {tampered ? 'Restore original record' : 'Alter this record'}
                    </Button>
                  </div>
                  {verified && (
                    <motion.div className={`result ${verified.ok ? 'ok' : 'bad'}`} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}>
                      <span>{verified.ok ? Icon.check : Icon.cross}</span>
                      <div>
                        <strong>{verified.ok ? 'Verified by the DecisionLogAnchor contract' : 'Rejected by the DecisionLogAnchor contract'}</strong>
                        <span className="small">Read directly from the chain at block {verified.block.toString()}, not from the bank.</span>
                      </div>
                    </motion.div>
                  )}
                </div>
              </div>
            )}
          </Card>
          {proof && !tampered && (
            <motion.div style={{ marginTop: 16 }} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
              <div className="card-title">Step 2 · Was the decision itself right?</div>
              <AuditorPanel key={`${study.id}-${proof.record.seq}`} seq={proof.record.seq} />
            </motion.div>
          )}
        </motion.div>
      )}
    </div>
  );
}
