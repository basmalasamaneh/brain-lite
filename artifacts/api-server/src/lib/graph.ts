import { pool } from "@workspace/db";
import { ConnectionError } from "./connections";
import { assembleGraph, normalizeGraphPerson, type Graph, type GraphFilters, type GraphMemory, type GraphSpace, type GraphLink, type GraphMembership } from "./graph-utils";
import type { PoolClient } from "pg";

export { normalizeGraphPerson } from "./graph-utils";

const memoryFilter = `m.user_id=$1
  AND ($2::text[] IS NULL OR m.type=ANY($2::text[]))
  AND ($3::uuid IS NULL OR EXISTS (
    SELECT 1 FROM space_memories sm JOIN spaces s ON s.id=sm.space_id AND s.user_id=$1
    WHERE sm.user_id=$1 AND sm.memory_id=m.id AND sm.space_id=$3 AND sm.status='confirmed'))
  AND ($4::text IS NULL OR COALESCE(NULLIF(left(m.event_date,10),''),(m.created_at AT TIME ZONE 'UTC')::date::text)>=$4)
  AND ($5::text IS NULL OR COALESCE(NULLIF(left(m.event_date,10),''),(m.created_at AT TIME ZONE 'UTC')::date::text)<=$5)`;

async function populateFullScopeCounts(client: PoolClient, values: unknown[], graph: Graph): Promise<void> {
  const spaceNodes = graph.nodes.filter((node) => node.kind === "space");
  if (spaceNodes.length) {
    const totals = (await client.query<{ space_id: string; total: string }>(`
      SELECT sm.space_id,count(*) AS total FROM memories m
      JOIN space_memories sm ON sm.memory_id=m.id AND sm.user_id=$1 AND sm.status='confirmed'
      JOIN spaces s ON s.id=sm.space_id AND s.user_id=$1
      WHERE ${memoryFilter} AND sm.space_id=ANY($6::uuid[])
      GROUP BY sm.space_id`, [...values, spaceNodes.map((node) => node.space_id)])).rows;
    const bySpace = new Map(totals.map((row) => [row.space_id, Number(row.total)]));
    for (const node of spaceNodes) node.total_count = bySpace.get(node.space_id!) ?? 0;
  }
  const personNodes = graph.nodes.filter((node) => node.kind === "person");
  if (!personNodes.length) return;
  const byPerson = new Map(personNodes.map((node) => [node.id.slice("person:".length), 0]));
  // Count full-scope People exactly with the same JS Unicode normalization as
  // graph IDs and listMemories. SQL lower()/locale whitespace rules differ for
  // names such as İ and BOM. Stream only people arrays in bounded keyset batches,
  // not raw text, embeddings, or uncapped memory objects. Each memory counts once
  // even when its people field has multiple spelling variants of the same name.
  let after = 0;
  while (true) {
    const batch = (await client.query<{ id: number; people: string[] }>(`
      SELECT m.id,m.people FROM memories m
      WHERE ${memoryFilter} AND m.id>$6 AND cardinality(m.people)>0
      ORDER BY m.id LIMIT 1000`, [...values, after])).rows;
    for (const row of batch) {
      for (const name of new Set(row.people.map(normalizeGraphPerson))) {
        if (byPerson.has(name)) byPerson.set(name, byPerson.get(name)! + 1);
      }
    }
    if (batch.length < 1000) break;
    after = batch[batch.length - 1].id;
  }
  for (const node of personNodes) node.total_count = byPerson.get(node.id.slice("person:".length))!;
}

