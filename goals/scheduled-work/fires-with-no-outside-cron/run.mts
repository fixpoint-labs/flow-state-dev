/** What this run proves is `goal.md` beside this file. */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { REPO_ROOT, freePort, goalTmpDir, runGoal, stopProcessGroup } from "../../lib/index.mts";
import { assertPatched, describePatches, modulePatchEnv, type ModulePatch } from "../../lib/module-patch.mts";
import { CRON_SECRET, PLAIN_FLOW, SCHEDULE_KEY, readLedger, type ClaimRow, type FireRow } from "./app.mts";
import { sleep } from "../../lib/time.mts";

const HERE = dirname(fileURLToPath(import.meta.url));
const HOST = join(HERE, "host.mts");
const CONFIG = join(HERE, "fsdev.config.mts");
const TSX = join(REPO_ROOT, "packages/fsdev/node_modules/.bin/tsx");
const FSDEV = join(REPO_ROOT, "packages/fsdev/bin/fsdev.ts");
const SCRATCH = goalTmpDir("fires-with-no-outside-cron");
const MINUTE = 60_000;
/** The spec's handover bound, and what the tick itself may take past it to write its claim. */
const HANDOVER_MS = 3 * MINUTE;
const TICK_SLACK_MS = 5_000;
const CLI_RUN_MS = 90_000;

/** The controls: each degrades one behaviour in the code under test, as it loads. */
const CONTROLS: Record<string, ModulePatch[]> = {
  // Every process ticks, holding the lease or not.
  "no-lease": [
    {
      module: "packages/engine/src/execution/local-scheduler.ts",
      from: String.raw`if \(stopped \|\| leaseId === undefined \|\| running !== undefined\) return;`,
      to: "if (stopped || running !== undefined) return;"
    }
  ],
  // The tick skips static schedules and claims indexes only, as serve()'s tick did.
  "index-only": [
    { module: "packages/engine/src/execution/schedule-tick.ts", from: String.raw`if \(schedule\.enabled === false\) continue;`, to: "continue;" }
  ],
  // The router leaves its built-in scheduled endpoint out: an app with no adapter line has no schedule route.
  "no-builtin-mount": [
    { module: "packages/engine/src/routes/createFlowApiRouter.ts", from: String.raw`createScheduledEndpointAdapter\(\),`, to: "" }
  ],
  // The local cron starts when the runtime resolves, so `fsdev run` ticks too.
  "cli-ticks": [
    {
      module: "packages/engine/src/flowstate/createFlowState.ts",
      from: String.raw`const mode = jobQueue\?\.mode \?\? "colocated";`,
      to: 'const mode = jobQueue?.mode ?? "colocated"; this.#armLocalScheduler(stores);'
    }
  ]
};
const control = process.env.GOAL_CONTROL;
if (control !== undefined && CONTROLS[control] === undefined) {
  throw new Error(`setup: unknown GOAL_CONTROL "${control}"; known: ${Object.keys(CONTROLS).join(", ")}`);
}
const mark = join(SCRATCH, "patched.txt");
const patchEnv = control === undefined ? {} : modulePatchEnv(CONTROLS[control]!, REPO_ROOT, mark);
if (control !== undefined) console.error(`control ${control}:\n${describePatches(CONTROLS[control]!, REPO_ROOT)}`);

/** The environment every process runs with: no machine model overrides, the scheduler's secret, the control. */
function baseEnv(extra: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && !key.startsWith("FSDEV_") && !key.startsWith("GOAL_")) env[key] = value;
  }
  return { ...env, NODE_ENV: "development", CRON_SECRET, ...patchEnv, ...extra };
}

/** Start one host process; resolve once it prints `__READY__`. */
async function startHost(name: string, env: Record<string, string>): Promise<ChildProcess> {
  const child = spawn(TSX, [HOST], { env: baseEnv({ GOAL_PROCESS: name, ...env }), detached: true, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`setup: ${name} did not start in 60 s:\n${output}`)), 60_000);
    const hear = (chunk: Buffer) => {
      output += chunk.toString();
      if (output.includes("__READY__")) {
        clearTimeout(timer);
        resolve(child);
      }
    };
    child.stdout!.on("data", hear);
    child.stderr!.on("data", (chunk: Buffer) => {
      output += chunk.toString();
      if (process.env.GOAL_VERBOSE === "1") process.stderr.write(`[${name}] ${chunk}`);
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      if (!output.includes("__READY__")) reject(new Error(`setup: ${name} exited ${code} before it served:\n${output}`));
    });
  });
}

