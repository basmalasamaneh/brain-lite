import type { GraphEdge, GraphNode, LifeGraph } from '@workspace/api-client-react';

/** Filter chip -> actual memory types. `other` and `note` ride with Ideas/Documents so no memory is orphaned. */
export const CHIP_TYPES = {
  events: ['appointment'],
  documents: ['document', 'receipt', 'other'],
  tasks: ['task'],
  ideas: ['idea', 'note'],
} as const;
export type MemoryChip = keyof typeof CHIP_TYPES;
export type KindChip = 'people' | 'spaces';
export type GraphChip = MemoryChip | KindChip;
export const MEMORY_CHIPS: MemoryChip[] = ['events', 'documents', 'tasks', 'ideas'];
export const ALL_CHIPS: GraphChip[] = [...MEMORY_CHIPS, 'people', 'spaces'];

export interface GraphFilters {
  chips: GraphChip[];
  spaceId: string;
  from: string;
  to: string;
  suggested: boolean;
  limit: number;
}
export const DEFAULT_FILTERS: GraphFilters = { chips: ALL_CHIPS, spaceId: '', from: '', to: '', suggested: false, limit: 150 };

export function filtersToParams(f: GraphFilters) {
  const mem = MEMORY_CHIPS.filter((c) => f.chips.includes(c));
  const types = mem.length === MEMORY_CHIPS.length || mem.length === 0 ? undefined : mem.flatMap((c) => CHIP_TYPES[c]).join(',');
  return {
    ...(types ? { types } : {}),
    ...(f.spaceId ? { space_id: f.spaceId } : {}),
    ...(f.from ? { from: f.from } : {}),
    ...(f.to ? { to: f.to } : {}),
    ...(f.suggested ? { include_suggested: true } : {}),
    limit: f.limit,
  };
}

/** Client-side view of the server graph: honours People/Spaces chips and "no memory chips" meaning hide memories. */
export function applyKindChips(graph: LifeGraph, chips: GraphChip[]): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const showMem = MEMORY_CHIPS.some((c) => chips.includes(c));
  const keep = (n: GraphNode) => (n.kind === 'memory' ? showMem : n.kind === 'person' ? chips.includes('people') : chips.includes('spaces'));
  const nodes = graph.nodes.filter(keep);
  const ids = new Set(nodes.map((n) => n.id));
  return { nodes, edges: graph.edges.filter((e) => ids.has(e.source) && ids.has(e.target)) };
}

export function neighborhood(edges: GraphEdge[], start: string, hops: number) {
  const adj = adjacency(edges);
  const seen = new Set([start]);
  let frontier = [start];
  for (let i = 0; i < hops; i++) {
    const next: string[] = [];
    for (const id of frontier) for (const n of adj.get(id) ?? []) if (!seen.has(n)) { seen.add(n); next.push(n); }
    frontier = next;
  }
  return seen;
}

export function adjacency(edges: GraphEdge[]) {
  const adj = new Map<string, Set<string>>();
  for (const e of edges) {
    if (!adj.has(e.source)) adj.set(e.source, new Set());
    if (!adj.has(e.target)) adj.set(e.target, new Set());
    adj.get(e.source)!.add(e.target);
    adj.get(e.target)!.add(e.source);
  }
  return adj;
}

export function personKey(node: GraphNode) {
  return node.id.startsWith('person:') ? node.id.slice(7) : node.title;
}

export function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  const first = Array.from(parts[0])[0] ?? '';
  const last = parts.length > 1 ? Array.from(parts[parts.length - 1])[0] ?? '' : '';
  return (first + last).toUpperCase();
}

const fold = (s: string) => s.normalize('NFKD').replace(/[\u0300-\u036f\u064B-\u065F\u0670]/g, '').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').toLowerCase().trim();

/** Ranked name search: exact > prefix > word-start > contains > all-words. */
export function searchNodes(nodes: GraphNode[], query: string, max = 6) {
  const q = fold(query);
  if (!q) return [];
  const words = q.split(/\s+/);
  const scored: { n: GraphNode; s: number }[] = [];
  for (const n of nodes) {
    const t = fold(n.title);
    let s = 0;
    if (t === q) s = 100;
    else if (t.startsWith(q)) s = 80;
    else if (t.split(/\s+/).some((w) => w.startsWith(q))) s = 60;
    else if (t.includes(q)) s = 40;
    else if (words.every((w) => t.includes(w))) s = 25;
    if (s) scored.push({ n, s: s + Math.min(n.count, 10) });
  }
  return scored.sort((a, b) => b.s - a.s).slice(0, max).map((x) => x.n);
}

export type Insight = { id: string; label: string; value: string; target: string | null };

