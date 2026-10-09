/**
 * Goal check — in one org, each user's workers are theirs alone, every worker
 * runs on one shared copy of the flow it names with its own memory on
 * `agent`, and a hire reaches a second process without a restart.
 *
 * Real path, no mocking but a scripted model, out of CI: two hosts of one app,
 * each the real HTTP router over one on-disk SQLite file, driven through the
 * shipped clients the way an app drives them. See goal.md for the contract.
 *
 * Run: pnpm tsx goals/workers-as-resources/keeps-each-users-workers-their-own/run.mts
 * Controls: GOAL_CONTROL=org-scoped-workers must FAIL leg b on "b:reads-worker";
 * GOAL_CONTROL=no-create-check must FAIL leg b on "b:create".
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient, createSessionClient, type ClientFetch } from "@flow-state-dev/client";
import { createFlowApiRouter, createFlowRegistry, type FlowRegistry, type StoreRegistry } from "@flow-state-dev/engine";
import { createSQLiteStores } from "@flow-state-dev/store-sqlite";
import { createWorkforceClient, ROSTER_FLOW_KIND } from "@flow-state-dev/workforce/browser";
import { readWorkforce } from "@flow-state-dev/workforce/loader";
import { fixtureDir, loadFixture, runGoal, silentLogger, stripIntentOverrides } from "../../lib/index.mts";
import { appFlows, markerEchoModel, RESEARCH, verified, type Control } from "./fixtures/app";

type Fixture = {
  org: string;
  alice: string;
  bob: string;
  standard: { onAgent: string; onResearch: string };
  markers: { onAgent: string; onResearch: string; skill: string };
  fork: { id: string };
  hire: { id: string; instructions: string; marker: string };
};

stripIntentOverrides();

const fixture = loadFixture<Fixture>(import.meta.url);
const CONTROLS = ["org-scoped-workers", "no-create-check"] as const;
const control = process.env.GOAL_CONTROL as Control;
if (control !== undefined && !(CONTROLS as readonly string[]).includes(control)) {
  throw new Error(`Unknown GOAL_CONTROL "${control}". This goal understands: ${CONTROLS.join(", ")}.`);
}

const tree = await readWorkforce(join(fixtureDir(import.meta.url), "workforce"));
if (tree.errors.length > 0 || tree.skillErrors.length > 0) {
  throw new Error(`the fixture tree did not load: ${JSON.stringify([tree.errors, tree.skillErrors])}`);
}
const MARKERS = [fixture.markers.onAgent, fixture.markers.onResearch, fixture.markers.skill, fixture.hire.marker];

/** One process of the app over the SQLite file. */
function host(dbFile: string) {
  const stores = createSQLiteStores({ filename: dbFile }) as unknown as StoreRegistry;
  const registry: FlowRegistry = createFlowRegistry();
  for (const flow of appFlows(tree.workers, control)) registry.register(flow);
  const router = createFlowApiRouter({
    registry,
    stores,
    resolvePrincipal: verified.resolvePrincipal,
    modelResolver: markerEchoModel(MARKERS),
    logger: silentLogger,
    staleSweepIntervalMs: 0,
  } as never) as unknown as Record<string, (request: Request, context: unknown) => Promise<Response>>;

  /** A fetch that hands each request to this host's router as `user`. */
  const fetcher =
    (user: string): ClientFetch =>
    async (input, init) => {
      const url = new URL(String(input), "http://goal.local");
      const headers = new Headers(init?.headers);
      headers.set("x-verified-user", user);
      headers.set("x-verified-org", fixture.org);
      const path = url.pathname.replace(/^\/api\/flows\/?/, "").split("/").filter(Boolean).map(decodeURIComponent);
      const method = (init?.method ?? "GET").toUpperCase();
      return router[method]!(new Request(url, { ...init, headers }), { params: { path } });
    };

  /** What one user reaches through this host: the shipped clients, nothing else. */
  const as = (user: string) => {
    const transport = { fetcher: fetcher(user) };
    const sessions = createSessionClient(transport);
    const workforce = createWorkforceClient({ userId: user, ...transport });
    /** One action, followed to its end: its status, its output and its error. */
    const act = async (flowKind: string, sessionId: string, action: string, input: unknown) => {
      const actions = createClient({ flowKind, userId: user, ...transport });
      const started = await actions.sendAction(action, input, { sessionId });
      const until = Date.now() + 15_000;
      let status = (await actions.getRequestStatus(started.request.id)).status;
      while (status === "in_progress") {
        if (Date.now() > until) throw new Error(`${action} on ${sessionId} never settled`);
        await new Promise((resolve) => setTimeout(resolve, 10));
        status = (await actions.getRequestStatus(started.request.id)).status;
      }
      const listed = await sessions.listSessionRequests(sessionId, { includeResultOutput: true, limit: 100 });
      const found = listed.find((request) => request.id === started.request.id);
      return { status, output: JSON.stringify(found?.result?.output ?? null), error: found?.result?.error?.message ?? null };
    };
    return { sessions, workforce, act };
  };
  return { registry, as, close: () => (stores as unknown as { close(): void }).close() };
}

