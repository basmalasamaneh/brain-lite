import { useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useLocation, useParams } from 'wouter';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowLeft, Archive, Loader2, Pencil, Pin, Plus, Trash2 } from 'lucide-react';
import { useAuth } from '@workspace/replit-auth-web';
import { useAskBrain, type Memory } from '@workspace/api-client-react';
import { useSpace, useSpaceAction, useSpaceMemories, type SpaceFilter } from '@/hooks/use-spaces';
import { useI18n, usePageTitle } from '@/lib/i18n';
import { spaceText, type SpaceTextKey } from '@/lib/i18n-spaces';
import { formatDate, formatDateTime } from '@/lib/memory';
import { SpaceEditor, SpaceIcon } from '@/components/spaces';
import { EmptyState, ErrorState, MemoryCard, Skeleton, Surface, TypeChip, btnDanger, btnGhost, btnPrimary, fieldCls } from '@/components/kit';
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { cn } from '@/lib/utils';
import { Form } from '@/components/ui/form';

type SourceMemory = Memory & { connected?: boolean; connected_via?: number | null; connection_hop?: number; source_kind?: string };
function SpaceAsk({ id }: { id: string }) {
  const { lang } = useI18n();
  const { user } = useAuth();
  const owner = useRef(user?.id);
  owner.current = user?.id;
  const s = (key: SpaceTextKey) => spaceText(lang, key);
  const ask = useAskBrain();
  const form = useForm({ defaultValues: { question: '' } });
  const question = form.watch('question');
  const [answer, setAnswer] = useState<{ answer: string; sources: SourceMemory[] } | null>(null);
  const [error, setError] = useState('');
  const send = () => {
    if (!question.trim() || ask.isPending) return;
    setError('');
    const ownerAtSend = user?.id;
    let timezone = 'UTC';
    try { timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { /* Preserve the existing Ask UTC fallback. */ }
    const data = { question: question.trim(), language: lang, timezone, space_id: id };
    ask.mutate({ data }, {
      onSuccess: (res) => { if (owner.current === ownerAtSend) { setAnswer(res); form.reset(); } },
      onError: (err) => { if (owner.current === ownerAtSend) setError(err instanceof Error ? err.message : s('error')); },
    });
  };
  return <Surface className="space-y-3 p-4 sm:p-5" data-testid="section-ask-space">
    <h2 className="font-display text-xl">{s('ask')}</h2><p className="text-xs text-muted-foreground">{s('askHint')}</p>
    <Form {...form}><form onSubmit={form.handleSubmit(send)} className="flex gap-2">
      <input {...form.register('question')} maxLength={1000} placeholder={s('question')} aria-label={s('ask')} className={cn(fieldCls, 'min-w-0 flex-1')} data-testid="input-ask-space" />
      <button disabled={!question.trim() || ask.isPending} className={cn(btnPrimary, 'shrink-0 px-3')} data-testid="button-ask-space">{ask.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : s('send')}</button>
    </form></Form>
    {ask.isPending && <div role="status" className="space-y-2"><Skeleton className="h-4 w-full" /><Skeleton className="h-4 w-2/3" /></div>}
    {error && <p role="alert" className="break-words text-sm text-danger-ink">{error}</p>}
    {answer && <div className="space-y-3"><p className="whitespace-pre-wrap break-words leading-relaxed">{answer.answer}</p><p className="text-xs font-medium text-gold">{s('sources')}</p>
      {answer.sources.length ? <div className="grid gap-2 sm:grid-cols-2">{answer.sources.map((memory) => <Link data-testid={`link-space-ask-source-${memory.id}`} key={memory.id} href={`/memories/${memory.id}`} className="min-w-0 rounded-xl border border-gold-400/30 p-3">
        <TypeChip type={memory.type} /><p className="mt-2 truncate text-sm font-medium">{memory.title}</p>
        {memory.summary && <p className="mt-1 line-clamp-2 break-words text-xs text-muted-foreground">{memory.summary}</p>}
        {(memory.connected || memory.connected_via != null || (memory.connection_hop ?? 0) > 0 || memory.source_kind === 'connected') && <p className="mt-2 text-xs text-gold">{s('connected')}</p>}
      </Link>)}</div> : <p className="text-xs text-muted-foreground">{s('noSources')}</p>}
    </div>}
  </Surface>;
}

const filters: { value: SpaceFilter; key: SpaceTextKey }[] = [{ value: 'all', key: 'all' }, { value: 'events', key: 'events' }, { value: 'documents', key: 'documents' }, { value: 'tasks', key: 'taskFilter' }, { value: 'notes', key: 'notes' }, { value: 'links', key: 'links' }];

export default function SpaceDetailPage() {
  const { id = '' } = useParams<{ id: string }>();
  const { lang } = useI18n();
  const s = (key: SpaceTextKey) => spaceText(lang, key);
  const [, navigate] = useLocation();
  const query = useSpace(id);
  const [filter, setFilter] = useState<SpaceFilter>('all');
  const memories = useSpaceMemories(id, filter);
  const action = useSpaceAction();
  const [editing, setEditing] = useState(false);
  const [confirmation, setConfirmation] = useState<'space' | number | null>(null);
  usePageTitle(query.data?.space.name ?? s('spaces'));
  const back = <Link data-testid="link-back-spaces" href="/spaces" className="mb-5 inline-flex min-h-11 items-center gap-2 text-sm text-muted-foreground"><ArrowLeft className="h-4 w-4 rtl:-scale-x-100" />{s('back')}</Link>;
  if (query.isLoading) return <>{back}<Skeleton className="mb-5 h-48 rounded-2xl" /><Skeleton className="h-72 rounded-2xl" /></>;
  if (query.isError || !query.data) return <>{back}{(query.error as { status?: number })?.status === 404 ? <EmptyState title={lang === 'ar' ? 'المساحة غير موجودة' : 'Space not found'} /> : <ErrorState onRetry={() => query.refetch()} />}</>;
  const { space, counts, upcoming, open_tasks, profile } = query.data;
  const whatNext = [...upcoming, ...open_tasks.filter((m) => !upcoming.some((u) => u.id === m.id))];
  const groups = new Map<string, Memory[]>();
  [...(memories.data?.memories ?? [])].sort((a, b) => (b.event_date ?? b.created_at).localeCompare(a.event_date ?? a.created_at)).forEach((memory) => {
    const date = new Date(memory.event_date ?? memory.created_at);
    const month = Number.isNaN(date.getTime()) ? s('unknown') : date.toLocaleDateString(lang, { month: 'long', year: 'numeric' });
    groups.set(month, [...(groups.get(month) ?? []), memory]);
  });
  const remove = () => {
    if (confirmation === null) return;
    const deletingSpace = confirmation === 'space';
    action.mutate(confirmation === 'space' ? { action: 'delete', id } : { action: 'dismissMemory', id, memoryId: confirmation }, {
      onSuccess: () => { setConfirmation(null); if (deletingSpace) navigate('/spaces'); },
    });
  };
  return <div className="min-w-0 space-y-5">
    {back}
    <Surface className="gold-frame space-y-4 p-5">
      <div className="flex items-start gap-4"><SpaceIcon space={space} large /><div className="min-w-0 flex-1">
        <h1 className="break-words font-display text-3xl sm:text-4xl" data-testid="text-space-name">{space.name}</h1>
        <div className="mt-2 flex flex-wrap gap-2"><span className="rounded-full bg-gold-soft px-3 py-1 text-xs text-gold">{s(space.kind)}</span>{space.archived && <span className="rounded-full bg-muted px-3 py-1 text-xs">{s('archived')}</span>}</div>
      </div></div>
      {space.description && <p className="break-words text-sm text-muted-foreground">{space.description}</p>}
      <p className="text-sm font-medium text-gold" data-testid="text-space-counts">{counts.memories.toLocaleString(lang)} {s('memories')} · {counts.upcoming.toLocaleString(lang)} {s('upcoming')} · {counts.tasks.toLocaleString(lang)} {s('tasks')}</p>
      <div className="flex flex-wrap gap-2">
        <Link data-testid="link-capture-into-space" href={`/capture?space_id=${encodeURIComponent(id)}`} className={btnPrimary}><Plus className="h-4 w-4" />{s('capture')}</Link>
        <button data-testid="button-edit-space" className={btnGhost} onClick={() => setEditing(true)}><Pencil className="h-4 w-4" />{s('edit')}</button>
        <button data-testid="button-pin-space" disabled={action.isPending} className={cn(btnGhost, space.pinned && 'text-gold')} onClick={() => action.mutate({ action: 'update', id, data: { pinned: !space.pinned } })}><Pin className="h-4 w-4" />{s(space.pinned ? 'unpin' : 'pin')}</button>
        <button data-testid="button-archive-space" disabled={action.isPending} className={btnGhost} onClick={() => action.mutate({ action: 'update', id, data: { archived: !space.archived } })}><Archive className="h-4 w-4" />{s(space.archived ? 'restore' : 'archive')}</button>
        <button data-testid="button-delete-space" className={cn(btnGhost, 'text-danger-ink')} onClick={() => setConfirmation('space')}><Trash2 className="h-4 w-4" />{s('delete')}</button>
      </div>
    </Surface>
    {space.kind === 'person' && <Surface className="space-y-3 p-5">
      <h2 className="font-display text-xl">{s('profile')}</h2>
      <p className="text-sm"><span className="text-muted-foreground">{s('last')}: </span>{profile?.last_interaction ? formatDate(profile.last_interaction, lang) : s('unknown')}</p>
      <p className="rounded-xl bg-gold-soft/40 p-3 text-xs leading-relaxed text-muted-foreground">{s('privacy')}</p>
      {profile?.items.map((item) => <div key={item.id} className="flex min-w-0 items-start gap-2 border-t border-border pt-3">
        <Link data-testid={`link-space-profile-source-${item.id}`} href={`/memories/${item.memory_id}`} className="min-w-0 flex-1 rounded-lg py-2"><p className="break-words text-sm">{item.value}</p><p className="mt-1 text-xs text-gold">{s('sources')} · #{item.memory_id}</p></Link>
        <button data-testid={`button-remove-profile-item-${item.id}`} disabled={action.isPending} title={s('removeItem')} aria-label={s('removeItem')} className="grid h-11 w-11 shrink-0 place-items-center rounded-xl text-muted-foreground hover:bg-gold-soft" onClick={() => action.mutate({ action: 'hideProfileItem', id, itemId: item.id })}><Trash2 className="h-4 w-4" /></button>
      </div>)}
    </Surface>}
    <Surface className="space-y-3 p-5"><h2 className="font-display text-xl">{s('next')}</h2>
      {whatNext.length ? whatNext.map((memory) => <Link data-testid={`link-space-next-${memory.id}`} key={memory.id} href={`/memories/${memory.id}`} className="flex min-h-14 min-w-0 items-center gap-3 rounded-xl border border-gold-400/20 p-3">
        <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{memory.title}</p><p className="mt-1 text-xs text-gold">{memory.event_date ? formatDateTime(memory.event_date, lang) : s('taskFilter')}</p></div><TypeChip type={memory.type} />
      </Link>) : <p className="text-sm text-muted-foreground">{s('noNext')}</p>}
    </Surface>
    <SpaceAsk key={id} id={id} />
    <section className="min-w-0">
      <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label={s('memories')}>{filters.map((f) => <button data-testid={`button-space-filter-${f.value}`} key={f.value} aria-pressed={filter === f.value} className={cn(btnGhost, 'px-3', filter === f.value && 'border-gold-500 bg-gold-soft text-gold')} onClick={() => setFilter(f.value)}>{s(f.key)}</button>)}</div>
      {memories.isLoading ? <div className="space-y-3"><Skeleton className="h-24 rounded-2xl" /><Skeleton className="h-24 rounded-2xl" /></div>
        : memories.isError ? <ErrorState onRetry={() => memories.refetch()} />
        : groups.size === 0 ? <EmptyState title={s(filter === 'all' ? 'noMemories' : 'noFilter')} />
        : <AnimatePresence mode="wait"><motion.div key={`${id}-${filter}`} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-5">{[...groups].map(([month, items]) => <div key={month}>
          <h3 className="mb-3 border-s-2 border-gold-400 ps-3 text-sm font-semibold text-gold">{month}</h3>
          <div className="space-y-3">{items.map((memory) => <div key={memory.id}><MemoryCard memory={memory} /><button data-testid={`button-remove-space-memory-${memory.id}`} onClick={() => setConfirmation(memory.id)} className="mt-1 flex min-h-11 items-center gap-2 px-3 text-xs text-muted-foreground hover:text-danger-ink"><Trash2 className="h-3.5 w-3.5" />{s('remove')}</button></div>)}</div>
        </div>)}</motion.div></AnimatePresence>}
    </section>
    {!!memories.data?.suggestions.length && <section className="space-y-3"><h2 className="font-display text-2xl">{s('suggested')}</h2>{memories.data.suggestions.map(({ memory, reason, confidence }) => <Surface key={memory.id} className="space-y-3 p-4">
      <Link data-testid={`link-space-suggested-memory-${memory.id}`} href={`/memories/${memory.id}`} className="block min-h-11 break-words font-medium">{memory.title}</Link><p className="break-words text-sm text-muted-foreground">{reason}</p><p className="text-xs text-gold">{confidence.toLocaleString(lang)}%</p>
      <div className="flex flex-wrap gap-2"><button data-testid={`button-add-space-suggestion-${memory.id}`} disabled={action.isPending} className={btnPrimary} onClick={() => action.mutate({ action: 'addMemory', id, memoryId: memory.id })}>{s('add')}</button><button data-testid={`button-dismiss-space-suggestion-${memory.id}`} disabled={action.isPending} className={btnGhost} onClick={() => action.mutate({ action: 'dismissMemory', id, memoryId: memory.id })}>{s('dismiss')}</button></div>
    </Surface>)}</section>}
    <SpaceEditor open={editing} onOpenChange={setEditing} space={space} />
    <AlertDialog open={confirmation !== null} onOpenChange={(open) => { if (!open && !action.isPending) setConfirmation(null); }}>
      <AlertDialogContent className="rounded-2xl"><AlertDialogHeader><AlertDialogTitle>{s(confirmation === 'space' ? 'delete' : 'remove')}</AlertDialogTitle><AlertDialogDescription>{s(confirmation === 'space' ? 'deleteBody' : 'removeBody')}</AlertDialogDescription></AlertDialogHeader>
        <AlertDialogFooter className="gap-2"><AlertDialogCancel data-testid="button-cancel-space-removal" disabled={action.isPending}>{s('cancel')}</AlertDialogCancel><button data-testid="button-confirm-space-removal" onClick={remove} disabled={action.isPending} className={btnDanger}>{action.isPending && <Loader2 className="h-4 w-4 animate-spin" />}{s(confirmation === 'space' ? 'delete' : 'remove')}</button></AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>;
}