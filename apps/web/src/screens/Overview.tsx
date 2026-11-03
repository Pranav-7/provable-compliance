import { motion } from 'framer-motion';
import { Honeycomb } from '../components/Honeycomb';
import { Avatar, Button, Chip, Icon, Note } from '../components/ui';
import { COUNTRY_NAMES, HOLDERS } from '@pc/shared';
import { useApp, useStudy } from '../store';

export function Overview() {
  const go = useApp((s) => s.go);
  const study = useStudy();
  const { sanctioned, ineligible } = study.roles;
  const cast = [
    { name: 'Issuing Bank', role: `Issues ${study.policy.asset.symbol} · runs the compliant node`, tone: 'grey' as const },
    ...study.holders.map((id) => {
      const h = HOLDERS[id];
      const note = id === sanctioned ? ' · sanctioned midway' : id === ineligible ? ' · never eligible' : '';
      return { name: h.name, role: `${h.role} · ${COUNTRY_NAMES[h.country]}${note}`, tone: id === sanctioned ? ('coral' as const) : id === ineligible ? ('grey' as const) : ('blue' as const) };
    }),
    { name: 'Auditor', role: 'Re-checks any decision for the supervisor', tone: 'violet' as const },
  ];
  return (
    <div className="screen">
      <div className="hero">
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }}>
          <div className="kicker">{study.title}</div>
          <h1>From enforcement to evidence</h1>
          <p className="lede">A proof travels with every transfer. Others can check the rules held, without seeing who the participants are.</p>
          <div className="row" style={{ gap: 8, marginBottom: 28 }}>
            <Chip tone="blue">Real ZK proofs</Chip>
            <Chip tone="mint">Local Ethereum chain</Chip>
            <Chip tone="coral">Independent auditor</Chip>
          </div>
          <Button onClick={() => go(1)}>
            Start the walkthrough {Icon.arrow}
          </Button>
          <Note style={{ marginTop: 22 }}>
            {study.subtitle}. Layers 1 to 4 run end to end, with a first step of Layer 6. The issuing bank&apos;s compliant node stays the primary
            control throughout.
          </Note>
        </motion.div>
        <motion.div initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.45, delay: 0.1 }}>
          <Honeycomb />
        </motion.div>
      </div>

      <div className="card-title">The participants</div>
      <div className="cast">
        {cast.map((c, i) => (
          <motion.div className="cast-card" key={c.name} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 + i * 0.05 }}>
            <Avatar name={c.name} tone={c.tone} />
            <div style={{ fontWeight: 700, marginTop: 10, lineHeight: 1.25 }}>{c.name}</div>
            <div className="tiny muted">{c.role}</div>
          </motion.div>
        ))}
      </div>
    </div>
  );
}
