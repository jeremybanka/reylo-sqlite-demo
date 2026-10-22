import { openDatabase, defaultDatabasePath } from "../src/db.ts";
const db = await openDatabase();
const { default: create } = await import("../src/queries/create_task.sql");
const rows = await db`SELECT count(*) AS n FROM tasks`;
if (Number(rows[0].n) === 0 && !process.argv.includes("--empty")) {
  for (const task of [
    { title: "Catch a small idea", body: "A quieter space for the next thing worth making.", status: "planned" },
    { title: "Build something that stays", body: "SQL lives in its own files. Reylo brings the types. Bun writes to SQLite.", status: "active" },
    { title: "Practice the recovery", body: "Snapshot, write, replicate, restore. A backup earns trust when it comes back.", status: "done" },
  ]) await create.run(db, { id: crypto.randomUUID(), ...task });
}
console.log(`Initialized ${defaultDatabasePath}`);
await db.close();
