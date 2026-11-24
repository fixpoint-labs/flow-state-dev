/**
 * Goal check: a filer learns what a delegate takes, and a task that doesn't
 * fit is refused at filing with the field named (FIX-2894). The tree, the
 * legs, the controls and what each must fail are in goal.md.
 *
 * Run: pnpm tsx goals/workforce/a-task-fits-its-flow/run.mts
 * Controls: GOAL_CONTROL=hide-shape
 * Legs: GOAL_LEGS=discover,scripted (default: both)
 */
import { spawnSync } from "node:child_process";
import { randomInt } from "node:crypto";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { createModelResolver, defineFlow, handler } from "@flow-state-dev/core";
import { createFlowState } from "@flow-state-dev/engine";
import type { Task } from "@flow-state-dev/orchestration/tasks";
import { sqliteStores } from "@flow-state-dev/store-sqlite";
import {
  defineSessionBoard,
  messageReceivedEntry,
  taskInputSchema,
  workerConfigSchema,
  workerFlow,
  workerMessagesResources,
  workerTaskEntry,
  type WorkerInstallation,
  type WorkerTaskBlockInput
} from "@flow-state-dev/workforce";
import { workforce } from "@flow-state-dev/workforce/kit";
import {
  REPO_ROOT,
  RUN_STAMP,
  actingAs,
  assertPatched,
  describePatches,
  gatewayModel,
  goalModel,
  goalTmpDir,
  keysServing,
  modulePatchEnv,
  runGoal,
  silentLogger,
  type ModulePatch
} from "../../lib/index.mts";
import { sleep } from "../../lib/time.mts";

const TREE = fileURLToPath(new URL("./fixtures/workforce", import.meta.url));
const USER_ID = "u_task_fits";
const ORG_ID = "org_task_fits";
const SCRATCH = goalTmpDir("a-task-fits-its-flow");
const CONTROL = process.env.GOAL_CONTROL ?? "";
const MODEL = gatewayModel(goalModel());
/** How many filings the Discover leg runs, and how many must be accepted first time. */
const RUNS = Number(process.env.GOAL_RUNS ?? 5);
const MUST_PASS = 4;
const QUIET_BUDGET_MS = 240_000;
const GRACE_MS = 3_000;
const LEAD = "ops.lead";
const TRIAGER = "ops.triager";
const DESK = "ops.desk";

// ---- controls ---------------------------------------------------------------------

const CONTROLS: Record<string, { patches: ModulePatch[]; legs: string[]; assertions: string[] }> = {
  "hide-shape": {
    legs: ["discover"],
    assertions: ["discover:first-filing-fits"],
    patches: [
      {
        // listDelegates shows no delegate's input schema: a model files from a guess.
        module: "packages/workforce/src/delegates/worker-delegates.ts",
        from: String.raw`return declaration === undefined \? null : \{ jsonSchema:`,
        to: "return declaration === undefined || true ? null : { jsonSchema:"
      }
    ]
  }
};

if (CONTROL !== "" && CONTROLS[CONTROL] === undefined) {
  console.error(`unknown GOAL_CONTROL "${CONTROL}"; known: ${Object.keys(CONTROLS).join(", ")}`);
  process.exit(2);
}
const control = CONTROL === "" ? undefined : CONTROLS[CONTROL]!;

// A control runs this same file again with its patch applied as it loads, and
// checks the patch reached the code it names.
if (control !== undefined && process.env.GOAL_MODULE_PATCH === undefined) {
  const mark = join(SCRATCH, `patch-mark-${RUN_STAMP}`);
  rmSync(mark, { force: true });
  console.error(`control ${CONTROL}:\n${describePatches(control.patches, REPO_ROOT)}`);
  const child = spawnSync(process.execPath, [...process.execArgv, ...process.argv.slice(1)], {
    stdio: "inherit",
    env: { ...process.env, GOAL_LEGS: process.env.GOAL_LEGS ?? control.legs.join(","), ...modulePatchEnv(control.patches, REPO_ROOT, mark) }
  });
  assertPatched(control.patches, REPO_ROOT, mark);
  process.exit(child.status ?? 1);
}

const legs = new Set((process.env.GOAL_LEGS ?? "discover,scripted").split(",").map((s) => s.trim()).filter(Boolean));
const say = (s: string) => console.error(`[a-task-fits-its-flow ${new Date().toISOString().slice(11, 19)}] ${s}`);
const show = (value: unknown) => JSON.stringify(value)?.slice(0, 600);

// ---- the app ----------------------------------------------------------------------

/** Each run of the triage flow's block: the task and the input it was handed. */
const handed: Array<{ taskId: string; input: unknown }> = [];

/**
 * What the triage flow takes. Not guessable from the ask: the field names, the
 * ticket's pattern and the kind's two words come only from `listDelegates`.
 */
