import { motion, AnimatePresence } from 'framer-motion';
import { HOLDERS, type RegistryState } from '@pc/shared';
import { HashText } from './HashText';

const LEAF_X = [85, 245, 405, 565];
const W = 650;
const LEAF_W = 150;

/**
 * The issuer's credential tree, condensed: the four client leaves, the hashes
 * above them, the remaining levels of empty slots, and the root that is the only
 * thing published on-chain.
 */
export function RegistryTree({ registry, highlight }: { registry: RegistryState | null; highlight?: string }) {
  const members = registry?.members ?? [];
  const leafY = 250;
  const l1Y = 185;
  const l2Y = 125;
  const rootY = 30;
  const l1X = [(LEAF_X[0] + LEAF_X[1]) / 2, (LEAF_X[2] + LEAF_X[3]) / 2];
  const l2X = (l1X[0] + l1X[1]) / 2;
  const on = members.length > 0;

  const line = (x1: number, y1: number, x2: number, y2: number, delay: number, key: string) => (
    <motion.line
      key={key}
      x1={x1}
      y1={y1}
      x2={x2}
      y2={y2}
      stroke="#d6cdbb"
      strokeWidth={1.5}
      initial={{ pathLength: 0, opacity: 0 }}
      animate={{ pathLength: on ? 1 : 0, opacity: on ? 1 : 0 }}
      transition={{ duration: 0.4, delay }}
    />
  );

  return (
    <div>
      <svg viewBox={`0 0 ${W} 300`} width="100%" role="img" aria-label="Credential registry tree">
        {LEAF_X.map((x, i) => line(x, leafY - 18, l1X[i >> 1], l1Y + 12, 0.5 + i * 0.05, `a${i}`))}
        {l1X.map((x, i) => line(x, l1Y - 12, l2X, l2Y + 12, 0.8 + i * 0.05, `b${i}`))}
        <motion.line
          x1={l2X}
          y1={l2Y - 12}
          x2={l2X}
          y2={rootY + 26}
          stroke="#d6cdbb"
          strokeWidth={1.5}
          strokeDasharray="4 5"
          initial={{ opacity: 0 }}
          animate={{ opacity: on ? 1 : 0 }}
          transition={{ delay: 1 }}
        />
        <motion.text x={l2X + 12} y={(l2Y + rootY) / 2 + 12} fontSize={11} fill="#6b6f7b" initial={{ opacity: 0 }} animate={{ opacity: on ? 1 : 0 }} transition={{ delay: 1 }}>
          5 more levels · 252 empty slots
        </motion.text>

        {[...l1X, l2X].map((x, i) => (
          <motion.circle
            key={`n${i}`}
            cx={x}
            cy={i < 2 ? l1Y : l2Y}
            r={9}
            fill="#fffdf9"
            stroke="#2f5bd8"
            strokeWidth={2}
            initial={{ scale: 0 }}
            animate={{ scale: on ? 1 : 0 }}
            transition={{ delay: i < 2 ? 0.75 : 0.95, type: 'spring', stiffness: 300, damping: 20 }}
          />
        ))}

        <motion.rect
          x={l2X - 40}
          y={rootY - 4}
          width={80}
          height={30}
          rx={8}
          fill="#14213d"
          initial={{ scale: 0 }}
          animate={{ scale: on ? 1 : 0 }}
          transition={{ delay: 1.15, type: 'spring', stiffness: 260, damping: 18 }}
        />
        <motion.text x={l2X} y={rootY + 15} textAnchor="middle" fontSize={12} fontWeight={700} fill="#fff" initial={{ opacity: 0 }} animate={{ opacity: on ? 1 : 0 }} transition={{ delay: 1.25 }}>
          ROOT
        </motion.text>

        {LEAF_X.map((x, i) => {
          const m = members.find((mm) => mm.leafIndex === i);
          const revoked = m?.status === 'revoked';
          const focus = highlight && m?.holderId === highlight;
          return (
            <g key={`leaf${i}`}>
              <AnimatePresence>
                {m && (
                  <motion.g initial={{ opacity: 0, y: -16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.12 * i, duration: 0.35 }}>
                    <rect
                      x={x - LEAF_W / 2}
                      y={leafY - 18}
                      width={LEAF_W}
                      height={40}
                      rx={9}
                      fill={revoked ? '#fbe5e1' : '#e9eefc'}
                      stroke={revoked ? '#c93a2e' : focus ? '#14213d' : '#b9c8f5'}
                      strokeWidth={focus || revoked ? 2 : 1.5}
                      strokeDasharray={revoked ? '4 3' : undefined}
                    />
                    <text x={x} y={leafY - 1} textAnchor="middle" fontSize={12} fontWeight={700} fill={revoked ? '#c93a2e' : '#14213d'} fontFamily="IBM Plex Sans, sans-serif">
                      {HOLDERS[m.holderId].name}
                    </text>
                    <text x={x} y={leafY + 14} textAnchor="middle" fontSize={10} fill={revoked ? '#c93a2e' : '#6b6f7b'} fontFamily="IBM Plex Mono, monospace">
                      {revoked ? 'revoked · 0x00…00' : `${m.leaf.slice(0, 8)}…`}
                    </text>
                  </motion.g>
                )}
              </AnimatePresence>
              {!m && <rect x={x - LEAF_W / 2} y={leafY - 18} width={LEAF_W} height={40} rx={8} fill="#f8f3ea" stroke="#e2d9c8" strokeDasharray="4 4" />}
            </g>
          );
        })}
      </svg>
      <div className="row" style={{ justifyContent: 'center', marginTop: 4 }}>
        <span className="tiny muted">Registry root (epoch {registry?.epoch ?? 0})</span>
      </div>
      <div style={{ textAlign: 'center', marginTop: 2 }}>
        {registry ? <HashText value={registry.root} className="fingerprint small" /> : <span className="muted small">not yet published</span>}
      </div>
    </div>
  );
}