export function buildInsights(nodes: GraphNode[], edges: GraphEdge[], tx: {
  mostConnected: string; unlinkedOne: string; unlinkedMany: string; allLinked: string; newestLink: string; largestSpace: string; topPerson: string; insights: string;
}, nf: (n: number) => string): Insight[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const memories = nodes.filter((n) => n.kind === 'memory');
  const conn = edges.filter((e) => e.kind === 'connection' && !e.suggested);
  const out: Insight[] = [];
  const degree = new Map<string, number>();
  for (const e of conn) { degree.set(e.source, (degree.get(e.source) ?? 0) + 1); degree.set(e.target, (degree.get(e.target) ?? 0) + 1); }
  const top = memories.filter((m) => (degree.get(m.id) ?? 0) > 0).sort((a, b) => (degree.get(b.id)! - degree.get(a.id)!) || b.count - a.count)[0];
  if (top) out.push({ id: 'top', label: tx.mostConnected, value: top.title, target: top.id });
  if (memories.length) {
    const lonely = memories.filter((m) => !degree.has(m.id));
    out.push(lonely.length
      ? { id: 'lonely', label: tx.insights, value: `${nf(lonely.length)} ${lonely.length === 1 ? tx.unlinkedOne : tx.unlinkedMany}`, target: lonely[0].id }
      : { id: 'lonely', label: tx.insights, value: tx.allLinked, target: null });
  }
  const newest = conn.filter((e) => e.created_at).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0];
  if (newest && byId.has(newest.source) && byId.has(newest.target)) {
    out.push({ id: 'newest', label: tx.newestLink, value: `${byId.get(newest.source)!.title} \u2194 ${byId.get(newest.target)!.title}`, target: newest.source });
  }
  if (out.length < 3) {
    const vc = (n: GraphNode) => visibleScopeIds(n, nodes).length;
    const space = nodes.filter((n) => n.kind === 'space' && vc(n) > 0).sort((a, b) => vc(b) - vc(a))[0];
    if (space) out.push({ id: 'space', label: tx.largestSpace, value: `${space.title} \u00b7 ${nf(vc(space))}`, target: space.id });
  }
  if (out.length < 3) {
    const vc = (n: GraphNode) => visibleScopeIds(n, nodes).length;
    const person = nodes.filter((n) => n.kind === 'person' && vc(n) > 0).sort((a, b) => vc(b) - vc(a))[0];
    if (person) out.push({ id: 'person', label: tx.topPerson, value: `${person.title} \u00b7 ${nf(vc(person))}`, target: person.id });
  }
  return out.slice(0, 3);
}

/** Groups memory nodes by their Space membership for the clustered fallback. */
export function clusterBySpace(nodes: GraphNode[], edges: GraphEdge[]) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const clusters = new Map<string, { space: GraphNode | null; members: GraphNode[] }>();
  const placed = new Set<string>();
  for (const s of nodes.filter((n) => n.kind === 'space')) clusters.set(s.id, { space: s, members: [] });
  for (const e of edges) {
    if (e.kind !== 'membership') continue;
    const [sp, mem] = byId.get(e.source)?.kind === 'space' ? [e.source, e.target] : [e.target, e.source];
    const c = clusters.get(sp); const m = byId.get(mem);
    if (c && m && m.kind === 'memory') { c.members.push(m); placed.add(m.id); }
  }
  const unfiled = nodes.filter((n) => n.kind === 'memory' && !placed.has(n.id));
  const list = [...clusters.values()].sort((a, b) => Number(b.space?.pinned) - Number(a.space?.pinned) || b.members.length - a.members.length);
  if (unfiled.length) list.push({ space: null, members: unfiled });
  return list;
}

/** Stronger relations draw thicker. */
export function edgeWeight(e: GraphEdge) {
  if (e.kind === 'membership') return 1;
  if (e.kind === 'mention') return 0.8;
  switch (e.relation_type) {
    case 'duplicate': case 'same_event': return 2.6;
    case 'follow_up': case 'same_project': return 2.1;
    case 'same_person': return 1.8;
    default: return 1.4;
  }
}

export function nodeRadius(n: GraphNode) {
  if (n.kind === 'space') return Math.min(34, 20 + Math.sqrt(n.count) * 2.4);
  if (n.kind === 'person') return Math.min(20, 12 + Math.sqrt(n.count) * 1.8);
  return Math.min(22, 10 + Math.sqrt(n.count) * 2.6);
}

const SEEN_KEY = (owner: string) => `bl-graph-seen:${owner}`;
/** Memories not seen on the previous visit get a gentle pulse. First visit pulses nothing. */
export function takeNewMemoryIds(owner: string | undefined, nodes: GraphNode[]) {
  if (!owner) return new Set<string>();
  const ids = nodes.filter((n) => n.kind === 'memory').map((n) => n.id);
  try {
    const raw = localStorage.getItem(SEEN_KEY(owner));
    const prev = raw ? new Set<string>(JSON.parse(raw) as string[]) : null;
    const merged = new Set([...(prev ?? []), ...ids]);
    localStorage.setItem(SEEN_KEY(owner), JSON.stringify([...merged].slice(-1200)));
    return prev ? new Set(ids.filter((id) => !prev.has(id))) : new Set<string>();
  } catch {
    return new Set<string>();
  }
}

/** Memory ids of a Space/Person limited to memories actually visible in the current graph. */
export function visibleScopeIds(node: GraphNode, nodes: GraphNode[]): number[] {
  if (node.kind === 'memory') return node.memory_id != null ? [node.memory_id] : [];
  const onMap = new Set(nodes.filter((n) => n.kind === 'memory' && n.memory_id != null).map((n) => n.memory_id as number));
  return node.memory_ids.filter((id) => onMap.has(id));
}

/** "X memories; Y on this map" for Space/Person. Uses backend total_count when present, else the visible count. */
export function scopeCounts(node: GraphNode, nodes: GraphNode[]) {
  const visible = visibleScopeIds(node, nodes).length;
  const total = typeof node.total_count === 'number' ? Math.max(node.total_count, visible) : null;
  return { visible, total };
}
