import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link } from 'wouter';
import { motion } from 'framer-motion';
import { BookOpen, Briefcase, Hash, Heart, Loader2, Map, Pin, Plane, Plus, Sparkles, UserRound } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { spaceText, type SpaceTextKey } from '@/lib/i18n-spaces';
import { useMemorySpaces, useSpaceAction, useSpaces, useSpaceSuggestions, type Space, type SpaceDraft } from '@/hooks/use-spaces';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { ErrorState, Skeleton, Surface, btnGhost, btnPrimary, fieldCls } from '@/components/kit';
import { cn } from '@/lib/utils';
import { Form } from '@/components/ui/form';
import { useMemorySpaceSuggestions } from '@/hooks/use-spaces';

export const spaceIcons = { briefcase: Briefcase, user: UserRound, plane: Plane, hash: Hash, heart: Heart, book: BookOpen, sparkles: Sparkles, map: Map };
const kindIcons = { project: Briefcase, person: UserRound, trip: Plane, topic: Hash };
const kindDefaults: Record<Space['kind'], Space['icon']> = { project: 'briefcase', person: 'user', trip: 'plane', topic: 'hash' };
const tones = { gold: '#b58a35', amber: '#bd7e22', bronze: '#a57448', sand: '#ad9870' };
export function SpaceIcon({ space, large = false }: { space: Pick<Space, 'icon' | 'color'>; large?: boolean }) {
  const Icon = spaceIcons[space.icon] ?? Sparkles;
  return <span style={{ color: tones[space.color], backgroundColor: `${tones[space.color]}18`, borderColor: `${tones[space.color]}66` }}
    className={cn('grid shrink-0 place-items-center rounded-2xl border', large ? 'h-16 w-16' : 'h-11 w-11')}><Icon className={large ? 'h-8 w-8' : 'h-5 w-5'} strokeWidth={1.5} /></span>;
}

export function SpaceCard({ space }: { space: Space & { memory_count: number } }) {
  const { lang } = useI18n();
  return <Link href={`/spaces/${space.id}`} className="lift block min-w-0 rounded-2xl border border-gold-400/40 bg-card p-4 soft-shadow" data-testid={`card-space-${space.id}`}>
    <div className="flex items-center justify-between gap-2"><SpaceIcon space={space} />{space.pinned && <Pin className="h-4 w-4 text-gold" aria-label={spaceText(lang, 'pinned')} />}</div>
    <h3 className="mt-3 truncate font-display text-xl">{space.name}</h3>
    <p className="mt-1 text-xs text-muted-foreground">{spaceText(lang, space.kind)} · {space.memory_count.toLocaleString(lang)} {spaceText(lang, 'memories')}</p>
    {space.description && <p className="mt-2 line-clamp-2 break-words text-sm text-muted-foreground">{space.description}</p>}
  </Link>;
}