/** Whether `attempt` was refused: it threw, or its run ended other than completed. */
async function refused(attempt: () => Promise<{ status: string } | unknown>): Promise<boolean> {
  try {
    const result = await attempt();
    return result !== null && typeof result === "object" && "status" in result && (result as { status: string }).status !== "completed";
  } catch {
    return true;
  }
}

await runGoal(async (failures) => {
  const evidence: string[] = [];
  const { markers, standard, fork, hire } = fixture;
  const dbFile = join(mkdtempSync(join(tmpdir(), "fsd-workers-as-resources-")), "goal.db");

  const first = host(dbFile);
  // The second process is up before anything is hired.
  const second = host(dbFile);
  const registered = (h: ReturnType<typeof host>) => h.registry.list().map((flow) => flow.id).sort();
  const before = { first: registered(first), second: registered(second) };

  // ---- leg a: Alice forks, hires and talks --------------------------------
  const alice = first.as(fixture.alice);
  await alice.workforce.roster(); // her roster session
  const [rosterSession] = await alice.sessions.listSessions({ flowKind: ROSTER_FLOW_KIND, userId: fixture.alice });
  if (rosterSession === undefined) return { failures: ["a:roster — Alice has no roster session"], evidence: "" };
  const forked = await alice.act(ROSTER_FLOW_KIND, rosterSession.id, "fork", { from: standard.onAgent, id: fork.id });
  if (forked.status !== "completed") failures.push(`a:fork — fork ended ${forked.status}: ${forked.error}`);
  const hired = await alice.act(ROSTER_FLOW_KIND, rosterSession.id, "hire", {
    id: hire.id,
    flow: "agent",
    instructions: hire.instructions,
  });
  if (hired.status !== "completed") failures.push(`a:hire — hire ended ${hired.status}: ${hired.error}`);

  const roster = (await alice.workforce.roster()).map((entry) => `${entry.id}@${entry.flow}`).sort();
  for (const expected of [`${fork.id}@agent`, `${hire.id}@agent`, `${standard.onAgent}@agent`, `${standard.onResearch}@${RESEARCH}`]) {
    if (!roster.includes(expected)) failures.push(`a:roster — Alice's roster lacks ${expected}: ${roster.join(", ")}`);
  }

  // Each worker answers as its own configuration. The hire is reached through
  // the second process, which was never restarted.
  const talks: Array<{ worker: string; via: ReturnType<typeof host>; own: string[]; leg: string }> = [
    { worker: standard.onAgent, via: first, own: [markers.onAgent, markers.skill], leg: "a:standard" },
    { worker: fork.id, via: first, own: [markers.onAgent, markers.skill], leg: "a:fork-answers" },
    { worker: hire.id, via: second, own: [hire.marker], leg: "a:second-host" },
    { worker: standard.onResearch, via: first, own: [markers.onResearch], leg: "a:research" },
  ];
  const sessionOf = new Map<string, { id: string; flowKind: string }>();
  for (const talk of talks) {
    const client = talk.via.as(fixture.alice);
    let session: { id: string; flowKind: string };
    try {
      session = await client.workforce.ensureWorkerSession({ worker: talk.worker });
    } catch (error) {
      failures.push(`${talk.leg} — ensureWorkerSession(${talk.worker}) refused: ${(error as Error).message}`);
      continue;
    }
    sessionOf.set(talk.worker, session);
    const again = await client.workforce.ensureWorkerSession({ worker: talk.worker });
    if (again.id !== session.id) failures.push(`${talk.leg} — a second ensureWorkerSession(${talk.worker}) opened another session`);
    // Every worker is asked for the skill only the standard worker and its fork hold.
    const turn = await client.act(session.flowKind, session.id, "run", { message: "/refund-policy Who are you?" });
    if (turn.status !== "completed") {
      failures.push(`${talk.leg} — ${talk.worker}'s turn ended ${turn.status}: ${turn.error}`);
      continue;
    }
    for (const marker of talk.own) {
      if (!turn.output.includes(marker)) failures.push(`${talk.leg} — ${talk.worker} answered without its own ${marker}: ${turn.output}`);
    }
    for (const marker of MARKERS.filter((m) => !talk.own.includes(m))) {
      if (!turn.output.includes(marker)) continue;
      // A skill seen by a worker that doesn't hold it came from another
      // worker's drawer: the standard worker and the fork both run first.
      const leg = marker === markers.skill ? "a:own-memory" : talk.leg;
      failures.push(`${leg} — ${talk.worker} answered with another worker's ${marker}: ${turn.output}`);
    }
  }
  for (const [name, h] of [["first", first], ["second", second]] as const) {
    const after = registered(h);
    if (JSON.stringify(after) !== JSON.stringify(before[name])) {
      failures.push(`a:one-copy — the ${name} process's registry changed: ${before[name].join(", ")} → ${after.join(", ")}`);
    }
    const perWorker = after.filter((id) => [fork.id, hire.id, standard.onAgent, standard.onResearch].includes(id));
    if (perWorker.length > 0) failures.push(`a:one-copy — the ${name} process registered a copy per worker: ${perWorker.join(", ")}`);
  }
  evidence.push(
    `a: Alice forked ${fork.id} and hired ${hire.id}; ${talks.length} workers answered as their own configuration on one copy per flow (${before.first.join(", ")}), ${hire.id} through the second process with no restart, and ${hire.id} read no other worker's skills`,
  );

  // ---- leg b: Bob reaches for Alice's workers ------------------------------
  const bob = first.as(fixture.bob);
  const bobsRoster = (await bob.workforce.roster()).map((entry) => entry.id);
  const leaked = bobsRoster.filter((id) => id === fork.id || id === hire.id);
  if (leaked.length > 0) failures.push(`b:reads-worker — Bob reads Alice's worker(s) ${leaked.join(", ")} on his roster`);
  const hireSession = sessionOf.get(hire.id);
  try {
    const found = await bob.workforce.findWorkerSession({ worker: hire.id });
    if (found !== undefined) failures.push(`b:find — Bob found ${found.id}, a session with Alice's ${hire.id}`);
  } catch {
    // Refused outright: nothing found.
  }
  if (hireSession !== undefined) {
    if (!(await refused(() => bob.sessions.getSession(hireSession.id)))) {
      failures.push(`b:open — Bob opened Alice's session ${hireSession.id}`);
    }
    if (!(await refused(() => bob.act("agent", hireSession.id, "run", { message: "hello" })))) {
      failures.push(`b:run — Bob ran a turn in Alice's session ${hireSession.id}`);
    }
  }
  if (!(await refused(() => bob.sessions.createSession({ flowKind: "agent", userId: fixture.bob, state: { workerId: hire.id } })))) {
    failures.push(`b:create — Bob's create naming Alice's ${hire.id} wrote a session`);
  }
  if (!(await refused(() => alice.sessions.createSession({ flowKind: "agent", userId: fixture.alice })))) {
    failures.push("b:no-worker — a session was created on agent with no worker");
  }
  if (!(await refused(() => alice.sessions.createSession({ flowKind: RESEARCH, userId: fixture.alice, state: { workerId: hire.id } })))) {
    failures.push(`b:other-flow — Alice's ${hire.id}, which runs on agent, got a session on ${RESEARCH}`);
  }
  const deskSession = sessionOf.get(standard.onAgent);
  if (deskSession !== undefined) {
    if (!(await refused(() => alice.act("agent", deskSession.id, "run", { message: "hello", workerId: hire.id })))) {
      failures.push(`b:names-worker — a turn on agent whose message named ${hire.id} ran`);
    }
  }
  const researchSession = sessionOf.get(standard.onResearch);
  if (researchSession !== undefined) {
    if (!(await refused(() => alice.act(RESEARCH, researchSession.id, "run", { message: "hello", workerId: hire.id })))) {
      failures.push(`b:names-worker — a turn on ${RESEARCH} whose message named ${hire.id} ran`);
    }
    if (!(await refused(() => alice.act(RESEARCH, researchSession.id, "reassign", { to: hire.id })))) {
      failures.push(`b:reassign — a turn moved a ${RESEARCH} session to ${hire.id}`);
    }
    const after = await alice.act(RESEARCH, researchSession.id, "run", { message: "Who are you now?" });
    if (!after.output.includes(markers.onResearch) || after.output.includes(hire.marker)) {
      failures.push(`b:reassign — after the refused move, the session answered as: ${after.output}`);
    }
  }
  evidence.push(
    "b: Bob's roster lists none of Alice's workers, and his find, open, run and create naming her worker are refused; a session with no worker, a turn naming a worker, a turn moving a session to another worker, and a session on a flow the worker doesn't run on are refused",
  );
  if (control !== undefined) evidence.push(`control ${control} active`);

  first.close();
  second.close();
  return { failures, evidence: evidence.join("; ") };
});
