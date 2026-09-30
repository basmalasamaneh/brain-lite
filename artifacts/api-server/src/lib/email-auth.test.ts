import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import request from "supertest";
import { db, pool, uploadsTable, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import app from "../app";

test("two accounts cannot read, modify, cite, or fetch one another's records", async () => {
  const a = request.agent(app);
  const b = request.agent(app);
  const id = randomUUID();
  const firstEmail = `isolation-a-${id}@example.org`;
  const secondEmail = `isolation-b-${id}@example.org`;
  const password = "test-only-password-123";
  const accounts: string[] = [];
  try {
    for (const [agent, email] of [[a, firstEmail], [b, secondEmail]] as const) {
      const response = await agent.post("/api/auth/signup").send({
        email, password, name: "Test person", language: "en", theme: "system",
      });
      assert.equal(response.status, 201);
      accounts.push(response.body.user.id);
    }
    const unauthenticated = await request(app).get("/api/memories");
    assert.equal(unauthenticated.status, 401);
    assert.equal((await request(app).get("/api/auth/me")).status, 401);
    assert.equal((await request(app).get("/api/healthz")).status, 401);
    await a.delete("/api/memories/samples").expect(204);
    const [bMemory] = (await b.get("/api/memories").expect(200)).body;
    assert.ok(bMemory?.id);
    assert.deepEqual((await a.get("/api/memories").expect(200)).body, []);
    await a.get(`/api/memories/${bMemory.id}`).expect(404);
    await a.patch(`/api/memories/${bMemory.id}`).send({ title: "stolen" }).expect(404);
    await a.delete(`/api/memories/${bMemory.id}`).expect(404);
    await a.get(`/api/memories/${bMemory.id}/calendar`).expect(404);
    const answer = await a.post("/api/brain/ask").send({ question: "What are my memories?", language: "en" }).expect(200);
    assert.deepEqual(answer.body.source_ids, []);
    assert.deepEqual(answer.body.sources, []);
    const filePath = `/objects/uploads/${accounts[1]}/${randomUUID()}`;
    await db.insert(uploadsTable).values({
      path: filePath, userId: accounts[1], name: "private.pdf", size: 20, contentType: "application/pdf",
    });
    await a.get(`/api/storage${filePath}`).expect(404);
    assert.deepEqual((await a.get("/api/brain/export").expect(200)).body.uploads, []);
    assert.equal((await b.get("/api/memories").expect(200)).body.length, 5);
    await a.post("/api/auth/logout").expect(204);
    await a.get("/api/memories").expect(401);
  } finally {
    for (const userId of accounts) await db.delete(usersTable).where(eq(usersTable.id, userId));
    for (const userId of accounts) await pool.query("DELETE FROM sessions WHERE sess->>'userId' = $1", [userId]);
  }
});