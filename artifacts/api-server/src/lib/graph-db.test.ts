import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import express from "express";
import supertest from "supertest";
import { pool } from "@workspace/db";
import graphRouter from "../routes/graph";
import { initializeConnections } from "./connections";
import { initializeSpaces } from "./spaces";
import { initializeSemanticSearch } from "./semantic-search";
import { getOwnerGraph } from "./graph";
import { graphQuery, type Graph } from "./graph-utils";

after(async () => { await pool.end(); });

test("graph DB and API: 0/3/30 with 3 Spaces/300, strict filters, isolation and terminal dismissals", {
  skip: process.env.GRAPH_DB_TEST !== "1" ? "Opt in with GRAPH_DB_TEST=1; cleans disposable fixtures only" : undefined,
}, async () => {
  // Migration setup only: this suite never invokes extraction, embeddings or AI.
  await initializeSemanticSearch(); await initializeConnections(); await initializeSpaces();
  const a = randomUUID(), b = randomUUID();
  const spaceIds = [randomUUID(), randomUUID(), randomUUID()];
  await pool.query(`INSERT INTO users(id,email,name,password_hash)
    VALUES($1,$2,'Graph fixture','unused-fixture-hash'),($3,$4,'Graph other fixture','unused-fixture-hash')`,
    [a, `graph-${a}@example.invalid`, b, `graph-${b}@example.invalid`]);
  // A route-only HTTP harness exercises the real handler with the authenticated
  // identity boundary supplied by middleware, without starting the production app.
  const app = express();
  app.use((req, _res, next) => {
    const owner = req.headers["x-graph-test-owner"];
    req.isAuthenticated = (() => typeof owner === "string" && (owner === a || owner === b)) as typeof req.isAuthenticated;
    if (req.isAuthenticated()) req.user = {
      id: owner as string, email: "disposable@example.invalid", name: "Graph test",
      language: "en", theme: "system", onboardingCompleted: true,
    };
    req.log = { warn: () => {} } as unknown as typeof req.log;
    next();
  });
  app.use("/api", graphRouter);
  const request = (owner: string, query = "") => supertest(app).get(`/api/graph${query}`).set("x-graph-test-owner", owner);
  const filter = (query: Record<string, string> = {}) => graphQuery.parse(query);
  const verify = (graph: Graph, limit: number, allowed: Set<number>) => {
    assert.ok(graph.nodes.length <= limit);
    const visible = new Set(graph.nodes.map((node) => node.id));
    const visibleMemories = new Set(graph.nodes.filter((node) => node.kind === "memory").map((node) => node.memory_id));
    assert.ok(graph.nodes.every((node) => node.memory_ids.every((id) => allowed.has(id) && visibleMemories.has(id))));
    assert.ok(graph.nodes.filter((node) => node.kind === "memory").every((node) => allowed.has(node.memory_id!)));
    assert.ok(graph.nodes.filter((node) => node.kind !== "memory").every((node) =>
      Number.isInteger(node.total_count) && node.total_count! >= node.count));
    assert.ok(graph.edges.every((edge) => visible.has(edge.source) && visible.has(edge.target)));
    const json = JSON.stringify(graph);
    assert.equal(json.includes("raw_text"), false);
    assert.equal(json.includes("embedding"), false);
    assert.equal(json.includes("DO NOT RETURN SECRET"), false);
  };
  try {
    assert.equal((await supertest(app).get("/api/graph")).status, 401);
    const zero = await request(a);
    assert.equal(zero.status, 200);
    assert.deepEqual(zero.body, { nodes: [], edges: [], truncated: false, total_memory_count: 0, filtered_memory_count: 0 });
    const other = (await pool.query(`INSERT INTO memories(user_id,title,people,raw_text,status)
      VALUES($1,'Other owner private title',ARRAY['Private owner person',' SARA Smith '],'DO NOT RETURN SECRET','confirmed') RETURNING id`, [b])).rows[0].id;
    const three = (await pool.query(`INSERT INTO memories(user_id,title,type,people,event_date,raw_text,status,created_at)
      SELECT $1,'Graph fixture '||i,CASE WHEN i=2 THEN 'task' ELSE 'note' END,
        ARRAY[CASE WHEN i=1 THEN ' ＳＡＲＡ  Smith ' ELSE 'sara smith' END,'Sara Smith'],
        '2025-01-0'||i,'DO NOT RETURN SECRET','confirmed','2025-01-01'::timestamptz + i*interval '1 day'
      FROM generate_series(1,3) i RETURNING id`, [a])).rows.map((row) => row.id as number);
    const allowed = new Set(three);
    const small = await request(a);
    assert.equal(small.status, 200);
    assert.equal(small.body.total_memory_count, 3);
    assert.equal(small.body.filtered_memory_count, 3);
    assert.equal(small.body.truncated, false);
    assert.equal(small.body.nodes.filter((node: { kind: string }) => node.kind === "person").length, 1);
    assert.equal(small.body.nodes.find((node: { kind: string }) => node.kind === "person").total_count, 3);
    verify(small.body, 150, allowed);
    const hiddenOtherSpace = randomUUID();
    await pool.query(`INSERT INTO spaces(id,user_id,name,kind,icon,pinned) VALUES($1,$2,'Private space','project','briefcase',true)`, [hiddenOtherSpace, b]);
    assert.equal((await request(a, `?space_id=${hiddenOtherSpace}`)).status, 404);
    for (const [index, id] of spaceIds.entries()) {
      await pool.query(`INSERT INTO spaces(id,user_id,name,kind,icon,pinned)
        VALUES($1,$2,$3,'project','briefcase',$4)`, [id, a, `Graph space ${index}`, index === 0]);
    }
    const rest = (await pool.query(`INSERT INTO memories(user_id,title,type,people,event_date,raw_text,status,created_at)
      SELECT $1,'Graph fixture '||i,CASE WHEN i%2=0 THEN 'task' ELSE 'note' END,ARRAY['Sara Smith'],
        '2025-02-01','DO NOT RETURN SECRET','confirmed','2025-02-01'::timestamptz + i*interval '1 minute'
      FROM generate_series(4,30) i RETURNING id`, [a])).rows.map((row) => row.id as number);
    rest.forEach((id) => allowed.add(id));
    const all30 = [...three, ...rest];
    for (const [index, id] of all30.entries()) {
      await pool.query(`INSERT INTO space_memories(user_id,space_id,memory_id,source,status,reason)
        VALUES($1,$2,$3,'manual','confirmed','Confirmed membership')`, [a, spaceIds[index % 3], id]);
    }
    // Suggested/dismissed Space memberships must never appear even with suggestions enabled.
    await pool.query(`INSERT INTO space_memories(user_id,space_id,memory_id,source,status,reason)
      VALUES($1,$2,$3,'ai','suggested','Forbidden suggested membership'),($1,$2,$4,'ai','dismissed','Forbidden dismissed membership')`,
    [a, spaceIds[0], three[1], three[2]]);
    const confirmed = (await pool.query(`INSERT INTO memory_links(user_id,memory_a_id,memory_b_id,source,status,relation_type,reason,confidence)
      VALUES($1,$2,$3,'manual','confirmed','same_project','Confirmed link',100) RETURNING id`, [a, three[0], three[1]])).rows[0].id;
    const suggested = (await pool.query(`INSERT INTO memory_links(user_id,memory_a_id,memory_b_id,source,status,relation_type,reason,confidence)
      VALUES($1,$2,$3,'ai','suggested','same_topic','Suggested link',90) RETURNING id`, [a, three[0], three[2]])).rows[0].id;
    const dismissed = (await pool.query(`INSERT INTO memory_links(user_id,memory_a_id,memory_b_id,source,status,relation_type,reason,confidence)
      VALUES($1,$2,$3,'ai','dismissed','same_topic','Forbidden dismissed link',90) RETURNING id`, [a, three[1], three[2]])).rows[0].id;
    const full = await request(a);
    assert.equal(full.status, 200);
    assert.equal(full.body.total_memory_count, 30);
    assert.equal(full.body.nodes.length, 34);
    assert.equal(full.body.truncated, false);
    assert.equal(full.body.nodes.filter((node: { kind: string }) => node.kind === "space").length, 3);
    assert.equal(full.body.nodes.find((node: { id: string }) => node.id === "person:sara smith").total_count, 30);
    assert.ok(full.body.nodes.filter((node: { kind: string }) => node.kind === "space")
      .every((node: { total_count: number; count: number }) => node.total_count === 10 && node.count === 10));
    assert.deepEqual(full.body.edges.filter((edge: { kind: string }) => edge.kind === "connection").map((edge: { connection_id: number }) => edge.connection_id), [confirmed]);
    verify(full.body, 150, allowed);
    const withSuggestions = await request(a, "?include_suggested=true");
    assert.equal(withSuggestions.status, 200);
    assert.ok(withSuggestions.body.edges.some((edge: { connection_id: number; suggested: boolean }) => edge.connection_id === suggested && edge.suggested));
    assert.equal(withSuggestions.body.edges.some((edge: { connection_id: number }) => edge.connection_id === dismissed), false);
    assert.equal(JSON.stringify(withSuggestions.body).includes("Forbidden"), false);
    const falseSuggestions = await request(a, "?include_suggested=false");
    assert.equal(falseSuggestions.body.edges.some((edge: { suggested: boolean }) => edge.suggested), false);
    const scoped = await request(a, `?space_id=${spaceIds[0]}`);
    assert.equal(scoped.status, 200);
    assert.equal(scoped.body.filtered_memory_count, 10);
    assert.equal(scoped.body.nodes.find((node: { kind: string }) => node.kind === "person").total_count, 10);
    assert.equal(scoped.body.nodes.find((node: { kind: string }) => node.kind === "space").total_count, 10);
    assert.ok(scoped.body.nodes.filter((node: { kind: string }) => node.kind === "memory").every((node: { memory_id: number }) => all30.indexOf(node.memory_id) % 3 === 0));
    assert.ok(scoped.body.nodes.filter((node: { kind: string }) => node.kind === "space").every((node: { space_id: string }) => node.space_id === spaceIds[0]));
    const typed = await request(a, "?types=task");
    assert.equal(typed.status, 200);
    assert.equal(typed.body.filtered_memory_count, 15);
    assert.equal(typed.body.total_memory_count, 30);
    assert.equal(typed.body.nodes.find((node: { kind: string }) => node.kind === "person").total_count, 15);
    assert.ok(typed.body.nodes.filter((node: { kind: string }) => node.kind === "space")
      .every((node: { total_count: number }) => node.total_count === 5));
    assert.ok(typed.body.nodes.filter((node: { kind: string }) => node.kind === "memory").every((node: { type: string }) => node.type === "task"));
    const combined = await request(a, "?types=note,task&from=2025-01-01&to=2025-01-03");
    assert.equal(combined.body.filtered_memory_count, 3);
    const dated = await request(a, "?from=2025-01-02&to=2025-01-02");
    assert.equal(dated.body.filtered_memory_count, 1);
    assert.deepEqual(dated.body.nodes.filter((node: { kind: string }) => node.kind === "memory").map((node: { memory_id: number }) => node.memory_id), [three[1]]);
    const noMatch = await request(a, "?types=receipt");
    assert.equal(noMatch.body.total_memory_count, 30);
    assert.equal(noMatch.body.filtered_memory_count, 0);
    assert.equal(noMatch.body.truncated, false);
    assert.equal(noMatch.body.nodes.find((node: { kind: string }) => node.kind === "space").total_count, 0);
    const otherGraph = await request(b);
    verify(otherGraph.body, 150, new Set([other]));
    assert.equal(otherGraph.body.total_memory_count, 1);
    assert.equal(JSON.stringify(full.body).includes("Private"), false);
    assert.equal(JSON.stringify(otherGraph.body).includes("Graph fixture"), false);
    for (const query of ["?limit=301", "?limit=0", "?limit=1.5", "?types=unknown", "?from=2025-02-30",
      "?from=2025-03-01&to=2025-01-01", "?include_suggested=1", "?include_suggested=false&include_suggested=true",
      "?types=note&types=task", "?space_id=bad", "?limit=10&limit=20"]) {
      assert.equal((await request(a, query)).status, 400, query);
    }
    // An older connected hub must survive a wave of recently captured isolated
    // memories. This also checks degree prioritization uses confirmed owner links.
    await pool.query(`INSERT INTO memory_links(user_id,memory_a_id,memory_b_id,source,status,relation_type,reason,confidence)
      SELECT $1::varchar,$2::int,id,'manual','confirmed','same_project','Older hub link',100
      FROM memories WHERE user_id=$1::varchar AND id=ANY($3::int[])`, [a, three[0], rest]);
    const added = (await pool.query(`INSERT INTO memories(user_id,title,type,people,raw_text,status)
      SELECT $1,'Graph scale '||i,'idea',ARRAY['Person '||i],'DO NOT RETURN SECRET','confirmed'
      FROM generate_series(31,300) i RETURNING id`, [a])).rows.map((row) => row.id as number);
    added.forEach((id) => allowed.add(id));
    const start = performance.now();
    const large = await request(a);
    assert.equal(large.status, 200);
    assert.equal(large.body.total_memory_count, 300);
    assert.equal(large.body.filtered_memory_count, 300);
    assert.equal(large.body.nodes.length, 150);
    assert.equal(large.body.truncated, true);
    assert.equal(large.body.nodes[0].space_id, spaceIds[0]);
    assert.ok(large.body.nodes.some((node: { memory_id: number }) => node.memory_id === three[0]), "Older high-degree memory retained");
    assert.ok(large.body.edges.some((edge: { connection_id: number }) => edge.connection_id === confirmed), "Visible connected neighbors retained");
    verify(large.body, 150, allowed);
    assert.ok(performance.now() - start < 10000, "300-memory route returns within 10s");
    const max = await getOwnerGraph(a, filter({ limit: "300", include_suggested: "true" }));
    assert.equal(max.nodes.length, 300);
    assert.equal(max.truncated, true, "300 memories plus Spaces/People exceeds 300 total nodes");
    verify(max, 300, allowed);
    const capped = await request(a, "?limit=5");
    assert.equal(capped.status, 200);
    verify(capped.body, 5, allowed);
    const cappedSara = capped.body.nodes.find((node: { id: string }) => node.id === "person:sara smith");
    assert.equal(cappedSara.total_count, 30, "Person total includes all filtered memories, not only graph candidates or visible IDs");
    assert.ok(cappedSara.count < cappedSara.total_count);
    assert.equal(cappedSara.count, cappedSara.memory_ids.length);
    assert.ok(capped.body.nodes.filter((node: { kind: string }) => node.kind === "space")
      .every((node: { total_count: number; count: number; memory_ids: number[] }) =>
        node.total_count === 10 && node.count < node.total_count && node.count === node.memory_ids.length));
    const today = new Date().toISOString().slice(0, 10);
    const creationDates = await getOwnerGraph(a, filter({ types: "idea", from: today, to: today }));
    assert.equal(creationDates.filtered_memory_count, 270, "Undated memories use creation calendar date");
    const tiny = await request(a, "?limit=1");
    assert.equal(tiny.body.nodes.length, 1);
    assert.equal(tiny.body.nodes[0].space_id, spaceIds[0]);
    assert.deepEqual(tiny.body.nodes[0].memory_ids, []);
    assert.equal(tiny.body.nodes[0].count, 0);
    assert.equal(tiny.body.nodes[0].total_count, 10, "Space total remains accurate even when no memory nodes fit the cap");
    assert.equal(tiny.body.truncated, true);
    // More than one bounded people-count batch, with same-memory duplicate
    // spellings and JS Unicode case/whitespace rules that differ from SQL lower.
    const paged = (await pool.query(`INSERT INTO memories(user_id,title,type,people,raw_text,status)
      SELECT $1,'Graph totals batch '||i,'note',$2::text[],'DO NOT RETURN SECRET','confirmed'
      FROM generate_series(1,1005) i RETURNING id`,
    [a, [" \uFEFFＳＡＲＡ\tSmith \uFEFF", "sara smith", "SARA SMITH", " İ \u00a0 ADA ", "i\u0307 ada"]])).rows.map((row) => row.id as number);
    paged.forEach((id) => allowed.add(id));
    const paginatedTotals = await request(a, "?limit=150");
    assert.equal(paginatedTotals.status, 200);
    verify(paginatedTotals.body, 150, allowed);
    const paginatedSara = paginatedTotals.body.nodes.find((node: { id: string }) => node.id === "person:sara smith");
    const unicodePerson = paginatedTotals.body.nodes.find((node: { id: string }) => node.id === "person:i\u0307 ada");
    assert.equal(paginatedTotals.body.total_memory_count, 1305);
    assert.equal(paginatedSara.total_count, 1035);
    assert.equal(unicodePerson.total_count, 1005);
    assert.ok(paginatedSara.memory_ids.length <= 150 && paginatedSara.count < paginatedSara.total_count);
    assert.ok(unicodePerson.memory_ids.length <= 150 && unicodePerson.count < unicodePerson.total_count);
  } finally {
    await pool.query("DELETE FROM users WHERE id=ANY($1::varchar[])", [[a, b]]);
  }
  assert.equal((await pool.query("SELECT id FROM memories WHERE user_id=ANY($1::varchar[])", [[a, b]])).rowCount, 0);
});