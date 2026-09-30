import { useState } from 'react';
import { Link, useLocation, useParams } from 'wouter';
import { ArrowLeft, Calendar, Check, ExternalLink, Loader2, Lock, Paperclip, Pencil, Trash2, Users, Wallet, Tag } from 'lucide-react';
import { useAuth } from '@workspace/replit-auth-web';
import { getGetMemoryQueryKey, useDeleteMemory, useGetMemory, useUpdateMemory, type Memory, type MemoryStatus, type MemoryType, type MemoryUpdate } from '@workspace/api-client-react';
import { useI18n, usePageTitle, type TKey } from '@/lib/i18n';
import { MEMORY_TYPES, fileUrl, formatAmount, formatDate, useInvalidateMemories } from '@/lib/memory';
import { useToast } from '@/hooks/use-toast';
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { EmptyState, ErrorState, SampleBanner, StatusPill, Surface, TypeChip, btnGhost, btnPrimary, fieldCls } from '@/components/kit';
import { cn } from '@/lib/utils';

type Draft = { title: string; raw_text: string; summary: string; type: MemoryType; status: MemoryStatus; event_date: string; amount: string; currency: string; people: string; tags: string };

const toDraft = (m: Memory): Draft => ({
  title: m.title, raw_text: m.raw_text, summary: m.summary ?? '', type: m.type, status: m.status,
  event_date: m.event_date ? m.event_date.slice(0, 10) : '', amount: m.amount == null ? '' : String(m.amount),
  currency: m.currency ?? '', people: m.people.join(', '), tags: m.tags.join(', '),
});
const splitList = (s: string) => s.split(/[,،]/).map((x) => x.trim()).filter(Boolean).slice(0, 50);

function Field({ label, children, hint, error }: { label: string; children: React.ReactNode; hint?: string; error?: string | null }) {
  return (
    <label className="block">
      <span className="mb-1.5 flex items-baseline gap-2 text-sm font-medium">{label}{hint && <span className="text-xs font-normal text-muted-foreground">{hint}</span>}</span>
      {children}
      {error && <span className="mt-1 block text-xs text-destructive" role="alert">{error}</span>}
    </label>
  );
}

function Meta({ icon: Icon, label, children }: { icon: typeof Calendar; label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3 py-3">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0"><div className="text-xs text-muted-foreground">{label}</div><div className="mt-0.5 text-sm font-medium">{children}</div></div>
    </div>
  );
}

