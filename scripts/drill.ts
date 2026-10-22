import { deepStrictEqual, strict as assert } from "node:assert";
import { mkdtemp, mkdir, readdir, rm } from "node:fs/promises";
import { resolve, join } from "node:path";
import { openDatabase } from "../src/db.ts";

await mkdir("artifacts", { recursive: true });
const dir = await mkdtemp(resolve("artifacts/drill-"));
const dbPath = join(dir, "source.db");
const replicaDir = join(dir, "replica");
const restoredPath = join(dir, "restored.db");
const statusPath = join(dir, "health.json");
const readyPath = join(dir, "ready.json");
const node = Bun.which("node");
if (!node) throw new Error("Node 24.22.1 must be on PATH.");
const env = { ...process.env, DB_PATH: dbPath, REPLICA_DIR: replicaDir, REPLICA_STATUS_PATH: statusPath };
let app: Bun.Subprocess | undefined;
let watcher: Bun.Subprocess<"ignore", "pipe", "pipe"> | undefined;
let url = "";
const observations: Record<string, unknown> = { bun: Bun.version, directory: dir };

async function nodeCommand(script: string, args: string[], overrides: Record<string, string> = {}, succeeds = true) {
  const process = Bun.spawn([node!, script, ...args], { env: { ...env, ...overrides }, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([
    new Response(process.stdout).text(), new Response(process.stderr).text(), process.exited,
  ]);
  if (succeeds && code !== 0) throw new Error(`Node command failed (${code}): ${stderr}\n${stdout}`);
  if (!succeeds && code === 0) throw new Error("Expected command to fail, but it succeeded.");
  if (succeeds && stdout.trim()) console.log(stdout.trim());
  return { stdout, stderr, code };
}

async function start() {
  await rm(readyPath, { force: true });
  app = Bun.spawn([process.execPath, "src/server.ts"], {
    env: { ...env, PORT: "0", READY_FILE: readyPath }, stdout: "inherit", stderr: "inherit",
  });
  for (let attempt = 0; attempt < 200; attempt++) {
    if (await Bun.file(readyPath).exists()) {
      url = (await Bun.file(readyPath).json()).url;
      assert.equal(new URL(url).hostname, "127.0.0.1");
      const health = await fetch(new URL("api/health", url)).then((r) => r.json());
      assert.equal(health.driver, "Bun SQL");
      assert.equal(health.runtime, "1.4.4");
      return;
    }
    if (app.exitCode !== null) throw new Error(`App exited on startup: ${app.exitCode}`);
    await Bun.sleep(50);
  }
  throw new Error("App startup timed out.");
}

async function stop() {
  if (!app) return;
  app.kill("SIGTERM");
  const timeout = setTimeout(() => app?.kill("SIGKILL"), 5000);
  const exit = await app.exited;
  clearTimeout(timeout);
  app = undefined;
  assert.equal(exit, 0);
}

async function request(path = "", method = "GET", body?: unknown) {
  const response = await fetch(new URL(`api/tasks${path}`, url), {
    method, headers: { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  assert.ok(response.ok, `HTTP ${method} ${path}: ${response.status} ${await response.clone().text()}`);
  return response.status === 204 ? null : response.json();
}

async function ltxFiles(path: string): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const child = join(path, entry.name);
    if (entry.isDirectory()) result.push(...await ltxFiles(child));
    else if (entry.name.endsWith(".ltx")) result.push(child);
  }
  return result;
}

try {
  await start();
  const first = await request("", "POST", { title: "Recovery seed", body: "Synthetic: snapshot base", status: "planned" });
  const deleted = await request("", "POST", { title: "Temporary note", body: "Synthetic: delete after snapshot", status: "planned" });
  const beforeRestart = await request();
  await stop();
  await start();
  deepStrictEqual(await request(), beforeRestart);
  observations.persistenceAcrossProcessRestart = true;

  await nodeCommand("scripts/replica.ts", ["snapshot"]);
  const snapshotHealth = await Bun.file(statusPath).json();
  await request(`/${first.id}`, "PUT", { title: "Recovery seed, grown", body: 'Synthetic: {"literal":"quoted JSON"}', status: "done" });
  await request(`/${deleted.id}`, "DELETE");
  await request("", "POST", { title: "'); DROP TABLE tasks; --", body: "Synthetic: bound, literal text", status: "active" });

  // A separate Bun SQL connection rolls a real Reylo transaction back.
  const connection = await openDatabase(dbPath);
  try {
    const { default: createTask } = await import("../src/queries/create_task.sql");
    await assert.rejects(connection.begin(async (tx) => {
      await createTask.run(tx, { id: "rolled-back", title: "Must not be backed up", body: "", status: "active" });
      throw new Error("drill rollback");
    }), /drill rollback/);
  } finally { await connection.close(); }
  assert.ok(!(await request()).some((row: { id: string }) => row.id === "rolled-back"));
  await nodeCommand("scripts/replica.ts", ["sync"]);
  const incrementalHealth = await Bun.file(statusPath).json();
  assert.ok(BigInt(incrementalHealth.localTXID) > BigInt(snapshotHealth.localTXID));
  assert.equal(incrementalHealth.inSync, true);

  await nodeCommand("scripts/replica.ts", ["restore", "--output", restoredPath]);
  const comparison = await nodeCommand("scripts/check-db.ts", [dbPath, restoredPath]);
  observations.snapshotAndIncrementalRestore = JSON.parse(comparison.stdout);
  observations.snapshotTXID = snapshotHealth.localTXID;
  observations.incrementalTXID = incrementalHealth.localTXID;
  observations.rollbackExcluded = true;
  const overwrite = await nodeCommand("scripts/replica.ts", ["restore", "--output", restoredPath], {}, false);
  assert.match(overwrite.stderr, /Refusing to overwrite/);
  observations.existingRestoreTargetRefused = true;

  // Real WAL checkpoint, graceful app restart, then a new committed write.
  const checkpointDb = await openDatabase(dbPath);
  await checkpointDb.unsafe("PRAGMA wal_checkpoint(TRUNCATE)");
  await checkpointDb.close();
  await stop();
  await start();
  await request("", "POST", { title: "After checkpoint and restart", body: "Synthetic: new WAL generation", status: "planned" });
  await nodeCommand("scripts/replica.ts", ["sync"]);
  const secondRestore = join(dir, "restored-after-restart.db");
  await nodeCommand("scripts/replica.ts", ["restore", "--output", secondRestore]);
  const secondComparison = await nodeCommand("scripts/check-db.ts", [dbPath, secondRestore]);
  observations.checkpointAndRestartRestore = JSON.parse(secondComparison.stdout);

  watcher = Bun.spawn([node, "scripts/replica.ts", "watch"], { env, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  let watchStartTXID: bigint | undefined;
  for (let attempt = 0; attempt < 200; attempt++) {
    const health = await Bun.file(statusPath).json();
    if (health.running && health.healthy) { watchStartTXID = BigInt(health.localTXID); break; }
    if (watcher.exitCode !== null) throw new Error(`Watcher exited: ${await new Response(watcher.stderr).text()}`);
    await Bun.sleep(50);
  }
  assert.ok(watchStartTXID !== undefined, "Watcher became healthy");
  const concurrent = await nodeCommand("scripts/replica.ts", ["sync"], {}, false);
  assert.match(concurrent.stderr, /EEXIST/);
  observations.concurrentReplicationRefused = true;
  await request("", "POST", { title: "Observed by the watcher", body: "Synthetic: live periodic replication", status: "active" });
  let watchedWrite = false;
  for (let attempt = 0; attempt < 200; attempt++) {
    const health = await Bun.file(statusPath).json();
    if (health.healthy && BigInt(health.localTXID) > watchStartTXID!) { watchedWrite = true; break; }
    await Bun.sleep(50);
  }
  assert.ok(watchedWrite, "Watcher replicated the new committed write");
  watcher.kill("SIGTERM");
  const watchExit = await watcher.exited;
  assert.equal(watchExit, 0, await new Response(watcher.stderr).text());
  watcher = undefined;
  const watchRestore = join(dir, "restored-watch.db");
  await nodeCommand("scripts/replica.ts", ["restore", "--output", watchRestore]);
  const watchComparison = await nodeCommand("scripts/check-db.ts", [dbPath, watchRestore]);
  observations.continuousReplicationRestore = JSON.parse(watchComparison.stdout);
  observations.finalTXID = (await Bun.file(statusPath).json()).localTXID;

  const invalidReplica = join(dir, "not-a-directory");
  const invalidHealth = join(dir, "unhealthy.json");
  await Bun.write(invalidReplica, "Synthetic invalid destination");
  const failure = await nodeCommand("scripts/replica.ts", ["sync"], {
    REPLICA_DIR: invalidReplica, REPLICA_STATUS_PATH: invalidHealth,
  }, false);
  assert.equal((await Bun.file(invalidHealth).json()).healthy, false);
  observations.invalidDestination = { exit: failure.code, healthy: false };
  observations.ltxFiles = (await ltxFiles(replicaDir)).map((path) => path.slice(replicaDir.length + 1));
  assert.ok((observations.ltxFiles as string[]).some((path) => path.includes("/9/")));
  assert.ok((observations.ltxFiles as string[]).filter((path) => path.includes("/0/")).length >= 2);
  await stop();
  observations.passed = true;
  await Bun.write(join(dir, "results.json"), JSON.stringify(observations, null, 2));
  console.log(JSON.stringify(observations, null, 2));
} finally {
  if (watcher) { watcher.kill("SIGTERM"); await watcher.exited; }
  if (app) { app.kill("SIGTERM"); await app.exited; }
}
