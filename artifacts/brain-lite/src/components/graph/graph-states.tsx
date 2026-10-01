import { useState } from 'react';
import { Link } from 'wouter';
import { AlertCircle, Loader2, Plus, RotateCcw, ShieldCheck } from 'lucide-react';
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Surface, Skeleton, btnGhost, btnPrimary } from '@/components/kit';
import { Medallion, StarGlyph } from '@/components/brand';
import { useI18n } from '@/lib/i18n';
import { graphText } from '@/lib/i18n-graph';
import { cn } from '@/lib/utils';

export function GraphSkeleton() {
  const { lang } = useI18n();
  const tx = graphText(lang);
  const dots = [[22, 30, 10], [48, 22, 16], [70, 38, 8], [35, 58, 12], [62, 66, 18], [80, 60, 9], [18, 72, 8], [50, 44, 22]];
  return (
    <div className="space-y-3" role="status" aria-label={tx.loading} data-testid="status-graph-loading">
      <div className="flex gap-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-14 w-60 shrink-0 rounded-2xl" />)}</div>
      <div className="skeleton relative h-[58dvh] min-h-[380px] w-full rounded-3xl">
        {dots.map(([x, y, r], i) => <span key={i} className="absolute rounded-full border border-gold-400/40 bg-card/70" style={{ left: `${x}%`, top: `${y}%`, width: r * 2, height: r * 2 }} />)}
        <p className="absolute inset-x-0 bottom-5 text-center text-sm text-muted-foreground">{tx.loading}</p>
      </div>
    </div>
  );
}

export function GraphError({ onRetry }: { onRetry: () => void }) {
  const { lang } = useI18n();
  const tx = graphText(lang);
  return (
    <Surface className="flex flex-col items-center gap-3 p-10 text-center" role="alert" data-testid="state-graph-error">
      <span className="grid h-12 w-12 place-items-center rounded-full bg-destructive/10 text-danger-ink"><AlertCircle className="h-5 w-5" /></span>
      <p className="font-medium">{tx.error}</p>
      <button type="button" onClick={onRetry} className={btnGhost} data-testid="button-graph-retry"><RotateCcw className="h-4 w-4" />{tx.retry}</button>
    </Surface>
  );
}

/** Illustration-style ornament: a small constellation growing from the brand star. */
function Constellation() {
  const pts = [[60, 60], [22, 34], [98, 28], [104, 88], [30, 96], [60, 14]];
  return (
    <svg viewBox="0 0 120 120" className="mx-auto h-36 w-36" aria-hidden>
      {pts.slice(1).map(([x, y], i) => <line key={i} x1={60} y1={60} x2={x} y2={y} stroke="hsl(var(--gold-500))" strokeOpacity={0.45} strokeWidth={1} strokeDasharray={i % 2 ? '3 3' : undefined} />)}
      <line x1={22} y1={34} x2={60} y2={14} stroke="hsl(var(--gold-400))" strokeOpacity={0.35} />
      {pts.slice(1).map(([x, y], i) => <circle key={i} cx={x} cy={y} r={i === 2 ? 9 : 6} fill="hsl(var(--card))" stroke="hsl(var(--gold-500))" strokeOpacity={0.7} strokeWidth={1.4} />)}
      <circle cx={60} cy={60} r={17} fill="hsl(var(--gold-soft))" stroke="hsl(var(--gold-400))" strokeWidth={3} />
      <path d="M60 50l2.6 7.4L70 60l-7.4 2.6L60 70l-2.6-7.4L50 60l7.4-2.6z" fill="hsl(var(--gold-500))" />
    </svg>
  );
}

export function GraphEmpty() {
  const { lang } = useI18n();
  const tx = graphText(lang);
  return (
    <Surface className="pattern-star relative overflow-hidden px-6 py-12 text-center" data-testid="state-graph-empty">
      <Constellation />
      <h2 className="relative mx-auto mt-4 max-w-sm font-display text-3xl">{tx.emptyTitle}</h2>
      <p className="relative mx-auto mt-2 max-w-sm text-muted-foreground">{tx.emptyBody}</p>
      <Link href="/capture" className={cn(btnPrimary, 'relative mt-6')} data-testid="link-graph-empty-capture"><Plus className="h-4 w-4" />{tx.emptyCapture}</Link>
    </Surface>
  );
}

export function GraphNoMatch({ onClear }: { onClear: () => void }) {
  const { lang } = useI18n();
  const tx = graphText(lang);
  return (
    <Surface className="pattern-star relative overflow-hidden px-6 py-12 text-center" data-testid="state-graph-nomatch">
      <Medallion className="mb-4"><StarGlyph className="h-6 w-6" /></Medallion>
      <h2 className="relative font-display text-2xl">{tx.noMatch}</h2>
      <p className="relative mt-2 text-muted-foreground">{tx.noMatchBody}</p>
      <button type="button" onClick={onClear} className={cn(btnGhost, 'relative mt-5')} data-testid="button-graph-nomatch-clear">{tx.clear}</button>
    </Surface>
  );
}

export function ShareSnapshotDialog({ open, onOpenChange, onConfirm }: { open: boolean; onOpenChange: (v: boolean) => void; onConfirm: () => Promise<void> }) {
  const { lang } = useI18n();
  const tx = graphText(lang);
  const [busy, setBusy] = useState(false);
  return (
    <AlertDialog open={open} onOpenChange={(v) => !busy && onOpenChange(v)}>
      <AlertDialogContent className="max-w-[calc(100vw-2rem)] rounded-3xl border-gold-400/35 sm:max-w-md" dir={lang === 'ar' ? 'rtl' : 'ltr'} data-testid="dialog-graph-share">
        <AlertDialogHeader className="text-start sm:text-start">
          <span className="mb-1 grid h-11 w-11 place-items-center rounded-full bg-gold-soft text-gold"><ShieldCheck className="h-5 w-5" /></span>
          <AlertDialogTitle className="font-display text-2xl">{tx.shareTitle}</AlertDialogTitle>
          <AlertDialogDescription>{tx.shareBody}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="gap-2">
          <AlertDialogCancel disabled={busy} className="min-h-11 rounded-xl" data-testid="button-graph-share-cancel">{tx.cancel}</AlertDialogCancel>
          <button type="button" disabled={busy} onClick={async () => { setBusy(true); try { await onConfirm(); } finally { setBusy(false); } }} className={btnPrimary} data-testid="button-graph-share-confirm">
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}{tx.shareConfirm}
          </button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
