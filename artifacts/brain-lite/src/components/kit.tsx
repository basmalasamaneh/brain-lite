import { useState, type ReactNode } from 'react';
import { Link } from 'wouter';
import { AlertCircle, ArrowUpRight, FlaskConical, Info, Loader2, Paperclip, RotateCcw, Sparkle, Trash2 } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Medallion, OrnamentDivider } from '@/components/brand';
import { useListMemories, type Memory, type MemoryStatus, type MemoryType } from '@workspace/api-client-react';
import { isSample, useRemoveSamples } from '@/lib/auth-helpers';
import { useToast } from '@/hooks/use-toast';
import { useI18n, type TKey } from '@/lib/i18n';
import { formatAmount, formatDate, typeMeta } from '@/lib/memory';
import { cn } from '@/lib/utils';

export function Surface({ className, children, ...rest }: { className?: string; children: ReactNode } & React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('min-w-0 rounded-2xl border border-card-border bg-card soft-shadow', className)} {...rest}>{children}</div>;
}

export function PageHeader({ title, lead, action, eyebrow }: { title: string; lead?: string; action?: ReactNode; eyebrow?: string }) {
  return (
    <header className="rise mb-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          {eyebrow && <p className="eyebrow mb-2 text-gold">{eyebrow}</p>}
          <h1 className="font-display text-4xl sm:text-5xl" data-testid="text-page-title">{title}</h1>
          {lead && <p className="mt-2 max-w-xl text-muted-foreground">{lead}</p>}
        </div>
        {action}
      </div>
      <OrnamentDivider className="mt-6" />
    </header>
  );
}

/** Small info icon with a tooltip for contextual help. */
export function InfoTip({ text, className }: { text: string; className?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" aria-label={text} className={cn('inline-grid h-11 w-11 shrink-0 place-items-center rounded-full text-muted-foreground transition hover:bg-gold-soft hover:text-gold', className)}>
          <Info className="h-3.5 w-3.5" strokeWidth={1.75} />
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs rounded-xl border border-gold-400/40 bg-card text-card-foreground lux-shadow">{text}</TooltipContent>
    </Tooltip>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('skeleton', className)} aria-hidden />;
}

export function TypeChip({ type, size = 'sm' }: { type: MemoryType; size?: 'sm' | 'lg' }) {
  const { t } = useI18n();
  const m = typeMeta[type];
  const Icon = m.icon;
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-full font-medium', m.tone, size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3 py-1.5 text-sm')}>
      <Icon className={size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4'} strokeWidth={1.75} />
      {t(`type_${type}` as TKey)}
    </span>
  );
}

export function TypeIcon({ type, className }: { type: MemoryType; className?: string }) {
  const m = typeMeta[type];
  const Icon = m.icon;
  return <span className={cn('grid h-11 w-11 shrink-0 place-items-center rounded-full', m.tone, className)}><Icon className="h-5 w-5" strokeWidth={1.5} /></span>;
}

export function StatusPill({ status }: { status: MemoryStatus }) {
  const { t } = useI18n();
  const review = status === 'needs_review';
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium', review ? 'bg-warning/12 text-warning-ink' : 'bg-success/10 text-success-ink')} data-testid="status-memory">
      <span className={cn('h-2 w-2 rounded-full', review ? 'bg-warning' : 'bg-success')} />
      {t(`status_${status}` as TKey)}
    </span>
  );
}