export function SpaceForm({ space, onSaved, memoryId }: { space?: Space; onSaved: (space: Space) => void; memoryId?: number }) {
  const { lang } = useI18n();
  const s = (key: SpaceTextKey) => spaceText(lang, key);
  const form = useForm<SpaceDraft>({ defaultValues: space ? { kind: space.kind, name: space.name, description: space.description, icon: space.icon, color: space.color } : { kind: 'project', name: '', description: '', icon: 'briefcase', color: 'gold' } });
  const draft = form.watch();
  const setDraft = (next: SpaceDraft) => {
    for (const key of Object.keys(next) as (keyof SpaceDraft)[]) form.setValue(key, next[key], { shouldDirty: true });
  };
  const [created, setCreated] = useState<Space | null>(null);
  const [error, setError] = useState('');
  const action = useSpaceAction();
  const submit = async () => {
    if (action.isPending) return;
    if (!draft.name.trim()) { setError(s('required')); return; }
    setError('');
    try {
      let result = created;
      if (!result) {
        const data = { ...draft, name: draft.name.trim(), description: draft.description?.trim() || null };
        const response = await action.mutateAsync(space ? { action: 'update', id: space.id, data } : { action: 'create', data });
        if (!response?.space) throw new Error(s('error'));
        result = response.space;
        if (memoryId) setCreated(result);
      }
      if (memoryId) await action.mutateAsync({ action: 'addMemory', id: result.id, memoryId });
      onSaved(result);
    } catch (e) { setError((e as Error).message); }
  };
  return <Form {...form}><form onSubmit={form.handleSubmit(submit)} className="space-y-5">
    <fieldset disabled={action.isPending || !!created} className="space-y-5 disabled:opacity-70">
      <div className="grid grid-cols-2 gap-3" role="group" aria-label={s('new')}>
        {(Object.keys(kindIcons) as Space['kind'][]).map((kind) => {
          const Icon = kindIcons[kind];
          return <button key={kind} type="button" data-testid={`button-space-kind-${kind}`} aria-pressed={draft.kind === kind} onClick={() => setDraft({ ...draft, kind, icon: kindDefaults[kind] })}
            className={cn('flex min-h-24 flex-col items-center justify-center gap-2 rounded-2xl border p-3 transition active:scale-95', draft.kind === kind ? 'border-gold-500 bg-gold-soft text-gold' : 'border-border bg-card')}>
            <Icon className="h-8 w-8" strokeWidth={1.5} /><span>{s(kind)}</span>
          </button>;
        })}
      </div>
      <label className="block space-y-2"><span className="text-sm font-medium">{s('name')}</span><input required maxLength={120} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} className={fieldCls} data-testid="input-space-name" /></label>
      <label className="block space-y-2"><span className="text-sm font-medium">{s('description')}</span><textarea data-testid="input-space-description" rows={3} maxLength={2000} value={draft.description ?? ''} onChange={(e) => setDraft({ ...draft, description: e.target.value })} className={fieldCls} /></label>
      <div><p className="mb-2 text-sm font-medium">{s('icon')}</p><div className="grid grid-cols-4 gap-2">
        {(Object.keys(spaceIcons) as Space['icon'][]).map((icon) => { const Icon = spaceIcons[icon]; return <button key={icon} type="button" data-testid={`button-space-icon-${icon}`} aria-label={s(icon)} aria-pressed={draft.icon === icon} onClick={() => setDraft({ ...draft, icon })}
          className={cn('grid min-h-12 place-items-center rounded-xl border', draft.icon === icon ? 'border-gold-500 bg-gold-soft text-gold' : 'border-border')}><Icon className="h-5 w-5" /></button>; })}
      </div></div>
      <div><p className="mb-2 text-sm font-medium">{s('color')}</p><div className="grid grid-cols-4 gap-2">
        {(Object.keys(tones) as Space['color'][]).map((color) => <button key={color} type="button" data-testid={`button-space-color-${color}`} aria-pressed={draft.color === color} onClick={() => setDraft({ ...draft, color })}
          className={cn('flex min-h-14 min-w-0 flex-col items-center justify-center gap-1 rounded-xl border text-xs', draft.color === color ? 'border-gold-500 bg-gold-soft' : 'border-border')}><span style={{ backgroundColor: tones[color] }} className="h-4 w-4 rounded-full" />{s(color)}</button>)}
      </div></div>
    </fieldset>
    {error && <p role="alert" className="text-sm text-danger-ink">{error}</p>}
    <button disabled={action.isPending} type="submit" className={cn(btnPrimary, 'w-full')} data-testid="button-save-space">{action.isPending && <Loader2 className="h-4 w-4 animate-spin" />}{memoryId ? s('createAdd') : space ? s('save') : s('create')}</button>
  </form></Form>;
}

export function SpaceEditor({ open, onOpenChange, space, onSaved }: { open: boolean; onOpenChange: (open: boolean) => void; space?: Space; onSaved?: (space: Space) => void }) {
  const { lang } = useI18n();
  return <Sheet open={open} onOpenChange={onOpenChange}><SheetContent side="bottom" className="space-sheet" closeLabel={spaceText(lang, 'cancel')}>
    <SheetHeader className="mb-5 text-start"><SheetTitle className="font-display text-2xl">{spaceText(lang, space ? 'edit' : 'new')}</SheetTitle><SheetDescription>{spaceText(lang, 'lead')}</SheetDescription></SheetHeader>
    {open && <SpaceForm key={`${space?.id ?? 'new'}-${space?.updated_at ?? ''}`} space={space} onSaved={(result) => { onOpenChange(false); onSaved?.(result); }} />}
  </SheetContent></Sheet>;
}