const triageInput = z
  .object({
    ticket: z.string().regex(/^ENG-\d+$/).describe("The ticket's id, ENG- and its number"),
    kind: z.enum(["fix", "probe"]).describe("probe: look into it and change nothing; fix: change the code to fix it"),
    requestedBy: z.string().min(1)
  })
  .strict();

function startHost(db: string) {
  const doorInput = z.object({ message: z.string() });
  const deskFlow = (installation: WorkerInstallation) => {
    const board = defineSessionBoard({ installation, flowKind: "desk" });
    const turn = handler({ name: "task-fits-desk-turn", inputSchema: doorInput, execute: () => "Noted." });
    return defineFlow({
      kind: "desk",
      configSchema: workerConfigSchema(),
      session: { ...installation.session(board.sessionStateShape), serverOwned: [...board.serverOwned] },
      resources: { ...installation.resources, ...board.resources },
      actions: { respond: { inputSchema: doorInput.strict(), block: turn, userMessage: (input: { message: string }) => input.message }, ...board.actions },
      internal: { actions: board.entries(turn) }
    } as never);
  };
  const triageFlow = (installation: WorkerInstallation) => {
    const block = handler({
      name: "task-fits-triage-block",
      inputSchema: z.unknown(),
      execute: async (task: unknown) => {
        const run = task as WorkerTaskBlockInput;
        handed.push({ taskId: run.taskId, input: run.input });
        return "Triaged.";
      }
    });
    const door = handler({ name: "task-fits-triage-door", inputSchema: doorInput, execute: () => "I take tasks only." });
    const heard = handler({ name: "task-fits-triage-heard", inputSchema: z.object({ from: z.string(), text: z.string() }).passthrough(), execute: () => "I take tasks only." });
    return defineFlow({
      kind: "triage",
      configSchema: workerConfigSchema(),
      session: installation.session(),
      resources: { ...installation.resources, ...workerMessagesResources },
      actions: { respond: { inputSchema: doorInput, block: door, userMessage: (input: { message: string }) => input.message } },
      internal: { actions: { onMessageReceived: messageReceivedEntry({ installation, flowKind: "triage", turn: heard }) } },
      task: {
        actions: {
          work: workerTaskEntry({
            name: "task-fits-triage-work",
            block,
            inputSchema: taskInputSchema(triageInput, {
              serverOwned: ["requestedBy"],
              fill: ({ ctx }) => ({ requestedBy: `u:${(ctx as { user?: { identity?: { userId?: string } } }).user?.identity?.userId ?? ""}` })
            })
          })
        }
      }
    } as never);
  };
  const real = createModelResolver() as unknown as (id: string, block?: string) => unknown;
  const modelResolver = Object.assign((id: string, block?: string) => real(id === "goal/real" ? MODEL : id, block), {
    resolveId: (id: string) => (id === "goal/real" ? MODEL : id)
  });
  return createFlowState({
    kits: [workforce({ directory: TREE, agent: {} })],
    fill: {
      [workforce.slots.workerFlows]: {
        desk: workerFlow(deskFlow, { roles: ["manager"] }),
        triage: workerFlow(triageFlow, { roles: ["contributor"] })
      }
    },
    stores: { default: { primary: sqliteStores({ filename: db }) } },
    logger: silentLogger,
    modelResolver,
    resolvePrincipal: (context: any) => {
      const user = context.request?.headers.get("x-user");
      return typeof user === "string" ? { userId: user, orgId: ORG_ID } : null;
    }
  } as never);
}

type Host = ReturnType<typeof startHost>;
type Row = Task & { partition: string };

async function storeOf(host: Host) {
  const stores = (await host.getRuntime()).stores as any;
  return {
    rows: async (): Promise<Row[]> =>
      Object.entries(await stores.resourceState.getByPrefix("user", `${USER_ID}:~org:${ORG_ID}`, "tasks/")).map(([key, value]: [string, any]) => ({
        ...(value.state as Task),
        partition: key.split("/")[1]!
      })),
    requests: async (sessionId: string): Promise<any[]> =>
      ((await stores.request.list({ sessionId, withItems: true })) as any[]).sort((a, b) => a.createdAt - b.createdAt),
    running: async (): Promise<number> => (await stores.request.list({ status: "in_progress", orderBy: "none", limit: 1 })).length
  };
}

async function quiet(host: Host): Promise<boolean> {
  const store = await storeOf(host);
  for (const deadline = Date.now() + QUIET_BUDGET_MS; Date.now() < deadline; await sleep(200)) {
    if ((await store.running()) === 0) {
      await sleep(GRACE_MS);
      if ((await store.running()) === 0) return true;
    }
  }
  return false;
}

// ---- the run ----------------------------------------------------------------------

