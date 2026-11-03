import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { COUNTRY_NAMES, INVESTOR_CLASS, canonicalPolicy, policyHash, type PolicyDocument, type PolicyRule } from '@pc/shared';
import { bank } from '../api';
import { HashText } from '../components/HashText';
import { Button, Card, Chip, Hash, Note, ScreenHeader } from '../components/ui';
import { useApp, useStudy } from '../store';

const ENFORCEMENT: Record<PolicyRule['enforcement'], { label: string; tone: 'blue' | 'coral' | 'mint' }> = {
  'zk-proof': { label: 'Inside the ZK proof', tone: 'blue' },
  'credential-revocation': { label: 'By revocation', tone: 'coral' },
  'on-chain': { label: 'By the token contract', tone: 'mint' },
};

function describeParams(rule: PolicyRule, symbol: string): string {
  switch (rule.type) {
    case 'InvestorClassAllow':
      return rule.params.classes.join(', ');
    case 'SanctionsScreen':
      return `${rule.params.list}, version ${rule.params.listVersion}`;
    case 'MaxBalance':
      return `${Number(rule.params.maxHolderBalance).toLocaleString('en-GB')} ${symbol} per holder`;
    case 'AuditDisclosure':
      return `${rule.params.recipient} · ${rule.params.scheme}`;
    default:
      return '';
  }
}

export function PolicyScreen() {
  const { policy, run, busy, technical, caseId } = useApp();
  const study = useStudy();
  const v = study.policy.version;
  const [doc, setDoc] = useState<PolicyDocument | null>(null);
  const [countries, setCountries] = useState<string[] | null>(null);
  const [showJson, setShowJson] = useState(false);

  useEffect(() => {
    setDoc(null);
    setCountries(null);
    void bank.policyDocument().then(({ document }) => setDoc(document));
  }, [caseId]);

  const original = useMemo(() => (doc ? (doc.rules.find((r) => r.type === 'CountryAllow')?.params as { countries: string[] }).countries : []), [doc]);
  const selected = countries ?? original;
  const edited = useMemo(() => {
    if (!doc) return null;
    const clone = structuredClone(doc);
    const rule = clone.rules.find((r) => r.type === 'CountryAllow');
    if (rule?.type === 'CountryAllow') rule.params.countries = original.filter((c) => selected.includes(c));
    return clone;
  }, [doc, selected, original]);

  if (!doc || !edited) return <div className="screen muted">Loading policy…</div>;

  const isEdited = selected.length !== original.length;
  const hash = policyHash(edited);
  const toggle = (c: string) => {
    if (policy) return;
    setCountries(selected.includes(c) ? selected.filter((x) => x !== c) : [...selected, c]);
  };

  return (
    <div className="screen">
      <ScreenHeader
        kicker="Layer 1 · Machine-readable rules"
        title="Publish the policy as one fingerprint"
        lede={`Every later proof is checked against version ${v}. Change one rule and the fingerprint changes completely.`}
      />

      <div className="grid-2-wide">
        <Card
          title={
            <span>
              {doc.policyId} · v{doc.version}
            </span>
          }
          aside={policy ? <Chip tone="mint">Published</Chip> : <Chip tone="grey">{doc.status}</Chip>}
        >
          <div className="small muted" style={{ marginTop: -6, marginBottom: 8 }}>
            {doc.asset.name} ({doc.asset.symbol}) · issued by {doc.issuer.name} · effective {doc.effectiveFrom.slice(0, 10)}
          </div>
          {doc.rules.map((rule) => (
            <div className="rule" key={rule.id}>
              <span className="rule-id">{rule.id}</span>
              <div>
                <div className="rule-type">{rule.type}</div>
                {technical && <div className="rule-desc">{rule.description}</div>}
                {rule.type === 'CountryAllow' ? (
                  <div className="country-toggle">
                    {original.map((c) => (
                      <button
                        key={c}
                        className={`country ${selected.includes(c) ? 'on' : 'off'}`}
                        onClick={() => toggle(c)}
                        title={policy ? 'Published policies are immutable' : `Toggle ${COUNTRY_NAMES[c]}`}
                      >
                        {c}
                      </button>
                    ))}
                    {!policy && <span className="tiny" style={{ alignSelf: 'center', color: 'var(--accent-text)', fontWeight: 600 }}>← try removing one</span>}
                  </div>
                ) : (
                  describeParams(rule, doc.asset.symbol) && <div className="tiny muted" style={{ marginTop: 3 }}>{describeParams(rule, doc.asset.symbol)}</div>
                )}
              </div>
              <Chip tone={ENFORCEMENT[rule.enforcement].tone}>{ENFORCEMENT[rule.enforcement].label}</Chip>
            </div>
          ))}
          <div className="row" style={{ marginTop: 10 }}>
            <Button variant="ghost" size="sm" onClick={() => setShowJson((v) => !v)}>
              {showJson ? 'Hide' : 'View'} canonical JSON
            </Button>
            <span className="tiny muted">RFC 8785: the exact bytes that are hashed</span>
          </div>
          {showJson && <div className="json" style={{ marginTop: 10 }}>{canonicalPolicy(edited)}</div>}
        </Card>

        <div className="stack">
          <Card title="Fingerprint (keccak-256)" aside={isEdited ? <Chip tone="coral">Edited locally</Chip> : <Chip tone="blue">Version {v}</Chip>}>
            <HashText value={hash} />
            <p className="small" style={{ marginBottom: 14, color: isEdited ? 'var(--red)' : 'var(--grey)', fontWeight: isEdited ? 600 : 400 }}>
              {isEdited ? `One country removed: a completely different fingerprint. No v${v} proof can pass against it.` : 'This is the value published on-chain.'}
            </p>
            {isEdited ? (
              <Button variant="ghost" onClick={() => setCountries(null)}>
                Restore version {v}
              </Button>
            ) : (
              !policy && (
                <Button busy={busy.publish} onClick={() => run('publish', bank.publishPolicy)}>
                  Publish v{v} on-chain
                </Button>
              )
            )}
          </Card>

          <AnimatePresence>
            {policy && (
              <motion.div initial={{ opacity: 0, y: -24, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ type: 'spring', stiffness: 220, damping: 22 }}>
                <Card title="On-chain policy registry" aside={<Chip tone="mint">Block {policy.blockNumber}</Chip>}>
                  <dl className="kv">
                    <dt>Active version</dt>
                    <dd>v{policy.version}</dd>
                    <dt>Document hash</dt>
                    <dd>
                      <Hash value={policy.documentHash} chars={10} />
                    </dd>
                    <dt>Jurisdictions</dt>
                    <dd>{policy.allowedCountries.filter(Boolean).join(', ')} (ISO 3166 numeric)</dd>
                    <dt>Class mask</dt>
                    <dd>
                      0b{policy.allowedClassMask.toString(2).padStart(6, '0')} (
                      {Object.entries(INVESTOR_CLASS)
                        .filter(([, bit]) => (policy.allowedClassMask >> bit) & 1)
                        .map(([name]) => name)
                        .join(', ')}
                      )
                    </dd>
                    {technical && (
                      <>
                        <dt>Transaction</dt>
                        <dd>
                          <Hash value={policy.txHash} />
                        </dd>
                      </>
                    )}
                  </dl>
                  <Note>The verifier contract reads these parameters directly, so no holder can prove eligibility against rules of their own choosing.</Note>
                </Card>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
