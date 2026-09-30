import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Link, useLocation } from 'wouter';
import { Info, Link2, Loader2, Plus, Search, Sparkles, Trash2 } from 'lucide-react';
import { useAuth } from '@workspace/replit-auth-web';
import { useListMemories, type Memory } from '@workspace/api-client-react';
import { useI18n } from '@/lib/i18n';
import { connectionText, type ConnectionTextKey } from '@/lib/i18n-connections';
import { useConnectionAction, useConnectionSettings, useConnectionSuggestions, useDeferredConnections, useMemoryConnections, type Connection } from '@/hooks/use-connections';
import { useRelatedMemories } from '@/hooks/use-semantic-search';
import { useToast } from '@/hooks/use-toast';
import { Skeleton, Surface, TypeChip, btnDanger, btnGhost, btnPrimary, fieldCls } from '@/components/kit';
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { cn } from '@/lib/utils';

const sheetCls = 'connection-sheet mx-auto max-h-[85dvh] w-full max-w-2xl overflow-y-auto rounded-t-3xl border-gold-400/50 bg-card pb-[calc(1.5rem+env(safe-area-inset-bottom))]';
function useCopy() {
  const { lang } = useI18n();
  return { lang, c: (key: ConnectionTextKey) => connectionText(lang, key), n: (value: number) => value.toLocaleString(lang === 'ar' ? 'ar' : 'en') };
}
function haptic() { try { navigator.vibrate?.(12); } catch { /* Unsupported browsers simply skip haptics. */ } }

function MiniMemory({ memory, compact = false }: { memory: Memory; compact?: boolean }) {
  return <Link href={`/memories/${memory.id}`} data-testid={`link-connection-memory-${memory.id}`}
    className={cn('block min-h-11 min-w-0 rounded-xl border border-gold-400/30 bg-background/80 p-3 transition hover:border-gold-500', !compact && 'flex-1')}>
    <TypeChip type={memory.type} />
    <h3 dir="auto" className="mt-2 line-clamp-2 break-words text-sm font-semibold">{memory.title}</h3>
    <p dir="auto" className="mt-1 line-clamp-2 break-words text-xs text-muted-foreground">{memory.summary || memory.raw_text}</p>
  </Link>;
}

function LoadError({ retry }: { retry: () => void }) {
  const { c } = useCopy();
  return <div role="alert" className="space-y-2 rounded-xl border border-destructive/30 p-4" data-testid="error-connections">
    <p className="text-sm text-danger-ink">{c('loadError')}</p>
    <button onClick={retry} className={btnGhost} data-testid="button-retry-connections">{c('retry')}</button>
  </div>;
}

