// Provider-free retrieval regression tests. SQL mocks require ownership and
// allow-list predicates on EVERY retrieval query; deterministic vectors avoid AI.
// Run: node --test artifacts/api-server/src/lib/graph-ask-scope.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

const require = createRequire(new URL("../../package.json", import.meta.url));
const { build } = require("esbuild");
const vector = Array(768).fill(1);
const fixtures = Array.from({ length: 12 }, (_, i) => ({
  id: i + 1, userId: "owner", type: "receipt", title: `Coffee Acme ${i + 1}`,
  raw_text: "Coffee purchase at Acme", summary: "Coffee", tags: ["coffee"], people: ["Acme"],
  event_date: "2026-05-05", amount: 10, currency: i === 11 ? "EUR" : "USD",
  embedding: vector, created_at: new Date("2026-05-05"),
}));
fixtures.push({ ...fixtures[0], id: 90, userId: "foreign", amount: 9999 });
const allow = fixtures.filter((row) => row.userId === "owner").map((row) => row.id);
let queries = [];
let selection = [];
let allowed = allow;
let scopeRequired = true;
let selectedSpaceIds;
const pool = {
  async connect() {
    return { query: async () => ({ rows: [], rowCount: 0 }), release() {} };
  },
  async query(text, values = []) {
    queries.push({ text, values });
    if (text.includes("pg_attribute")) return { rows: [{ typname: "_float8", storage_type: "double precision[]" }] };
    if (text.startsWith("UPDATE memory_embedding_jobs")) return { rows: [], rowCount: 0 };
    if (text.startsWith("SELECT id FROM memories")) {
      return { rows: fixtures.filter((row) => row.userId === values[0] && values[1].includes(row.id)).map(({ id }) => ({ id })) };
    }
    assert.match(text, /m\.user_id=\$1/, "SQL retrieval must always enforce ownership");
    const match = text.match(/m\.id=ANY\(\$(\d+)::int\[\]\)/);
    if (scopeRequired) assert.ok(match, "Every vector, exact, sample and aggregate query must have the allow-list");
    if (match) assert.deepEqual(values[Number(match[1]) - 1], allowed);
    let rows = fixtures.filter((row) => row.userId === values[0] && (!match || allowed.includes(row.id)));
    if (selectedSpaceIds) {
      assert.match(text, /sm\.status='confirmed'/);
      rows = rows.filter((row) => selectedSpaceIds.includes(row.id));
    }
    if (text.includes("::text[]")) {
      const terms = values.find((value) => Array.isArray(value) && typeof value[0] === "string");
      rows = rows.filter((row) => terms.every((term) => `${row.title} ${row.raw_text}`.toLowerCase().split(/\W+/).includes(term)));
    }
    if (text.includes("sum(m.amount)")) {
      assert.doesNotMatch(text, /LIMIT/i, "Totals must aggregate all scoped matching rows, not top-k");
      const currencies = [...new Set(rows.map((row) => row.currency))];
      return { rows: currencies.map((currency) => {
        const group = rows.filter((row) => row.currency === currency);
        return { currency, count: group.length, total_amount: group.reduce((sum, row) => sum + row.amount, 0) };
      }) };
    }
    selection = text.includes("LIMIT 8") ? rows.slice(0, 8) : rows;
    const result = text.includes("m.embedding") ? selection.map(({ id, embedding }) => ({ id, embedding }))
      : selection.map(({ id }) => ({ id }));
    return { rows: result, rowCount: result.length };
  },
};
globalThis.__graphScopeTestDb = {
  pool,
  memoriesTable: { userId: "userId", id: "id" },
  db: { select() { return { from() { return { where: async () => selection.map((row) => ({ ...row })) }; } }; } },
};

