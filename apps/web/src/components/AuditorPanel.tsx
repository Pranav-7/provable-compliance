import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { COUNTRY_NAMES, Outcome, REASON_LABEL, type AuditReport } from '@pc/shared';
import { auditor } from '../api';
import { useApp } from '../store';
import { Button, Card, Chip, Icon } from './ui';

const MODES: { id: AuditReport['mode']; label: string; blurb: string }[] = [
  {
    id: 'proof',
    label: 'Proof only',
    blurb: 'Re-verify the proof and the public state. Learns that the rules held, nothing about the holder.',
  },
  {
    id: 'proof+data',
    label: 'Proof + data',
    blurb: 'Also open the sealed copy, rebuild the credential and re-run the policy. Learns why.',
  },
];

/**
 * The independent auditor's re-check of one decision. It treats the bank as
 * untrusted: the record must match an anchored root, and every claim in it is
 * checked again against the chain (or the bank's archive, for transactions the
 * node held back, matched by hash).
 */
export function AuditorPanel({ seq }: { seq: number }) {
  const { caseId, run, busy, results, setResults } = useApp();
  const [mode, setMode] = useState<AuditReport['mode']>('proof');
  const key = `${seq}:${mode}`;
  const report = results.audits[key];

  const check = () =>
    run('audit', async () => {
      const r = await auditor.check(caseId, seq, mode);
      setResults((s) => ({ audits: { ...s.audits, [key]: r } }));
    });

  return (
    <Card
      title="Independent auditor"
      aside={
        <div className="segmented" role="tablist">
          {MODES.map((m) => (
            <button key={m.id} role="tab" aria-selected={mode === m.id} className={mode === m.id ? 'on' : ''} onClick={() => setMode(m.id)}>
              {m.label}
            </button>
          ))}
        </div>
      }
    >
      <div className="row" style={{ alignItems: 'flex-start', gap: 16, marginBottom: 14 }}>
        <p className="small muted" style={{ margin: 0, flex: 1 }}>
          {MODES.find((m) => m.id === mode)!.blurb}
        </p>
        <Button busy={busy.audit} onClick={check}>
          {report ? 'Run again' : `Re-check record #${seq}`}
        </Button>
      </div>

      <AnimatePresence mode="wait">
        {report && (
          <motion.div key={key} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="grid-2">
            <div>
              <div className="checks">
                {report.checks.map((c, i) => (
                  <motion.div className="check-row" key={c.id} initial={{ opacity: 0, x: -4 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.04 }}>
                    <span className={c.ok ? 'ok' : 'bad'}>{c.ok ? Icon.check : Icon.cross}</span>
                    <div>
                      <div>{c.label}</div>
                      <div className="check-detail">{c.detail}</div>
                    </div>
                    {c.mode === 'data' ? <Chip tone="coral">data</Chip> : <span />}
                  </motion.div>
                ))}
              </div>
            </div>
            <div className="stack">
              <div className={`result ${report.conclusion.matchesRecord ? 'ok' : 'bad'}`}>
                <span>{report.conclusion.matchesRecord ? Icon.check : Icon.cross}</span>
                <div>
                  <strong>{report.conclusion.matchesRecord ? 'Auditor agrees with the bank’s record' : 'Auditor disagrees with the record'}</strong>
                  <span className="small">{report.conclusion.summary}</span>
                </div>
              </div>
              <dl className="kv">
                <dt>Recorded by the bank</dt>
                <dd>
                  {report.recordedOutcome.outcome === Outcome.Settled ? 'Settled' : `Blocked: ${REASON_LABEL[report.recordedOutcome.reason]}`}
                </dd>
                <dt>Auditor’s own finding</dt>
                <dd>{report.conclusion.outcome === Outcome.Settled ? 'Settled' : `Blocked: ${REASON_LABEL[report.conclusion.reason]}`}</dd>
                <dt>Transaction bytes from</dt>
                <dd>{report.source === 'chain' ? 'The chain' : 'Bank archive, matched by hash (held back before broadcast)'}</dd>
              </dl>
              {report.disclosed ? (
                <div className="private">
                  <div className="private-label">{Icon.lock} Disclosed to the auditor only</div>
                  <div className="small">
                    {COUNTRY_NAMES[report.disclosed.country] ?? report.disclosed.country} · {report.disclosed.investorClass} · credential to{' '}
                    {new Date(report.disclosed.expiry * 1000).toISOString().slice(0, 10)} · registry slot {report.disclosed.leafIndex}
                  </div>
                </div>
              ) : (
                <p className="tiny muted" style={{ margin: 0 }}>
                  Nothing about the holder was disclosed. Switch to <em>Proof + data</em> to open the sealed audit copy.
                </p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </Card>
  );
}
