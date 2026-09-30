import type { ReactNode } from 'react';
import { Link } from 'wouter';
import { AlertCircle, ArrowUpRight, Eye, Paperclip, RotateCcw, Sparkle } from 'lucide-react';
import { useAuth } from '@workspace/replit-auth-web';
import type { Memory, MemoryStatus, MemoryType } from '@workspace/api-client-react';
import { useI18n, type TKey } from '@/lib/i18n';
import { formatAmount, formatDate, typeMeta } from '@/lib/memory';
import { cn } from '@/lib/utils';

export function Surface({ className, children, ...rest }: { className?: string; children: ReactNode } & React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('rounded-2xl border border-card-border bg-card soft-shadow', className)} {...rest}>{children}</div>;
}

export function PageHeader({ title, lead, action }: { title: string; lead?: string; action?: ReactNode }) {
  return (
    <header className="rise mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="font-display text-3xl font-bold sm:text-4xl" data-testid="text-page-title">{title}</h1>
        {lead && <p className="mt-2 max-w-xl text-muted-foreground">{lead}</p>}
      </div>
      {action}
    </header>
  );
}

export function TypeChip({ type, size = 'sm' }: { type: MemoryType; size?: 'sm' | 'lg' }) {
  const { t } = useI18n();
  const m = typeMeta[type];
  const Icon = m.icon;
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-full font-medium', m.tone, size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3 py-1.5 text-sm')}>
      <Icon className={size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4'} />
      {t(`type_${type}` as TKey)}
    </span>
  );
}

export function TypeIcon({ type, className }: { type: MemoryType; className?: string }) {
  const m = typeMeta[type];
  const Icon = m.icon;
  return <span className={cn('grid h-11 w-11 shrink-0 place-items-center rounded-xl', m.tone, className)}><Icon className="h-5 w-5" /></span>;
}

export function StatusPill({ status }: { status: MemoryStatus }) {
  const { t } = useI18n();
  const review = status === 'needs_review';
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium', review ? 'bg-amber/12 text-amber' : 'bg-green/12 text-green')} data-testid="status-memory">
      <span className={cn('h-1.5 w-1.5 rounded-full', review ? 'bg-amber' : 'bg-green')} />
      {t(`status_${status}` as TKey)}
    </span>
  );
}

export function MemoryCard({ memory, index = 0 }: { memory: Memory; index?: number }) {
  const { lang } = useI18n();
  const date = memory.event_date ?? memory.created_at;
  const amount = formatAmount(memory.amount, memory.currency, lang);
  return (
    <Link href={`/memories/${memory.id}`} className="group block rise" style={{ animationDelay: `${Math.min(index, 10) * 45}ms` }} data-testid={`card-memory-${memory.id}`}>
      <Surface className="lift flex gap-4 p-4 sm:p-5 group-hover:border-primary/25">
        <TypeIcon type={memory.type} />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <h3 className="font-display truncate font-semibold">{memory.title}</h3>
            <ArrowUpRight className="h-4 w-4 shrink-0 text-muted-foreground opacity-0 transition group-hover:opacity-100 rtl:-scale-x-100" />
          </div>
          <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{memory.summary || memory.raw_text}</p>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <StatusPill status={memory.status} />
            <span>{formatDate(date, lang)}</span>
            {amount && <span className="font-medium text-foreground/80">· {amount}</span>}
            {memory.file_path && <Paperclip className="h-3.5 w-3.5" />}
            {memory.tags.slice(0, 2).map((tag) => <span key={tag} className="rounded-md bg-muted px-1.5 py-0.5">#{tag}</span>)}
          </div>
        </div>
      </Surface>
    </Link>
  );
}

export function MemoryCardSkeleton() {
  return (
    <Surface className="flex gap-4 p-5">
      <div className="h-11 w-11 animate-pulse rounded-xl bg-muted" />
      <div className="flex-1 space-y-2.5">
        <div className="h-4 w-2/5 animate-pulse rounded bg-muted" />
        <div className="h-3 w-4/5 animate-pulse rounded bg-muted" />
        <div className="h-3 w-1/4 animate-pulse rounded bg-muted" />
      </div>
    </Surface>
  );
}

export function ErrorState({ onRetry, message }: { onRetry?: () => void; message?: string }) {
  const { t } = useI18n();
  return (
    <Surface className="flex flex-col items-center gap-3 p-10 text-center" role="alert">
      <span className="grid h-12 w-12 place-items-center rounded-full bg-destructive/10 text-destructive"><AlertCircle className="h-5 w-5" /></span>
      <p className="font-medium">{message ?? t('loadError')}</p>
      {onRetry && (
        <button onClick={onRetry} className="inline-flex items-center gap-2 rounded-xl bg-lavender px-4 py-2 text-sm font-medium text-primary transition hover:bg-primary hover:text-primary-foreground active:scale-95" data-testid="button-retry">
          <RotateCcw className="h-4 w-4" />{t('retry')}
        </button>
      )}
    </Surface>
  );
}

export function EmptyState({ title, body, action }: { title: string; body?: string; action?: ReactNode }) {
  return (
    <Surface className="relative overflow-hidden px-6 py-14 text-center sm:px-12">
      <div className="breathe pointer-events-none absolute left-1/2 top-6 h-40 w-40 -translate-x-1/2 rounded-full bg-primary/15 blur-3xl" />
      <div className="relative mx-auto mb-5 grid h-14 w-14 place-items-center rounded-2xl bg-lavender text-primary"><Sparkle className="h-6 w-6" /></div>
      <h2 className="relative font-display mx-auto max-w-md text-xl font-semibold sm:text-2xl">{title}</h2>
      {body && <p className="relative mx-auto mt-3 max-w-md text-muted-foreground">{body}</p>}
      {action && <div className="relative mt-6 flex justify-center">{action}</div>}
    </Surface>
  );
}

export function SampleBanner() {
  const { t } = useI18n();
  const { isAuthenticated, isLoading, login } = useAuth();
  if (isLoading || isAuthenticated) return null;
  return (
    <div className="rise mb-6 flex flex-col gap-3 rounded-2xl border border-amber/30 bg-amber/10 p-4 sm:flex-row sm:items-center" data-testid="banner-sample">
      <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-amber px-2.5 py-1 text-xs font-semibold text-[#1C1B29]"><Eye className="h-3.5 w-3.5" />{t('samplePreview')}</span>
      <p className="flex-1 text-sm">{t('sampleBanner')}</p>
      <button onClick={login} className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:brightness-110 active:scale-95" data-testid="button-banner-login">{t('login')}</button>
    </div>
  );
}

export const btnPrimary = 'inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-[0_6px_20px_-8px_hsl(var(--primary)/0.7)] transition hover:brightness-110 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50';
export const btnGhost = 'inline-flex items-center justify-center gap-2 rounded-xl border border-border bg-card px-4 py-2.5 text-sm font-medium transition hover:border-primary/30 hover:bg-lavender active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50';
export const fieldCls = 'w-full rounded-xl border border-input bg-background/60 px-3.5 py-2.5 text-sm outline-none transition placeholder:text-muted-foreground/70 focus:border-primary focus:ring-4 focus:ring-primary/10';
