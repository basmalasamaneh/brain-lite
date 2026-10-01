import { z } from "zod";
import { GetGraphQueryParams, GetGraphResponse } from "@workspace/api-zod";

export function normalizeGraphPerson(name: string): string {
  return name.normalize("NFKC").trim().replace(/\s+/gu, " ").toLowerCase();
}

const memoryTypes = new Set(["appointment", "receipt", "task", "idea", "document", "note", "other"]);
const calendarDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(+date) && date.toISOString().slice(0, 10) === value;
}, "Invalid calendar date");

// Generated coercion would interpret the string 'false' as true and accept
// repeated/coerced query parameters. Validate wire values before transforming.
export const graphQuery = GetGraphQueryParams.extend({
  types: z.string().min(1).max(200).refine((value) =>
    value.split(",").every((type) => memoryTypes.has(type.trim())), "Unknown memory type").optional(),
  space_id: z.string().uuid().optional(),
  from: calendarDate.optional(),
  to: calendarDate.optional(),
  include_suggested: z.enum(["true", "false"]).optional().transform((value) => value === "true"),
  limit: z.string().regex(/^[1-9]\d*$/).optional().transform((value) => value === undefined ? 150 : Number(value))
    .pipe(z.number().int().min(1).max(300)),
}).strict().refine((value) => !value.from || !value.to || value.from <= value.to, {
  message: "from must not be after to",
});
export type GraphFilters = z.infer<typeof graphQuery>;
export type Graph = z.infer<typeof GetGraphResponse>;
type Node = Graph["nodes"][number];
type Edge = Graph["edges"][number];

export interface GraphMemory {
  id: number; title: string; type: string; event_date: string | null; status: string;
  created_at: Date; people: string[]; degree: number;
}
export interface GraphSpace {
  id: string; name: string; kind: string; pinned: boolean; created_at: Date;
}
export interface GraphLink {
  id: number; memory_a_id: number; memory_b_id: number; status: string;
  relation_type: string; reason: string; created_at: Date;
}
export interface GraphMembership { space_id: string; memory_id: number; reason: string }

export function assembleGraph(input: {
  memories: GraphMemory[]; spaces: GraphSpace[]; links: GraphLink[];
  memberships: GraphMembership[]; total: number; filtered: number; limit: number;
  includeSuggested: boolean; spacesOverflow?: boolean;
}): Graph {
  const nodes: Node[] = [];
  const edges: Edge[] = [];
  const memoryIds = new Set(input.memories.map((memory) => memory.id));
  const spaceIds = new Set(input.spaces.map((space) => space.id));
  const common = { date: null, status: null, memory_id: null, space_id: null, count: 0, pinned: false, memory_ids: [] };
  for (const memory of input.memories) {
    nodes.push({ ...common, id: `memory:${memory.id}`, kind: "memory", title: memory.title, type: memory.type,
      date: memory.event_date ?? memory.created_at.toISOString(), status: memory.status,
      memory_id: memory.id, memory_ids: [memory.id] });
  }
  for (const space of input.spaces) {
    nodes.push({ ...common, id: `space:${space.id}`, kind: "space", title: space.name, type: space.kind,
      space_id: space.id, pinned: space.pinned, memory_ids: [] });
  }
  const people = new Map<string, Node>();
  for (const memory of input.memories) {
    for (const normalized of new Set(memory.people.map(normalizeGraphPerson).filter(Boolean))) {
      let person = people.get(normalized);
      if (!person) {
        const displayName = memory.people.find((name) => normalizeGraphPerson(name) === normalized)!;
        person = { ...common, id: `person:${normalized}`, kind: "person",
          title: displayName.normalize("NFKC").trim().replace(/\s+/gu, " "), type: "person", memory_ids: [] };
        people.set(normalized, person);
        nodes.push(person);
      }
      person.memory_ids.push(memory.id);
      edges.push({ id: `mention:${memory.id}:${normalized}`, source: `memory:${memory.id}`, target: person.id,
        kind: "mention", relation_type: null, reason: null, suggested: false, connection_id: null, created_at: null });
    }
  }
  for (const member of input.memberships) {
    if (!memoryIds.has(member.memory_id) || !spaceIds.has(member.space_id)) continue;
    const space = nodes.find((node) => node.id === `space:${member.space_id}`)!;
    space.memory_ids.push(member.memory_id);
    edges.push({ id: `membership:${member.space_id}:${member.memory_id}`, source: `memory:${member.memory_id}`,
      target: space.id, kind: "membership", relation_type: null, reason: member.reason || null,
      suggested: false, connection_id: null, created_at: null });
  }
  for (const link of input.links) {
    if (!memoryIds.has(link.memory_a_id) || !memoryIds.has(link.memory_b_id)
      || (link.status !== "confirmed" && !(input.includeSuggested && link.status === "suggested"))) continue;
    edges.push({ id: `connection:${link.id}`, source: `memory:${link.memory_a_id}`, target: `memory:${link.memory_b_id}`,
      kind: "connection", relation_type: link.relation_type, reason: link.reason || null,
      suggested: link.status === "suggested", connection_id: link.id, created_at: link.created_at.toISOString() });
  }
  // Pinned Spaces lead; remaining hubs compete with recency-ranked memories.
  // Candidate degree is metadata only and is recomputed on visible edges below.
  const scores = new Map<string, number>();
  input.memories.forEach((memory, index) =>
    scores.set(`memory:${memory.id}`, 2 + Number(memory.degree) + 2 * (1 - index / Math.max(1, input.memories.length))));
  nodes.sort((a, b) => Number(b.pinned) - Number(a.pinned)
    || (scores.get(b.id) ?? b.memory_ids.length * 2) - (scores.get(a.id) ?? a.memory_ids.length * 2)
    || a.id.localeCompare(b.id));
  const selected = nodes.slice(0, input.limit);
  const visible = new Set(selected.map((node) => node.id));
  const visibleMemories = new Set(selected.filter((node) => node.kind === "memory").map((node) => node.memory_id!));
  const visibleEdges = edges.filter((edge) => visible.has(edge.source) && visible.has(edge.target));
  for (const node of selected) {
    node.memory_ids = [...new Set(node.memory_ids)].filter((id) => visibleMemories.has(id));
    node.count = node.kind === "memory"
      ? visibleEdges.filter((edge) => edge.source === node.id || edge.target === node.id).length
      : node.memory_ids.length;
  }
  return { nodes: selected, edges: visibleEdges, total_memory_count: input.total, filtered_memory_count: input.filtered,
    truncated: Boolean(input.spacesOverflow) || nodes.length > selected.length || input.filtered > visibleMemories.size };
}