export function MemoryCard({ memory, index = 0 }: { memory: Memory; index?: number }) {
  const { lang } = useI18n();
  const date = memory.event_date ?? memory.created_at;
  const amount = formatAmount(memory.amount, memory.currency, lang);
  return (
    <Link href={`/memories/${memory.id}`} className="group block rise min-w-0 max-w-full rounded-2xl" style={{ animationDelay: `${Math.min(index, 10) * 45}ms` }} data-testid={`card-memory-${memory.id}`}>
      <Surface className="lift relative flex gap-4 p-4 sm:p-5 group-hover:border-gold-400/50">
        <span className={cn('absolute end-4 top-4 h-2.5 w-2.5 rounded-full ring-4', memory.status === 'needs_review' ? 'bg-warning ring-warning/15' : 'bg-success ring-success/15')} aria-hidden data-testid={`dot-status-${memory.id}`} />
        <TypeIcon type={memory.type} />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-start justify-between gap-3">
            <h3 className="font-display flex min-w-0 flex-1 items-center gap-2 pe-5 text-xl"><span className="min-w-0 truncate">{memory.title}</span>{isSample(memory) && <SampleBadge />}</h3>
            <ArrowUpRight className="mt-6 h-4 w-4 shrink-0 text-gold opacity-0 transition group-hover:opacity-100 rtl:-scale-x-100" />
          </div>
          <p className="mt-1 line-clamp-2 break-words text-sm text-muted-foreground [overflow-wrap:anywhere]">{memory.summary || memory.raw_text}</p>
          <div className="mt-3 flex min-w-0 flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <StatusPill status={memory.status} />
            <span className="min-w-0 max-w-full break-words tabular-nums">{formatDate(date, lang)}</span>
            {amount && <span className="min-w-0 max-w-full break-words font-medium text-foreground/80 [overflow-wrap:anywhere]">· {amount}</span>}
            {memory.file_path && <Paperclip className="h-3.5 w-3.5" />}
            {memory.tags.slice(0, 2).map((tag) => <span key={tag} className="min-w-0 max-w-full truncate rounded-md bg-muted px-1.5 py-0.5">#{tag}</span>)}
          </div>
        </div>
      </Surface>
    </Link>
  );
}

export function MemoryCardSkeleton() {
  return (
    <Surface className="flex gap-4 p-5">
      <Skeleton className="h-11 w-11 rounded-full" />
      <div className="flex-1 space-y-2.5">
        <Skeleton className="h-4 w-2/5 rounded-md" />
        <Skeleton className="h-3 w-4/5 rounded-md" />
        <Skeleton className="h-3 w-1/4 rounded-md" />
      </div>
    </Surface>
  );
}

export function ErrorState({ onRetry, message }: { onRetry?: () => void; message?: string }) {
  const { t } = useI18n();
  return (
    <Surface className="flex flex-col items-center gap-3 p-10 text-center" role="alert">
      <span className="grid h-12 w-12 place-items-center rounded-full bg-destructive/10 text-danger-ink"><AlertCircle className="h-5 w-5" /></span>
      <p className="font-medium">{message ?? t('loadError')}</p>
      {onRetry && (
        <button onClick={onRetry} className={btnGhost} data-testid="button-retry">
          <RotateCcw className="h-4 w-4" />{t('retry')}
        </button>
      )}
    </Surface>
  );
}

export function EmptyState({ title, body, action }: { title: string; body?: string; action?: ReactNode }) {
  return (
    <Surface className="pattern-star relative overflow-hidden px-6 py-14 text-center sm:px-12" data-testid="state-empty">
      <Medallion className="mb-6"><Sparkle className="h-6 w-6" strokeWidth={1.5} /></Medallion>
      <h2 className="relative font-display mx-auto max-w-md text-2xl sm:text-3xl">{title}</h2>
      {body && <p className="relative mx-auto mt-3 max-w-md text-muted-foreground">{body}</p>}
      {action && <div className="relative mt-6 flex justify-center">{action}</div>}
    </Surface>
  );
}

export function SampleBanner() {
  const { t } = useI18n();
  const { toast } = useToast();
  const list = useListMemories();
  const remove = useRemoveSamples();
  const [busy, setBusy] = useState(false);
  const count = (list.data ?? []).filter(isSample).length;
  if (!count) return null;
  const onRemove = async () => {
    setBusy(true);
    try { await remove(); toast({ title: t('samplesRemoved') }); }
    catch { toast({ variant: 'destructive', title: t('samplesRemoveFail') }); }
    finally { setBusy(false); }
  };
  return (
    <div className="rise mb-6 flex flex-col gap-3 rounded-2xl border border-gold-400/40 bg-gold-soft/60 p-4 sm:flex-row sm:items-center" data-testid="banner-sample">
      <span className="inline-flex w-fit items-center gap-1.5 rounded-full gold-gradient px-2.5 py-1 text-xs font-semibold text-gold-ink"><FlaskConical className="h-3.5 w-3.5" />{t('sampleTag')} · {count}</span>
      <div className="min-w-0 flex-1 text-sm"><p className="font-semibold">{t('samplesTitle')}</p><p className="text-muted-foreground">{t('samplesBody')}</p></div>
      <button onClick={onRemove} disabled={busy} className={btnGhost} data-testid="button-remove-samples">
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}{busy ? t('removingSamples') : t('removeSamples')}
      </button>
    </div>
  );
}

export function SampleBadge() {
  const { t } = useI18n();
  return <span className="inline-flex items-center gap-1 rounded-full border border-gold-400/50 bg-gold-soft px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-gold" data-testid="badge-sample"><FlaskConical className="h-3 w-3" />{t('sampleTag')}</span>;
}

export const btnPrimary = 'btn-gold inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50';
export const btnGhost = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-gold-400/60 bg-transparent px-4 py-2.5 text-sm font-medium text-foreground transition hover:border-gold-500 hover:bg-gold-soft active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50';
export const btnDanger = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-destructive px-5 py-2.5 text-sm font-semibold text-destructive-foreground transition hover:brightness-110 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50';
export const fieldCls = 'min-h-11 w-full min-w-0 rounded-xl border border-input bg-card px-3.5 py-2.5 text-base outline-none transition placeholder:text-muted-foreground/80 hover:border-gold-400/60 focus:border-gold-500 focus:ring-4 focus:ring-gold-400/20 disabled:opacity-60 sm:text-sm aria-[invalid=true]:border-destructive';
