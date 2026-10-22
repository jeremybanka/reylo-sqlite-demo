import { openDatabase } from "./db.ts";

const db = await openDatabase();
// Schema must exist before Reylo's query modules load.
const { createHandler } = await import("./app.ts");
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: Number(process.env.PORT ?? 4173),
  fetch: createHandler(db),
  maxRequestBodySize: 32 * 1024,
});
console.log(`Fieldnotes → ${server.url} (Bun ${Bun.version}, Bun SQL + Reylo)`);
if (process.env.READY_FILE) await Bun.write(process.env.READY_FILE, JSON.stringify({ url: server.url.toString(), pid: process.pid }));
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    await server.stop(true);
    await db.close();
    process.exit(0);
  });
}