type DialogState = { kind: 'why' | 'remove' | 'merge'; connection: Connection } | null;
function ConnectionDialogs({ state, close }: { state: DialogState; close: () => void }) {
  const { c, lang, n } = useCopy();
  const action = useConnectionAction();
  const [, navigate] = useLocation();
  const [keepId, setKeepId] = useState<number | null>(null);
  useEffect(() => { setKeepId(null); action.reset(); }, [state?.connection.id, state?.kind]);
  const link = state?.connection;
  const reason = link?.reason || c(link?.source === 'manual' ? 'manual' : 'noReason');
  return <>
    <Sheet open={state?.kind === 'why'} onOpenChange={(open) => { if (!open) close(); }}>
      <SheetContent side="bottom" className={sheetCls} closeLabel={c('close')} dir={lang === 'ar' ? 'rtl' : 'ltr'}>
        <SheetHeader className="text-start sm:text-start">
          <SheetTitle className="font-display text-2xl">{c('why')}</SheetTitle>
          <SheetDescription dir="auto" className="break-words text-start">{reason}</SheetDescription>
        </SheetHeader>
        {link && <div className="mt-5 space-y-3" data-testid={`text-connection-confidence-${link.id}`}>
          <p className="text-sm font-medium">{c(link.relation_type)}</p>
          <p className="text-sm">{c('confidence')}: {link.confidence == null ? c('unknownConfidence') : `${n(link.confidence)}%`}</p>
          {link.confidence != null && <div className="h-2 overflow-hidden rounded-full bg-muted"><div className="gold-gradient h-full" style={{ width: `${Math.max(0, Math.min(100, link.confidence))}%` }} /></div>}
        </div>}
        <SheetClose className={cn(btnGhost, 'mt-5 w-full')} data-testid="button-close-connection-why">{c('close')}</SheetClose>
      </SheetContent>
    </Sheet>
    <AlertDialog open={state?.kind === 'remove' || state?.kind === 'merge'} onOpenChange={(open) => { if (!open && !action.isPending) close(); }}>
      <AlertDialogContent dir={lang === 'ar' ? 'rtl' : 'ltr'} className="max-h-[90dvh] overflow-y-auto">
        <AlertDialogHeader className="text-start sm:text-start">
          <AlertDialogTitle>{c(state?.kind === 'merge' ? 'mergeTitle' : 'removeTitle')}</AlertDialogTitle>
          <AlertDialogDescription>{c(state?.kind === 'merge' ? 'mergeBody' : 'removeBody')}</AlertDialogDescription>
        </AlertDialogHeader>
        {state?.kind === 'merge' && link && <fieldset className="space-y-2" disabled={action.isPending}>
          <legend className="mb-2 text-sm font-medium">{c('keep')}</legend>
          {[link.memory_a, link.memory_b].map((memory) => <label key={memory.id} className={cn('flex min-h-11 cursor-pointer items-start gap-3 rounded-xl border p-3', keepId === memory.id ? 'border-gold-500 bg-gold-soft' : 'border-border')}>
            <input type="radio" name="connection-keeper" value={memory.id} checked={keepId === memory.id} onChange={() => setKeepId(memory.id)} className="mt-1 accent-[hsl(var(--gold))]" data-testid={`radio-merge-keeper-${memory.id}`} />
            <span className="min-w-0"><span dir="auto" className="block break-words font-medium">{memory.title}</span><span dir="auto" className="mt-1 block max-h-36 overflow-y-auto whitespace-pre-wrap break-words text-xs text-muted-foreground">{memory.raw_text || memory.summary}</span></span>
          </label>)}
        </fieldset>}
        {action.isError && <p role="alert" className="text-sm text-danger-ink">{c('error')}</p>}
        <AlertDialogFooter className="gap-2">
          <AlertDialogCancel disabled={action.isPending} data-testid="button-cancel-connection-destructive">{c('cancel')}</AlertDialogCancel>
          <button className={btnDanger} data-testid="button-confirm-connection-destructive" disabled={action.isPending || (state?.kind === 'merge' && keepId == null)}
            onClick={() => {
              if (!link || action.isPending) return;
              if (state?.kind === 'merge' && keepId != null) action.mutate({ action: 'merge', id: link.id, keepId }, { onSuccess: () => { close(); navigate(`/memories/${keepId}`); } });
              else if (state?.kind === 'remove') action.mutate({ action: 'remove', id: link.id }, { onSuccess: close });
            }}>
            {action.isPending && <Loader2 className="h-4 w-4 animate-spin" />}{c(state?.kind === 'merge' ? 'mergeConfirm' : 'remove')}
          </button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </>;
}

function WhyButton({ connection, open }: { connection: Connection; open: (state: DialogState) => void }) {
  const { c } = useCopy();
  return <button onClick={() => open({ kind: 'why', connection })} className="inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-xs font-semibold text-gold hover:bg-gold-soft" data-testid={`button-why-connection-${connection.id}`} aria-label={`${c('why')} ${connection.memory_a.title} — ${connection.memory_b.title}`}><Info className="h-4 w-4" />{c('why')}</button>;
}