export function HomeSpaces() {
  const { lang } = useI18n();
  const query = useSpaces();
  const pinned = query.data?.spaces.filter((space) => space.pinned) ?? [];
  return <section className="mb-8 min-w-0" data-testid="section-home-spaces">
    <div className="mb-3 flex items-center justify-between gap-3"><h2 className="font-display text-2xl">{spaceText(lang, 'pinned')}</h2><Link data-testid="link-home-spaces" href="/spaces" className="flex min-h-11 items-center text-sm font-medium text-gold">{spaceText(lang, 'back')}</Link></div>
    {query.isLoading ? <div className="flex gap-3 overflow-hidden"><Skeleton className="h-40 w-48 shrink-0 rounded-2xl" /><Skeleton className="h-40 w-48 shrink-0 rounded-2xl" /></div>
      : query.isError ? <ErrorState onRetry={() => query.refetch()} />
      : pinned.length ? <div className="flex snap-x gap-3 overflow-x-auto pb-3">{pinned.map((space) => <div key={space.id} className="w-48 shrink-0 snap-start"><SpaceCard space={space} /></div>)}</div>
      : <Surface className="p-4 text-sm text-muted-foreground">{spaceText(lang, query.data?.spaces.length ? 'noPinned' : 'empty')}</Surface>}
    <SpaceSuggestions />
  </section>;
}

export function SpaceSuggestions() {
  const { lang } = useI18n();
  const query = useSpaceSuggestions();
  const action = useSpaceAction();
  if (query.isLoading) return <Skeleton className="mt-3 h-20 rounded-2xl" />;
  if (query.isError) return <div className="mt-3"><ErrorState onRetry={() => query.refetch()} /></div>;
  if (!query.data?.suggestions.length) return null;
  return <div className="mt-4 space-y-3"><h3 className="text-sm font-medium text-gold">{spaceText(lang, 'createSuggested')}</h3>{query.data.suggestions.map((suggestion) => <motion.div layout key={suggestion.id} className="rounded-2xl border border-gold-400/40 bg-gold-soft/30 p-4">
    <p className="font-display text-lg">{lang === 'ar' ? `إنشاء مساحة لـ «${suggestion.name}»؟` : `Create a Space for “${suggestion.name}”?`}</p>
    <p className="mt-1 break-words text-sm text-muted-foreground">{suggestion.reason}</p>
    <div className="mt-3 flex flex-wrap gap-2"><button data-testid={`button-space-suggestion-confirm-${suggestion.id}`} disabled={action.isPending} onClick={() => action.mutate({ action: 'confirmSuggestion', id: suggestion.id })} className={btnPrimary}>{spaceText(lang, 'create')}</button>
      <button data-testid={`button-space-suggestion-dismiss-${suggestion.id}`} disabled={action.isPending} onClick={() => action.mutate({ action: 'dismissSuggestion', id: suggestion.id })} className={btnGhost}>{spaceText(lang, 'dismissSpace')}</button></div>
  </motion.div>)}</div>;
}

