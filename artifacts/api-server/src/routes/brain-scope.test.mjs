// Provider-free boundary tests, invoking the registered Express handler with
// isolated route dependencies. Run: node --test artifacts/api-server/src/routes/brain-scope.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
const require = createRequire(new URL("../../package.json", import.meta.url));
const { build } = require("esbuild");
const zodPath = JSON.stringify(require.resolve("zod"));
const state = { handler: undefined, oneHopCalls: 0, retrievalCalls: [] };
globalThis.__brainScopeRouteTest = state;
const mocks = {
  express: `export const Router=()=>({use(){},get(){},delete(){},post(path,...handlers){if(path==='/brain/ask')globalThis.__brainScopeRouteTest.handler=handlers.at(-1)}});`,
  "express-rate-limit": "export default ()=>()=>{};",
  "drizzle-orm": "export const and=(...x)=>x,eq=(...x)=>x,inArray=(...x)=>x,sql=()=>{};",
  "@workspace/db": "export const db={},pool={},memoriesTable={},uploadsTable={},usersTable={},spacesTable={};",
  "@workspace/api-zod": `import {z} from ${zodPath};
    export const AskBrainBody=z.object({question:z.string().min(1),language:z.enum(['en','ar']),timezone:z.string().optional()});
    export const AskBrainResponse={parse:x=>x},DeleteBrainDataBody={},DeleteBrainDataResponse={},ExportBrainDataResponse={};`,
  objectStorage: "export class ObjectStorageService{}; export class ObjectNotFoundError extends Error{};",
  "brain-state": "export const activeCaptures=new Set(),activeQuestions=new Map(),activeUploadRequests=new Set(),deletingUsers=new Set();",
  "semantic-search": `export class InvalidMemoryScopeError extends Error{};
    export const publicMemory=x=>x;
    export async function retrieveForQuestion(...args){
      globalThis.__brainScopeRouteTest.retrievalCalls.push(args);
      if(args[4]?.includes(90))throw new InvalidMemoryScopeError();
      return {related:[],aggregate:undefined};
    }`,
  "semantic-utils": "export const validTimezone=x=>x==='UTC';",
  connections: "export class ConnectionError extends Error{}; export async function confirmedOneHop(){globalThis.__brainScopeRouteTest.oneHopCalls++;return [];}",
  spaces: "export const requireSpace=async()=>{},serializeSpace=x=>x;",
  "spaces-utils": `import {z} from ${zodPath}; export const spaceIdBody=z.string().uuid().optional();`,
  "brain-answer": "export const noDataAnswer=()=> 'No scoped memories found',prepareContext=()=>{},parseGroundedAnswer=()=>{}; export function generateGroundedAnswer(){throw new Error('AI must never be invoked in these tests')};",
};
const result = await build({
  entryPoints: [new URL("./brain.ts", import.meta.url).pathname],
  bundle: true, write: false, platform: "node", format: "esm",
  plugins: [{ name: "route-scope-test-mocks", setup(build) {
    build.onResolve({ filter: /.*/ }, ({ path }) => {
      const key = path.startsWith("../lib/") ? path.slice("../lib/".length) : path;
      return mocks[key] === undefined ? undefined : { path: key, namespace: "route-test" };
    });
    build.onLoad({ filter: /.*/, namespace: "route-test" }, ({ path }) => ({
      contents: mocks[path], resolveDir: new URL("../../", import.meta.url).pathname,
    }));
  } }],
});
await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
async function invoke(body) {
  const response = { statusCode: 200, body: undefined, status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; } };
  await state.handler({ body, user: { id: "owner" }, log: { warn() {} } }, response);
  return response;
}
test("Brain boundary strictly validates memory_ids and maps unavailable IDs to an opaque error", async () => {
  for (const ids of [[], [0], [-1], [1.5], ["1"], null, "1,2", [2147483648], Array(301).fill(1)]) {
    const before = state.retrievalCalls.length;
    const result = await invoke({ question: "Coffee", language: "en", memory_ids: ids });
    assert.equal(result.statusCode, 400);
    assert.equal(state.retrievalCalls.length, before);
  }
  const unavailable = await invoke({ question: "Coffee", language: "en", memory_ids: [1, 90] });
  assert.equal(unavailable.statusCode, 404);
  assert.doesNotMatch(unavailable.body.error, /90|foreign|owner/i);
});
test("explicit graph IDs disable one-hop expansion while Space-only Ask keeps it", async () => {
  state.oneHopCalls = 0;
  const strict = await invoke({ question: "Coffee", language: "en", memory_ids: [1, 2] });
  assert.equal(strict.statusCode, 200);
  assert.deepEqual(state.retrievalCalls.at(-1).slice(0, 5), ["owner", "Coffee", "UTC", undefined, [1, 2]]);
  assert.equal(state.oneHopCalls, 0);
  const space = "00000000-0000-4000-8000-000000000001";
  const combined = await invoke({ question: "Coffee", language: "ar", space_id: space, memory_ids: [2] });
  assert.equal(combined.statusCode, 200);
  assert.deepEqual(state.retrievalCalls.at(-1).slice(3), [space, [2]]);
  assert.equal(state.oneHopCalls, 0);
  const existing = await invoke({ question: "Coffee", language: "en", space_id: space });
  assert.equal(existing.statusCode, 200);
  assert.equal(state.oneHopCalls, 1);
});