export function ConnectionDeck() {
  const { c, lang, n } = useCopy();
  const query = useConnectionSuggestions();
  const deferred = useDeferredConnections();
  const action = useConnectionAction();
  const { toast } = useToast();
  const reduced = useReducedMotion();
  const [dialog, setDialog] = useState<DialogState>(null);
  const [handled, setHandled] = useState<number[]>([]);
  const [direction, setDirection] = useState(1);
  const [drag, setDrag] = useState(0);
  const start = useRef<{ x: number; y: number; axis: 'x' | 'y' | null } | null>(null);
  const suppressClick = useRef(false);
  const suggestions = query.data?.suggestions ?? [];
  const available = suggestions.filter((s) => !deferred.ids.includes(s.id) && !handled.includes(s.id));
  const current = available[0];
  const progress = useRef({ ids: [] as number[], owner: '' });
  const { user } = useAuth();
  if (progress.current.owner !== user?.id) { progress.current = { ids: [], owner: user?.id ?? '' }; }
  for (const s of suggestions) if (!progress.current.ids.includes(s.id)) progress.current.ids.push(s.id);
  useEffect(() => { if (query.data && suggestions.length === 0) progress.current.ids = []; }, [query.data, suggestions.length]);
  const decide = (choice: 'confirm' | 'dismiss' | 'later') => {
    if (!current || action.isPending) return;
    setDirection((choice === 'dismiss' ? -1 : 1) * (lang === 'ar' ? -1 : 1));
    haptic();
    if (choice === 'later') {
      deferred.defer(current.id);
      toast({ title: c('laterToast') });
    } else action.mutate({ action: choice, id: current.id }, { onSuccess: () => setHandled((old) => [...old, current.id]) });
  };
  return <section className="min-w-0" data-testid="section-connection-deck">
    {query.isLoading ? <Skeleton className="h-64 rounded-2xl" /> : query.isError ? <LoadError retry={() => query.refetch()} /> : !current ? <Surface className="p-5">
      <h2 className="flex items-center gap-2 font-display text-xl"><Link2 className="h-5 w-5 text-gold" />{c('possible')}</h2>
      <p className="mt-2 text-sm text-muted-foreground" data-testid="text-connections-empty">{c(suggestions.some((s) => deferred.ids.includes(s.id)) ? 'deferred' : 'empty')}</p>
      {suggestions.some((s) => deferred.ids.includes(s.id)) && <button className={cn(btnGhost, 'mt-3')} data-testid="button-review-deferred-connections" onClick={() => { deferred.reset(); progress.current.ids = available.map((s) => s.id); toast({ title: c('review') }); }}>{c('review')}</button>}
    </Surface> : <div className="relative isolate pb-2">
      {available.length > 1 && <div aria-hidden className="absolute inset-x-3 bottom-0 top-3 -z-10 rounded-2xl border border-gold-400/40 bg-gold-soft" />}
      <div className="overflow-hidden rounded-2xl bg-gradient-to-br from-gold-300 via-gold-500 to-gold-300/30 p-[1px]">
        <AnimatePresence initial={false} mode="wait">
          <motion.div key={current.id} className="rounded-[15px] bg-card p-4 sm:p-5" data-testid={`card-connection-suggestion-${current.id}`}
            initial={reduced ? false : { opacity: 0, x: direction * 32 }} animate={{ opacity: 1, x: drag }} exit={reduced ? { opacity: 0 } : { opacity: 0, x: direction * 80 }} transition={{ duration: reduced ? 0 : 0.18 }}>
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="font-display text-xl">{c('possible')}</h2>
              <span className="shrink-0 text-xs text-muted-foreground tabular-nums" aria-live="polite" data-testid="text-connection-deck-counter">{n(progress.current.ids.indexOf(current.id) + 1)} {c('of')} {n(progress.current.ids.length)}</span>
            </div>
            <div style={{ touchAction: 'pan-y' }} data-testid="swipe-connection"
              onClickCapture={(e) => { if (suppressClick.current) { e.preventDefault(); e.stopPropagation(); suppressClick.current = false; } }}
              onPointerDown={(e) => { suppressClick.current = false; if (e.pointerType !== 'mouse') start.current = { x: e.clientX, y: e.clientY, axis: null }; }}
              onPointerMove={(e) => {
                const s = start.current;
                if (!s || action.isPending) return;
                const dx = e.clientX - s.x, dy = e.clientY - s.y;
                if (!s.axis && Math.max(Math.abs(dx), Math.abs(dy)) > 12) {
                  s.axis = Math.abs(dx) > Math.abs(dy) * 1.5 ? 'x' : 'y';
                  if (s.axis === 'x') { e.currentTarget.setPointerCapture(e.pointerId); suppressClick.current = true; }
                }
                if (s.axis === 'x') setDrag(Math.max(-60, Math.min(60, dx)));
              }}
              onPointerUp={(e) => {
                const s = start.current; start.current = null; setDrag(0);
                if (!s || s.axis !== 'x') return;
                const dx = e.clientX - s.x, dy = e.clientY - s.y;
                if (Math.abs(dx) >= 65 && Math.abs(dx) > Math.abs(dy) * 1.5) decide(dx * (lang === 'ar' ? -1 : 1) > 0 ? 'confirm' : 'dismiss');
              }}
              onPointerCancel={() => { start.current = null; setDrag(0); }}>
              <div className="grid grid-cols-[minmax(0,1fr)_1.5rem_minmax(0,1fr)] items-center gap-2">
                <MiniMemory memory={current.memory_a} compact />
                <Link2 className="connection-link h-5 w-5 text-gold" aria-hidden />
                <MiniMemory memory={current.memory_b} compact />
              </div>
              <p className="sr-only">{c(lang === 'ar' ? 'swipeRtl' : 'swipe')}</p>
            </div>
            <div className="mt-2 flex items-start gap-2">
              <p dir="auto" className="min-w-0 flex-1 pt-3 text-sm leading-relaxed line-clamp-2">{current.reason || c(current.source === 'manual' ? 'manual' : 'noReason')}</p>
              <WhyButton connection={current} open={setDialog} />
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2">
              <button onClick={() => decide('confirm')} disabled={action.isPending} aria-busy={action.isPending} className={cn(btnPrimary, 'min-w-0 px-2 text-sm')} data-testid="button-connect-suggestion">{action.isPending ? <><Loader2 className="h-4 w-4 animate-spin" /><span className="sr-only">{c('connect')}</span></> : c('connect')}</button>
              <button onClick={() => decide('dismiss')} disabled={action.isPending} className={cn(btnGhost, 'px-2 text-sm')} data-testid="button-dismiss-suggestion">{c('dismiss')}</button>
              <button onClick={() => decide('later')} disabled={action.isPending} className={cn(btnGhost, 'border-transparent px-2 text-sm')} data-testid="button-later-suggestion">{c('later')}</button>
            </div>
            {current.relation_type === 'duplicate' && <button className={cn(btnGhost, 'mt-3 w-full')} onClick={() => setDialog({ kind: 'merge', connection: current })} disabled={action.isPending} data-testid={`button-merge-connection-${current.id}`}>{c('merge')}</button>}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>}
    <ConnectionDialogs state={dialog} close={() => setDialog(null)} />
  </section>;
}

