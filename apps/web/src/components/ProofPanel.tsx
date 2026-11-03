import { motion } from 'framer-motion';
import type { ProofArtifact } from '@pc/shared';
import { Card, Chip, Hash, Note } from './ui';
import { useApp } from '../store';

/** Side by side: what the holder proved (privately), and what the chain actually received. */
export function ProofPanel({ proof, holder, statement }: { proof: ProofArtifact; holder: string; statement: string }) {
  const technical = useApp((s) => s.technical);
  return (
    <motion.div className="grid-2" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
      <Card title={`What ${holder} proved`} aside={<Chip tone="blue">Zero-knowledge</Chip>}>
        <p className="statement">{statement}</p>
        <div className="tiny muted" style={{ marginBottom: 6 }}>
          Kept on {holder}&apos;s device, never sent anywhere:
        </div>
        <div className="hidden-list">
          {['Name', 'Country', 'Investor class', 'Credential expiry', 'Credential secret', 'Position in registry'].map((x) => (
            <Chip key={x} tone="grey">
              {x}
            </Chip>
          ))}
        </div>
        {proof.envelope && (
          <Note style={{ margin: '14px 0 0' }}>
            A copy of these attributes travels with the transfer, sealed so that only the auditor can open it. The proof commits to that sealed copy, so
            neither can be swapped later.
          </Note>
        )}
      </Card>
      <Card
        title="What the chain sees"
        aside={
          <span className="tiny muted">
            {proof.proofBytes.toLocaleString('en-GB')} byte proof · {(proof.provingMs / 1000).toFixed(2)}s to generate
          </span>
        }
      >
        <div className="inputs">
          {proof.publicInputs.map((p) => (
            <div className="input-row" key={p.label}>
              <span className="muted">{p.label}</span>
              {p.value.startsWith('0x') ? <Hash value={p.value} chars={8} /> : <span>{p.value}</span>}
            </div>
          ))}
          {proof.envelope && (
            <div className="input-row">
              <span className="muted">Audit envelope</span>
              <span>
                {proof.envelope.bytes} bytes, sealed to the auditor · <Hash value={proof.envelope.hash} chars={6} />
              </span>
            </div>
          )}
          <div className="input-row">
            <span className="muted">Proof</span>
            {technical ? <Hash value={proof.proofHex} chars={14} /> : <span className="mono">{proof.proofHex.slice(0, 26)}…</span>}
          </div>
        </div>
      </Card>
    </motion.div>
  );
}
