import { motion } from 'framer-motion';
import { Outcome } from '@pc/shared';
import { Card, Note, ScreenHeader } from '../components/ui';
import { useApp, useStudy } from '../store';

const MAP = [
  ['Publish the policy', 'Layer 1', 'Rules exist as one exact, versioned fingerprint.'],
  ['Issue credentials', 'Layer 2', 'Eligibility is a credential the holder carries; only a root is public.'],
  ['A compliant transfer', 'Layer 3', 'Every transfer carries a zero-knowledge proof the token verifies.'],
  ['Revocation on every route', 'Layer 3', 'The node screens first; the token checks again on any route.'],
  ['The audit trail', 'Layer 4', 'Every decision is provable on its own against an anchored root.'],
  ['Independent auditor', 'Layers 4 and 6', 'Re-check from the proof alone, or from the proof and its sealed data.'],
];

export function RecapScreen() {
  const { decisions, batches, results } = useApp();
  const study = useStudy();
  const audits = Object.values(results.audits);
  const withData = audits.filter((a) => a?.mode === 'proof+data').length;
  const settled = decisions.filter((d) => d.outcome === Outcome.Settled).length;
  const blocked = decisions.length - settled;
  const stats: [string, number, string][] = [
    ['Decisions recorded', decisions.length, 'var(--ink)'],
    ['Settled with a proof', settled, 'var(--mint)'],
    ['Blocked', blocked, 'var(--red)'],
    ['Roots anchored', batches.length, 'var(--blue)'],
    ['Auditor re-checks', audits.length, 'var(--violet)'],
  ];

  return (
    <div className="screen">
      <ScreenHeader kicker="Recap" title="Enforcement became evidence" lede="The node did the enforcing. Now others can check it, without relying on the bank's logs." />

      <div className="stats">
        {stats.map(([label, value, color], i) => (
          <motion.div key={label} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}>
            <Card>
              <div className="stat" style={{ color }}>
                {value}
              </div>
              <div className="tiny">
                {label}
                {label === 'Auditor re-checks' && audits.length ? ` · ${withData} with data` : ''}
              </div>
            </Card>
          </motion.div>
        ))}
      </div>

      <div className="recap" style={{ marginBottom: 20 }}>
        <motion.div initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }}>
          <Card title="What the market saw">
            <ul style={{ paddingLeft: 18, margin: 0 }}>
              <li>A policy fingerprint and a single registry root.</li>
              <li>For each transfer: a proof, addresses, amount and a sealed copy. No names, countries or investor classes.</li>
              <li>Rejected attempts, with a precise reason.</li>
            </ul>
          </Card>
        </motion.div>
        <motion.div initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }}>
          <Card title="What the auditor could verify">
            <ul style={{ paddingLeft: 18, margin: 0 }}>
              <li>Any one decision, exactly as recorded, against an anchored root.</li>
              <li>Proof only: the rules held, without learning anything about the holder.</li>
              <li>Proof + data: the holder's attributes, and why a transfer was blocked.</li>
            </ul>
          </Card>
        </motion.div>
      </div>

      <Card title="How the walkthrough maps to the note">
        {MAP.map(([screen, layer, line]) => (
          <div className="rule" key={screen} style={{ gridTemplateColumns: 'minmax(150px, 200px) 110px minmax(0, 1fr)' }}>
            <strong className="small">{screen}</strong>
            <span className="small" style={{ color: 'var(--accent-text)', fontFamily: 'var(--mono)' }}>
              {layer}
            </span>
            <span className="small">{line}</span>
          </div>
        ))}
        <Note>
          The sealed audit copy is a first step of Layer 6. Not demonstrated here: hiding amounts (Layer 5), threshold or multi-party supervisory keys
          (rest of Layer 6), operator attestation (Layer 7) and cross-bank standards (Layer 8).
        </Note>
      </Card>
    </div>
  );
}
