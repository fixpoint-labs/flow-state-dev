/**
 * Goal check — two copies of one flow keep their own saved work, across a
 * restart, over HTTP, the CLI, and the queue worker's job processor.
 *
 * Real path, no mocking, no model, out of CI. See goal.md for the contract.
 *
 * Run: pnpm tsx goals/flow-instances/owner-continuity/run.mts
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { UnrecoverableError } from "bullmq";
import type { Job } from "bullmq";
import { createFlowApiRouter, createFlowRegistry, type StoreRegistry } from "@flow-state-dev/engine";
import { createFlowJobProcessor } from "@flow-state-dev/bullmq";
import type { FlowJobData } from "@flow-state-dev/bullmq";
import { createSQLiteStores } from "@flow-state-dev/store-sqlite";
import type { FlowInstance } from "@flow-state-dev/core/types";
import { REPO_ROOT, intentFreeEnv, loadFixture, runGoal, silentLogger, stripIntentOverrides } from "../../lib/index.mts";
import { REVIEW_KIND, reviewInstance } from "./fixtures/review";

type Copy = { id: string; marker: string };
type Fixture = { east: Copy; west: Copy };

stripIntentOverrides();

const fixture = loadFixture<Fixture>(import.meta.url);
const USER = "u_goal";

function host(stores: StoreRegistry, ...flows: FlowInstance[]) {
  const registry = createFlowRegistry();
  registry.registerMany(flows);
  return {
    registry,
    router: createFlowApiRouter({ registry, stores, runtimeConfig: { logger: silentLogger } } as never),
  };
}

type Router = ReturnType<typeof createFlowApiRouter>;

async function act(router: Router, address: string, sessionId: string): Promise<Response> {
  return router.POST(
    new Request(`http://goal/api/flows/${address}/${sessionId}/actions/run`, {
      method: "POST",
      body: JSON.stringify({ userId: USER, input: {} }),
    }),
    { params: { path: [address, sessionId, "actions", "run"] } },
  );
}

async function settled(stores: StoreRegistry, requestId: string): Promise<string | undefined> {
  for (let i = 0; i < 200; i += 1) {
    const record = await stores.request.get(requestId);
    if (record !== undefined && record.status !== "in_progress") return record.status;
    await new Promise((r) => setTimeout(r, 25));
  }
  return undefined;
}

async function owned(stores: StoreRegistry, sessionId: string) {
  const session = await stores.session.get(sessionId);
  return { marker: session?.state.marker, flowId: session?.flowId, flowKind: session?.flowKind };
}

/** Run the real CLI over the discovery path, from a scratch cwd. */
function cli(cwd: string, args: string[]): { status: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync(
      join(REPO_ROOT, "node_modules", ".bin", "tsx"),
      [join(REPO_ROOT, "packages", "cli", "src", "bin.ts"), ...args],
      { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: intentFreeEnv(process.env) },
    );
    return { status: 0, stdout, stderr: "" };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return { status: e.status ?? 1, stdout: String(e.stdout ?? ""), stderr: String(e.stderr ?? "") };
  }
}

