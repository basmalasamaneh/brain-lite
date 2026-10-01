import { ChevronRight, Layers3, Maximize2, Users } from 'lucide-react';
import type { GraphEdge, GraphNode, MemoryType } from '@workspace/api-client-react';
import { Surface, TypeIcon } from '@/components/kit';
import { useI18n, type TKey } from '@/lib/i18n';
import { graphText } from '@/lib/i18n-graph';
import { clusterBySpace, initials } from '@/lib/graph-model';
import { formatDate, MEMORY_TYPES } from '@/lib/memory';
import { cn } from '@/lib/utils';

function NodeRow({ n, onSelect, selected, scopeCount }: { n: GraphNode; onSelect: (id: string) => void; selected: boolean; scopeCount: (n: GraphNode) => number }) {
  const { lang } = useI18n();
  const tx = graphText(lang);
  const nf = (x: number) => x.toLocaleString(lang === 'ar' ? 'ar' : 'en');
  return (
    <li>
      <button type="button" onClick={() => onSelect(n.id)} aria-current={selected || undefined}
        className={cn('flex min-h-12 w-full items-center gap-3 rounded-xl px-3 py-2 text-start transition hover:bg-gold-soft', selected && 'bg-gold-soft')} data-testid={`row-graph-node-${n.id}`}>
        {n.kind === 'memory' && MEMORY_TYPES.includes(n.type as MemoryType) ? <TypeIcon type={n.type as MemoryType} className="h-9 w-9" />
          : n.kind === 'person' ? <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-surface-alt text-xs font-semibold text-gold ring-1 ring-gold-500/30" aria-hidden>{initials(n.title)}</span>
          : <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-gold-soft text-gold ring-2 ring-gold-400" aria-hidden><Layers3 className="h-4 w-4" /></span>}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{n.title}</span>
          <span className="block text-xs text-muted-foreground tabular-nums">
            {n.kind === 'memory' ? `${n.date ? formatDate(n.date, lang) : tx.noDate} · ${nf(n.count)} ${tx.links}` : (typeof n.total_count === 'number' ? `${nf(Math.max(n.total_count, scopeCount(n)))} ${tx.memoriesTotal} \u00b7 ${nf(scopeCount(n))} ${tx.onThisMap}` : `${nf(scopeCount(n))} ${scopeCount(n) === 1 ? tx.memoryOne : tx.memoriesOnMap}`)}
          </span>
        </span>
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground rtl:-scale-x-100" aria-hidden />
      </button>
    </li>
  );
}

/** Screen-reader friendly equivalent of the canvas: the same nodes, grouped. */
export function GraphListView({ nodes, selectedId, onSelect, scopeCount }: { nodes: GraphNode[]; selectedId: string | null; onSelect: (id: string) => void; scopeCount: (n: GraphNode) => number }) {
  const { t, lang } = useI18n();
  const tx = graphText(lang);
  const spaces = nodes.filter((n) => n.kind === 'space');
  const people = nodes.filter((n) => n.kind === 'person').sort((a, b) => b.count - a.count);
  const byType = MEMORY_TYPES.map((ty) => ({ ty, items: nodes.filter((n) => n.kind === 'memory' && n.type === ty).sort((a, b) => String(b.date).localeCompare(String(a.date))) })).filter((g) => g.items.length);
  const Group = ({ title, items, id }: { title: string; items: GraphNode[]; id: string }) => (
    <section aria-labelledby={`g-${id}`} className="min-w-0">
      <h3 id={`g-${id}`} className="mb-1 flex items-center justify-between px-3 text-sm font-semibold"><span>{title}</span><span className="text-xs font-normal text-muted-foreground tabular-nums">{items.length.toLocaleString(lang === 'ar' ? 'ar' : 'en')}</span></h3>
      <ul className="space-y-0.5">{items.map((n) => <NodeRow key={n.id} n={n} scopeCount={scopeCount} onSelect={onSelect} selected={selectedId === n.id} />)}</ul>
    </section>
  );
  return (
    <Surface className="space-y-5 p-2 py-4 sm:p-4" data-testid="view-graph-list">
      <p className="px-3 text-sm text-muted-foreground">{tx.listIntro}</p>
      {spaces.length > 0 && <Group id="spaces" title={tx.groupSpaces} items={spaces} />}
      {people.length > 0 && <Group id="people" title={tx.groupPeople} items={people} />}
      {byType.map((g) => <Group key={g.ty} id={g.ty} title={t(`type_${g.ty}` as TKey)} items={g.items} />)}
    </Surface>
  );
}

/** Low-FPS / very large fallback: memories clustered by Space, no simulation. */
export function GraphClusterView({ nodes, edges, selectedId, onSelect, onTryGraph }: { nodes: GraphNode[]; edges: GraphEdge[]; selectedId: string | null; onSelect: (id: string) => void; onTryGraph: () => void }) {
  const { lang } = useI18n();
  const tx = graphText(lang);
  const clusters = clusterBySpace(nodes, edges);
  const people = nodes.filter((n) => n.kind === 'person').sort((a, b) => b.count - a.count).slice(0, 24);
  return (
    <div className="space-y-3" data-testid="view-graph-clustered">
      <Surface className="flex flex-wrap items-center gap-3 border-gold-400/40 bg-gold-soft/50 p-4">
        <div className="min-w-0 flex-1"><p className="font-semibold">{tx.fallbackTitle}</p><p className="text-sm text-muted-foreground">{tx.fallbackBody}</p></div>
        <button type="button" onClick={onTryGraph} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-gold-400/60 px-4 text-sm font-medium hover:bg-gold-soft" data-testid="button-graph-try-full"><Maximize2 className="h-4 w-4" />{tx.tryGraph}</button>
      </Surface>
      <div className="grid gap-3 md:grid-cols-2">
        {clusters.map((c, i) => (
          <Surface key={c.space?.id ?? 'unfiled'} className={cn('rise p-3', c.space ? 'border-gold-400/40' : '')} style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }} data-testid={`cluster-${c.space?.id ?? 'unfiled'}`}>
            <button type="button" disabled={!c.space} onClick={() => c.space && onSelect(c.space.id)} className="mb-2 flex min-h-12 w-full items-center gap-3 rounded-xl px-2 text-start enabled:hover:bg-gold-soft">
              <span className={cn('grid h-10 w-10 shrink-0 place-items-center rounded-full', c.space ? 'bg-gold-soft text-gold ring-[3px] ring-gold-400' : 'bg-muted text-muted-foreground')}><Layers3 className="h-4 w-4" /></span>
              <span className="min-w-0 flex-1"><span className="block truncate font-display text-xl">{c.space?.title ?? tx.unfiled}</span><span className="text-xs text-muted-foreground tabular-nums">{c.members.length.toLocaleString(lang === 'ar' ? 'ar' : 'en')} {tx.memoriesOnMap}</span></span>
            </button>
            <div className="flex flex-wrap gap-1.5">
              {c.members.slice(0, 40).map((m) => (
                <button key={m.id} type="button" onClick={() => onSelect(m.id)} aria-current={selectedId === m.id || undefined} className={cn('min-h-9 max-w-full truncate rounded-full border px-3 text-xs hover:border-gold-400/60', selectedId === m.id ? 'border-gold-400 bg-gold-soft' : 'border-border bg-background')} data-testid={`cluster-node-${m.id}`}>{m.title}</button>
              ))}
              {c.members.length > 40 && <span className="px-2 py-2 text-xs text-muted-foreground">+{(c.members.length - 40).toLocaleString(lang === 'ar' ? 'ar' : 'en')}</span>}
            </div>
          </Surface>
        ))}
      </div>
      {people.length > 0 && (
        <Surface className="p-3">
          <p className="mb-2 flex items-center gap-2 px-2 text-sm font-semibold"><Users className="h-4 w-4 text-gold" />{tx.groupPeople}</p>
          <div className="flex flex-wrap gap-1.5">
            {people.map((p) => <button key={p.id} type="button" onClick={() => onSelect(p.id)} className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-border bg-background pe-3 ps-1 text-xs hover:border-gold-400/60" data-testid={`cluster-person-${p.id}`}><span className="grid h-7 w-7 place-items-center rounded-full bg-surface-alt text-[10px] font-semibold text-gold">{initials(p.title)}</span>{p.title}</button>)}
          </div>
        </Surface>
      )}
    </div>
  );
}