export async function getOwnerGraph(userId: string, filters: GraphFilters) {
  const client = await pool.connect();
  try {
    // One consistent snapshot for counts, nodes and reasons during edits/deletion.
    await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    if (filters.space_id) {
      const space = await client.query("SELECT id FROM spaces WHERE user_id=$1 AND id=$2", [userId, filters.space_id]);
      if (!space.rowCount) throw new ConnectionError(404, "Space not found");
    }
    const values = [userId, filters.types ? [...new Set(filters.types.split(",").map((type) => type.trim()))] : null,
      filters.space_id ?? null, filters.from ?? null, filters.to ?? null];
    const counts = (await client.query<{ total: string; filtered: string }>(`
      SELECT (SELECT count(*) FROM memories WHERE user_id=$1) AS total,
      count(*) AS filtered FROM memories m WHERE ${memoryFilter}`, values)).rows[0];
    // Select only lightweight metadata. SQL caps candidate memories before sending
    // them to JS; recent memories get a boost, but established older hubs still
    // compete instead of being displaced by every recent isolated memory.
    const memories = (await client.query<GraphMemory>(`
      WITH owned_links AS MATERIALIZED (
        SELECT l.memory_a_id,l.memory_b_id FROM memory_links l
        JOIN memories a ON a.id=l.memory_a_id AND a.user_id=$1
        JOIN memories b ON b.id=l.memory_b_id AND b.user_id=$1
        WHERE l.user_id=$1 AND (l.status='confirmed' OR ($6::boolean AND l.status='suggested'))
      ), degrees AS (
        SELECT endpoint.memory_id,count(*) AS degree FROM owned_links l
        CROSS JOIN LATERAL (VALUES (l.memory_a_id),(l.memory_b_id)) endpoint(memory_id)
        GROUP BY endpoint.memory_id
      ), ranked AS (
        SELECT m.id,m.title,m.type,m.event_date,m.status,m.created_at,m.people,
          COALESCE(d.degree,0) AS degree
        FROM memories m LEFT JOIN degrees d ON d.memory_id=m.id WHERE ${memoryFilter}
      )
      SELECT * FROM ranked
      ORDER BY (CASE WHEN created_at >= now()-interval '30 days' THEN 2 ELSE 0 END + 3*LEAST(degree,20)) DESC,
        created_at DESC, id DESC
      LIMIT $7`, [...values, filters.include_suggested, filters.limit])).rows;
    const ids = memories.map((memory) => memory.id);
    const spaces = (await client.query<GraphSpace>(`
      SELECT s.id,s.name,s.kind,s.pinned,s.created_at FROM spaces s
      WHERE s.user_id=$1 AND ($2::uuid IS NULL OR s.id=$2)
        AND ($5::boolean OR s.pinned OR s.id=$2 OR EXISTS (
          SELECT 1 FROM space_memories sm JOIN memories m ON m.id=sm.memory_id AND m.user_id=$1
          WHERE sm.user_id=$1 AND sm.space_id=s.id AND sm.status='confirmed' AND sm.memory_id=ANY($3::int[])))
      ORDER BY s.pinned DESC,s.updated_at DESC,s.id LIMIT $4`,
    [userId, filters.space_id ?? null, ids, filters.limit + 1, !filters.types && !filters.from && !filters.to])).rows;
    const selectedSpaces = spaces.slice(0, filters.limit);
    const memberships = (await client.query<GraphMembership>(`
      SELECT sm.space_id,sm.memory_id,sm.reason FROM space_memories sm
      JOIN spaces s ON s.id=sm.space_id AND s.user_id=$1
      JOIN memories m ON m.id=sm.memory_id AND m.user_id=$1
      WHERE sm.user_id=$1 AND sm.status='confirmed'
      AND sm.memory_id=ANY($2::int[]) AND sm.space_id=ANY($3::uuid[])`,
    [userId, ids, selectedSpaces.map((space) => space.id)])).rows;
    const links = (await client.query<GraphLink>(`
      SELECT l.id,l.memory_a_id,l.memory_b_id,l.status,l.relation_type,l.reason,l.created_at
      FROM memory_links l
      JOIN memories a ON a.id=l.memory_a_id AND a.user_id=$1
      JOIN memories b ON b.id=l.memory_b_id AND b.user_id=$1
      WHERE l.user_id=$1 AND l.memory_a_id=ANY($2::int[]) AND l.memory_b_id=ANY($2::int[])
      AND (l.status='confirmed' OR ($3::boolean AND l.status='suggested'))`,
    [userId, ids, filters.include_suggested])).rows;
    const graph = assembleGraph({ memories, spaces: selectedSpaces, memberships, links,
      total: Number(counts.total), filtered: Number(counts.filtered), limit: filters.limit,
      includeSuggested: filters.include_suggested, spacesOverflow: spaces.length > selectedSpaces.length });
    await populateFullScopeCounts(client, values, graph);
    await client.query("COMMIT");
    return graph;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}