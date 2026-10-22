import type { SQL } from "bun";
import listTasks from "./queries/list_tasks.sql";
import getTask from "./queries/get_task.sql";
import createTask from "./queries/create_task.sql";
import updateTask from "./queries/update_task.sql";
import deleteTask from "./queries/delete_task.sql";

const statuses = ["planned", "active", "done"];
const json = (body: unknown, status = 200) => Response.json(body, { status });

function input(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected a task object.");
  const { title, body, status } = value as Record<string, unknown>;
  if (typeof title !== "string" || !title.trim() || title.trim().length > 120) {
    throw new Error("Title must contain 1–120 characters.");
  }
  if (typeof body !== "string" || body.length > 4000) throw new Error("Notes must be at most 4,000 characters.");
  if (typeof status !== "string" || !statuses.includes(status)) throw new Error("Choose a valid column.");
  return { title: title.trim(), body, status };
}

export function createHandler(db: SQL, publicDir = new URL("../public/", import.meta.url)) {
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    const { pathname } = url;
    if (pathname.startsWith("/api/")) {
      // This local demo has no authentication. Reject cross-origin mutation attempts.
      const origin = request.headers.get("origin");
      if (!["GET", "HEAD"].includes(request.method) && origin && origin !== url.origin) {
        return json({ error: "Cross-origin writes are disabled." }, 403);
      }
      try {
        if (pathname === "/api/health" && request.method === "GET") {
          await db`SELECT 1`;
          return json({ ok: true, driver: "Bun SQL", runtime: Bun.version });
        }
        if (pathname === "/api/tasks") {
          if (request.method === "GET") return json(await listTasks.run(db));
          if (request.method === "POST") {
            const task = input(await request.json());
            return json(await createTask.run(db, { id: crypto.randomUUID(), ...task }), 201);
          }
        }
        const match = /^\/api\/tasks\/([a-zA-Z0-9-]+)$/.exec(pathname);
        if (match?.[1]) {
          const id = match[1];
          if (request.method === "GET") {
            const task = await getTask.run(db, { id });
            return task ? json(task) : json({ error: "Task not found." }, 404);
          }
          if (request.method === "PUT") {
            const task = input(await request.json());
            const updated = await updateTask.run(db, { id, ...task });
            return updated ? json(updated) : json({ error: "Task not found." }, 404);
          }
          if (request.method === "DELETE") {
            const removed = await deleteTask.run(db, { id });
            return removed ? new Response(null, { status: 204 }) : json({ error: "Task not found." }, 404);
          }
        }
        return json({ error: "Route or method not found." }, 404);
      } catch (error) {
        if (error instanceof SyntaxError || (error instanceof Error && /Expected a task|Title must|Notes must|Choose a valid/.test(error.message))) {
          return json({ error: (error as Error).message }, 400);
        }
        console.error(error);
        return json({ error: "Database request failed. See the local server log." }, 500);
      }
    }
    const files: Record<string, string> = { "/": "index.html", "/app.js": "app.js", "/style.css": "style.css" };
    const file = files[pathname];
    if (request.method !== "GET" || !file) return new Response("Not found", { status: 404 });
    return new Response(Bun.file(new URL(file, publicDir)), {
      headers: {
        "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "no-cache",
      },
    });
  };
}