const result = await build({
  entryPoints: [new URL("./semantic-search.ts", import.meta.url).pathname],
  bundle: true, write: false, platform: "node", format: "esm", logLevel: "silent",
  define: { "import.meta.url": JSON.stringify(new URL("./semantic-search.ts", import.meta.url).href) },
  plugins: [{
    name: "provider-free-scope-fixtures",
    setup(build) {
      build.onResolve({ filter: /^(@workspace\/db|@workspace\/api-zod|@google\/genai|drizzle-orm)$/ }, ({ path }) => ({ path, namespace: "scope-fixtures" }));
      build.onLoad({ filter: /.*/, namespace: "scope-fixtures" }, ({ path }) => ({
        contents: path === "@workspace/db" ? "export const {db,pool,memoriesTable}=globalThis.__graphScopeTestDb;"
          : path === "@workspace/api-zod" ? "export const GetMemoryResponse={parse:v=>v};"
            : path === "drizzle-orm" ? "export const and=(...v)=>v,eq=(...v)=>v,inArray=(...v)=>v;"
              : "export class GoogleGenAI { constructor(){throw new Error('AI must not be called in scope tests')} }",
      }));
      build.onResolve({ filter: /\/logger$|^\.\/logger$/ }, () => ({ path: "logger", namespace: "scope-logger" }));
      build.onLoad({ filter: /.*/, namespace: "scope-logger" }, () => ({ contents: "export const logger={info(){},warn(){}};" }));
      build.onLoad({ filter: /semantic-search\.ts$/ }, async ({ path }) => ({
        contents: (await readFile(path, "utf8")).replace("await queryEmbedding(userId, query)", "Array(768).fill(1)"),
        loader: "ts",
      }));
    },
  }],
});
const { retrieveForQuestion, InvalidMemoryScopeError } = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);

test("strict graph retrieval scopes exact/vector candidates, aggregates, qualifiers and ownership without AI", async (t) => {
  await t.test("reject foreign, missing, empty and invalid IDs before semantic initialization/retrieval", async () => {
    for (const ids of [[90], [1, 90], [999], [], [0], [-1], [1.5], Array(301).fill(1)]) {
      queries = [];
      await assert.rejects(retrieveForQuestion("owner", "coffee", "UTC", undefined, ids), InvalidMemoryScopeError);
      assert.ok(queries.every(({ text }) => text.startsWith("SELECT id FROM memories")));
    }
  });
  await t.test("all 12 rows are summed, only 8 are sampled and currencies stay separate", async () => {
    const result = await retrieveForQuestion("owner", "How much did I spend on 2026-05-05?", "UTC", undefined, allow);
    assert.equal(result.related.length, 8);
    assert.equal(result.aggregate.count, 12);
    assert.deepEqual(result.aggregate.groups, [
      { currency: "USD", count: 11, total_amount: 110 }, { currency: "EUR", count: 1, total_amount: 10 },
    ]);
    assert.deepEqual(result.aggregate.scope.memory_ids, allow);
  });
  await t.test("exact and float-vector ranking cannot retrieve matching records outside scope", async () => {
    allowed = [1, 2];
    queries = [];
    const result = await retrieveForQuestion("owner", "Coffee Acme", "UTC", undefined, allowed);
    assert.deepEqual(new Set(result.related.map(({ memory }) => memory.id)), new Set(allowed));
    assert.ok(queries.some(({ text }) => text.includes("m.embedding")));
    assert.ok(queries.some(({ text }) => text.includes("SELECT m.id FROM memories") && !text.includes("LIMIT")));
  });
  await t.test("qualified spending and absent qualifier never fall back to broader totals", async () => {
    const qualified = await retrieveForQuestion("owner", "How much did I spend at Acme on 2026-05-05?", "UTC", undefined, allowed);
    assert.equal(qualified.aggregate.count, 2);
    const absent = await retrieveForQuestion("owner", "How much did I spend on rocket fuel on 2026-05-05?", "UTC", undefined, allowed);
    assert.equal(absent.aggregate.count, 0);
    assert.deepEqual(absent.related, []);
  });
  await t.test("combined Space scope intersects graph IDs; omitted graph scope preserves Space filtering", async () => {
    selectedSpaceIds = [2];
    const strict = await retrieveForQuestion("owner", "How much did I spend on 2026-05-05?", "UTC", "space-fixture", allowed);
    assert.equal(strict.aggregate.count, 1);
    assert.deepEqual(strict.related.map(({ memory }) => memory.id), [2]);
    scopeRequired = false;
    const existing = await retrieveForQuestion("owner", "How much did I spend on 2026-05-05?", "UTC", "space-fixture");
    assert.equal(existing.aggregate.count, 1);
    assert.equal(existing.aggregate.scope.memory_ids, undefined);
    selectedSpaceIds = undefined;
  });
});