function ManualLinkSheet({ id, excluded, open, close }: { id: number; excluded: number[]; open: boolean; close: () => void }) {
  const { c, lang } = useCopy();
  const { user } = useAuth();
  const action = useConnectionAction();
  const [input, setInput] = useState('');
  const [search, setSearch] = useState('');
  useEffect(() => { if (open) { setInput(''); setSearch(''); action.reset(); } }, [open, id]);
  useEffect(() => { const timer = setTimeout(() => setSearch(input.trim()), 350); return () => clearTimeout(timer); }, [input]);
  const params = search ? { search } : undefined;
  const list = useListMemories(params, { query: { queryKey: ['/api/memories', user?.id, 'connection-picker', params], enabled: open && !!user }, request: { credentials: 'include' } });
  const semantic = useRelatedMemories(search, {}, open);
  const results = Array.from(new Map([...(list.data ?? []), ...(semantic.data?.memories ?? [])].map((m) => [m.id, m])).values()).filter((m) => m.id !== id && !excluded.includes(m.id));
  const loading = search !== input.trim() || list.isLoading || (!!search && semantic.isLoading);
  return <Sheet open={open} onOpenChange={(o) => { if (!o && !action.isPending) close(); }}>
    <SheetContent side="bottom" className={sheetCls} closeLabel={c('close')} dir={lang === 'ar' ? 'rtl' : 'ltr'}>
      <SheetHeader className="text-start sm:text-start">
        <SheetTitle className="font-display text-2xl">{c('link')}</SheetTitle>
        <SheetDescription>{c('searchHint')}</SheetDescription>
      </SheetHeader>
      <label className="relative mt-5 block">
        <span className="sr-only">{c('search')}</span><Search className="pointer-events-none absolute start-3 top-3.5 h-4 w-4 text-gold" />
        <input value={input} onChange={(e) => setInput(e.target.value)} className={cn(fieldCls, 'ps-10')} placeholder={c('search')} data-testid="input-link-memory-search" />
      </label>
      <div className="mt-4 max-h-[45dvh] space-y-2 overflow-y-auto" aria-live="polite">
        {(list.isError || (search && semantic.isError)) && <LoadError retry={() => { list.refetch(); if (search) semantic.refetch(); }} />}
        {loading ? <><Skeleton className="h-20" /><Skeleton className="h-20" /></> : !results.length && !list.isError && !semantic.isError ? <p className="py-5 text-sm text-muted-foreground" data-testid="text-link-memory-empty">{c('noResults')}</p>
          : !loading && results.map((memory) => <button key={memory.id} onClick={() => {
            if (memory.id === id || action.isPending) return;
            action.mutate({ action: 'link', memoryId: id, otherId: memory.id }, { onSuccess: close });
          }} disabled={action.isPending} className="flex min-h-11 w-full items-center gap-3 rounded-xl border border-border p-3 text-start hover:border-gold-400 hover:bg-gold-soft" data-testid={`button-link-memory-${memory.id}`}>
            <div className="min-w-0 flex-1"><TypeChip type={memory.type} /><p dir="auto" className="mt-1 break-words text-sm font-medium">{memory.title}</p><p dir="auto" className="line-clamp-2 break-words text-xs text-muted-foreground">{memory.summary || memory.raw_text}</p></div>
            {action.isPending && action.variables?.action === 'link' && action.variables.otherId === memory.id ? <Loader2 className="h-5 w-5 shrink-0 animate-spin text-gold" /> : <Plus className="h-5 w-5 shrink-0 text-gold" />}
          </button>)}
      </div>
      {action.isError && <p role="alert" className="mt-3 text-sm text-danger-ink">{c('error')}</p>}
      <button disabled={action.isPending} onClick={close} className={cn(btnGhost, 'mt-4 w-full')} data-testid="button-close-link-memory">{c('cancel')}</button>
    </SheetContent>
  </Sheet>;
}

