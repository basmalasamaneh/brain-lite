import { Fragment } from 'react';
import { AlertTriangle, CalendarPlus, Check, History, Loader2, Pencil, Sparkles } from 'lucide-react';
import type { Memory } from '@workspace/api-client-react';
import { useI18n, type TKey } from '@/lib/i18n';
import { calendarUrl } from '@/lib/memory';
import { InfoTip, Skeleton, Surface, btnGhost, btnPrimary } from '@/components/kit';
import { CornerFlourishes } from '@/components/brand';
import { MeterFill, PulseStar } from '@/components/motion';
import { cn } from '@/lib/utils';

export function ConfidenceMeter({ value }: { value: number }) {
  const { t } = useI18n();
  const v = Math.max(0, Math.min(100, Math.round(value)));
  const tone = v >= 80 ? 'bg-success' : v >= 50 ? 'gold-gradient' : 'bg-destructive';
  return (
    <div data-testid="meter-confidence">
      <div className="mb-1.5 flex items-baseline justify-between text-xs">
        <span className="flex items-center gap-1 text-muted-foreground">{t('confidence')}<InfoTip text={t('tipConfidence')} className="h-6 w-6" /></span>
        <span className="font-display text-xl font-semibold text-gold tabular-nums" data-testid="text-confidence">{v}<span className="text-xs text-muted-foreground">/100</span></span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-surface-alt ring-1 ring-inset ring-border" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={v}>
        <MeterFill value={v} className={tone} />
      </div>
    </div>
  );
}

export function UnderstandingSkeleton() {
  const { t } = useI18n();
  return (
    <Surface className="rise pattern-star relative overflow-hidden p-6 sm:p-8" role="status" aria-live="polite" data-testid="status-understanding">
      <div className="relative flex items-center gap-3">
        <PulseStar />
        <div>
          <p className="font-display text-2xl">{t('understanding')}</p>
          <p className="text-sm text-muted-foreground">{t('understandingBody')}</p>
        </div>
      </div>
      <div className="relative mt-6 space-y-3">
        <Skeleton className="h-6 w-28 rounded-full" />
        <Skeleton className="h-4 w-full rounded-md" />
        <Skeleton className="h-4 w-4/5 rounded-md" />
        <div className="grid grid-cols-3 gap-3 pt-2">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-12" />)}
        </div>
      </div>
    </Surface>
  );
}

const str = (v: unknown) => (typeof v === 'string' || typeof v === 'number' ? String(v) : v == null ? '' : JSON.stringify(v));

export function ExtraSummary({ extra }: { extra?: Record<string, unknown> }) {
  const { t } = useI18n();
  if (!extra || !Object.keys(extra).length) return null;
  const { store, items, warranty, ...rest } = extra as Record<string, unknown>;
  const itemList = Array.isArray(items) ? items : [];
  return (
    <div className="space-y-3 text-sm" data-testid="section-extra">
      {store != null && <div><div className="text-xs text-muted-foreground">{t('extraStore')}</div><div className="font-medium">{str(store)}</div></div>}
      {items != null && !Array.isArray(items) && <div><div className="text-xs text-muted-foreground">{t('extraItems')}</div><div className="break-words font-medium">{str(items)}</div></div>}
      {itemList.length > 0 && (
        <div><div className="text-xs text-muted-foreground">{t('extraItems')}</div>
          <ul className="mt-1 space-y-1">{itemList.map((it, i) => {
            const o = it && typeof it === 'object' ? (it as Record<string, unknown>) : null;
            return <li key={i} className="flex justify-between gap-3 rounded-lg bg-muted/60 px-2.5 py-1.5"><span>{o ? str(o.name ?? o.description ?? JSON.stringify(o)) : str(it)}</span>{o && (o.price ?? o.amount) != null && <span className="tabular-nums text-muted-foreground">{str(o.price ?? o.amount)}</span>}</li>;
          })}</ul></div>
      )}
      {warranty != null && <div><div className="text-xs text-muted-foreground">{t('extraWarranty')}</div><div className="font-medium">{str(warranty)}</div></div>}
      {Object.keys(rest).length > 0 && (
        <div><div className="text-xs text-muted-foreground">{t('extraDetails')}</div>
          <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">{Object.entries(rest).map(([k, v]) => <Fragment key={k}><dt className="text-muted-foreground">{k}</dt><dd className="break-words">{str(v)}</dd></Fragment>)}</dl></div>
      )}
    </div>
  );
}

