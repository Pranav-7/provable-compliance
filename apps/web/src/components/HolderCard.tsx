import { motion } from 'framer-motion';
import { COUNTRY_NAMES, type HolderView } from '@pc/shared';
import { Avatar, Chip, Icon } from './ui';
import type { ReactNode } from 'react';
import { useStudy } from '../store';

const avatarTone = (h: HolderView, ineligible: string) => (h.credentialStatus === 'revoked' ? 'coral' : h.id === ineligible ? 'grey' : 'blue');

/** A holder's wallet: private attributes only they can see, plus public on-chain state. */
export function HolderCard({ holder, footer, showPrivate = true, showBalance = true }: { holder: HolderView; footer?: ReactNode; showPrivate?: boolean; showBalance?: boolean }) {
  const c = holder.credential;
  const study = useStudy();
  return (
    <motion.div layout className={`holder${holder.credentialStatus === 'revoked' ? ' revoked' : ''}`}>
      <div className="row">
        <Avatar name={holder.name} tone={avatarTone(holder, study.roles.ineligible)} />
        <div>
          <div className="holder-name">{holder.name}</div>
          <div className="holder-role">{holder.role}</div>
        </div>
      </div>

      {showPrivate && (
        <div className="private">
          <div className="private-label">
            {Icon.lock} Private to {holder.name}
          </div>
          {c ? (
            <div>
              {COUNTRY_NAMES[c.country] ?? c.country} · {c.investorClass}
              {holder.credentialStatus === 'revoked' && (
                <div style={{ color: 'var(--red)', fontWeight: 600, marginTop: 2 }}>Credential revoked</div>
              )}
            </div>
          ) : (
            <span className="muted">No credential yet</span>
          )}
        </div>
      )}

      {showBalance && (
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <motion.span key={holder.balance} className="balance" initial={{ opacity: 0.3 }} animate={{ opacity: 1 }}>
            {holder.balance}
          </motion.span>
          <span className="tiny muted">{study.policy.asset.symbol}</span>
        </div>
      )}
      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
        {holder.hasReceivePass ? <Chip tone="mint">Receive pass</Chip> : <Chip tone="grey">No receive pass</Chip>}
      </div>
      {footer}
    </motion.div>
  );
}