export function MemoryConnections({ id }: { id: number }) {
  const { c } = useCopy();
  const query = useMemoryConnections(id);
  const action = useConnectionAction();
  const [dialog, setDialog] = useState<DialogState>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const confirmed = query.data?.confirmed ?? [], suggested = query.data?.suggested ?? [];
  const other = (connection: Connection) => connection.memory_a.id === id ? connection.memory_b : connection.memory_a;
  return <section className="mt-8 min-w-0" data-testid="section-memory-connections">
    <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
      <h2 className="flex items-center gap-2 font-display text-2xl"><Link2 className="h-5 w-5 text-gold" />{c('connected')}</h2>
      <button onClick={() => setPickerOpen(true)} className={btnGhost} data-testid="button-link-memory"><Plus className="h-4 w-4" />{c('link')}</button>
    </div>
    {query.isLoading ? <Skeleton className="h-48" /> : query.isError ? <LoadError retry={() => query.refetch()} /> : <>
      {!confirmed.length ? <Surface className="p-4 text-sm text-muted-foreground" data-testid="text-memory-connections-empty">{c('none')}</Surface>
        : <div className="flex max-w-full snap-x gap-3 overflow-x-auto pb-3" data-testid="list-confirmed-connections">
          {confirmed.map((connection) => <Surface key={connection.id} className="w-[min(17rem,85vw)] shrink-0 snap-start p-3" data-testid={`card-confirmed-connection-${connection.id}`}>
            <span className="mb-2 inline-block rounded-full bg-gold-soft px-2.5 py-1 text-xs font-medium text-gold">{c(connection.relation_type)}</span>
            <MiniMemory memory={other(connection)} compact />
            <p dir="auto" className="mt-3 line-clamp-2 break-words text-sm text-muted-foreground">{connection.reason || c(connection.source === 'manual' ? 'manual' : 'noReason')}</p>
            <div className="mt-2 flex items-center justify-between gap-2">
              <WhyButton connection={connection} open={setDialog} />
              <button onClick={() => setDialog({ kind: 'remove', connection })} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl text-danger-ink hover:bg-destructive/10" aria-label={c('remove')} data-testid={`button-remove-connection-${connection.id}`}><Trash2 className="h-4 w-4" /></button>
            </div>
            {connection.relation_type === 'duplicate' && <button className={cn(btnGhost, 'w-full')} onClick={() => setDialog({ kind: 'merge', connection })} data-testid={`button-merge-connection-${connection.id}`}>{c('merge')}</button>}
          </Surface>)}
        </div>}
      {suggested.length > 0 && <div className="mt-5 space-y-3">
        <h3 className="font-display text-xl">{c('suggested')}</h3>
        {suggested.map((connection) => <Surface key={connection.id} className="p-4" data-testid={`card-detail-suggestion-${connection.id}`}>
          <span className="mb-2 inline-block rounded-full bg-gold-soft px-2.5 py-1 text-xs text-gold">{c(connection.relation_type)}</span>
          <MiniMemory memory={other(connection)} compact />
          <div className="mt-2 flex items-start gap-2"><p dir="auto" className="min-w-0 flex-1 pt-3 text-sm text-muted-foreground">{connection.reason || c('noReason')}</p><WhyButton connection={connection} open={setDialog} /></div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button className={btnPrimary} disabled={action.isPending} onClick={() => { haptic(); action.mutate({ action: 'confirm', id: connection.id }); }} data-testid={`button-connect-detail-${connection.id}`}>{action.isPending && action.variables?.action === 'confirm' && action.variables.id === connection.id && <Loader2 className="h-4 w-4 animate-spin" />}{c('connect')}</button>
            <button className={btnGhost} disabled={action.isPending} onClick={() => action.mutate({ action: 'dismiss', id: connection.id })} data-testid={`button-dismiss-detail-${connection.id}`}>{c('dismiss')}</button>
            {connection.relation_type === 'duplicate' && <button className={btnGhost} disabled={action.isPending} onClick={() => setDialog({ kind: 'merge', connection })} data-testid={`button-merge-connection-${connection.id}`}>{c('merge')}</button>}
          </div>
        </Surface>)}
      </div>}
    </>}
    <ManualLinkSheet id={id} excluded={confirmed.map((link) => other(link).id)} open={pickerOpen} close={() => setPickerOpen(false)} />
    <ConnectionDialogs state={dialog} close={() => setDialog(null)} />
  </section>;
}