/** Status banner explaining how this memory was organized. */
export function ExtractionBanner({ m, canEdit, onConfirm, onChange, confirming }: { m: Memory; canEdit: boolean; onConfirm: () => void; onChange: () => void; confirming: boolean }) {
  const { t } = useI18n();
  const es = m.extraction_status ?? 'legacy';
  if (es === 'legacy') return (
    <div className="rise flex items-start gap-2.5 rounded-xl border border-border bg-muted/50 px-4 py-3 text-sm text-muted-foreground" data-testid="banner-legacy"><History className="mt-0.5 h-4 w-4 shrink-0" />{t('legacyNote')}</div>
  );
  if (es === 'processing') return (
    <div className="rise flex items-center gap-2.5 rounded-xl border border-gold-500/20 bg-gold-soft px-4 py-3 text-sm text-gold" data-testid="banner-processing"><Loader2 className="h-4 w-4 animate-spin" />{t('processingNote')}</div>
  );
  if (es === 'fallback') {
    const reason = (m.extraction_error ? `reason_${m.extraction_error}` : 'reason_unknown') as TKey;
    return (
      <div className="rise rounded-xl border border-warning/40 bg-warning/10 px-4 py-3.5 text-sm" role="status" data-testid="banner-fallback">
        <p className="flex items-center gap-2 font-semibold text-warning-ink"><AlertTriangle className="h-4 w-4" />{t('fallbackTitle')}</p>
        <p className="mt-1 font-medium" data-testid="text-fallback-reason">{t(reason)}</p>
        <p className="mt-0.5 text-muted-foreground">{t('fallbackSaved')}</p>
        <div className="mt-3 max-w-xs"><ConfidenceMeter value={m.confidence} /></div>
        {m.status === 'needs_review' ? (
          <>
            <p className="mt-2 text-muted-foreground">{t('fallbackReview')}</p>
            {canEdit && <div className="mt-3 flex flex-wrap gap-2"><ConfirmChange onConfirm={onConfirm} onChange={onChange} confirming={confirming} /></div>}
          </>
        ) : (
          <>
            <p className="mt-2 text-muted-foreground">{t('confirmedManual')}</p>
            {canEdit && <button onClick={onChange} className={cn(btnGhost, 'mt-3')} data-testid="button-fallback-edit"><Pencil className="h-4 w-4" />{t('edit')}</button>}
          </>
        )}
      </div>
    );
  }
  // extracted
  return (
    <div className="rise gold-frame relative rounded-2xl p-5 lux-shadow sm:p-6" data-testid="banner-extracted">
      <CornerFlourishes />
      <div className="relative grid gap-4 sm:grid-cols-[1fr_15rem] sm:items-center">
        <div>
          <p className="eyebrow flex items-center gap-2 text-gold"><Sparkles className="h-3.5 w-3.5" strokeWidth={1.5} />{t('resultTitle')}</p>
          <p className="mt-1.5 text-sm" data-testid="text-extraction-state">{m.status === 'confirmed' ? (m.confidence >= 80 ? t('confirmedAuto') : t('confirmedManual')) : t('reviewPrompt')}</p>
        </div>
        <ConfidenceMeter value={m.confidence} />
      </div>
      {m.status === 'needs_review' && canEdit && (
        <div className="relative mt-4 flex flex-wrap gap-2">
          <ConfirmChange onConfirm={onConfirm} onChange={onChange} confirming={confirming} />
        </div>
      )}
    </div>
  );
}

export function ConfirmChange({ onConfirm, onChange, confirming, id = '' }: { onConfirm: () => void; onChange: () => void; confirming: boolean; id?: string | number }) {
  const { t } = useI18n();
  const sfx = id !== '' ? `-${id}` : '';
  return (
    <>
      <button type="button" onClick={onConfirm} disabled={confirming} className={btnPrimary} data-testid={`button-confirm${sfx}`}>
        {confirming ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}{t('confirm')}
      </button>
      <button type="button" onClick={onChange} disabled={confirming} className={cn(btnGhost, 'px-4 py-2')} data-testid={`button-change${sfx}`}><Pencil className="h-4 w-4" />{t('change')}</button>
    </>
  );
}

export function CalendarLink({ m, className }: { m: Memory; className?: string }) {
  const { t } = useI18n();
  if (m.type !== 'appointment' || !m.event_date) return null;
  return (
    <a href={calendarUrl(m.id)} download={`memory-${m.id}.ics`} className={cn(btnGhost, 'w-full', className)} data-testid="link-calendar">
      <CalendarPlus className="h-4 w-4" />{t('addToCalendar')}
    </a>
  );
}
