import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../src/db.ts";

const dir = await mkdtemp(join(tmpdir(), "fieldnotes-test-"));
const path = join(dir, "test.db");
let db = await openDatabase(path);
const { createHandler } = await import("../src/app.ts");
let handler = createHandler(db);
afterAll(async () => { await db.close(); await rm(dir, { recursive: true, force: true }); });
const req = (path = "", method = "GET", body?: unknown, origin?: string) => handler(new Request(`http://127.0.0.1:3000/api/tasks${path}`, {
  method, headers: { "Content-Type": "application/json", ...(origin ? { Origin: origin } : {}) },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
}));

describe("real Reylo + Bun SQL CRUD", () => {
  test("create, read, update, restart persistence, delete and missing IDs", async () => {
    const response = await req("", "POST", { title: "A small idea", body: "Synthetic note", status: "planned" });
    expect(response.status).toBe(201);
    const created = await response.json();
    expect(created.title).toBe("A small idea");
    expect((await (await req(`/${created.id}`)).json()).id).toBe(created.id);
    const update = await req(`/${created.id}`, "PUT", { title: "A lasting idea", body: "Updated", status: "done" });
    expect(update.status).toBe(200);
    expect((await update.json()).status).toBe("done");
    await db.close();
    db = await openDatabase(path);
    handler = createHandler(db);
    const persisted = await (await req(`/${created.id}`)).json();
    expect(persisted.title).toBe("A lasting idea");
    expect(persisted.created_at).toBe(created.created_at);
    expect((await req(`/${created.id}`, "DELETE")).status).toBe(204);
    expect((await req(`/${created.id}`)).status).toBe(404);
    expect((await req(`/${created.id}`, "PUT", { title: "Missing", body: "", status: "planned" })).status).toBe(404);
    expect((await req(`/${created.id}`, "DELETE")).status).toBe(404);
  });

  test("bound strings preserve quotes, injection text and markup", async () => {
    const title = "'); DROP TABLE tasks; --";
    const body = '<script>alert("synthetic")</script> {"quoted":"JSON"}';
    const created = await (await req("", "POST", { title, body, status: "active" })).json();
    expect(created.title).toBe(title);
    expect(created.body).toBe(body);
    expect((await (await req()).json()).length).toBe(1);
    await req(`/${created.id}`, "DELETE");
  });

  test("invalid input, malformed JSON and cross-origin writes fail", async () => {
    for (const body of [null, [], {}, { title: " ", body: "", status: "planned" }, { title: "x", body: "x".repeat(4001), status: "planned" }, { title: "x", body: "", status: "nope" }]) {
      expect((await req("", "POST", body)).status).toBe(400);
    }
    expect((await handler(new Request("http://127.0.0.1:3000/api/tasks", { method: "POST", body: "{" }))).status).toBe(400);
    expect((await req("", "POST", { title: "x", body: "", status: "planned" }, "https://example.invalid")).status).toBe(403);
    expect((await (await req()).json()).length).toBe(0);
  });

  test("rolled-back Reylo writes do not persist", async () => {
    const { default: create } = await import("../src/queries/create_task.sql");
    await expect(db.begin(async (tx) => {
      await create.run(tx, { id: "rollback", title: "Should not survive", body: "", status: "planned" });
      throw new Error("Intentional rollback");
    })).rejects.toThrow("Intentional rollback");
    expect((await (await req()).json()).length).toBe(0);
  });

  test("static files are allowlisted with a local content policy", async () => {
    const response = await handler(new Request("http://127.0.0.1:3000/"));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-security-policy")).toContain("default-src 'self'");
    expect((await response.text())).toContain("Fieldnotes");
    expect((await handler(new Request("http://127.0.0.1:3000/package.json"))).status).toBe(404);
  });
});
