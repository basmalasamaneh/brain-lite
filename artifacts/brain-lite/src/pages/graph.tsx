import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useSearch } from 'wouter';
import { AnimatePresence } from 'framer-motion';
import { AlertTriangle, ArrowLeft, Crosshair, List, Minus, Network, Plus, Share2, X } from 'lucide-react';
import { useAuth } from '@workspace/replit-auth-web';
import type { GraphNode } from '@workspace/api-client-react';
import { useI18n, usePageTitle } from '@/lib/i18n';
import { graphText } from '@/lib/i18n-graph';
import { visibleScopeIds, applyKindChips, buildInsights, DEFAULT_FILTERS, neighborhood, personKey, takeNewMemoryIds, type GraphFilters } from '@/lib/graph-model';
import { useLifeGraph, usePrefersReducedMotion } from '@/hooks/use-graph';
import { useToast } from '@/hooks/use-toast';
import { GraphCanvas, type GraphCanvasHandle } from '@/components/graph/graph-canvas';
import { GraphFilterBar } from '@/components/graph/graph-filters';
import { GraphInsights } from '@/components/graph/graph-insights';
import { GraphLegend } from '@/components/graph/graph-legend';
import { GraphNodeSheet } from '@/components/graph/graph-sheet';
import { GraphClusterView, GraphListView } from '@/components/graph/graph-list';
import { GraphEmpty, GraphError, GraphNoMatch, GraphSkeleton, ShareSnapshotDialog } from '@/components/graph/graph-states';
import { cn } from '@/lib/utils';

const LARGE_GRAPH = 220;
const EMPTY_SET = new Set<string>();
const ctrlBtn = 'grid h-11 w-11 place-items-center rounded-full border border-gold-400/40 bg-card/95 text-foreground lux-shadow backdrop-blur transition hover:border-gold-500 hover:text-gold active:scale-95';

