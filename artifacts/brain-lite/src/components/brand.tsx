import { useId, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

/** Gold gradient defs — colors come from CSS tokens so both themes stay in sync. */
function GoldDefs({ id }: { id: string }) {
  return (
    <defs>
      <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="hsl(var(--gold-700))" />
        <stop offset="0.5" stopColor="hsl(var(--gold-400))" />
        <stop offset="1" stopColor="hsl(var(--gold-100))" />
      </linearGradient>
    </defs>
  );
}

/** Brand mark: a four-lobed brain-star held inside a rounded diamond. */
export function LogoMark({ className, title }: { className?: string; title?: string }) {
  const gid = useId().replace(/:/g, '');
  return (
    <svg viewBox="0 0 48 48" className={cn('h-10 w-10', className)} role={title ? 'img' : undefined} aria-hidden={title ? undefined : true} aria-label={title}>
      <GoldDefs id={gid} />
      <rect x="10" y="10" width="28" height="28" rx="7" transform="rotate(45 24 24)" fill="hsl(var(--gold-soft))" stroke={`url(#${gid})`} strokeWidth="1.8" />
      <rect x="14.5" y="14.5" width="19" height="19" rx="4.5" transform="rotate(45 24 24)" fill="none" stroke={`url(#${gid})`} strokeWidth="0.7" opacity="0.6" />
      {/* brain lobes */}
      <path d="M24 15.5c-2.6 0-4.4 1.7-4.6 3.9-1.9.3-3.3 1.9-3.3 3.9 0 1 .3 1.8.9 2.5-.6.7-.9 1.5-.9 2.5 0 2.2 1.8 3.9 4 3.9.7 1.6 2.2 2.3 3.9 2.3M24 15.5c2.6 0 4.4 1.7 4.6 3.9 1.9.3 3.3 1.9 3.3 3.9 0 1-.3 1.8-.9 2.5.6.7.9 1.5.9 2.5 0 2.2-1.8 3.9-4 3.9-.7 1.6-2.2 2.3-3.9 2.3"
        fill="none" stroke={`url(#${gid})`} strokeWidth="1.5" strokeLinecap="round" />
      {/* star at the heart */}
      <path d="M24 20.2l1.25 3.55L28.8 25l-3.55 1.25L24 29.8l-1.25-3.55L19.2 25l3.55-1.25z" fill={`url(#${gid})`} />
    </svg>
  );
}

export function Wordmark({ name, className, size = 'md' }: { name: string; className?: string; size?: 'sm' | 'md' | 'lg' }) {
  return (
    <span className={cn('flex items-center gap-2.5', className)}>
      <LogoMark className={size === 'lg' ? 'h-12 w-12' : size === 'sm' ? 'h-9 w-9' : 'h-10 w-10'} />
      <span className={cn('font-display font-semibold leading-none tracking-tight', size === 'lg' ? 'text-2xl' : 'text-xl')}>{name}</span>
    </span>
  );
}

/** Thin gold rule with a small centered diamond. */
export function OrnamentDivider({ className, label }: { className?: string; label?: string }) {
  return (
    <div className={cn('flex items-center gap-3 text-gold', className)} role="separator" aria-label={label}>
      <span className="h-px flex-1 bg-gradient-to-r from-transparent via-gold-400/50 to-gold-400/70 rtl:bg-gradient-to-l" />
      {label && <span className="eyebrow text-gold">{label}</span>}
      <svg viewBox="0 0 20 10" className="h-2.5 w-5 shrink-0" aria-hidden>
        <path d="M10 0l4 5-4 5-4-5z" fill="currentColor" />
        <circle cx="1.5" cy="5" r="1" fill="currentColor" opacity=".6" />
        <circle cx="18.5" cy="5" r="1" fill="currentColor" opacity=".6" />
      </svg>
      <span className="h-px flex-1 bg-gradient-to-l from-transparent via-gold-400/50 to-gold-400/70 rtl:bg-gradient-to-r" />
    </div>
  );
}

/** Small SVG flourishes for the four corners of important cards. */
export function CornerFlourishes({ className }: { className?: string }) {
  const corner = (pos: string) => (
    <svg viewBox="0 0 28 28" className={cn('pointer-events-none absolute h-6 w-6 text-gold-400', pos)} aria-hidden>
      <path d="M2 16V6a4 4 0 0 1 4-4h10" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <path d="M6 12V9a3 3 0 0 1 3-3h3" fill="none" stroke="currentColor" strokeWidth="0.9" strokeLinecap="round" opacity=".7" />
      <path d="M5 5l1.2 1.2L5 7.4 3.8 6.2z" fill="currentColor" />
    </svg>
  );
  return (
    <span className={cn('pointer-events-none', className)} aria-hidden>
      {corner('start-2 top-2 rtl:-scale-x-100')}
      {corner('end-2 top-2 -scale-x-100 rtl:scale-x-100')}
      {corner('bottom-2 start-2 -scale-y-100 rtl:scale-x-[-1]')}
      {corner('bottom-2 end-2 scale-[-1] rtl:scale-y-[-1] rtl:scale-x-100')}
    </span>
  );
}

/** Eight-point star glyph (two overlapping squares). */
export function StarGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={cn('h-4 w-4', className)} aria-hidden>
      <rect x="6" y="6" width="12" height="12" fill="currentColor" opacity=".9" />
      <rect x="6" y="6" width="12" height="12" transform="rotate(45 12 12)" fill="currentColor" opacity=".9" />
      <circle cx="12" cy="12" r="2.4" fill="hsl(var(--card))" />
    </svg>
  );
}

/** Lucide icon inside a soft gold circle. */
export function IconCircle({ icon: Icon, className, size = 'md' }: { icon: LucideIcon; className?: string; size?: 'sm' | 'md' | 'lg' }) {
  const s = size === 'sm' ? 'h-8 w-8' : size === 'lg' ? 'h-14 w-14' : 'h-10 w-10';
  const i = size === 'sm' ? 'h-4 w-4' : size === 'lg' ? 'h-6 w-6' : 'h-[18px] w-[18px]';
  return (
    <span className={cn('grid shrink-0 place-items-center rounded-full bg-gold-soft text-gold ring-1 ring-inset ring-gold-400/30', s, className)}>
      <Icon className={i} strokeWidth={1.5} />
    </span>
  );
}

/** Illustration-style ornament for empty states: a diamond medallion. */
export function Medallion({ children, className }: { children?: ReactNode; className?: string }) {
  const gid = useId().replace(/:/g, '');
  return (
    <div className={cn('relative mx-auto grid h-24 w-24 place-items-center', className)}>
      <svg viewBox="0 0 96 96" className="absolute inset-0 h-full w-full" aria-hidden>
        <GoldDefs id={gid} />
        <rect x="20" y="20" width="56" height="56" rx="12" transform="rotate(45 48 48)" fill="hsl(var(--card))" stroke={`url(#${gid})`} strokeWidth="1.2" />
        <rect x="26" y="26" width="44" height="44" rx="6" fill="none" stroke={`url(#${gid})`} strokeWidth="0.8" opacity=".55" />
        <rect x="26" y="26" width="44" height="44" rx="6" transform="rotate(45 48 48)" fill="none" stroke={`url(#${gid})`} strokeWidth="0.8" opacity=".55" />
        {[0, 90, 180, 270].map((r) => <circle key={r} cx="48" cy="6" r="1.8" fill={`url(#${gid})`} transform={`rotate(${r} 48 48)`} />)}
      </svg>
      <span className="relative text-gold">{children}</span>
    </div>
  );
}