export default function MemoryDetailPage() {
  const { t, lang } = useI18n();
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const valid = Number.isInteger(id) && id > 0;
  const { isAuthenticated, login } = useAuth();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const invalidate = useInvalidateMemories();
  const q = useGetMemory(id, { query: { enabled: valid, queryKey: getGetMemoryQueryKey(id) } });
  const update = useUpdateMemory();
  const del = useDeleteMemory();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [errors, setErrors] = useState<Partial<Record<keyof Draft, TKey>>>({});
  const [saveError, setSaveError] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleteError, setDeleteError] = useState(false);
  const m = q.data;
  usePageTitle(m?.title ?? t('memoriesTitle'));

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => (d ? { ...d, [k]: v } : d));

  const send = (data: MemoryUpdate, after?: () => void) => {
    setSaveError(false);
    update.mutate({ id, data }, {
      onSuccess: () => { invalidate(id); after?.(); toast({ title: t('updatedToast') }); },
      onError: () => setSaveError(true),
    });
  };

  const save = () => {
    if (!draft || update.isPending) return;
    const e: typeof errors = {};
    if (!draft.title.trim()) e.title = 'errTitleRequired';
    else if (draft.title.trim().length > 200) e.title = 'errTitleLong';
    const amt = draft.amount.trim() === '' ? null : Number(draft.amount);
    if (amt !== null && (isNaN(amt) || amt < 0)) e.amount = 'errAmount';
    if (draft.currency.trim().length > 10) e.currency = 'errCurrency';
    setErrors(e);
    if (Object.keys(e).length) return;
    send({
      title: draft.title.trim(), raw_text: draft.raw_text, summary: draft.summary.trim() || null, type: draft.type, status: draft.status,
      event_date: draft.event_date || null, amount: amt, currency: draft.currency.trim().toUpperCase() || null,
      people: splitList(draft.people), tags: splitList(draft.tags),
    }, () => setDraft(null));
  };

  const doDelete = () => {
    setDeleteError(false);
    del.mutate({ id }, {
      onSuccess: () => { invalidate(); setConfirmOpen(false); toast({ title: t('deletedToast') }); navigate('/memories'); },
      onError: () => setDeleteError(true),
    });
  };

  const back = (
    <Link href="/memories" className="group mb-6 inline-flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground" data-testid="link-back">
      <ArrowLeft className="h-4 w-4 transition group-hover:-translate-x-0.5 rtl:-scale-x-100 rtl:group-hover:translate-x-0.5" />{t('back')}
    </Link>
  );

  if (!valid) return <>{back}<EmptyState title={t('notFound')} /></>;
  if (q.isLoading) return (
    <>{back}<Surface className="space-y-4 p-8"><div className="h-6 w-24 animate-pulse rounded-full bg-muted" /><div className="h-9 w-2/3 animate-pulse rounded bg-muted" /><div className="h-4 w-full animate-pulse rounded bg-muted" /><div className="h-4 w-4/5 animate-pulse rounded bg-muted" /></Surface></>
  );
  if (q.isError || !m) {
    const status = (q.error as { status?: number } | null)?.status;
    return <>{back}{status === 404 ? <EmptyState title={t('notFound')} /> : <ErrorState onRetry={() => q.refetch()} />}</>;
  }

  const amount = formatAmount(m.amount, m.currency, lang);
  const isImage = m.file_path && !/\.pdf$/i.test(m.file_path);

  return (
    <>
      <SampleBanner />
      {back}
      {draft ? (
        <form onSubmit={(e) => { e.preventDefault(); save(); }} className="rise space-y-5" noValidate>
          <Surface className="grid gap-5 p-5 sm:grid-cols-2 sm:p-7">
            <div className="sm:col-span-2"><Field label={t('titleLabel')} error={errors.title && t(errors.title)}>
              <input value={draft.title} onChange={(e) => set('title', e.target.value)} maxLength={200} className={fieldCls} data-testid="input-edit-title" /></Field></div>
            <Field label={t('fType')}>
              <select value={draft.type} onChange={(e) => set('type', e.target.value as MemoryType)} className={fieldCls} data-testid="select-type">
                {MEMORY_TYPES.map((ty) => <option key={ty} value={ty}>{t(`type_${ty}` as TKey)}</option>)}
              </select></Field>
            <Field label={t('fStatus')}>
              <div className="flex gap-2">
                {(['needs_review', 'confirmed'] as MemoryStatus[]).map((s) => (
                  <button type="button" key={s} onClick={() => set('status', s)} data-testid={`button-status-${s}`}
                    className={cn('flex-1 rounded-xl border px-3 py-2.5 text-sm font-medium transition active:scale-95', draft.status === s ? (s === 'confirmed' ? 'border-green bg-green/10 text-green' : 'border-amber bg-amber/10 text-amber') : 'border-input')}>
                    {t(`status_${s}` as TKey)}
                  </button>
                ))}
              </div></Field>
            <Field label={t('fDate')}><input type="date" value={draft.event_date} onChange={(e) => set('event_date', e.target.value)} className={fieldCls} data-testid="input-date" /></Field>
            <div className="grid grid-cols-[1fr_7rem] gap-3">
              <Field label={t('fAmount')} error={errors.amount && t(errors.amount)}><input inputMode="decimal" value={draft.amount} onChange={(e) => set('amount', e.target.value)} className={fieldCls} data-testid="input-amount" /></Field>
              <Field label={t('fCurrency')} error={errors.currency && t(errors.currency)}><input value={draft.currency} onChange={(e) => set('currency', e.target.value)} maxLength={10} placeholder="USD" className={cn(fieldCls, 'uppercase')} data-testid="input-currency" /></Field>
            </div>
            <Field label={t('fPeople')} hint={t('commaHint')}><input value={draft.people} onChange={(e) => set('people', e.target.value)} className={fieldCls} data-testid="input-people" /></Field>
            <Field label={t('fTags')} hint={t('commaHint')}><input value={draft.tags} onChange={(e) => set('tags', e.target.value)} className={fieldCls} data-testid="input-tags" /></Field>
            <div className="sm:col-span-2"><Field label={t('fSummary')}><textarea value={draft.summary} onChange={(e) => set('summary', e.target.value)} maxLength={5000} rows={3} className={fieldCls} data-testid="input-summary" /></Field></div>
            <div className="sm:col-span-2"><Field label={t('fRaw')}><textarea value={draft.raw_text} onChange={(e) => set('raw_text', e.target.value)} maxLength={100000} rows={8} className={cn(fieldCls, 'leading-relaxed')} data-testid="input-raw" /></Field></div>
          </Surface>
          {saveError && <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">{t('errSave')}</p>}
          <div className="flex justify-end gap-3">
            <button type="button" onClick={() => { setDraft(null); setErrors({}); setSaveError(false); }} disabled={update.isPending} className={btnGhost} data-testid="button-cancel-edit">{t('cancel')}</button>
            <button type="submit" disabled={update.isPending} className={btnPrimary} data-testid="button-save-edit">{update.isPending && <Loader2 className="h-4 w-4 animate-spin" />}{update.isPending ? t('saving') : t('saveChanges')}</button>
          </div>
        </form>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[1fr_18rem]">
          <Surface className="rise p-6 sm:p-9">
            <div className="flex flex-wrap items-center gap-2"><TypeChip type={m.type} size="lg" /><StatusPill status={m.status} /></div>
            <h1 className="font-display mt-5 text-2xl font-bold leading-tight sm:text-3xl" data-testid="text-memory-title">{m.title}</h1>
            <p className={cn('mt-4 text-lg leading-relaxed', !m.summary && 'text-muted-foreground italic text-base')} data-testid="text-summary">{m.summary || t('noSummary')}</p>
            <div className="my-6 h-px bg-border" />
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t('fRaw')}</h2>
            <p className="whitespace-pre-wrap leading-relaxed text-foreground/85" data-testid="text-raw">{m.raw_text || t('noText')}</p>
            {m.file_path && (
              <div className="mt-6 rounded-xl border border-border bg-background/60 p-3">
                {isImage && <img src={fileUrl(m.file_path)} alt="" className="mb-3 max-h-80 w-full rounded-lg object-contain" onError={(e) => { e.currentTarget.style.display = 'none'; }} />}
                <a href={fileUrl(m.file_path)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline" data-testid="link-file">
                  <Paperclip className="h-4 w-4" />{t('openFile')}<ExternalLink className="h-3.5 w-3.5" />
                </a>
              </div>
            )}
          </Surface>

          <div className="space-y-4">
            <Surface className="rise divide-y divide-border px-5 py-2" style={{ animationDelay: '80ms' }}>
              <Meta icon={Calendar} label={t('fDate')}>{m.event_date ? formatDate(m.event_date, lang) : <span className="text-muted-foreground">{t('none')}</span>}</Meta>
              <Meta icon={Wallet} label={t('fAmount')}>{amount || <span className="text-muted-foreground">{t('none')}</span>}</Meta>
              <Meta icon={Users} label={t('fPeople')}>{m.people.length ? <div className="flex flex-wrap gap-1.5">{m.people.map((p) => <span key={p} className="rounded-full bg-lavender px-2 py-0.5 text-xs text-primary">{p}</span>)}</div> : <span className="text-muted-foreground">{t('none')}</span>}</Meta>
              <Meta icon={Tag} label={t('fTags')}>{m.tags.length ? <div className="flex flex-wrap gap-1.5">{m.tags.map((p) => <span key={p} className="rounded-md bg-muted px-2 py-0.5 text-xs">#{p}</span>)}</div> : <span className="text-muted-foreground">{t('none')}</span>}</Meta>
              <div className="py-3 text-xs text-muted-foreground">{t('created')} {formatDate(m.created_at, lang)}</div>
            </Surface>

            {isAuthenticated ? (
              <div className="rise space-y-2" style={{ animationDelay: '140ms' }}>
                {m.status === 'needs_review' && (
                  <button onClick={() => send({ status: 'confirmed' })} disabled={update.isPending} className={cn(btnGhost, 'w-full border-green/40 text-green hover:bg-green/10')} data-testid="button-confirm">
                    {update.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}{t('markConfirmed')}
                  </button>
                )}
                <button onClick={() => { setDraft(toDraft(m)); setErrors({}); }} className={cn(btnPrimary, 'w-full')} data-testid="button-edit"><Pencil className="h-4 w-4" />{t('edit')}</button>
                <button onClick={() => { setDeleteError(false); setConfirmOpen(true); }} className={cn(btnGhost, 'w-full text-destructive hover:border-destructive/40 hover:bg-destructive/10')} data-testid="button-delete"><Trash2 className="h-4 w-4" />{t('delete')}</button>
                {saveError && <p role="alert" className="text-sm text-destructive">{t('errSave')}</p>}
              </div>
            ) : (
              <div className="space-y-2">
                <button onClick={login} className={cn(btnPrimary, 'w-full')} data-testid="button-login-edit"><Lock className="h-4 w-4" />{t('loginToEdit')}</button>
                <button onClick={login} className={cn(btnGhost, 'w-full')} data-testid="button-login-delete"><Lock className="h-4 w-4" />{t('loginToDelete')}</button>
              </div>
            )}
          </div>
        </div>
      )}

      <AlertDialog open={confirmOpen} onOpenChange={(o) => { if (!del.isPending) setConfirmOpen(o); }}>
        <AlertDialogContent className="rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display">{t('deleteTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('deleteBody')}</AlertDialogDescription>
          </AlertDialogHeader>
          {deleteError && <p role="alert" className="text-sm text-destructive">{t('errSave')}</p>}
          <AlertDialogFooter className="gap-2">
            <AlertDialogCancel disabled={del.isPending} className="rounded-xl" data-testid="button-cancel-delete">{t('cancel')}</AlertDialogCancel>
            <button onClick={doDelete} disabled={del.isPending} className="inline-flex items-center justify-center gap-2 rounded-xl bg-destructive px-4 py-2 text-sm font-semibold text-destructive-foreground transition hover:brightness-110 disabled:opacity-50" data-testid="button-confirm-delete">
              {del.isPending && <Loader2 className="h-4 w-4 animate-spin" />}{del.isPending ? t('deleting') : t('delete')}
            </button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
