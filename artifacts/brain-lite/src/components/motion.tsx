import { useEffect, useRef, useState, type ReactNode } from 'react';
import { animate, motion, useReducedMotion, type Variants } from 'framer-motion';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/utils';

const EASE = [0.22, 0.8, 0.24, 1] as const;

/** Fade + slight inline slide on route change. Slide direction mirrors in RTL. */
export function PageTransition({ routeKey, children }: { routeKey: string; children: ReactNode }) {
  const reduce = useReducedMotion();
  const { dir } = useI18n();
  const x = reduce ? 0 : dir === 'rtl' ? -14 : 14;
  return (
    <motion.div key={routeKey} initial={{ opacity: 0, x }} animate={{ opacity: 1, x: 0 }} transition={{ duration: reduce ? 0 : 0.32, ease: EASE }} className="min-w-0">
      {children}
    </motion.div>
  );
}

const listV: Variants = { hidden: {}, show: { transition: { staggerChildren: 0.05, delayChildren: 0.04 } } };
const itemV: Variants = { hidden: { opacity: 0, y: 10 }, show: { opacity: 1, y: 0, transition: { duration: 0.32, ease: EASE } } };

export function Stagger({ children, className, ...rest }: { children: ReactNode; className?: string } & Record<`data-${string}`, string>) {
  const reduce = useReducedMotion();
  return <motion.div variants={listV} initial={reduce ? false : 'hidden'} animate="show" className={className} {...rest}>{children}</motion.div>;
}
const itemReducedV: Variants = { hidden: { opacity: 1, y: 0 }, show: { opacity: 1, y: 0, transition: { duration: 0 } } };
export function StaggerItem({ children, className }: { children: ReactNode; className?: string }) {
  const reduce = useReducedMotion();
  return <motion.div variants={reduce ? itemReducedV : itemV} className={cn('min-w-0', className)}>{children}</motion.div>;
}

/** Counts from 0 (or last value) up to `value`. */
export function CountUp({ value, format, className, ...rest }: { value: number; format?: (n: number) => string; className?: string } & Record<`data-${string}`, string>) {
  const reduce = useReducedMotion();
  const [shown, setShown] = useState(reduce ? value : 0);
  const from = useRef(0);
  useEffect(() => {
    if (reduce) { setShown(value); from.current = value; return; }
    const ctl = animate(from.current, value, { duration: 0.4, ease: EASE, onUpdate: (v) => setShown(Math.round(v)) });
    from.current = value;
    return () => ctl.stop();
  }, [value, reduce]);
  return <span className={cn('tabular-nums', className)} {...rest}>{format ? format(shown) : shown}</span>;
}

/** Horizontal fill that grows from the inline start. */
export function MeterFill({ value, className }: { value: number; className?: string }) {
  const reduce = useReducedMotion();
  const { dir } = useI18n();
  return (
    <motion.div className={cn('h-full rounded-full', className)} style={{ originX: dir === 'rtl' ? 1 : 0 }}
      initial={{ scaleX: reduce ? value / 100 : 0 }} animate={{ scaleX: value / 100 }} transition={{ duration: reduce ? 0 : 0.35, ease: EASE, delay: 0.05 }} />
  );
}

/** Pulsing gold eight-point star used while Brain Lite is working. */
export function PulseStar({ className }: { className?: string }) {
  const reduce = useReducedMotion();
  return (
    <span className={cn('relative grid h-14 w-14 place-items-center', className)} aria-hidden>
      {!reduce && <motion.span className="absolute inset-0 rounded-full bg-gold-400/25" animate={{ scale: [0.7, 1.35], opacity: [0.7, 0] }} transition={{ duration: 1.8, repeat: Infinity, ease: 'easeOut' }} />}
      <motion.svg viewBox="0 0 24 24" className="relative h-9 w-9 text-gold-500"
        animate={reduce ? undefined : { rotate: [0, 45], scale: [1, 1.08, 1] }} transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}>
        <rect x="6" y="6" width="12" height="12" rx="1" fill="currentColor" />
        <rect x="6" y="6" width="12" height="12" rx="1" transform="rotate(45 12 12)" fill="currentColor" opacity=".75" />
        <circle cx="12" cy="12" r="2.6" fill="hsl(var(--card))" />
      </motion.svg>
    </span>
  );
}

/** Drawn checkmark inside a gold ring. */
export function SuccessCheck({ className }: { className?: string }) {
  const reduce = useReducedMotion();
  const d = reduce ? 0 : 0.4;
  return (
    <svg viewBox="0 0 40 40" className={cn('h-8 w-8', className)} aria-hidden>
      <motion.circle cx="20" cy="20" r="17" fill="none" stroke="hsl(var(--success))" strokeWidth="2.2"
        initial={{ pathLength: reduce ? 1 : 0 }} animate={{ pathLength: 1 }} transition={{ duration: d, ease: EASE }} />
      <motion.path d="M12.5 20.5l5 5 10-11" fill="none" stroke="hsl(var(--success))" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"
        initial={{ pathLength: reduce ? 1 : 0 }} animate={{ pathLength: 1 }} transition={{ duration: d, delay: d * 0.8, ease: EASE }} />
    </svg>
  );
}