export function ConnectionSettingsSection() {
  const { c, n } = useCopy();
  const query = useConnectionSettings();
  const action = useConnectionAction();
  return <Surface className="rise p-5 sm:p-6" data-testid="section-connection-settings">
    <h2 className="mb-5 flex items-center gap-3 font-display text-2xl"><Link2 className="h-6 w-6 text-gold" />{c('title')}</h2>
    {query.isLoading ? <Skeleton className="h-24" /> : query.isError ? <LoadError retry={() => query.refetch()} /> : query.data && <>
      <div className="flex items-center justify-between gap-4">
        <label htmlFor="automatic-connections" className="min-w-0 cursor-pointer"><span className="block font-medium">{c('automatic')}</span><span className="mt-1 block text-sm text-muted-foreground">{c('automaticHint')}</span></label>
        <button id="automatic-connections" role="switch" aria-checked={query.data.automatic} aria-label={c('automatic')} disabled={action.isPending}
          onClick={() => action.mutate({ action: 'settings', automatic: !query.data.automatic })} data-testid="switch-automatic-connections"
          className="flex min-h-11 min-w-14 shrink-0 items-center justify-center rounded-xl disabled:opacity-50">
          <span aria-hidden className={cn('inline-flex h-7 w-12 items-center rounded-full p-1 transition-colors', query.data.automatic ? 'bg-gold-500' : 'bg-input')}>
            <span className={cn('h-5 w-5 rounded-full bg-card shadow transition-transform', query.data.automatic && 'translate-x-5 rtl:-translate-x-5')} />
          </span>
        </button>
      </div>
      <p className="mt-5 text-sm tabular-nums" data-testid="text-confirmed-connections-count">{n(query.data.confirmed_count)} {c('confirmedCount')}</p>
      <button onClick={() => action.mutate({ action: 'discover' })} disabled={action.isPending} className={cn(btnGhost, 'mt-3 w-full sm:w-auto')} data-testid="button-find-connections">
        {action.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4 text-gold" />}{c('find')}
      </button>
    </>}
  </Surface>;
}