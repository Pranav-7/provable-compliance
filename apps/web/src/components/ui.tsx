import type { ReactNode } from 'react';
import { motion } from 'framer-motion';
import { REASON_LABEL, type ActionResult } from '@pc/shared';
import { useApp } from '../store';

export function Button(props: {
  children: ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'ghost' | 'danger';
  size?: 'sm';
  busy?: boolean;
  disabled?: boolean;
  title?: string;
}) {
  const { variant = 'primary', size, busy, disabled, ...rest } = props;
  return (
    <button
      className={`btn btn-${variant}${size ? ` btn-${size}` : ''}`}
      disabled={disabled || busy}
      onClick={rest.onClick}
      title={rest.title}
    >
      {busy && <span className="spinner" style={{ borderTopColor: variant === 'primary' ? '#fff' : undefined }} />}
      {rest.children}
    </button>
  );
}

export function Chip({ tone, children }: { tone: 'blue' | 'mint' | 'coral' | 'red' | 'grey'; children: ReactNode }) {
  return <span className={`chip ${tone}`}>{children}</span>;
}

export function Card({ title, aside, children, soft, style }: { title?: ReactNode; aside?: ReactNode; children: ReactNode; soft?: boolean; style?: React.CSSProperties }) {
  return (
    <div className={`card${soft ? ' soft' : ''}`} style={style}>
      {title && (
        <div className="card-title">
          <span>{title}</span>
          {aside}
        </div>
      )}
      {children}
    </div>
  );
}

export function ScreenHeader({ kicker, tone, title, lede }: { kicker: string; tone?: 'mint' | 'coral'; title: string; lede?: ReactNode }) {
  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}>
      <div className={`kicker${tone ? ` ${tone}` : ''}`}>{kicker}</div>
      <h1>{title}</h1>
      {lede && <p className="lede">{lede}</p>}
    </motion.div>
  );
}

/** Supporting explanation, shown only when "Technical detail" is on so each screen leads with its output. */
export function Note({ children, style }: { children: ReactNode; style?: React.CSSProperties }) {
  const technical = useApp((s) => s.technical);
  if (!technical) return null;
  return (
    <p className="note" style={style}>
      {children}
    </p>
  );
}

/** Shortens a hash for display; the full value is shown in technical mode. */
export function Hash({ value, chars = 6 }: { value: string | null | undefined; chars?: number }) {
  const technical = useApp((s) => s.technical);
  if (!value) return <span className="muted">none</span>;
  const text = technical || value.length <= 2 + chars * 2 ? value : `${value.slice(0, 2 + chars)}…${value.slice(-chars)}`;
  return (
    <span className="mono" title={value} style={{ wordBreak: 'break-all' }}>
      {text}
    </span>
  );
}

export const Icon = {
  check: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M3.5 8.5l3 3 6-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  cross: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M4.5 4.5l7 7m0-7l-7 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  ),
  lock: (
    <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden>
      <rect x="2" y="5.5" width="8" height="5.5" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
      <path d="M4 5.5V4a2 2 0 014 0v1.5" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  ),
  arrow: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M3 8h10m-4-4l4 4-4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  chain: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
      <rect x="1.5" y="5" width="7" height="6" rx="3" stroke="currentColor" strokeWidth="1.5" />
      <rect x="7.5" y="5" width="7" height="6" rx="3" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  ),
};

/** Outcome of a wallet action, explained in one line. */
export function ResultLine({ result, okText }: { result: ActionResult; okText?: string }) {
  const technical = useApp((s) => s.technical);
  const where = result.stage === 'prove' ? 'No proof could be built' : result.stage === 'submit' ? "Stopped by the issuing bank's compliant node" : 'Rejected by the token contract';
  return (
    <motion.div
      className={`result ${result.ok ? 'ok' : 'bad'}`}
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
    >
      <span style={{ marginTop: 2 }}>{result.ok ? Icon.check : Icon.cross}</span>
      <div>
        <strong>{result.ok ? (okText ?? 'Settled on-chain') : where}</strong>
        {!result.ok && <span>{REASON_LABEL[result.reason]}</span>}
        {technical && result.txHash && (
          <div className="tiny" style={{ marginTop: 4, opacity: 0.85 }}>
            tx <Hash value={result.txHash} /> {result.blockNumber ? `· block ${result.blockNumber}` : ''} {result.gasUsed ? `· gas ${Number(result.gasUsed).toLocaleString('en-GB')}` : ''}
          </div>
        )}
      </div>
    </motion.div>
  );
}

export function Avatar({ name, tone = 'blue' }: { name: string; tone?: 'blue' | 'mint' | 'coral' | 'grey' | 'violet' }) {
  const palette = {
    blue: ['var(--blue-faint)', 'var(--blue)'],
    mint: ['var(--mint-faint)', 'var(--mint)'],
    coral: ['var(--coral-faint)', 'var(--coral)'],
    grey: ['var(--line-2)', 'var(--grey)'],
    violet: ['var(--violet-faint)', 'var(--violet)'],
  }[tone];
  return (
    <div className="avatar" style={{ background: palette[0], color: palette[1] }}>
      {name[0]}
    </div>
  );
}
