import assert from "node:assert/strict";
import { test } from "node:test";
import { assembleGraph, graphQuery, normalizeGraphPerson } from "./graph-utils";

test("graph wire filters validate calendar dates, booleans, types and limits strictly", () => {
  assert.equal(graphQuery.parse({}).limit, 150);
  assert.equal(graphQuery.parse({ include_suggested: "false" }).include_suggested, false);
  assert.equal(graphQuery.parse({ include_suggested: "true" }).include_suggested, true);
  assert.equal(graphQuery.parse({ types: "task, idea", from: "2024-02-29", to: "2024-03-01", limit: "300" }).limit, 300);
  for (const query of [
    { include_suggested: "1" }, { include_suggested: ["true", "false"] }, { include_suggested: true },
    { limit: "301" }, { limit: "0" }, { limit: "-1" }, { limit: "2.5" }, { limit: "1e2" }, { limit: ["10"] },
    { types: "person" }, { types: "task," }, { types: "" }, { types: ["task"] },
    { from: "2025-02-29" }, { from: "2024-13-01" }, { from: "2024-02-30" },
    { from: "2024-02-02", to: "2024-01-01" }, { space_id: "no" }, { unexpected: "x" },
  ]) assert.equal(graphQuery.safeParse(query).success, false, JSON.stringify(query));
});

test("people merge under NFKC whitespace and case only, not Arabic letter folding", () => {
  assert.equal(normalizeGraphPerson("  ＳＡＲＡ \n Smith "), "sara smith");
  assert.notEqual(normalizeGraphPerson("أحمد"), normalizeGraphPerson("احمد"));
});

test("all-node cap, pinned priority, visible scopes, per-space arrays and terminal dismissed edges", () => {
  const now = new Date("2025-01-01T00:00:00Z");
  const memories = [1, 2, 3].map((id) => ({
    id, title: `Memory ${id}`, type: "note", event_date: null, status: "confirmed",
    created_at: now, people: id === 1 ? ["Sara", " SARA ", "Ｓａｒａ"] : ["sara"], degree: 0,
  }));
  const input = {
    memories, spaces: [
      { id: "one", name: "One", kind: "project", pinned: true, created_at: now },
      { id: "two", name: "Two", kind: "project", pinned: false, created_at: now },
    ], memberships: [
      { space_id: "one", memory_id: 1, reason: "one reason" },
      { space_id: "two", memory_id: 2, reason: "two reason" },
    ], links: ["confirmed", "suggested", "dismissed"].map((status, index) => ({
      id: index + 1, memory_a_id: 1, memory_b_id: 2, status,
      relation_type: "same_topic", reason: status, created_at: now,
    })), total: 3, filtered: 3, limit: 300, includeSuggested: false,
  };
  const full = assembleGraph(input);
  assert.equal(full.nodes.length, 6);
  assert.equal(full.truncated, false);
  assert.equal(full.nodes.find((node) => node.id === "person:sara")!.count, 3);
  assert.deepEqual(full.nodes.find((node) => node.id === "space:one")!.memory_ids, [1]);
  assert.deepEqual(full.nodes.find((node) => node.id === "space:two")!.memory_ids, [2]);
  assert.equal(full.edges.filter((edge) => edge.kind === "connection").length, 1);
  const suggestions = assembleGraph({ ...input, includeSuggested: true });
  assert.equal(suggestions.edges.filter((edge) => edge.kind === "connection").length, 2);
  assert.equal(suggestions.edges.some((edge) => edge.connection_id === 3), false);
  assert.equal(suggestions.edges.find((edge) => edge.connection_id === 2)!.suggested, true);
  const capped = assembleGraph({ ...input, limit: 3 });
  assert.equal(capped.nodes.length, 3);
  assert.equal(capped.nodes[0].id, "space:one");
  assert.equal(capped.truncated, true);
  const visible = new Set(capped.nodes.map((node) => node.id));
  const memoryIds = new Set(capped.nodes.filter((node) => node.kind === "memory").map((node) => node.memory_id));
  assert.ok(capped.edges.every((edge) => visible.has(edge.source) && visible.has(edge.target)));
  assert.ok(capped.nodes.every((node) => node.memory_ids.every((id) => memoryIds.has(id))));
  const empty = assembleGraph({ memories: [], spaces: [], memberships: [], links: [], total: 0, filtered: 0, limit: 150, includeSuggested: false });
  assert.deepEqual(empty, { nodes: [], edges: [], truncated: false, total_memory_count: 0, filtered_memory_count: 0 });
});