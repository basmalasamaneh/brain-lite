import { useEffect, useRef, useState } from 'react';
import { motion, useDragControls, useReducedMotion, type PanInfo } from 'framer-motion';
import { ArrowUpRight, Check, Crosshair, Layers3, MessageCircleQuestion, Pin, X } from 'lucide-react';
import type { GraphEdge, GraphNode, MemoryType } from '@workspace/api-client-react';
import { StatusPill, TypeChip, Skeleton, btnGhost, btnPrimary } from '@/components/kit';
import { useI18n } from '@/lib/i18n';
import { graphText } from '@/lib/i18n-graph';
import { connectionText, type ConnectionTextKey } from '@/lib/i18n-connections';
import { formatDate, MEMORY_TYPES } from '@/lib/memory';
import { initials } from '@/lib/graph-model';
import { useGraphMemoryDetail } from '@/hooks/use-graph';
import { useConnectionAction } from '@/hooks/use-connections';
import { cn } from '@/lib/utils';

interface Props {
  node: GraphNode;
  /** Memory ids of this node visible in the current graph. */
  scopeIds: number[];
  byId: Map<string, GraphNode>;
  edges: GraphEdge[];
  onClose: () => void;
  onOpen: (n: GraphNode) => void;
  onFocus: (n: GraphNode) => void;
  onAsk: (n: GraphNode) => void;
  onSelect: (id: string) => void;
}

