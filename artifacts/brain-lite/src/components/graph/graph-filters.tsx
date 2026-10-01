import { useEffect, useMemo, useState } from 'react';
import { validateRange } from '@/lib/graph-dates';
import { CalendarClock, CheckSquare, ChevronDown, FileText, Layers3, Lightbulb, Search, SlidersHorizontal, Sparkles, Users, X, type LucideIcon } from 'lucide-react';
import type { GraphNode } from '@workspace/api-client-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Switch } from '@/components/ui/switch';
import { btnPrimary, fieldCls } from '@/components/kit';
import { useI18n } from '@/lib/i18n';
import { graphText } from '@/lib/i18n-graph';
import { ALL_CHIPS, DEFAULT_FILTERS, initials, searchNodes, type GraphChip, type GraphFilters } from '@/lib/graph-model';
import { typeMeta } from '@/lib/memory';
import { useSpaces } from '@/hooks/use-spaces';
import { cn } from '@/lib/utils';
import type { MemoryType } from '@workspace/api-client-react';

const CHIP_ICON: Record<GraphChip, LucideIcon> = { events: CalendarClock, documents: FileText, tasks: CheckSquare, ideas: Lightbulb, people: Users, spaces: Layers3 };
const CHIP_KEY = { events: 'chipEvents', documents: 'chipDocuments', tasks: 'chipTasks', ideas: 'chipIdeas', people: 'chipPeople', spaces: 'chipSpaces' } as const;

