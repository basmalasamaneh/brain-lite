// Provider-free listMemories person-filter regression tests.
// Run: node --test artifacts/api-server/src/routes/memories-person.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
const require = createRequire(new URL("../../package.json", import.meta.url));
const { build } = require("esbuild");
const base = {
  userId: "owner", is_sample: false, type: "note", title: "Unrelated title",
  summary: null, raw_text: "", transcript: null, event_date: null, amount: null,
  currency: null, tags: [], confidence: 100, status: "confirmed", file_path: null,
  created_at: new Date("2026-05-05"), extra: {},
};
const rows = [
  { ...base, id: 1, people: [" Ａｍａｌ\t Noor "] },
  { ...base, id: 2, people: ["AMAL NOOR", "Amal Noor"], type: "appointment" },
  { ...base, id: 3, people: ["Amal"] },
  { ...base, id: 4, people: [], title: "Amal Noor", raw_text: "Amal Noor" },
  { ...base, id: 5, people: ["  نور\n علي "] },
  { ...base, id: 90, userId: "foreign", people: ["Amal Noor"] },
];
let handler;
const mocks = {
  express: "export const Router=()=>({use(){},post(){},delete(){},patch(){},get(path,fn){if(path==='/memories')globalThis.__personRouteTest.register(fn)}});",
  "express-rate-limit": "export default ()=>()=>{};",
  "drizzle-orm": "export const and=(...x)=>x,eq=(column,value)=>({column,value}),desc=x=>x,ilike=()=>{},or=()=>{},sql=()=>{};",
  "drizzle-orm/node-postgres": "export const drizzle=()=>{};",
  "@workspace/db": "export const {db,memoriesTable}=globalThis.__personRouteTest; export const uploadsTable={};",
  extraction: "export const extractMemory=()=>{throw new Error('AI must not run')};",
  "capture-file": "export class CaptureFileError extends Error{}; export const MAX_CAPTURE_FILE_BYTES=0,readCaptureFile=()=>{};",
  calendar: "export const createCalendarEvent=()=>{},validEventDate=()=>true;",
  "brain-state": "export const activeCaptures=new Set(),deletingUsers=new Set();",
  "semantic-utils": "export const validDateFilter=()=>true;",
  spaces: "export const confirmCaptured=()=>{},requireSpace=()=>{};",
  "spaces-utils": `import {z} from ${JSON.stringify(require.resolve("zod"))}; export const spaceIdBody=z.string().uuid().optional();`,
  connections: "export class ConnectionError extends Error{}; export const ownerTransaction=()=>{};",
};
globalThis.__personRouteTest = {
  register(fn) { handler = fn; },
  memoriesTable: { userId: "userId", type: "type", status: "status" },
  db: { select() { return { from() { return { where(conditions) {
    assert.ok(conditions.some((condition) => condition?.column === "userId" && condition.value === "owner"), "List candidates must be ownership-scoped before person filtering");
    return { orderBy: async () => rows.filter((row) => conditions.every((condition) => !condition?.column || row[condition.column] === condition.value)) };
  } }; } }; } },
};
const result = await build({
  entryPoints: [new URL("./memories.ts", import.meta.url).pathname],
  bundle: true, write: false, platform: "node", format: "esm",
  plugins: [{ name: "person-route-dependencies", setup(build) {
    build.onResolve({ filter: /.*/ }, ({ path }) => {
      if (path === "@workspace/api-zod") return { path: new URL("../../../../lib/api-zod/src/generated/api.ts", import.meta.url).pathname };
      const key = path.startsWith("../lib/") ? path.slice("../lib/".length) : path;
      return mocks[key] === undefined ? undefined : { path: key, namespace: "person-test" };
    });
    build.onLoad({ filter: /.*/, namespace: "person-test" }, ({ path }) => ({
      contents: mocks[path], resolveDir: new URL("../../", import.meta.url).pathname,
    }));
  } }],
});
const { normalizePerson } = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
async function list(query) {
  const response = { statusCode: 200, body: undefined, status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; } };
  await handler({ query, user: { id: "owner" } }, response);
  return response;
}
test("Person Open normalizes NFKC/whitespace/case and matches the people array only, within ownership", async () => {
  assert.equal(normalizePerson(" Ａｍａｌ\tNoor "), "amal noor");
  assert.equal(normalizePerson(" نور\n علي "), "نور علي");
  for (const person of ["amal noor", "  AMAL \n NOOR  ", "Ａｍａｌ　Ｎｏｏｒ"]) {
    const result = await list({ person });
    assert.equal(result.statusCode, 200);
    assert.deepEqual(result.body.map(({ id }) => id), [1, 2]);
    assert.ok(result.body.every((row) => !("userId" in row)));
  }
  assert.deepEqual((await list({ person: "نور علي" })).body.map(({ id }) => id), [5]);
  assert.deepEqual((await list({ person: "Noor" })).body, [], "Person matching is not a substring search");
});
test("Person filtering composes with existing type/status filters and omission preserves existing lists", async () => {
  assert.deepEqual((await list({ person: "amal noor", type: "appointment", status: "confirmed" })).body.map(({ id }) => id), [2]);
  assert.equal((await list({})).body.length, 5);
  for (const person of ["", "   ", "x".repeat(201)]) assert.equal((await list({ person })).statusCode, 400);
});