await runGoal(async () => {
  const failures: string[] = [];
  const evidence: string[] = [];
  const dir = mkdtempSync(join(tmpdir(), "fsd-owner-continuity-"));
  const dbFile = join(dir, "goal.db");
  const east = () => reviewInstance(fixture.east.id, fixture.east.marker) as unknown as FlowInstance;
  const west = () => reviewInstance(fixture.west.id, fixture.west.marker) as unknown as FlowInstance;
  const sEast = "s_east";
  const sWest = "s_west";

  // ---- (a) HTTP: address A, address B, and the bare kind ----------------
  let stores: StoreRegistry = createSQLiteStores({ filename: dbFile }) as unknown as StoreRegistry;
  {
    const { router } = host(stores, east(), west());
    for (const [copy, session] of [[fixture.east, sEast], [fixture.west, sWest]] as const) {
      const res = await act(router, copy.id, session);
      const body = (await res.json()) as { request?: { id: string; flowId?: string } };
      if (res.status !== 202) failures.push(`${copy.id}: expected 202, got ${res.status}`);
      if (body.request?.flowId !== copy.id) failures.push(`${copy.id}: response flowId ${body.request?.flowId}`);
      const status = await settled(stores, body.request?.id ?? "");
      if (status !== "completed") failures.push(`${copy.id}: request ended ${status}`);
      const o = await owned(stores, session);
      if (o.marker !== copy.marker || o.flowId !== copy.id || o.flowKind !== REVIEW_KIND) {
        failures.push(`${copy.id}: session ${session} holds ${JSON.stringify(o)}`);
      }
      const record = await stores.request.get(body.request?.id ?? "");
      if (record?.flowId !== copy.id) failures.push(`${copy.id}: request record flowId ${record?.flowId}`);
    }
    const bare = await act(router, REVIEW_KIND, "s_bare");
    if (bare.status !== 404) failures.push(`bare kind: expected 404, got ${bare.status}`);
    evidence.push("HTTP: A and B each wrote their own marker and owner; the bare kind was 404");
  }

  // ---- (b) restart over the same file, B removed, A alone --------------
  (stores as unknown as { close(): void }).close();
  stores = createSQLiteStores({ filename: dbFile }) as unknown as StoreRegistry;
  {
    const { router } = host(stores, east());
    const again = await act(router, fixture.east.id, sEast);
    const body = (await again.json()) as { request?: { id: string } };
    if (again.status !== 202) failures.push(`restart: A re-entry expected 202, got ${again.status}`);
    if ((await settled(stores, body.request?.id ?? "")) !== "completed") failures.push("restart: A re-entry did not complete");
    const o = await owned(stores, sEast);
    if (o.marker !== fixture.east.marker || o.flowId !== fixture.east.id) {
      failures.push(`restart: A's session drifted to ${JSON.stringify(o)}`);
    }
    // (c) the owner's host reads the state route
    const state = await router.GET(new Request(`http://goal/api/flows/sessions/${sEast}/state`), {
      params: { path: ["sessions", sEast, "state"] },
    });
    if (state.status !== 200) failures.push(`state route on the owner: ${state.status}`);
  }
  {
    const { router } = host(stores, west());
    const before = await owned(stores, sEast);
    const refused = await act(router, fixture.west.id, sEast);
    const body = (await refused.json()) as { error?: string };
    if (refused.status !== 409 || body.error !== "wrong-instance-session") {
      failures.push(`B on A's session: expected 409 wrong-instance-session, got ${refused.status} ${body.error}`);
    }
    const after = await owned(stores, sEast);
    if (JSON.stringify(before) !== JSON.stringify(after)) failures.push("B's refusal changed A's session");
    if ((await stores.request.list({ sessionId: sEast })).some((r) => r.flowId !== fixture.east.id)) {
      failures.push("a request under A's session is not A's");
    }
    evidence.push("restart: A stayed A with B gone; a B-only host refused A's session with nothing changed");
  }

  // ---- (d) CLI discovery path ------------------------------------------
  {
    const cwd = mkdtempSync(join(tmpdir(), "fsd-owner-continuity-cli-"));
    const flowDir = join(REPO_ROOT, "goals", "flow-instances", "owner-continuity", "fixtures", "flows");
    const run = (address: string, session: string) =>
      cli(cwd, ["run", address, "run", "--flow-dir", flowDir, "-i", "{}", "--session", session, "--no-config", "--quiet"]);
    const lastLine = (out: string) => out.trim().split("\n").filter(Boolean).pop() ?? "";

    const a = run(fixture.east.id, "cli_s_a");
    const aDone = JSON.parse(lastLine(a.stdout) || "{}") as { type?: string; output?: { marker?: string } };
    if (a.status !== 0 || aDone.type !== "flow_complete" || aDone.output?.marker !== "east-ran") {
      failures.push(`cli A: status ${a.status}, last event ${lastLine(a.stdout)} ${a.stderr.slice(0, 200)}`);
    }
    const b = run(fixture.west.id, "cli_s_b");
    const bDone = JSON.parse(lastLine(b.stdout) || "{}") as { type?: string; output?: { marker?: string } };
    if (b.status !== 0 || bDone.output?.marker !== "west-ran") failures.push(`cli B: status ${b.status}`);

    const bare = run(REVIEW_KIND, "cli_s_bare");
    if (bare.status === 0 || !bare.stderr.includes(fixture.east.id) || !bare.stderr.includes(fixture.west.id)) {
      failures.push(`cli bare kind: status ${bare.status}, stderr ${bare.stderr.slice(0, 200)}`);
    }
    const foreign = run(fixture.west.id, "cli_s_a");
    if (foreign.status === 0 || !`${foreign.stdout}${foreign.stderr}`.includes("not owned by flow instance")) {
      failures.push(`cli B on A's session: status ${foreign.status} ${foreign.stderr.slice(0, 200)}`);
    }
    // The CLI's own filesystem store under the scratch cwd still says A.
    const record = JSON.parse(
      readFileSync(join(cwd, ".fsdev", "data", "sessions", "cli_s_a.json"), "utf8"),
    ) as { state?: { marker?: string }; flowId?: string };
    if (record.state?.marker !== "east-ran" || record.flowId !== fixture.east.id) {
      failures.push(`cli: A's session on disk is ${JSON.stringify(record)}`);
    }
    evidence.push("CLI: both ids ran their own copy, the bare kind was refused naming both, B could not re-enter A's session");
  }

  // ---- (e) BullMQ job processor over the same registry and stores -------
  {
    const registry = createFlowRegistry();
    registry.registerMany([east(), west()]);
    const process_ = createFlowJobProcessor({ registry, stores, runtimeConfig: { logger: silentLogger } as never });
    const job = (data: FlowJobData): Job<FlowJobData> =>
      ({ id: `job_${data.requestId}`, data, attemptsMade: 0, opts: { attempts: 3 } }) as unknown as Job<FlowJobData>;

    await process_(job({ flowKind: fixture.east.id, actionName: "run", input: {}, userId: USER, sessionId: "q_s_a", requestId: "req_q_a" }));
    const qa = await owned(stores, "q_s_a");
    if (qa.marker !== fixture.east.marker || qa.flowId !== fixture.east.id) failures.push(`queue A: ${JSON.stringify(qa)}`);

    const before = await owned(stores, sEast);
    let refusal: unknown;
    try {
      await process_(job({ flowKind: fixture.west.id, actionName: "run", input: {}, userId: USER, sessionId: sEast, requestId: "req_q_b" }));
    } catch (err) {
      refusal = err;
    }
    if (!(refusal instanceof UnrecoverableError)) failures.push(`queue B on A's session: expected UnrecoverableError, got ${String(refusal)}`);
    if (JSON.stringify(before) !== JSON.stringify(await owned(stores, sEast))) failures.push("queue refusal changed A's session");
    if ((await stores.request.get("req_q_b")) !== undefined) failures.push("queue refusal wrote a request record");
    evidence.push("queue processor: A's job ran A; B's job on A's session failed unrecoverably with nothing written");
  }

  (stores as unknown as { close(): void }).close();
  return { failures, evidence: evidence.join("; ") };
});