/** Wait until `when` holds, reading the ledger every two seconds; give up after `ms`. */
async function until(ledger: string, ms: number, when: (rows: { fires: FireRow[]; claims: ClaimRow[] }) => boolean): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (when(readLedger(ledger))) return;
    await sleep(2_000);
  }
}

const minuteOf = (at: number) => Math.floor(at / MINUTE) * MINUTE;
const iso = (at: number) => new Date(at).toISOString().slice(11, 16);

/** Fires per scheduled time, for one origin. */
function countsByTime(fires: FireRow[], origin: FireRow["origin"]): Map<number, number> {
  const counts = new Map<number, number>();
  for (const fire of fires) if (fire.origin === origin) counts.set(fire.nominal, (counts.get(fire.nominal) ?? 0) + 1);
  return counts;
}

/**
 * `a`: no scheduled time fired twice, and each time a tick stood at (every
 * minute some process claimed in, outside the handover) fired exactly once.
 */
function gradeFiresOnce(label: string, fires: FireRow[], expected: number[], failures: string[]): void {
  for (const origin of ["static", "dynamic"] as const) {
    const counts = countsByTime(fires, origin);
    const twice = [...counts].filter(([, n]) => n > 1);
    if (twice.length > 0) failures.push(`a:fires-once — ${label}: ${origin} times fired more than once: ${twice.map(([t, n]) => `${iso(t)}×${n}`).join(", ")}`);
    const missed = expected.filter((t) => (counts.get(t) ?? 0) !== 1);
    if (missed.length > 0) {
      failures.push(`a:fires-once — ${label}: ${origin} times a tick stood at that did not fire exactly once: ${missed.map((t) => `${iso(t)}×${counts.get(t) ?? 0}`).join(", ")}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Leg 1 · two serve() processes on one store, the ticker killed (a, b, c)
// ---------------------------------------------------------------------------
async function twoServers(label: string, store: Record<string, string>, failures: string[], tell: { over<T>(n: string, v: readonly T[], o?: { emptyIs: string }): T[] }) {
  const dir = join(SCRATCH, label);
  const ledger = join(dir, "ledger.sqlite");
  spawnSync("mkdir", ["-p", dir]);
  const shared = { GOAL_ROLE: "serve", GOAL_LEDGER: ledger, ...store };
  const p1Port = await freePort();
  const p1 = await startHost("p1", { ...shared, GOAL_PORT: String(p1Port), GOAL_SEED: "1" });
  const noLine = await scheduleRoutes(label, p1Port, failures);
  await sleep(5_000);
  const p2 = await startHost("p2", { ...shared, GOAL_PORT: String(await freePort()) });
  const children: Record<string, ChildProcess> = { p1, p2 };
  try {
    // Let one process tick twice, then kill it between ticks, with no shutdown.
    await until(ledger, 4 * MINUTE, ({ claims }) => claims.length >= 2);
    const before = readLedger(ledger).claims;
    const ticker = before[0]?.process;
    if (ticker === undefined) {
      failures.push(`b:one-ticker — ${label}: no process ticked in four minutes`);
      return;
    }
    await sleep(15_000);
    const killAt = Date.now();
    stopProcessGroup(children[ticker], "SIGKILL");
    const survivor = ticker === "p1" ? "p2" : "p1";
    await until(ledger, HANDOVER_MS + 2 * MINUTE, ({ claims }) => claims.filter((c) => c.process === survivor && c.at > killAt).length >= 2);
    await sleep(5_000);

    const { fires, claims } = readLedger(ledger);
    tell.over(`${label} · fires`, fires);
    tell.over(`${label} · claims`, claims);
    const killedLast = Math.max(...claims.filter((c) => c.process === ticker && c.at <= killAt).map((c) => c.at));
    const afterKill = claims.filter((c) => c.at > killAt);
    const survivorFirst = afterKill.find((c) => c.process === survivor)?.at;

    // b: one process claims each minute. Minutes are counted from the first claim, so a process's beat sits mid-bucket.
    const first = claims[0]!.at;
    const bucket = (at: number) => Math.round((at - first) / MINUTE);
    const byBucket = new Map<number, ClaimRow[]>();
    for (const claim of claims) byBucket.set(bucket(claim.at), [...(byBucket.get(bucket(claim.at)) ?? []), claim]);
    const shared2 = [...byBucket].filter(([, rows]) => new Set(rows.map((r) => r.process)).size > 1);
    if (shared2.length > 0) {
      failures.push(`b:one-ticker — ${label}: ${shared2.length} minute(s) claimed by two processes (${shared2.map(([, rows]) => rows.map((r) => `${r.process}@${iso(r.at)}`).join("+")).join("; ")})`);
    }
    const handover = (b: number) => b > bucket(killedLast) && survivorFirst !== undefined && b < bucket(survivorFirst);
    const lastBucket = bucket(claims[claims.length - 1]!.at);
    const wrongCount: string[] = [];
    for (let b = 0; b <= lastBucket; b++) {
      if (handover(b)) continue;
      const n = byBucket.get(b)?.length ?? 0;
      if (n !== 1) wrongCount.push(`minute ${b}: ${n} claims`);
    }
    if (wrongCount.length > 0) failures.push(`b:one-ticker — ${label}: outside the handover, minutes without exactly one claim: ${wrongCount.join(", ")}`);

    // c: the other process takes over within the bound, and fires the latest missed time once; earlier ones are dropped (D3).
    if (survivorFirst === undefined) {
      failures.push(`c:failover — ${label}: ${survivor} never ticked after ${ticker} was killed`);
    } else {
      const took = survivorFirst - killAt;
      if (took > HANDOVER_MS + TICK_SLACK_MS) failures.push(`c:failover — ${label}: ${survivor} first ticked ${Math.round(took / 1000)} s after ${ticker} was killed (bound 180 s)`);
      const latestMissed = minuteOf(survivorFirst);
      const dropped: number[] = [];
      for (let t = minuteOf(killedLast) + MINUTE; t < latestMissed; t += MINUTE) dropped.push(t);
      for (const origin of ["static", "dynamic"] as const) {
        const counts = countsByTime(fires, origin);
        if ((counts.get(latestMissed) ?? 0) !== 1) failures.push(`c:failover — ${label}: the latest missed ${origin} time ${iso(latestMissed)} fired ${counts.get(latestMissed) ?? 0} times, not once`);
        const replayed = tell.over(`${label} · ${origin} times missed in the handover`, dropped).filter((t) => (counts.get(t) ?? 0) > 0);
        if (replayed.length > 0) failures.push(`c:failover — ${label}: earlier missed ${origin} times fired: ${replayed.map(iso).join(", ")} (D3 drops them)`);
      }
    }

    // a: each time some process's tick stood at fired exactly once, static and dynamic; none twice.
    gradeFiresOnce(label, fires, [...new Set(claims.map((c) => minuteOf(c.at)))], failures);
    return `${label}: ${noLine}; ${ticker} ticked ${before.length}, killed; ${survivor} ticked ${afterKill.length} from ${survivorFirst === undefined ? "never" : `${Math.round((survivorFirst - killAt) / 1000)} s`} later; ${fires.length} fires over ${new Set(fires.map((f) => f.nominal)).size} times`;
  } finally {
    stopProcessGroup(p1, "SIGKILL");
    stopProcessGroup(p2, "SIGKILL");
  }
}

// ---------------------------------------------------------------------------
// f · the schedule routes answer on a served app with no adapter line
// ---------------------------------------------------------------------------
/**
 * `f`: the scheduled flow lists its static schedule; a registered flow with no
 * schedules answers both schedule routes, with and without the secret, exactly
 * as a flow id nobody registered does. Nothing here writes a fire.
 */
async function scheduleRoutes(label: string, port: number, failures: string[]): Promise<string> {
  const base = `http://127.0.0.1:${port}/api/flows`;
  const send = async (method: "GET" | "POST", path: string, secret: boolean) => {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: { "Content-Type": "application/json", ...(secret ? { Authorization: `Bearer ${CRON_SECRET}` } : {}) },
      ...(method === "POST" ? { body: "{}" } : {})
    });
    return { status: response.status, body: await response.text() };
  };
  const listed = await send("GET", "/digest/schedules", true);
  let ids: string[] = [];
  try {
    ids = ((JSON.parse(listed.body) as { static?: Array<{ id: string }> }).static ?? []).map((entry) => entry.id);
  } catch {
    // not JSON: graded below
  }
  if (listed.status !== 200 || !ids.includes(SCHEDULE_KEY)) {
    failures.push(`f:no-line — ${label}: GET /api/flows/digest/schedules answered ${listed.status} ${listed.body.slice(0, 200)}, not 200 listing "${SCHEDULE_KEY}"`);
  }
  const unused = `never-registered-${process.pid}`;
  let compared = 0;
  for (const [method, rest] of [["GET", "/schedules"], ["POST", `/schedules/${SCHEDULE_KEY}/dispatch`]] as const) {
    for (const secret of [true, false]) {
      const plain = await send(method, `/${PLAIN_FLOW}${rest}`, secret);
      const unknown = await send(method, `/${unused}${rest}`, secret);
      compared += 1;
      const wanted = JSON.stringify({ error: "flow_not_found" });
      if (plain.status !== 404 || plain.body !== wanted || plain.status !== unknown.status || plain.body !== unknown.body) {
        failures.push(
          `f:no-line — ${label}: ${method} ${PLAIN_FLOW}${rest} ${secret ? "with" : "without"} the secret answered ${plain.status} ${plain.body.slice(0, 200)}; ` +
            `an unused flow id answered ${unknown.status} ${unknown.body.slice(0, 200)}; both must be 404 ${wanted}`
        );
      }
    }
  }
  return `schedules listed ${listed.status} [${ids.join(", ")}], ${compared} no-schedule probes matched an unused id`;
}

// ---------------------------------------------------------------------------
// Leg 2 · `fsdev run` for ninety seconds fires nothing
// ---------------------------------------------------------------------------
async function fsdevRun(failures: string[]) {
  const dir = join(SCRATCH, "fsdev-run");
  spawnSync("mkdir", ["-p", dir]);
  const ledger = join(dir, "ledger.sqlite");
  const env = baseEnv({ GOAL_DB: join(dir, "app.sqlite"), GOAL_LEDGER: ledger });
  const started = Date.now();
  // Its own process, as a developer runs it: an action that keeps the run open for ninety seconds.
  const child = spawn(TSX, [FSDEV, "run", "digest", "wait", "--input", JSON.stringify({ ms: CLI_RUN_MS }), "--config", CONFIG, "--org", "acme", "--user", "alice", "--quiet"], {
    cwd: HERE,
    env,
    detached: true,
    stdio: ["ignore", "ignore", "pipe"]
  });
  let stderr = "";
  child.stderr!.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
  const code = await new Promise<number | null>((resolve) => child.once("exit", resolve));
  const ran = Date.now() - started;
  if (code !== 0) failures.push(`cli:fires-nothing — setup: fsdev run exited ${code}:\n${stderr.slice(-2000)}`);
  else if (ran < CLI_RUN_MS) failures.push(`cli:fires-nothing — setup: fsdev run ended after ${ran} ms, before a minute's tick could fall in it`);
  const { fires, claims } = readLedger(ledger);
  if (fires.length > 0 || claims.length > 0) failures.push(`cli:fires-nothing — fsdev run ticked ${claims.length} time(s) and fired ${fires.length} schedule(s) in ${Math.round(ran / 1000)} s`);
  return `fsdev run: ${Math.round(ran / 1000)} s, ${claims.length} ticks, ${fires.length} fires`;
}

// ---------------------------------------------------------------------------
// Leg 3 · vercelScheduler's route called each minute (d)
// ---------------------------------------------------------------------------
async function vercelRoute(failures: string[], tell: { over<T>(n: string, v: readonly T[]): T[] }) {
  const dir = join(SCRATCH, "vercel");
  spawnSync("mkdir", ["-p", dir]);
  const ledger = join(dir, "ledger.sqlite");
  const port = await freePort();
  const host = await startHost("vercel", { GOAL_ROLE: "vercel", GOAL_PORT: String(port), GOAL_DB: join(dir, "app.sqlite"), GOAL_LEDGER: ledger, GOAL_SEED: "1" });
  try {
    const call = async () =>
      (await fetch(`http://127.0.0.1:${port}/api/cron/schedules`, { headers: { Authorization: `Bearer ${CRON_SECRET}` } })).status;
    const statuses: number[] = [];
    const beats: number[] = [];
    // Vercel Cron's beat: just past each minute, three times; the second minute is called twice.
    for (let beat = 0; beat < 3; beat++) {
      await sleep(minuteOf(Date.now()) + MINUTE + 3_000 - Date.now());
      beats.push(Date.now());
      statuses.push(await call());
      if (beat === 1) statuses.push(await call());
    }
    const unauthorized = (await fetch(`http://127.0.0.1:${port}/api/cron/schedules`)).status;
    await sleep(3_000);
    const { fires, claims } = readLedger(ledger);
    tell.over("vercel · fires", fires);
    if (statuses.some((s) => s !== 200)) failures.push(`d:route — the route answered ${statuses.join(", ")}`);
    if (unauthorized !== 401) failures.push(`d:route — a call without the secret answered ${unauthorized}, not 401`);
    // The route ticks once per call: four calls, four claims, and nothing else ticked.
    if (claims.length !== statuses.length) failures.push(`d:route — ${claims.length} ticks for ${statuses.length} route calls`);
    const before = failures.length;
    gradeFiresOnce("vercel", fires, beats.map(minuteOf), failures);
    for (let i = before; i < failures.length; i++) failures[i] = failures[i]!.replace("a:fires-once", "d:route");
    return `vercel route: ${statuses.length} calls (${statuses.join(", ")}), ${claims.length} ticks, ${fires.length} fires`;
  } finally {
    stopProcessGroup(host, "SIGKILL");
  }
}

// ---------------------------------------------------------------------------
// Leg 4 · a web process that doesn't tick, and a job-queue worker that does
// ---------------------------------------------------------------------------
async function jobQueue(failures: string[], tell: { over<T>(n: string, v: readonly T[]): T[] }) {
  const dir = join(SCRATCH, "queue");
  spawnSync("mkdir", ["-p", dir]);
  const ledger = join(dir, "ledger.sqlite");
  const redisPort = await freePort();
  const redis = spawn("redis-server", ["--port", String(redisPort), "--save", "", "--appendonly", "no"], { detached: true, stdio: "ignore" });
  await sleep(1_000);
  const shared = { GOAL_DB: join(dir, "app.sqlite"), GOAL_LEDGER: ledger, GOAL_REDIS_URL: `redis://127.0.0.1:${redisPort}`, GOAL_QUEUE: "fires-goal" };
  let web: ChildProcess | undefined;
  let worker: ChildProcess | undefined;
  try {
    web = await startHost("web", { ...shared, GOAL_ROLE: "web", GOAL_PORT: String(await freePort()), GOAL_SEED: "1" });
    worker = await startHost("worker", { ...shared, GOAL_ROLE: "worker" });
    await until(ledger, 4 * MINUTE, ({ claims }) => claims.length >= 3);
    await sleep(10_000);
    const { fires, claims } = readLedger(ledger);
    tell.over("job queue · claims", claims);
    const notWorker = claims.filter((c) => c.process !== "worker");
    if (notWorker.length > 0) failures.push(`queue:worker-ticks — the web process (scheduler: false) ticked ${notWorker.length} time(s)`);
    if (claims.length === 0) failures.push("queue:worker-ticks — the job-queue worker never ticked");
    const before = failures.length;
    gradeFiresOnce("job queue", fires, [...new Set(claims.map((c) => minuteOf(c.at)))], failures);
    for (let i = before; i < failures.length; i++) failures[i] = failures[i]!.replace("a:fires-once", "queue:fires-once");
    const ranBy = [...new Set(fires.map((f) => f.process))].join(", ");
    return `job queue: ${claims.length} ticks by ${[...new Set(claims.map((c) => c.process))].join(", ")}, ${fires.length} fires run by ${ranBy}`;
  } finally {
    stopProcessGroup(web, "SIGKILL");
    stopProcessGroup(worker, "SIGKILL");
    stopProcessGroup(redis, "SIGKILL");
  }
}

// ---------------------------------------------------------------------------
// e · none of the removed exports resolves
// ---------------------------------------------------------------------------
const REMOVED: Record<string, string[]> = {
  "@flow-state-dev/scheduled": ["formatScheduleId", "runScheduleTick", "startScheduleTick", "scheduleDispatchRequest"],
  "@flow-state-dev/scheduled/collection": ["runScheduleTick", "startScheduleTick", "scheduleDispatchRequest", "formatScheduleId"],
  "@flow-state-dev/node": ["serveScheduleTicks"],
  "@flow-state-dev/bullmq": ["registerStaticSchedules", "createScheduleDispatchProcessor", "createBullmqScheduleIndex"],
  "@flow-state-dev/vercel": ["createGetToPostCronShim", "createScheduleTickHandler"]
};
const REMOVED_ENTRIES = ["@flow-state-dev/bullmq/schedules", "@flow-state-dev/vercel/schedules"];

async function onePath(failures: string[]) {
  const found: string[] = [];
  for (const [entry, names] of Object.entries(REMOVED)) {
    const mod = (await import(entry)) as Record<string, unknown>;
    for (const name of names) if (mod[name] !== undefined) found.push(`${entry} → ${name}`);
  }
  for (const entry of REMOVED_ENTRIES) {
    try {
      await import(entry);
      found.push(entry);
    } catch {
      // gone, as it should be
    }
  }
  if (found.length > 0) failures.push(`e:one-path — still resolves: ${found.join(", ")}`);
  return `${Object.values(REMOVED).flat().length + REMOVED_ENTRIES.length} removed names and entries checked`;
}

// ---------------------------------------------------------------------------
// g · one way to mount: no package exports the adapter factory, the engine imports no scheduled
// ---------------------------------------------------------------------------
const GONE = "createScheduledTransportAdapter";
/** The packages the factory could be published from: where it was, and where its code went. */
const MOUNT_PACKAGES = ["packages/scheduled", "packages/engine"];
/** The subpaths that import vitest, so they load only under a test runner. */
const TEST_RUNNER_ENTRIES = new Set(["./testing"]);

/** Every `.ts`/`.tsx`/`.mts` file under `dir`. */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "node_modules" || name === "dist" ? [] : sourceFiles(path);
    return /\.(ts|tsx|mts)$/.test(name) ? [path] : [];
  });
}

