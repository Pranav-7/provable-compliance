import { useEffect, useRef, useState } from 'react';

const HEX = '0123456789abcdef';

/**
 * Renders a hash and, when it changes, scrambles only the characters that differ
 * before settling on the new value. Makes "one small edit changes the whole
 * fingerprint" visible at a glance.
 */
export function HashText({ value, className = 'fingerprint' }: { value: string; className?: string }) {
  const [shown, setShown] = useState(value);
  const [changed, setChanged] = useState<Set<number>>(new Set());
  const prev = useRef(value);

  useEffect(() => {
    if (prev.current === value) return;
    const from = prev.current;
    prev.current = value;
    const diff = new Set<number>();
    for (let i = 0; i < value.length; i++) if (from[i] !== value[i]) diff.add(i);
    setChanged(diff);

    let frame = 0;
    const frames = 14;
    const timer = setInterval(() => {
      frame++;
      if (frame >= frames) {
        clearInterval(timer);
        setShown(value);
        setTimeout(() => setChanged(new Set()), 900);
        return;
      }
      setShown(
        value
          .split('')
          .map((ch, i) => (diff.has(i) && i > 1 && Math.random() < 1 - frame / frames ? HEX[Math.floor(Math.random() * 16)] : ch))
          .join(''),
      );
    }, 35);
    return () => clearInterval(timer);
  }, [value]);

  return (
    <div className={className}>
      {shown.split('').map((ch, i) => (
        <span key={i} className={changed.has(i) ? 'flip' : undefined}>
          {ch}
        </span>
      ))}
    </div>
  );
}
