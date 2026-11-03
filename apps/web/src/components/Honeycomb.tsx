const R = 54;
const W = Math.sqrt(3) * R + 8;

const NAMES: Record<number, [string, string]> = {
  1: ['Machine-readable', 'rules'],
  2: ['Eligibility', 'credentials'],
  3: ['Proof at', 'transfer'],
  4: ['Tamper-evident', 'record'],
  5: ['Confidential', 'amounts'],
  6: ['Regulator', 'access'],
  7: ['Provable', 'operators'],
  8: ['Shared', 'standards'],
};

/** [fill, stroke, number, label] per layer. Lit layers (run in this demo) are solid navy; the rest stay as outlines. */
const TONE = (n: number, on: boolean): [string, string, string, string] =>
  on ? ['#14213d', '#14213d', '#f0a35e', '#ffffff'] : n <= 6 ? ['#fbeadb', '#e3b98f', '#9a4a12', '#3e4659'] : ['#ece8de', '#c9c2b2', '#6b6f7b', '#3e4659'];

function hex(cx: number, cy: number, r: number) {
  return Array.from({ length: 6 }, (_, k) => {
    const a = ((60 * k - 90) * Math.PI) / 180;
    return `${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`;
  }).join(' ');
}

/** The architecture from the note. Layers 1 to 4 are lit: they are what this demo runs. */
export function Honeycomb({ lit = [1, 2, 3, 4] }: { lit?: number[] }) {
  const cx = 2 * W;
  const y1 = 290;
  const y2 = y1 - 1.5 * R - 6;
  const y3 = y2 - 1.5 * R - 6;
  const pos: Record<number, [number, number]> = {
    1: [cx - 1.5 * W, y1],
    2: [cx - 0.5 * W, y1],
    3: [cx + 0.5 * W, y1],
    4: [cx + 1.5 * W, y1],
    5: [cx - W, y2],
    6: [cx + W, y2],
    7: [cx - W / 2, y3],
    8: [cx + W / 2, y3],
  };
  return (
    <svg viewBox={`0 ${y3 - R - 10} ${4 * W} ${y1 - y3 + 2 * R + 20}`} width="100%" role="img" aria-label="Eight-layer architecture">
      <polygon points={hex(cx, y2, R)} fill="#fffdf9" stroke="#c8641e" strokeWidth={1.8} strokeDasharray="5 5" />
      <text x={cx} y={y2 - 6} textAnchor="middle" fontSize={10.5} fontWeight={700} fill="#9a4a12" fontFamily="IBM Plex Sans, sans-serif">
        Proof travels
      </text>
      <text x={cx} y={y2 + 8} textAnchor="middle" fontSize={10.5} fontWeight={700} fill="#9a4a12" fontFamily="IBM Plex Sans, sans-serif">
        with the
      </text>
      <text x={cx} y={y2 + 22} textAnchor="middle" fontSize={10.5} fontWeight={700} fill="#9a4a12" fontFamily="IBM Plex Sans, sans-serif">
        transaction
      </text>
      {Object.entries(pos).map(([k, [x, y]]) => {
        const n = Number(k);
        const on = lit.includes(n);
        const [fill, stroke, num, label] = TONE(n, on);
        return (
          <g key={n} opacity={on ? 1 : 0.6}>
            <polygon points={hex(x, y, R)} fill={fill} stroke={stroke} strokeWidth={2} />
            <text x={x} y={y - 12} textAnchor="middle" fontSize={18} fontWeight={700} fill={num} fontFamily="Source Serif 4 Variable, Georgia, serif">
              {n}
            </text>
            <text x={x} y={y + 7} textAnchor="middle" fontSize={9.5} fontWeight={600} fill={label} fontFamily="IBM Plex Sans, sans-serif">
              {NAMES[n][0]}
            </text>
            <text x={x} y={y + 21} textAnchor="middle" fontSize={9.5} fontWeight={600} fill={label} fontFamily="IBM Plex Sans, sans-serif">
              {NAMES[n][1]}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