export function MemorySpaces({ id }: { id: number }) {
  const { lang } = useI18n();
  const query = useMemorySpaces(id);
  const spaces = useSpaces();
  const suggestions = useMemorySpaceSuggestions(id);
  const action = useSpaceAction();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const attached = new Set(query.data?.spaces.map((space) => space.id));
  const matches = spaces.data?.spaces.filter((space) => space.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())) ?? [];
  return <Surface className="p-4">
    <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-medium text-gold">{spaceText(lang, 'spaces')}</h2><button data-testid="button-add-to-space" className={btnGhost} onClick={() => { setOpen(true); setCreating(false); setSearch(''); }}><Plus className="h-4 w-4" />{spaceText(lang, 'addTo')}</button></div>
    {query.isLoading ? <Skeleton className="mt-2 h-8 rounded-full" /> : query.isError ? <ErrorState onRetry={() => query.refetch()} /> : <div className="mt-2 flex flex-wrap gap-2">{query.data?.spaces.map((space) => <Link data-testid={`link-memory-space-${space.id}`} key={space.id} href={`/spaces/${space.id}`} className="flex min-h-11 max-w-full items-center gap-2 rounded-full border border-gold-400/40 bg-gold-soft px-4 text-sm text-gold"><span className="truncate">{space.name}</span></Link>)}</div>}
    {suggestions.isLoading ? <Skeleton className="mt-3 h-16 rounded-xl" /> : suggestions.isError ? <div className="mt-3"><ErrorState onRetry={() => suggestions.refetch()} /></div> : suggestions.data?.suggestions.map((suggestion) => <MemorySpaceSuggestion key={suggestion.space.id} {...suggestion} memoryId={id} />)}
    <SpaceSuggestions />
    <Sheet open={open} onOpenChange={setOpen}><SheetContent side="bottom" className="space-sheet" closeLabel={spaceText(lang, 'cancel')}>
      <SheetHeader className="mb-5 text-start"><SheetTitle>{spaceText(lang, creating ? 'createAdd' : 'addTo')}</SheetTitle><SheetDescription>{spaceText(lang, 'lead')}</SheetDescription></SheetHeader>
      {creating ? <><button data-testid="button-cancel-create-space" onClick={() => setCreating(false)} className={cn(btnGhost, 'mb-4')}>{spaceText(lang, 'cancel')}</button><SpaceForm memoryId={id} onSaved={() => setOpen(false)} /></> : <div className="space-y-3">
        <input data-testid="input-search-spaces" className={fieldCls} aria-label={spaceText(lang, 'search')} placeholder={spaceText(lang, 'search')} value={search} onChange={(e) => setSearch(e.target.value)} />
        {spaces.isLoading ? <Skeleton className="h-24 rounded-xl" /> : spaces.isError ? <ErrorState onRetry={() => spaces.refetch()} /> : matches.length === 0 ? <p className="py-4 text-sm text-muted-foreground">{spaceText(lang, 'noSearch')}</p> : matches.map((space) => <button key={space.id} data-testid={`button-add-memory-space-${space.id}`} disabled={action.isPending || attached.has(space.id)} onClick={() => action.mutate({ action: 'addMemory', id: space.id, memoryId: id }, { onSuccess: () => setOpen(false) })}
          className="flex min-h-14 w-full min-w-0 items-center gap-3 rounded-xl border border-gold-400/30 p-3 text-start disabled:opacity-50"><SpaceIcon space={space} /><span className="min-w-0 flex-1 truncate">{space.name}</span>{attached.has(space.id) && <span className="text-xs text-gold">{spaceText(lang, 'added')}</span>}</button>)}
        <button data-testid="button-create-add-space" onClick={() => setCreating(true)} className={cn(btnPrimary, 'w-full')}><Plus className="h-4 w-4" />{spaceText(lang, 'new')}</button>
      </div>}
    </SheetContent></Sheet>
  </Surface>;
}

function MemorySpaceSuggestion({ memoryId, space, reason, confidence }: { memoryId: number; space: Space; reason: string; confidence: number }) {
  const { lang } = useI18n();
  const action = useSpaceAction();
  return <div className="mt-3 space-y-3 rounded-xl border border-gold-400/40 bg-gold-soft/30 p-4" data-testid={`suggestion-memory-space-${space.id}`}>
    <Link href={`/spaces/${space.id}`} className="flex min-h-11 items-center gap-3"><SpaceIcon space={space} /><span className="min-w-0 truncate font-medium">{space.name}</span></Link>
    <p className="break-words text-sm text-muted-foreground">{reason}</p>
    <p className="text-xs text-gold">{confidence.toLocaleString(lang)}%</p>
    <div className="flex gap-2"><button data-testid={`button-confirm-memory-space-${space.id}`} className={btnPrimary} disabled={action.isPending} onClick={() => action.mutate({ action: 'addMemory', id: space.id, memoryId })}>{spaceText(lang, 'add')}</button>
      <button data-testid={`button-dismiss-memory-space-${space.id}`} className={btnGhost} disabled={action.isPending} onClick={() => action.mutate({ action: 'dismissMemory', id: space.id, memoryId })}>{spaceText(lang, 'dismiss')}</button></div>
  </div>;
}