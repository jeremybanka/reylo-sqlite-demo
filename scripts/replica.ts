import { Replica, FileReplicaClient } from "@platformatic/sqlite-js-stream";
import { mkdir, open, lstat, unlink, writeFile, rename } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

if (typeof (globalThis as Record<string, unknown>).Bun !== "undefined") {
  throw new Error("Replication requires the separate Node runtime, not Bun.");
}
const [major, minor, patch] = process.versions.node.split(".").map(Number);
if (major !== 24 || minor! < 22 || (minor === 22 && patch! < 1)) {
  throw new Error(`Use pinned Node 24.22.1 (got ${process.version}).`);
}
const command = process.argv[2];
if (!["backup", "snapshot", "sync", "watch", "restore"].includes(command ?? "")) {
  throw new Error("Usage: node scripts/replica.ts backup|snapshot|sync|watch|restore [--output fresh.db]");
}
const dbPath = resolve(process.env.DB_PATH ?? "data/app.db");
const replicaDir = resolve(process.env.REPLICA_DIR ?? "replicas/local");
const healthPath = resolve(process.env.REPLICA_STATUS_PATH ?? "data/replication-status.json");
const outputIndex = process.argv.indexOf("--output");
const outputPath = outputIndex >= 0 ? process.argv[outputIndex + 1] : undefined;
const stringify = (value: unknown) => JSON.stringify(value, (_, v) => typeof v === "bigint" ? v.toString() : v, 2);
const replica = new Replica(dbPath, new FileReplicaClient(replicaDir), {
  debug() {}, info: console.info, warn: console.warn, error: console.error,
});

async function assertMissing(path: string) {
  try { await lstat(path); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
  throw new Error(`Refusing to overwrite existing restore target: ${path}`);
}

async function health(healthy: boolean, extra: Record<string, unknown>) {
  const value = { healthy, checkedAt: new Date().toISOString(), dbPath, replicaDir, ...extra };
  await mkdir(dirname(healthPath), { recursive: true });
  await writeFile(`${healthPath}.tmp`, stringify(value));
  await rename(`${healthPath}.tmp`, healthPath);
  return value;
}

let lock: Awaited<ReturnType<typeof open>> | undefined;
const lockPath = `${dbPath}.replication.lock`;
try {
  // One writer to a replica/cache at a time. A crashed process can leave a lock;
  // remove it manually only after confirming no replication process is running.
  await mkdir(dirname(dbPath), { recursive: true });
  lock = await open(lockPath, "wx");
  await lock.writeFile(String(process.pid));
  if (command === "restore") {
    if (!outputPath) throw new Error("Restore requires --output pointing to a fresh, separate database.");
    const target = resolve(outputPath);
    if (target === dbPath) throw new Error("Restore target must differ from the source DB.");
    for (const suffix of ["", "-wal", "-shm", ".tmp"]) await assertMissing(`${target}${suffix}`);
    await replica.restore({ outputPath: target });
    console.log(stringify({ restored: target, replicaDir, runtime: process.version }));
  } else {
    await replica.sync();
    if (["backup", "snapshot", "watch"].includes(command!)) await replica.snapshot();
    if (command === "watch") {
      let stopped = false;
      for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => { stopped = true; });
      console.log(`Replicating ${dbPath} → ${replicaDir} (Node ${process.version})`);
      while (!stopped) {
        await replica.sync();
        const status = await replica.syncStatus();
        if (!status.inSync) throw new Error("Replica reports pending local LTX files.");
        await health(true, { ...status, running: true });
        await sleep(1000);
      }
      await replica.sync();
    }
    const status = await replica.syncStatus();
    if (!status.inSync) throw new Error("Replica is not in sync.");
    console.log(stringify(await health(true, { ...status, running: false, runtime: process.version })));
  }
} catch (error) {
  // Fail loudly; Replica.run() otherwise logs transient errors and continues.
  if (lock && command !== "restore") await health(false, { running: false, error: error instanceof Error ? error.message : String(error) });
  console.error(error);
  process.exitCode = 1;
} finally {
  replica.close();
  if (lock) { await lock.close(); await unlink(lockPath); }
}
