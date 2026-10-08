/**
 * Goal check — a team's own worker flow replaces ours, for every worker on
 * the roster.
 *
 * Three worker records. Two name no flow at all and one names `agent`
 * explicitly, so all three would run on the built-in. The app hands the
 * installation its own flow under `agent`, and every one of them runs on the
 * app's flow instead: one registered copy, checked worker by worker, because
 * one-worker-right-and-the-rest-ours is the failure a single assertion misses.
 *
 * Each worker's session is created naming it, through the real HTTP route,
 * and runs to completion there; a block nested inside the action reads the
 * turn's worker and records its own record's instructions and `desk`, a
 * setting only the caller's flow declares.
 *
 * Real path, no mocking, no model. See goal.md for the contract.
 *
 * Run: pnpm tsx goals/workforce-seats/a-callers-own-agent-wins-every-seat/run.mts
 * Control: GOAL_CONTROL=builtin-agent (the app passes no flow of its own) must FAIL at (b) for every worker.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFlowApiRouter, createFlowRegistry, type StoreRegistry } from "@flow-state-dev/engine";
import { createSQLiteStores } from "@flow-state-dev/store-sqlite";
import { AGENT_KIND, type WorkerManifest } from "@flow-state-dev/workforce";
import type { FlowInstance } from "@flow-state-dev/core/types";
import { installWorkers, loadFixture, runGoal, silentLogger, stripIntentOverrides } from "../../lib/index.mts";
import { defineCallerAgent } from "./fixtures/flows";

type Worker = {
  id: string;
  description: string;
  desk: string;
  body: string;
  /** Whether the record writes `flow: agent` or leaves the key out entirely. */
  namesTheKind: boolean;
};
type Fixture = { userId: string; note: string; roster: Worker[] };

stripIntentOverrides();

const CONTROL = process.env.GOAL_CONTROL ?? "";
if (CONTROL !== "" && CONTROL !== "builtin-agent") throw new Error(`unknown GOAL_CONTROL "${CONTROL}"`);

const fixture = loadFixture<Fixture>(import.meta.url);

/**
 * The roster, hand-built. The loader path is the sibling goal's subject; what
 * this one grades is which flow each record ends up on.
 */
function records(): WorkerManifest[] {
  return fixture.roster.map((worker) => ({
    id: worker.id,
    declared: {
      description: worker.description,
      desk: worker.desk,
      // The two shapes that must land on the same flow: an absent key, and the
      // name written out.
      ...(worker.namesTheKind ? { flow: AGENT_KIND } : {})
    },
    body: worker.body
  }));
}

type Router = ReturnType<typeof createFlowApiRouter>;

function host(stores: StoreRegistry, flows: FlowInstance[]): Router {
  const registry = createFlowRegistry();
  registry.registerMany(flows);
  return createFlowApiRouter({ registry, stores, runtimeConfig: { logger: silentLogger } } as never);
}

async function call(router: Router, method: "GET" | "POST", path: string[], body?: unknown): Promise<Response> {
  return router[method](
    new Request(`http://goal/api/flows/${path.join("/")}`, {
      method,
      headers: { "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    }),
    { params: { path } }
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

await runGoal(async (failures) => {
  const evidence: string[] = [];
  const dir = mkdtempSync(join(tmpdir(), "fsd-caller-agent-"));

  // ---- (a) one copy of `agent`, and it is the caller's ----------------------
  const { copies } = installWorkers(records(), (installation) =>
    CONTROL === "builtin-agent" ? {} : { [AGENT_KIND]: defineCallerAgent(installation) }
  );
  const agents = copies.filter((copy) => copy.kind === AGENT_KIND);
  if (agents.length !== 1 || agents[0]!.id !== AGENT_KIND) {
    failures.push(`(a) ${agents.length} copies of "${AGENT_KIND}" registered (${agents.map((c) => c.id).join(", ")}), wanted one, at its kind`);
  }
  if (copies.some((copy) => fixture.roster.some((w) => w.id === copy.id))) failures.push("(a) a copy was registered at a worker's id");
  evidence.push(`one call registered ${agents.length} copy of "${AGENT_KIND}" for ${fixture.roster.length} workers`);

  // ---- (b) every worker runs on it, as itself -------------------------------
  const stores = createSQLiteStores({ filename: join(dir, "goal.db") }) as unknown as StoreRegistry;
  try {
    const router = host(stores, copies);
    for (const worker of fixture.roster) {
      const sessionId = `s_${worker.id.replace(/\W/g, "_")}`;
      const created = await call(router, "POST", [AGENT_KIND, "sessions"], {
        userId: fixture.userId,
        sessionId,
        state: { workerId: worker.id }
      });
      if (created.status !== 201) {
        failures.push(`(b) ${worker.id}: its session was not created: ${created.status} ${await created.text()}`);
        continue;
      }
      const res = await call(router, "POST", [AGENT_KIND, sessionId, "actions", "run"], {
        userId: fixture.userId,
        input: { note: fixture.note }
      });
      if (res.status !== 202) {
        failures.push(`(b) ${worker.id}: expected 202 from the "${AGENT_KIND}" copy, got ${res.status}: ${await res.text()}`);
        continue;
      }
      const body = (await res.json()) as { request?: { id: string } };
      const status = await settled(stores, body.request?.id ?? "");
      if (status !== "completed") failures.push(`(b) ${worker.id}: request ended ${String(status)}`);
      const state = await call(router, "GET", ["sessions", sessionId, "state"]);
      const ran = ((await state.json()) as {
        clientData?: { session?: { ran?: { instructions?: string | null; desk?: string | null; runs?: number } } };
      }).clientData?.session?.ran;
      if ((ran?.instructions ?? "").trim() !== worker.body.trim()) {
        failures.push(`(b) ${worker.id}: its nested block saw instructions ${JSON.stringify(ran?.instructions)}`);
      }
      if (ran?.desk !== worker.desk) {
        failures.push(`(b) ${worker.id}: its nested block saw desk ${JSON.stringify(ran?.desk)}, wanted ${JSON.stringify(worker.desk)} — this turn did not run on the caller's flow`);
      }
    }
    const named = fixture.roster.filter((w) => w.namesTheKind).length;
    evidence.push(
      `every worker — ${named} naming the flow and ${fixture.roster.length - named} naming none — ran on the caller's copy through the real HTTP route, its own record's body arriving as \`instructions\` and its \`desk\` with it`
    );
  } finally {
    (stores as unknown as { close(): void }).close();
  }

  return { failures, evidence: evidence.join("; ") };
});