export function GraphFilterBar({ filters, onChange, nodes, onFind }: {
  filters: GraphFilters; onChange: (f: GraphFilters) => void; nodes: GraphNode[]; onFind: (id: string) => void;
}) {
  const { lang } = useI18n();
  const tx = graphText(lang);
  const [q, setQ] = useState('');
  const [openList, setOpenList] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const spaces = useSpaces();
  const results = useMemo(() => searchNodes(nodes, q), [nodes, q]);
  // Local drafts: only complete, ordered dates ever reach the query (no 400s while typing).
  const [fromDraft, setFromDraft] = useState(filters.from);
  const [toDraft, setToDraft] = useState(filters.to);
  useEffect(() => { setFromDraft(filters.from); setToDraft(filters.to); }, [filters.from, filters.to]);
  const rangeError = validateRange(fromDraft, toDraft);
  const invalidDates = rangeError !== null;
  const setDates = (from: string, to: string) => {
    setFromDraft(from); setToDraft(to);
    if (validateRange(from, to) === null && (from !== filters.from || to !== filters.to)) onChange({ ...filters, from, to });
  };
  const moreCount = Number(!!filters.spaceId) + Number(!!filters.from) + Number(!!filters.to) + Number(filters.suggested);
  const isDefault = filters.chips.length === ALL_CHIPS.length && !moreCount;

  const toggleChip = (c: GraphChip) => {
    const has = filters.chips.includes(c);
    const next = has ? filters.chips.filter((x) => x !== c) : [...filters.chips, c];
    onChange({ ...filters, chips: next.length ? next : ALL_CHIPS });
  };
  const find = (n: GraphNode) => { onFind(n.id); setQ(n.title); setOpenList(false); (document.activeElement as HTMLElement | null)?.blur(); };

  return (
    <div className="min-w-0 space-y-2.5" data-testid="graph-filter-bar">
      <div className="flex min-w-0 gap-2">
        <form role="search" className="relative min-w-0 flex-1" onSubmit={(e) => { e.preventDefault(); if (results[0]) find(results[0]); }}>
          <Search className="pointer-events-none absolute start-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <input type="search" value={q} onChange={(e) => { setQ(e.target.value); setOpenList(true); }} onFocus={() => setOpenList(true)} onBlur={() => setTimeout(() => setOpenList(false), 150)}
            placeholder={tx.searchPlaceholder} aria-label={tx.searchLabel} enterKeyHint="search" role="combobox" aria-expanded={openList && !!q} aria-controls="graph-search-results" aria-autocomplete="list"
            className={cn(fieldCls, 'h-12 ps-10 pe-10')} data-testid="input-graph-search" />
          {q && <button type="button" onClick={() => setQ('')} aria-label={tx.clear} className="absolute end-0.5 top-1/2 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-lg text-muted-foreground hover:text-foreground" data-testid="button-graph-search-clear"><X className="h-4 w-4" /></button>}
          {openList && q.trim() && (
            <ul id="graph-search-results" role="listbox" className="absolute inset-x-0 top-[calc(100%+6px)] z-30 overflow-hidden rounded-2xl border border-gold-400/30 bg-popover p-1 lux-shadow" data-testid="list-graph-search">
              {results.length === 0 ? <li className="px-3 py-3 text-sm text-muted-foreground">{tx.searchNone}</li> : results.map((n) => {
                const Icon = n.kind === 'memory' ? (typeMeta[n.type as MemoryType]?.icon ?? FileText) : Layers3;
                return (
                  <li key={n.id} role="option" aria-selected={false}>
                    <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => find(n)} className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 py-2 text-start text-sm hover:bg-gold-soft" data-testid={`option-graph-node-${n.id}`}>
                      {n.kind === 'person'
                        ? <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-surface-alt text-[11px] font-semibold text-gold">{initials(n.title)}</span>
                        : <span className={cn('grid h-7 w-7 shrink-0 place-items-center rounded-full', n.kind === 'space' ? 'bg-gold-soft text-gold ring-2 ring-gold-400' : 'bg-card text-gold ring-1 ring-border')}><Icon className="h-3.5 w-3.5" /></span>}
                      <span className="min-w-0 flex-1 truncate">{n.title}</span>
                      <span className="text-xs text-muted-foreground">{n.kind === 'space' ? tx.kindSpace : n.kind === 'person' ? tx.kindPerson : ''}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </form>
        <Popover open={moreOpen} onOpenChange={setMoreOpen}>
          <PopoverTrigger asChild>
            <button type="button" aria-label={tx.more} className={cn('relative grid h-12 w-12 shrink-0 place-items-center rounded-xl border transition hover:bg-gold-soft', moreCount ? 'border-gold-400/60 bg-gold-soft text-gold' : 'border-input bg-card text-muted-foreground', invalidDates && 'border-destructive text-danger-ink')} data-testid="button-graph-more-filters">
              <SlidersHorizontal className="h-4 w-4" />
              {moreCount > 0 && <span className="absolute -end-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full gold-gradient px-1 text-[11px] font-semibold text-gold-ink">{moreCount}</span>}
            </button>
          </PopoverTrigger>
          <PopoverContent align={lang === 'ar' ? 'start' : 'end'} sideOffset={8} collisionPadding={16} dir={lang === 'ar' ? 'rtl' : 'ltr'} aria-label={tx.more}
            className="w-[min(360px,calc(100vw-2rem))] rounded-2xl border-gold-400/30 bg-card p-0 shadow-xl" data-testid="panel-graph-more">
            <div className="space-y-3 p-4">
              <label className="block text-xs font-medium text-muted-foreground">{tx.space}
                <div className="relative mt-1.5">
                  <select value={filters.spaceId} onChange={(e) => onChange({ ...filters, spaceId: e.target.value })} className={cn(fieldCls, 'h-12 appearance-none pe-9')} data-testid="select-graph-space">
                    <option value="">{tx.anySpace}</option>
                    {(spaces.data?.spaces ?? []).map((sp) => <option key={sp.id} value={sp.id}>{sp.name}</option>)}
                  </select>
                  <ChevronDown className="pointer-events-none absolute end-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                </div>
              </label>
              <div className="grid grid-cols-2 gap-2">
                <label className="block min-w-0 text-xs font-medium text-muted-foreground">{tx.from}<input type="date" dir="ltr" value={fromDraft} max={toDraft || undefined} onChange={(e) => setDates(e.target.value, toDraft)} aria-describedby={invalidDates ? 'graph-date-error' : undefined} aria-invalid={invalidDates} className={cn(fieldCls, 'mt-1.5 h-12 px-2 text-sm')} data-testid="input-graph-from" /></label>
                <label className="block min-w-0 text-xs font-medium text-muted-foreground">{tx.to}<input type="date" dir="ltr" value={toDraft} min={fromDraft || undefined} onChange={(e) => setDates(fromDraft, e.target.value)} aria-describedby={invalidDates ? 'graph-date-error' : undefined} aria-invalid={invalidDates} className={cn(fieldCls, 'mt-1.5 h-12 px-2 text-sm')} data-testid="input-graph-to" /></label>
              </div>
              {invalidDates && <p id="graph-date-error" role="alert" className="text-sm text-danger-ink" data-testid="error-graph-dates">{rangeError === 'partial' ? tx.datePartial : tx.dateError}</p>}
              <label className="flex min-h-12 items-center justify-between gap-3 rounded-xl border border-border bg-background/60 px-3.5">
                <span className="flex items-center gap-2 text-sm font-medium"><Sparkles className="h-4 w-4 text-gold" />{tx.suggestions}</span>
                <Switch checked={filters.suggested} onCheckedChange={(v) => onChange({ ...filters, suggested: v })} aria-label={tx.suggestions} data-testid="switch-graph-suggestions" />
              </label>
            </div>
            <div className="flex gap-2 border-t border-border p-3">
              {(!isDefault || invalidDates) && <button type="button" onClick={() => { setFromDraft(''); setToDraft(''); onChange({ ...DEFAULT_FILTERS, limit: filters.limit }); }} className="min-h-11 flex-1 rounded-xl px-3 text-sm font-medium text-gold hover:bg-gold-soft" data-testid="button-graph-clear">{tx.clear}</button>}
              <button type="button" onClick={() => { if (!invalidDates) setMoreOpen(false); }} disabled={invalidDates} className={cn(btnPrimary, 'flex-1')} data-testid="button-graph-filters-done">{tx.done}</button>
            </div>
          </PopoverContent>
        </Popover>
      </div>
      <div role="group" aria-label={tx.filterTypes} className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 [scrollbar-width:none] md:mx-0 md:px-0 [&::-webkit-scrollbar]:hidden">
        {ALL_CHIPS.map((c) => {
          const on = filters.chips.includes(c) && filters.chips.length !== ALL_CHIPS.length;
          const all = filters.chips.length === ALL_CHIPS.length;
          const Icon = CHIP_ICON[c];
          return (
            <button key={c} type="button" onClick={() => (all ? onChange({ ...filters, chips: [c] }) : toggleChip(c))} aria-pressed={on || all}
              className={cn('inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-[13px] font-medium transition active:scale-95',
                on ? 'border-gold-400/70 bg-gold-soft text-gold' : all ? 'border-border bg-card text-foreground/80 hover:border-gold-400/40' : 'border-transparent bg-muted/50 text-muted-foreground line-through decoration-gold-500/40 hover:text-foreground')}
              data-testid={`chip-graph-${c}`}>
              <Icon className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />{tx[CHIP_KEY[c]]}
            </button>
          );
        })}
      </div>
    </div>
  );
}