async function oneWay(failures: string[]) {
  const found: string[] = [];
  let entries = 0;
  // Import each published entry of the two packages and look for the name.
  for (const pkg of MOUNT_PACKAGES) {
    const manifest = JSON.parse(readFileSync(join(REPO_ROOT, pkg, "package.json"), "utf8")) as { name: string; exports: Record<string, unknown> };
    for (const sub of Object.keys(manifest.exports)) {
      if (sub.includes("*") || sub.endsWith(".json")) continue;
      const entry = sub === "." ? manifest.name : `${manifest.name}/${sub.slice(2)}`;
      entries += 1;
      try {
        const mod = (await import(entry)) as Record<string, unknown>;
        if (mod[GONE] !== undefined) found.push(`${entry} exports ${GONE}`);
      } catch (error) {
        // Only an entry that loads under a test runner alone (`./testing` imports vitest) is read
        // from source instead; any other entry that fails to load fails the goal.
        if (!TEST_RUNNER_ENTRIES.has(sub)) {
          found.push(`${entry} fails to load: ${error instanceof Error ? error.message : String(error)}`);
          continue;
        }
        const target = manifest.exports[sub] as string | { default?: string };
        const source = typeof target === "string" ? target : target.default;
        if (source === undefined) throw new Error(`setup: ${entry} neither imports nor names a source file`);
        if (readFileSync(join(REPO_ROOT, pkg, source), "utf8").includes(GONE)) found.push(`${entry} (${source}) names ${GONE}`);
      }
    }
  }
  // Every other package: no source file under src names it at all.
  const packages = readdirSync(join(REPO_ROOT, "packages")).filter((name) => statSync(join(REPO_ROOT, "packages", name, "src"), { throwIfNoEntry: false })?.isDirectory());
  for (const name of packages) {
    for (const file of sourceFiles(join(REPO_ROOT, "packages", name, "src"))) {
      if (readFileSync(file, "utf8").includes(GONE)) found.push(`${file.slice(REPO_ROOT.length + 1)} names ${GONE}`);
    }
  }
  const engineImports = sourceFiles(join(REPO_ROOT, "packages/engine/src")).filter((file) => /["']@flow-state-dev\/scheduled(\/[^"']*)?["']/.test(readFileSync(file, "utf8")));
  for (const file of engineImports) found.push(`${file.slice(REPO_ROOT.length + 1)} imports @flow-state-dev/scheduled`);
  if (found.length > 0) failures.push(`g:one-way — ${found.join("; ")}`);
  return `${entries} entries imported, ${packages.length} packages' sources read for ${GONE}`;
}

await runGoal(async (failures, tell) => {
  const pgUrl = process.env.GOAL_PG_URL;
  const legs: Array<Promise<string | undefined>> = [
      twoServers("sqlite", { GOAL_DB: join(SCRATCH, "sqlite", "app.sqlite") }, failures, tell),
      fsdevRun(failures),
      vercelRoute(failures, tell),
      jobQueue(failures, tell),
      onePath(failures),
      oneWay(failures)
    ];
  if (pgUrl !== undefined && pgUrl !== "") legs.push(twoServers("postgres", { GOAL_PG_URL: pgUrl }, failures, tell));
  const evidence = await Promise.all(legs);
  if (control !== undefined) assertPatched(CONTROLS[control]!, REPO_ROOT, mark);
  return { failures, evidence: evidence.filter((e) => e !== undefined).join("; ") };
});
