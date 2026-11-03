import { motion } from 'framer-motion';
import { Outcome, type DecisionDTO } from '@pc/shared';

interface Props {
  /** Leaves (when not yet anchored) or the full set of levels once a batch is anchored. */
  levels: string[][];
  decisions: DecisionDTO[];
  /** Index of the selected leaf within the batch, if the auditor picked one. */
  selected?: number | null;
  /** Node index per level on the selected leaf's path to the root. */
  pathIndices?: number[];
  /** True once the batch root is anchored: draws parents and the root. */
  built: boolean;
  /** Root recomputed from a tampered record; renders the mismatch. */
  tampered?: boolean;
  onSelect?: (leafIndex: number) => void;
}

const H = 340;
const PAD_X = 22;

/**
 * The decision-log Merkle tree. Leaves drop in as decisions happen; anchoring
 * builds the tree level by level; an auditor's selection lights up a single
 * path while every other record stays undisclosed.
 */
export function DecisionTreeView({ levels, decisions, selected = null, pathIndices, built, tampered, onSelect }: Props) {
  const leaves = levels[0] ?? [];
  const n = Math.max(leaves.length, 1);
  const width = Math.max(560, n * 40 + PAD_X * 2);
  const depth = built ? levels.length : 1;
  const rowH = depth > 1 ? (H - 70) / (depth - 1) : 0;
  const yOf = (lvl: number) => H - 32 - lvl * rowH;

  // x positions: leaves evenly spaced; parents centred over their children.
  const xs: number[][] = [leaves.map((_, i) => PAD_X + 16 + (i * (width - 2 * PAD_X - 32)) / Math.max(n - 1, 1))];
  for (let l = 1; l < levels.length; l++) {
    xs.push(levels[l].map((_, j) => {
      const a = xs[l - 1][2 * j];
      const b = xs[l - 1][2 * j + 1];
      return b === undefined ? a : (a + b) / 2;
    }));
  }

  const onPath = (lvl: number, idx: number) => pathIndices?.[lvl] === idx;
  const isSibling = (lvl: number, idx: number) => pathIndices !== undefined && lvl < levels.length - 1 && (pathIndices[lvl] ^ 1) === idx;
  const dim = (lvl: number, idx: number) => selected !== null && pathIndices !== undefined && !onPath(lvl, idx) && !isSibling(lvl, idx);
  const levelDelay = (lvl: number) => (lvl === 0 ? 0 : 0.25 + lvl * 0.38);

  return (
    <svg viewBox={`0 0 ${width} ${H}`} width="100%" role="img" aria-label="Decision log Merkle tree">
      {built &&
        levels.slice(1).map((row, l1) =>
          row.map((_, j) => {
            const lvl = l1 + 1;
            const children = [2 * j, 2 * j + 1].filter((c) => c < levels[lvl - 1].length);
            return children.map((c) => {
              const hot = onPath(lvl, j) && onPath(lvl - 1, c);
              return (
                <motion.line
                  key={`e${lvl}-${j}-${c}`}
                  x1={xs[lvl - 1][c]}
                  y1={yOf(lvl - 1) - 9}
                  x2={xs[lvl][j]}
                  y2={yOf(lvl) + 9}
                  stroke={hot ? (tampered ? '#c93a2e' : '#5b47d6') : '#d6cdbb'}
                  strokeWidth={hot ? 2.5 : 1.3}
                  initial={{ pathLength: 0, opacity: 0 }}
                  animate={{ pathLength: 1, opacity: dim(lvl, j) && !hot ? 0.25 : 1 }}
                  transition={{ duration: 0.35, delay: levelDelay(lvl) - 0.15 }}
                />
              );
            });
          }),
        )}

      {built &&
        levels.slice(1).map((row, l1) =>
          row.map((_, j) => {
            const lvl = l1 + 1;
            const isRoot = lvl === levels.length - 1;
            const hot = onPath(lvl, j);
            const sib = isSibling(lvl, j);
            return (
              <motion.g
                key={`p${lvl}-${j}`}
                initial={{ scale: 0, opacity: 0 }}
                animate={{ scale: 1, opacity: dim(lvl, j) ? 0.25 : 1 }}
                transition={{ delay: levelDelay(lvl), type: 'spring', stiffness: 320, damping: 22 }}
                style={{ transformOrigin: `${xs[lvl][j]}px ${yOf(lvl)}px` }}
              >
                {isRoot ? (
                  <>
                    <rect x={xs[lvl][j] - (tampered ? 46 : 34)} y={yOf(lvl) - 14} width={tampered ? 92 : 68} height={28} rx={8} fill={tampered ? '#c93a2e' : '#14213d'} />
                    <text x={xs[lvl][j]} y={yOf(lvl) + 5} textAnchor="middle" fontSize={12} fontWeight={700} fill="#fff">
                      {tampered ? 'MISMATCH' : 'ROOT'}
                    </text>
                  </>
                ) : (
                  <circle cx={xs[lvl][j]} cy={yOf(lvl)} r={8} fill={hot ? (tampered ? '#c93a2e' : '#5b47d6') : '#fffdf9'} stroke={sib ? '#14213d' : hot ? 'none' : '#c9c0f0'} strokeWidth={sib ? 2 : 1.6} />
                )}
              </motion.g>
            );
          }),
        )}

      {leaves.map((leaf, i) => {
        const d = decisions[i];
        const blocked = d?.outcome === Outcome.Blocked;
        const hot = onPath(0, i);
        const sib = isSibling(0, i);
        return (
          <motion.g
            key={leaf + i}
            initial={{ y: -40, opacity: 0 }}
            animate={{ y: 0, opacity: dim(0, i) ? 0.22 : 1 }}
            transition={{ type: 'spring', stiffness: 260, damping: 20 }}
            style={{ cursor: onSelect ? 'pointer' : undefined }}
            onClick={() => onSelect?.(i)}
          >
            <rect
              x={xs[0][i] - 13}
              y={yOf(0) - 13}
              width={26}
              height={26}
              rx={6}
              fill={hot && tampered ? '#fbe5e1' : blocked ? '#fbe5e1' : '#e3f3ea'}
              stroke={hot ? (tampered ? '#c93a2e' : '#14213d') : sib ? '#14213d' : blocked ? '#efb3aa' : '#a8dcc4'}
              strokeWidth={hot || sib ? 2.2 : 1.5}
            />
            <text x={xs[0][i]} y={yOf(0) + 4} textAnchor="middle" fontSize={10} fontWeight={700} fontFamily="IBM Plex Mono, monospace" fill={blocked ? '#c93a2e' : '#138a5b'}>
              {d ? d.seq : i}
            </text>
          </motion.g>
        );
      })}
    </svg>
  );
}