export function GraphNodeSheet({ node, scopeIds, byId, edges, onClose, onOpen, onFocus, onAsk, onSelect }: Props) {
  const { lang } = useI18n();
  const tx = graphText(lang);
  const reduce = useReducedMotion();
  const drag = useDragControls();
  const [expanded, setExpanded] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  const detail = useGraphMemoryDetail(node.kind === 'memory' ? node.memory_id : null);
  const action = useConnectionAction();
  const nf = (n: number) => n.toLocaleString(lang === 'ar' ? 'ar' : 'en');

  useEffect(() => { setExpanded(false); }, [node.id]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [onClose]);

  const incident = edges.filter((e) => e.source === node.id || e.target === node.id);
  const connections = incident.filter((e) => e.kind === 'connection').sort((a, b) => Number(a.suggested) - Number(b.suggested));
  const context = incident.filter((e) => e.kind !== 'connection').flatMap((e) => { const n = byId.get(e.source === node.id ? e.target : e.source); return n ? [{ n, reason: e.reason }] : []; });
  const onDragEnd = (_: unknown, info: PanInfo) => {
    if (info.offset.y > 90 || info.velocity.y > 600) onClose();
    else if (info.offset.y < -50 || info.velocity.y < -500) setExpanded(true);
  };
  const isMemoryType = MEMORY_TYPES.includes(node.type as MemoryType);

  return (
    <motion.aside
      role="dialog" aria-modal={false} aria-labelledby="graph-sheet-title"
      initial={reduce ? { opacity: 0 } : { y: '100%' }} animate={reduce ? { opacity: 1 } : { y: 0 }} exit={reduce ? { opacity: 0 } : { y: '100%' }}
      transition={{ type: 'spring', damping: 32, stiffness: 320 }}
      drag="y" dragControls={drag} dragListener={false} dragConstraints={{ top: 0, bottom: 0 }} dragElastic={{ top: 0.08, bottom: 0.7 }} onDragEnd={onDragEnd}
      className={cn('fixed inset-x-0 bottom-0 z-[70] flex flex-col rounded-t-[1.75rem] border border-b-0 border-gold-400/35 bg-card lux-shadow md:inset-x-auto md:bottom-4 md:end-4 md:w-[26rem] md:rounded-3xl md:border-b',
        expanded ? 'max-h-[88dvh]' : 'max-h-[58dvh]')}
      style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 0.75rem)' }}
      data-testid="sheet-graph-node">
      <div onPointerDown={(e) => drag.start(e)} className="flex cursor-grab touch-none flex-col items-center pb-1 pt-2.5 active:cursor-grabbing" aria-hidden>
        <span className="h-1.5 w-11 rounded-full bg-gold-400/50" />
      </div>
      <div className="flex items-start gap-3 px-5 pb-3">
        {node.kind === 'person'
          ? <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-surface-alt text-base font-semibold text-gold ring-1 ring-gold-500/30">{initials(node.title)}</span>
          : node.kind === 'space' ? <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-gold-soft text-gold ring-[3px] ring-gold-400"><Layers3 className="h-5 w-5" /></span> : null}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            {node.kind === 'memory' && isMemoryType && <TypeChip type={node.type as MemoryType} />}
            {node.kind !== 'memory' && <span className="rounded-full bg-gold-soft px-2.5 py-1 text-xs font-medium text-gold">{node.kind === 'space' ? tx.kindSpace : tx.kindPerson}</span>}
            {node.pinned && <span className="inline-flex items-center gap-1 text-xs text-gold"><Pin className="h-3 w-3" />{tx.pinned}</span>}
          </div>
          <h2 id="graph-sheet-title" className="mt-1.5 font-display text-2xl leading-tight [overflow-wrap:anywhere]" data-testid="text-graph-sheet-title">{node.title}</h2>
          <p className="mt-0.5 text-sm text-muted-foreground tabular-nums">
            {node.kind === 'memory' ? (node.date ? formatDate(node.date, lang) : tx.noDate)
              : (typeof node.total_count === 'number' ? `${nf(Math.max(node.total_count, scopeIds.length))} ${Math.max(node.total_count, scopeIds.length) === 1 ? tx.memoryTotal : tx.memoriesTotal} \u00b7 ${nf(scopeIds.length)} ${tx.onThisMap}` : `${nf(scopeIds.length)} ${scopeIds.length === 1 ? tx.memoryOne : tx.memoriesOnMap}`)}
          </p>
        </div>
        <button ref={closeRef} type="button" onClick={onClose} aria-label={tx.close} className="-me-2 -mt-1 grid h-11 w-11 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-gold-soft hover:text-foreground" data-testid="button-graph-sheet-close"><X className="h-5 w-5" /></button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5" onScroll={(e) => { if ((e.target as HTMLElement).scrollTop > 24) setExpanded(true); }}>
        {node.kind === 'memory' && (
          <div className="mb-4">
            {node.status === 'needs_review' || node.status === 'confirmed' ? <div className="mb-2"><StatusPill status={node.status} /></div> : null}
            {detail.isLoading ? <div className="space-y-2"><Skeleton className="h-3.5 w-full rounded-md" /><Skeleton className="h-3.5 w-3/4 rounded-md" /></div>
              : detail.isError ? <p className="text-sm text-danger-ink">{tx.summaryError}</p>
              : <p className="line-clamp-4 text-sm text-foreground/85" data-testid="text-graph-sheet-summary">{detail.data?.summary || tx.noSummary}</p>}
          </div>
        )}

        {node.kind === 'memory' && (
          <section className="mb-4">
            <h3 className="eyebrow mb-2 text-gold">{tx.relations}</h3>
            {connections.length === 0 ? <p className="text-sm text-muted-foreground">{tx.noRelations}</p> : (
              <ul className="space-y-2">
                {connections.map((e) => {
                  const other = byId.get(e.source === node.id ? e.target : e.source);
                  if (!other) return null;
                  const rel = e.relation_type && (['same_event', 'same_person', 'same_project', 'same_topic', 'follow_up', 'duplicate', 'other'] as string[]).includes(e.relation_type) ? connectionText(lang, e.relation_type as ConnectionTextKey) : null;
                  return (
                    <li key={e.id} className={cn('rounded-xl border p-3', e.suggested ? 'border-dashed border-gold-400/60 bg-gold-soft/40' : 'border-border bg-background/60')} data-testid={`relation-${e.id}`}>
                      <button type="button" onClick={() => onSelect(other.id)} className="flex min-h-8 w-full items-center gap-2 text-start" data-testid={`button-relation-node-${e.id}`}>
                        <span className="min-w-0 flex-1 truncate text-sm font-medium">{other.title}</span>
                        {rel && <span className="shrink-0 rounded-full bg-gold-soft px-2 py-0.5 text-[11px] font-medium text-gold">{rel}</span>}
                        {e.suggested && <span className="shrink-0 rounded-full border border-dashed border-gold-500/60 px-2 py-0.5 text-[11px] text-gold">{tx.suggestedTag}</span>}
                      </button>
                      <p className="mt-1 text-xs text-muted-foreground">{e.reason || tx.manual}</p>
                      {e.suggested && e.connection_id != null && (
                        <div className="mt-2 flex gap-2">
                          <button type="button" disabled={action.isPending} onClick={() => action.mutate({ action: 'confirm', id: e.connection_id! })} className={cn(btnPrimary, 'min-h-10 flex-1 px-3 py-1.5')} data-testid={`button-connect-${e.connection_id}`}><Check className="h-4 w-4" />{tx.connect}</button>
                          <button type="button" disabled={action.isPending} onClick={() => action.mutate({ action: 'dismiss', id: e.connection_id! })} className={cn(btnGhost, 'min-h-10 flex-1 px-3 py-1.5')} data-testid={`button-dismiss-${e.connection_id}`}><X className="h-4 w-4" />{tx.dismiss}</button>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        )}

        {context.length > 0 && (
          <section className="mb-4">
            <h3 className="eyebrow mb-2 text-gold">{tx.memberOf}</h3>
            <div className="flex flex-wrap gap-1.5">
              {context.slice(0, expanded ? 60 : 12).map(({ n: c, reason }) => (
                <button key={c.id} type="button" onClick={() => onSelect(c.id)} title={reason ?? undefined} className={cn('inline-flex min-h-9 max-w-full flex-col items-start justify-center rounded-2xl border px-3 py-1 text-start text-xs font-medium hover:border-gold-400/60', c.kind === 'space' ? 'border-gold-400/50 bg-gold-soft text-gold' : 'border-border bg-background')} data-testid={`chip-context-${c.id}`}>
                  <span className="max-w-full truncate">{c.title}</span>
                  {reason && <span className="max-w-full truncate text-[11px] font-normal text-muted-foreground">{reason}</span>}
                </button>
              ))}
              {!expanded && context.length > 12 && <button type="button" onClick={() => setExpanded(true)} className="min-h-9 rounded-full px-3 text-xs text-gold">+{nf(context.length - 12)}</button>}
            </div>
          </section>
        )}
      </div>

      <div className="grid grid-cols-3 gap-2 border-t border-border px-4 pt-3">
        <button type="button" onClick={() => onOpen(node)} className={cn(btnPrimary, 'px-2')} data-testid="button-graph-open"><ArrowUpRight className="h-4 w-4 rtl:-scale-x-100" />{tx.open}</button>
        <button type="button" onClick={() => onFocus(node)} className={cn(btnGhost, 'px-2')} data-testid="button-graph-focus"><Crosshair className="h-4 w-4" />{tx.focus}</button>
        <button type="button" onClick={() => onAsk(node)} disabled={!scopeIds.length} className={cn(btnGhost, 'px-2 text-center leading-tight')} data-testid="button-graph-ask"><MessageCircleQuestion className="h-4 w-4 shrink-0" /><span className="text-[13px]">{tx.ask}</span></button>
      </div>
    </motion.aside>
  );
}