export default function GraphPage() {
  const { lang } = useI18n();
  const tx = graphText(lang);
  usePageTitle(tx.title);
  const { user } = useAuth();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const search = useSearch();
  const reduced = usePrefersReducedMotion();
  const canvasRef = useRef<GraphCanvasHandle>(null);

  const [view, setView] = useState<'graph' | 'list'>(() => (new URLSearchParams(search).get('view') === 'list' ? 'list' : 'graph'));
  const [filters, setFilters] = useState<GraphFilters>(DEFAULT_FILTERS);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [poorPerf, setPoorPerf] = useState(false);
  const [forceGraph, setForceGraph] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [newIds, setNewIds] = useState<Set<string>>(EMPTY_SET);

  const invalidDates = !!(filters.from && filters.to && filters.from > filters.to);
  const graph = useLifeGraph(filters, !invalidDates);
  const data = graph.data;

  const kindView = useMemo(() => (data ? applyKindChips(data, filters.chips) : { nodes: [], edges: [] }), [data, filters.chips]);
  const visible = useMemo(() => {
    if (!focusId || !kindView.nodes.some((n) => n.id === focusId)) return kindView;
    const keep = neighborhood(kindView.edges, focusId, 2);
    return { nodes: kindView.nodes.filter((n) => keep.has(n.id)), edges: kindView.edges.filter((e) => keep.has(e.source) && keep.has(e.target)) };
  }, [kindView, focusId]);
  const byId = useMemo(() => new Map(visible.nodes.map((n) => [n.id, n])), [visible.nodes]);
  const selected = selectedId ? byId.get(selectedId) ?? null : null;
  const highlight = useMemo(() => (selectedId && byId.has(selectedId) ? neighborhood(visible.edges, selectedId, 1) : null), [selectedId, byId, visible.edges]);
  const nf = useCallback((n: number) => n.toLocaleString(lang === 'ar' ? 'ar' : 'en'), [lang]);
  const insights = useMemo(() => buildInsights(visible.nodes, visible.edges, tx, nf), [visible, tx, nf]);

  // Newly saved memories pulse once; seen set is owner-scoped in this browser.
  const seenFor = useRef<typeof data>(undefined);
  useEffect(() => {
    if (!data || seenFor.current === data) return;
    seenFor.current = data;
    setNewIds(takeNewMemoryIds(user?.id, data.nodes));
  }, [data, user?.id]);

  useEffect(() => { if (selectedId && !byId.has(selectedId)) setSelectedId(null); }, [selectedId, byId]);
  useEffect(() => { if (focusId && data && !kindView.nodes.some((n) => n.id === focusId)) setFocusId(null); }, [focusId, data, kindView.nodes]);

  const fallback = !forceGraph && (poorPerf || visible.nodes.length > LARGE_GRAPH);
  const canvasMode = view === 'graph' && !fallback;

  // Smooth zoom-to-node after the sheet has mounted (so the anchor accounts for it).
  useEffect(() => {
    if (!selectedId || !canvasMode) return;
    const id = requestAnimationFrame(() => canvasRef.current?.zoomToNode(selectedId));
    return () => cancelAnimationFrame(id);
  }, [selectedId, canvasMode]);

  const select = useCallback((id: string | null) => setSelectedId(id), []);
  const pickInsight = (id: string) => { setSelectedId(id); if (view === 'list' || fallback) document.getElementById('graph-top')?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth' }); };
  const focus = (n: GraphNode) => { setFocusId(n.id); setSelectedId(n.id); setTimeout(() => canvasRef.current?.recenter(), reduced ? 0 : 700); };
  const exitFocus = () => { setFocusId(null); setTimeout(() => canvasRef.current?.recenter(), reduced ? 0 : 700); };
  const open = (n: GraphNode) => {
    if (n.kind === 'memory' && n.memory_id != null) navigate(`/memories/${n.memory_id}`);
    else if (n.kind === 'space' && n.space_id) navigate(`/spaces/${n.space_id}`);
    else if (n.kind === 'person') navigate(`/memories?person=${encodeURIComponent(personKey(n))}`);
  };
  const ask = (n: GraphNode) => {
    const ids = visibleScopeIds(n, visible.nodes);
    if (!ids.length) return;
    const label = n.kind === 'memory' ? n.title : n.kind === 'space' ? tx.scopeSpaceLabel(n.title, ids.length) : tx.scopePersonLabel(n.title, ids.length);
    navigate(`/ask?memory_ids=${ids.join(',')}&scope_label=${encodeURIComponent(label)}`);
  };
  const clearFilters = () => { setFilters({ ...DEFAULT_FILTERS, limit: filters.limit }); setFocusId(null); };

  const exportSnapshot = async () => {
    try {
      const blob = await canvasRef.current!.exportPng(lang === 'ar');
      const file = new File([blob], `brain-lite-graph-${new Date().toISOString().slice(0, 10)}.png`, { type: 'image/png' });
      const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
      if (nav.canShare?.({ files: [file] })) {
        try { await nav.share({ files: [file], title: 'Brain Lite' }); } catch (err) { if ((err as DOMException).name !== 'AbortError') throw err; }
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = file.name; a.click();
        setTimeout(() => URL.revokeObjectURL(url), 2000);
      }
      toast({ title: tx.shareDone });
      setShareOpen(false);
    } catch (e) {
      toast({ variant: 'destructive', title: tx.shareFail, description: e instanceof Error ? e.message : undefined });
    }
  };

  const isEmpty = !!data && data.total_memory_count < 5;
  const noMatch = !!data && !isEmpty && visible.nodes.length === 0;
  const ready = !!data && !isEmpty && !noMatch;

  return (
    <div id="graph-top" className="min-w-0 overscroll-y-contain" data-testid="page-graph">
      <header className="rise mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Link href="/memories" className="mb-1 inline-flex min-h-8 items-center gap-1 text-xs font-medium text-muted-foreground hover:text-gold" data-testid="link-graph-back"><ArrowLeft className="h-3.5 w-3.5 rtl:-scale-x-100" />{lang === 'ar' ? 'الذكريات' : 'Memories'}</Link>
          <h1 className="font-display text-4xl leading-none sm:text-5xl" data-testid="text-page-title">{tx.title}</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">{tx.lead}</p>
        </div>
        {ready && canvasMode && (
          <button type="button" onClick={() => setShareOpen(true)} aria-label={tx.share} className="mt-5 grid h-11 w-11 shrink-0 place-items-center rounded-full border border-gold-400/50 text-gold transition hover:bg-gold-soft" data-testid="button-graph-share"><Share2 className="h-4 w-4" /></button>
        )}
      </header>

      <div className="rise mb-3 flex items-center justify-between gap-2" style={{ animationDelay: '40ms' }}>
        <div role="radiogroup" aria-label={tx.viewToggle} className="inline-flex rounded-xl border border-gold-400/30 bg-card p-1">
          {(['graph', 'list'] as const).map((v) => (
            <button key={v} type="button" role="radio" aria-checked={view === v} onClick={() => setView(v)}
              className={cn('inline-flex min-h-10 items-center gap-1.5 rounded-lg px-3.5 text-sm font-medium transition', view === v ? 'gold-gradient text-gold-ink shadow-sm' : 'text-muted-foreground hover:text-foreground')}
              data-testid={`toggle-graph-view-${v}`}>
              {v === 'graph' ? <Network className="h-4 w-4" /> : <List className="h-4 w-4" />}{v === 'graph' ? tx.viewGraph : tx.viewList}
            </button>
          ))}
        </div>
        {data && <p className="text-xs text-muted-foreground tabular-nums" data-testid="text-graph-counts">{nf(visible.nodes.length)} {tx.nodes} · {nf(visible.edges.length)} {tx.links}</p>}
      </div>
      {view === 'graph' && <a href="#graph-list-anchor" onClick={(e) => { e.preventDefault(); setView('list'); }} className="sr-only focus:not-sr-only focus:mb-2 focus:inline-block focus:rounded-lg focus:bg-gold-soft focus:px-3 focus:py-2 focus:text-sm">{tx.skipToList}</a>}

      <div className="rise mb-3" style={{ animationDelay: '80ms' }}>
        <GraphFilterBar filters={filters} onChange={(f) => setFilters(f)} nodes={kindView.nodes} onFind={(id) => { if (focusId && !visible.nodes.some((n) => n.id === id)) setFocusId(null); setSelectedId(id); if (selectedId === id) canvasRef.current?.zoomToNode(id); }} />
      </div>

      {invalidDates ? <p role="alert" className="rounded-2xl border border-destructive/40 bg-destructive/5 p-4 text-sm text-danger-ink">{tx.dateError}</p>
        : graph.isError && !data ? <GraphError onRetry={() => graph.refetch()} />
        : !data ? <GraphSkeleton />
        : isEmpty ? <GraphEmpty />
        : (
          <div className="space-y-3">
            {ready && <GraphInsights insights={insights} onPick={pickInsight} />}
            {data.truncated && (
              <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-warning/35 bg-warning/8 p-3.5" role="status" data-testid="banner-graph-capped">
                <AlertTriangle className="h-4 w-4 shrink-0 text-warning-ink" />
                <div className="min-w-0 flex-1 text-sm"><p className="font-semibold text-warning-ink">{tx.capped}</p><p className="text-muted-foreground">{tx.cappedBody(nf(data.nodes.filter((n) => n.kind === 'memory').length), nf(data.filtered_memory_count))}</p></div>
                {filters.limit < 300 && <button type="button" onClick={() => setFilters({ ...filters, limit: 300 })} className="min-h-11 rounded-xl border border-warning/40 px-3.5 text-sm font-medium hover:bg-warning/10" data-testid="button-graph-limit">{tx.showMore}</button>}
              </div>
            )}
            {focusId && byId.get(focusId) && (
              <div className="flex items-center gap-2 rounded-full border border-gold-400/50 bg-gold-soft/70 py-1 pe-1 ps-3.5 text-sm" data-testid="chip-graph-focus">
                <Crosshair className="h-4 w-4 shrink-0 text-gold" />
                <span className="min-w-0 flex-1 truncate">{tx.focusing} <strong className="font-semibold">{byId.get(focusId)!.title}</strong></span>
                <button type="button" onClick={exitFocus} className="inline-flex min-h-10 shrink-0 items-center gap-1 rounded-full bg-card px-3 text-xs font-medium text-gold" data-testid="button-graph-exit-focus"><X className="h-3.5 w-3.5" />{tx.exitFocus}</button>
              </div>
            )}

            {noMatch ? <GraphNoMatch onClear={clearFilters} />
              : view === 'list' ? <div id="graph-list-anchor"><GraphListView nodes={visible.nodes} scopeCount={(n) => visibleScopeIds(n, visible.nodes).length} selectedId={selectedId} onSelect={select} /></div>
              : fallback ? <GraphClusterView nodes={visible.nodes} edges={visible.edges} selectedId={selectedId} onSelect={select} onTryGraph={() => { setForceGraph(true); setPoorPerf(false); }} />
              : (
                <div className={cn('relative h-[60dvh] min-h-[380px] w-full overflow-hidden rounded-3xl border border-gold-400/25 soft-shadow md:h-[68dvh]', graph.isFetching && 'opacity-95')} style={{ overscrollBehavior: 'none' }} data-testid="panel-graph-canvas">
                  <GraphCanvas ref={canvasRef} nodes={visible.nodes} edges={visible.edges} selectedId={selectedId} highlight={highlight} reduced={reduced}
                    newIds={newIds} sheetOpen={!!selected} ariaLabel={tx.canvasLabel(visible.nodes.length, visible.edges.length)} onSelect={select} onPoorPerformance={() => setPoorPerf(true)} />
                  <p className="pointer-events-none absolute inset-x-3 top-3 hidden text-center text-[11px] text-muted-foreground/80 sm:block">{tx.gestures}</p>
                  <div className="absolute bottom-3 start-3"><GraphLegend /></div>
                  <div className="absolute bottom-3 end-3 flex flex-col gap-2">
                    <button type="button" onClick={() => canvasRef.current?.zoomBy(1.4)} aria-label={tx.zoomIn} className={ctrlBtn} data-testid="button-graph-zoom-in"><Plus className="h-5 w-5" /></button>
                    <button type="button" onClick={() => canvasRef.current?.zoomBy(1 / 1.4)} aria-label={tx.zoomOut} className={ctrlBtn} data-testid="button-graph-zoom-out"><Minus className="h-5 w-5" /></button>
                    <button type="button" onClick={() => canvasRef.current?.recenter()} aria-label={tx.recenter} className={ctrlBtn} data-testid="button-graph-recenter"><Crosshair className="h-5 w-5" /></button>
                  </div>
                </div>
              )}
          </div>
        )}

      <AnimatePresence>
        {selected && (
          <GraphNodeSheet key="sheet" node={selected} scopeIds={visibleScopeIds(selected, visible.nodes)} byId={byId} edges={visible.edges} onClose={() => setSelectedId(null)} onOpen={open} onFocus={focus} onAsk={ask} onSelect={(id) => setSelectedId(id)} />
        )}
      </AnimatePresence>
      <ShareSnapshotDialog open={shareOpen} onOpenChange={setShareOpen} onConfirm={exportSnapshot} />
    </div>
  );
}