await runGoal(async (failures) => {
  const notes: string[] = [];

  // ---- discover ----------------------------------------------------------------
  if (legs.has("discover")) {
    const key = keysServing(MODEL).find((k) => (process.env[k] ?? "") !== "");
    if (key === undefined) return { failures: [`blocked: no key here serves ${MODEL}; none of ${keysServing(MODEL).join(", ")} is set`], evidence: "" };
    const db = join(SCRATCH, `${RUN_STAMP}-${CONTROL || "plain"}.sqlite`);
    say(`store ${db}; model ${MODEL}${control === undefined ? "" : `; control ${CONTROL}`}`);
    const host = startHost(db);
    try {
      const http = actingAs((await host.getRouter()) as any, USER_ID);
      const store = await storeOf(host);
      let accepted = 0;
      for (let run = 1; run <= RUNS; run += 1) {
        const ticket = `ENG-${randomInt(100, 10_000)}`;
        const conv = await http.open("desk", { workerId: DESK });
        // The ask names the ticket and what to do with it, never the field names or the kind's words.
        const ask = `Ticket ${ticket} needs triage. Have it looked into, but nothing about the code should change yet.`;
        const out = await http.act("desk", conv, "createTask_tasks", { goal: ask, assignee: LEAD });
        if (out?.ok !== true) throw new Error(`filing for ${LEAD} was refused: ${show(out)}`);
        await quiet(host);
        const rows = await store.rows();
        const top = rows.find((r) => r.id === out.taskId);
        const piece = rows.find((r) => r.assignee === TRIAGER && (r.metadata as Record<string, unknown> | undefined)?.pieceOf === out.taskId);
        const got = piece === undefined ? undefined : handed.find((h) => h.taskId === piece.id);
        // The lead's createTask calls for the triager, in order, as its task session stored them.
        const own = (top as { run?: { sessionId?: string } } | undefined)?.run?.sessionId;
        const calls =
          own === undefined
            ? []
            : (await store.requests(own))
                .flatMap((r) => (r.items ?? []) as any[])
                .filter((i) => i.type === "tool_output" && i.toolCall?.name === "createTask");
        const refusedFirst = calls.findIndex((i) => /input_refused/.test(JSON.stringify(i.output ?? i.result ?? "")));
        const acceptedFirst = calls.findIndex((i) => piece !== undefined && JSON.stringify(i.output ?? i.result ?? "").includes(piece.id));
        const fits =
          piece !== undefined &&
          got !== undefined &&
          (piece.input as Record<string, unknown>).ticket === ticket &&
          (got.input as Record<string, unknown>).kind === "probe" &&
          (piece.input as Record<string, unknown>).requestedBy === `u:${USER_ID}` &&
          acceptedFirst !== -1 &&
          (refusedFirst === -1 || refusedFirst > acceptedFirst);
        if (fits) accepted += 1;
        notes.push(
          `run ${run}: ${fits ? "first filing fit" : "did not"}; stored ${show(piece?.input)}; handed ${show(got?.input)}; createTask calls ${calls.length} (first refused at ${refusedFirst}, accepted at ${acceptedFirst}); first call ${show({ input: calls[0]?.toolCall?.input ?? calls[0]?.toolCall?.args, output: calls[0]?.output ?? calls[0]?.result })}`
        );
      }
      if (accepted < MUST_PASS) {
        failures.push(`discover:first-filing-fits — wanted the lead's first filing for ${TRIAGER} accepted in at least ${MUST_PASS} of ${RUNS} runs; ${accepted} were`);
      }
      notes.push(`discover: ${accepted} of ${RUNS} first filings fit`);
    } finally {
      await host.dispose();
    }
  }

  // ---- scripted ------------------------------------------------------------------
  // Refuse, Own, Stamp, Race, Round trip, Move, Claim, Open and Project, on the
  // real engine and board, graded on the stored row and what the worker block
  // received: the workforce suite for this issue, run here once.
  if (legs.has("scripted")) {
    const run = spawnSync("pnpm", ["exec", "vitest", "run", "test/task-input.test.ts", "test/task-input-race.test.ts", "test/task-input-sources.test.ts"], {
      cwd: join(REPO_ROOT, "packages/workforce"),
      encoding: "utf8"
    });
    const text = `${run.stdout}\n${run.stderr}`;
    const failed = text.split("\n").filter((line) => line.trim().startsWith("×"));
    if (run.status !== 0) failures.push(`scripted:suite — wanted every signal's test to pass; ${failed.length} failed: ${show(failed.map((l) => l.trim()))}`);
    notes.push(`scripted: ${/Tests\s+[^\n]+/.exec(text)?.[0] ?? "no summary"}`);
  }

  for (const note of notes) say(note);
  if (control !== undefined) {
    for (const assertion of control.assertions) {
      const named = failures.some((f) => f.startsWith(`${assertion} `));
      failures.unshift(named ? `control ${CONTROL}: ${assertion} failed, as it must` : `control ${CONTROL}: ${assertion} did NOT fail, so the check can't see what the control removes`);
    }
  }
  return { failures, evidence: `legs ${[...legs].join(", ")} on ${MODEL}; ${notes.join(" | ")}` };
});
