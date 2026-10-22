import { DatabaseSync } from "node:sqlite";
import { deepStrictEqual } from "node:assert";
import { resolve } from "node:path";

const [source, restored] = process.argv.slice(2);
if (!source || !restored) throw new Error("Usage: node scripts/check-db.ts source.db restored.db");
function inspect(path: string) {
  const db = new DatabaseSync(resolve(path), { readOnly: true });
  try {
    const integrity = db.prepare("PRAGMA integrity_check").all();
    deepStrictEqual(integrity, [{ integrity_check: "ok" }].map((row) => Object.assign(Object.create(null), row)));
    return {
      rows: db.prepare("SELECT id, title, body, status, created_at, updated_at FROM tasks ORDER BY id").all(),
      schema: db.prepare("SELECT type,name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").all(),
      version: db.prepare("PRAGMA user_version").get(),
    };
  } finally { db.close(); }
}
const original = inspect(source);
const copy = inspect(restored);
deepStrictEqual(copy, original);
console.log(JSON.stringify({ equal: true, rows: original.rows.length, schemaEqual: true, integrity: "ok", runtime: process.version }));
