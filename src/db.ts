import { SQL } from "bun";
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export const defaultDatabasePath = resolve(process.env.DB_PATH ?? "data/app.db");

export async function openDatabase(filename = defaultDatabasePath) {
  await mkdir(dirname(filename), { recursive: true });
  const db = new SQL({ adapter: "sqlite", filename, safeIntegers: true });
  await db.unsafe("PRAGMA journal_mode = WAL");
  await db.unsafe("PRAGMA busy_timeout = 5000");
  await db.unsafe("PRAGMA foreign_keys = ON");
  // Individual statements: Bun SQL prepares one statement at a time.
  const schema = await Bun.file(new URL("../db/schema.sql", import.meta.url)).text();
  for (const statement of schema.split(";").map((s) => s.trim()).filter(Boolean)) {
    await db.unsafe(statement);
  }
  return db;
}
