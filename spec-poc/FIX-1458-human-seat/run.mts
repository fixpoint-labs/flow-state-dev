/**
 * spec/FIX-1458 — humans-in-seats, run rather than argued.
 *
 * Throwaway. Nothing here ships. Run it:
 *
 *   pnpm tsx spec-poc/FIX-1458-human-seat/run.mts
 *   POC_CONTROL=no-park pnpm tsx spec-poc/FIX-1458-human-seat/run.mts   # must FAIL at leg (b)
 *
 * ## The question
 *
 * The spec claims a person occupies the **same roster slot** an agent does, with
 * no new L1 type, no new task status, no second work plane — a `WORKER.md` on a
 * kind that parks, and one setting saying who the person is. Prose cannot settle
 * that. This runs it.
 *
 * ## The legs
 *
 * (a) The tree alone hires three seats, and the human ones carry `kind: "human"`
 *     — the exact value `openInventory` writes as its inventory row's `kind`.
 *     One of them declares NO `principal:` and hires all the same (BR-3): an
 *     absent setting is not an undeclared one. Control: the same file on a kind
 *     that never declared `principal:` refuses the whole roster, by the key's
 *     name.
 * (b) A row filed for the human's desk comes back **parked**, carrying the
 *     reason the seat wrote, and the drain exits `parked-for-review` — while the
 *     row filed for the agent desk on the SAME board completes inline. The
 *     difference is the kind, not the board.
 * (c) The audience is derivable and nothing stores it: row → desk → the seat
 *     whose own file answers for that desk → that seat's `principal:`. Null
 *     arm: the unnamed seat's parked row names the SEAT and no person, which is
 *     a different answer from a row that resolves to nobody at all.
 * (d) The answer arrives in a LATER request. `unparkAndDrain` re-queues the row
 *     and the same seat records the answer as the row's outcome; the row settles
 *     `completed` carrying it. What this leg does NOT show is who sent it —
 *     every request here runs as `u_boot` and `unparkAndDrain` takes
 *     `{ taskId, feedback }` with no caller identity. Recording the words is not
 *     proving who spoke; see DECISIONS.md → Open.
 *
 * ## What this does NOT grade, stated rather than implied
 *
 * - `openChannels` / `openInventory` are not run: both need a live host, and
 *   what they write about a seat is `{ id, kind }` off the hired flow copy,
 *   which leg (a) reads directly. The inventory claim here is structural, not
 *   observed.
 * - The board's seats are blocks in a registry, which is the board's own inline
 *   seat model. A seat that runs in its own session is a
 *   `dispatcher({ type: "task" })`, and that arm is not exercised.
 * - No model runs anywhere. Nothing here is a judgement call.
 */
import { defineFlow, handler } from "@flow-state-dev/core";
import { createInMemoryStores, runAction } from "@flow-state-dev/engine";
import {
  defineTaskCollection,
  type TaskCollectionRef,
  type TaskWorkerInput,
} from "@flow-state-dev/orchestration/tasks";
import {
  taskBoard,
  taskWorkerInputSchema,
  TASK_BOARD_META_COMPONENT_TYPE,
} from "@flow-state-dev/orchestration/task-board";
import { createMockModelResolver } from "@flow-state-dev/testing";
import { hireWorkforce } from "@flow-state-dev/workforce";
import { readDeclaredRoster } from "@flow-state-dev/workforce/loader";
import { z } from "zod";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  HUMAN_KIND,
  audienceOf,
  boardTasks,
  defineDeskFlow,
  defineHumanSeatFlow,
  humanDrain,
} from "./human-kind.mts";

const HERE = dirname(fileURLToPath(import.meta.url));
const CONTROL = process.env.POC_CONTROL ?? "";
const USER_ID = "u_boot";
const ORG_ID = "org_acme";
const SESSION_ID = "s_refunds";
const BOARD = "refunds";
const LEDGER_ID = `${BOARD}-ledger`;
const ASK = "Refund over the desk limit. Approve or send it back?";
const AUDIT_ASK = "Flagged for audit. Somebody has to look at this.";

const failures: string[] = [];
function check(leg: string, ok: boolean, detail: string): void {
  if (ok) console.log(`  ok   (${leg}) ${detail}`);
  else {
    console.log(`  FAIL (${leg}) ${detail}`);
    failures.push(leg);
  }
}

// ---------------------------------------------------------------- leg (a)

console.log("\n(a) the tree hires, and the human seat's kind is the one the inventory would record");

const roster = await readDeclaredRoster(join(HERE, "workforce"));
check("a", roster.problems.length === 0, `tree loaded clean (${roster.problems.length} problems)`);

const seats = hireWorkforce(roster.workers, {
  kinds: { [HUMAN_KIND]: defineHumanSeatFlow(), desk: defineDeskFlow() },
});
const reviewer = seats.find((s) => s.id === "ops.reviewer");
const filer = seats.find((s) => s.id === "ops.filer");
const auditor = seats.find((s) => s.id === "ops.auditor");
check("a", seats.length === 3, `hired ${seats.length} seats: ${seats.map((s) => s.id).join(", ")}`);
check("a", reviewer?.kind === HUMAN_KIND, `ops.reviewer hired into kind "${reviewer?.kind}"`);
check("a", filer?.kind === "desk", `ops.filer hired into kind "${filer?.kind}"`);

// BR-3's null arm at the hire: the same human kind, no `principal:` in the file.
// An ABSENT setting is not an undeclared one — the roster must not refuse, and
// the seat must not acquire a principal from anywhere.
check("a", auditor?.kind === HUMAN_KIND, `ops.auditor hired into kind "${auditor?.kind}" with no principal declared`);
check(
  "a",
  (auditor?.config as { principal?: unknown } | undefined)?.principal === undefined,
  `and its settings carry no principal: ${JSON.stringify((auditor?.config as { principal?: unknown } | undefined)?.principal)}`
);

// The oracle for every later leg: what the TREE says, read at run time.
const declared = roster.workers.map((w) => ({
  id: w.id,
  kind: (w.declared.flow as string | undefined) ?? "agent",
  answersFor: w.declared.answersFor as string | undefined,
  principal: w.declared.principal as string | undefined,
}));
check(
  "a",
  declared.find((d) => d.id === "ops.reviewer")?.principal === "u_dana",
  "the person is named in the tree, not in this file"
);

// Control: the same `principal:` on a kind that never declared it.
const refusalTree = await readDeclaredRoster(join(HERE, "refusal-tree"));
let refusal = "";
try {
  hireWorkforce(refusalTree.workers, { kinds: { desk: defineDeskFlow() } });
} catch (error) {
  refusal = error instanceof Error ? error.message : String(error);
}
check(
  "a",
  refusal.includes("principal"),
  refusal === ""
    ? "CONTROL DID NOT FIRE: a kind with no `principal:` hired the seat anyway"
    : `control refuses by the key's name: ${refusal.split("\n")[0].slice(0, 140)}`
);

// ---------------------------------------------------------------- the board

const ledger = defineTaskCollection({
  id: LEDGER_ID,
  scope: "session",
  stateSchema: z.object({ amount: z.number() }),
});

/** The agent desk: does its row and settles, the ordinary case. */
const routineDrain = handler({
  name: "routine-desk-drain",
  inputSchema: taskWorkerInputSchema,
  outputSchema: z.object({ answeredBy: z.string(), answer: z.string() }),
  execute: async (input: TaskWorkerInput) => ({ answeredBy: "seat", answer: `refunded ${input.taskId}` }),
});

/**
 * The control: a human seat that forgets to park. It is the shape somebody
 * writes when they treat a person as "an agent that is slow", and leg (b) is
 * what must catch it.
 */
const noParkDrain = handler({
  name: "human-seat-drain-no-park",
  inputSchema: taskWorkerInputSchema,
  outputSchema: z.object({ answeredBy: z.string(), answer: z.string() }),
  execute: async () => ({ answeredBy: "person", answer: "looks fine" }),
});

const board = taskBoard({
  name: BOARD,
  collection: ledger,
  concurrency: 1,
  dispatcher: "fifo",
  workers: {
    // The desk keys are a different spelling from the seat ids on purpose: the
    // board's assignee registry and the roster RESOLVE to each other (ER-7).
    "approvals-desk": CONTROL === "no-park" ? noParkDrain : humanDrain({ ledgerId: LEDGER_ID, ask: ASK }),
    "routine-desk": routineDrain,
    // The desk of the human seat nobody is named to. Same kind, same drain —
    // the only difference is that its file names no person (BR-3). The control
    // swaps BOTH human desks, because the defect it models is a wrong idea about
    // the kind, not one badly written desk.
    "audit-desk":
      CONTROL === "no-park"
        ? noParkDrain
        : humanDrain({ ledgerId: LEDGER_ID, ask: AUDIT_ASK, name: "human-seat-drain-audit" }),
  },
  onReview: "exit",
  idlePollMs: 2,
  maxIterations: 20,
});

const seed = handler({
  name: `${BOARD}-seed`,
  inputSchema: z.unknown(),
  outputSchema: z.null(),
  uses: [board.capability],
  execute: async (_input, ctx) => {
    const tasks: TaskCollectionRef = await ctx.cap[BOARD].tasks();
    await tasks.addTask({
      id: "over-limit",
      goal: "refund #8812, over the desk limit",
      assignee: "approvals-desk",
      input: { amount: 940 },
    });
    await tasks.addTask({
      id: "routine",
      goal: "refund #8813, within the desk limit",
      assignee: "routine-desk",
      input: { amount: 12 },
    });
    await tasks.addTask({
      id: "unnamed",
      goal: "refund #8814, flagged for audit",
      assignee: "audit-desk",
      input: { amount: 400 },
    });
    return null;
  },
});

const rowSchema = z.object({
  status: z.string().nullable(),
  feedback: z.string().optional(),
  assignee: z.string().optional(),
  output: z.unknown().optional(),
});

const inspect = handler({
  name: `${BOARD}-inspect`,
  inputSchema: z.object({ taskId: z.string() }),
  outputSchema: rowSchema,
  uses: [board.capability],
  execute: async (input, ctx) => {
    const tasks: TaskCollectionRef = await ctx.cap[BOARD].tasks();
    const row = tasks.get(input.taskId);
    return {
      status: row?.status ?? null,
      feedback: row?.feedback,
      assignee: row?.assignee,
      output: row?.output,
    };
  },
});

const flow = defineFlow({
  kind: BOARD,
  actions: {
    seed: { block: seed },
    drain: { block: board.drain },
    inspect: { block: inspect },
    answer: { block: board.unparkAndDrain },
  },
  resources: { [LEDGER_ID]: ledger },
})({ id: BOARD });

void boardTasks; // re-exported for the kind module's own use; not called here.

const stores = createInMemoryStores();
const registry = { get: (kind: string) => (kind === BOARD ? flow : undefined) } as never;

async function run(actionName: string, input: unknown) {
  return runAction({
    flow,
    registry,
    stores,
    actionName,
    input,
    userId: USER_ID,
    orgId: ORG_ID,
    sessionId: SESSION_ID,
    runtimeConfig: { modelResolver: createMockModelResolver({}) },
  } as never) as Promise<{ items?: readonly unknown[]; output?: unknown }>;
}

function terminationReason(result: { items?: readonly unknown[] }): string | undefined {
  type MetaItem = { type?: string; component?: string; data?: unknown };
  const meta = ((result.items ?? []) as MetaItem[]).find(
    (i) => i.type === "component" && i.component === TASK_BOARD_META_COMPONENT_TYPE
  );
  return (meta?.data as { terminationReason?: string } | undefined)?.terminationReason;
}

// ---------------------------------------------------------------- leg (b)

console.log("\n(b) one board, two desks: the person's row parks, the agent's row settles");

await run("seed", {});
const firstDrain = await run("drain", {});
const parked = (await run("inspect", { taskId: "over-limit" })).output as z.infer<typeof rowSchema>;
const done = (await run("inspect", { taskId: "routine" })).output as z.infer<typeof rowSchema>;

check("b", parked.status === "parked", `the person's row is "${parked.status}" after the drain returned`);
check("b", parked.feedback === ASK, `it carries the reason the seat wrote: ${JSON.stringify(parked.feedback)}`);
check("b", done.status === "completed", `the agent desk's row on the same board is "${done.status}"`);
check(
  "b",
  terminationReason(firstDrain) === "parked-for-review",
  `the drain exited "${terminationReason(firstDrain)}" — the request ends, the row does not`
);

// ---------------------------------------------------------------- leg (c)

// A second drain, because `onReview: "exit"` ends the request at the first park
// and the audit row is behind it. It doubles as the cheap version of BR-7: the
// row the first drain parked must still be parked, still carrying its reason.
await run("drain", {});
const stillParked = (await run("inspect", { taskId: "over-limit" })).output as z.infer<typeof rowSchema>;
const unnamed = (await run("inspect", { taskId: "unnamed" })).output as z.infer<typeof rowSchema>;
check(
  "b",
  stillParked.status === "parked" && stillParked.feedback === ASK,
  `a second drain does not re-take the parked row — still "${stillParked.status}" with its reason`
);

console.log("\n(c) who owes it — derived from the row and the tree, stored nowhere");

const audience = audienceOf({ ...parked, status: parked.status ?? "" }, declared);
check("c", audience?.seatId === "ops.reviewer", `the desk "${parked.assignee}" resolves to seat ${audience?.seatId}`);
check("c", audience?.principal === "u_dana", `and that seat's file names ${audience?.principal}`);
check(
  "c",
  audienceOf({ ...done, status: done.status ?? "" }, declared) === undefined,
  "a settled row waits on nobody"
);

// BR-3's null arm at the READ. The unnamed seat's row parks the same way, and
// the read names the seat while naming no person — which must not collapse into
// the answer for a row that resolves to no seat at all.
const unnamedAudience = audienceOf({ ...unnamed, status: unnamed.status ?? "" }, declared);
check("c", unnamed.status === "parked", `the unnamed seat's row is "${unnamed.status}" — it hired and it parks`);
check(
  "c",
  unnamedAudience?.seatId === "ops.auditor" && unnamedAudience.principal === undefined,
  `and the read names the seat with no person: ${JSON.stringify(unnamedAudience)}`
);
check(
  "c",
  audienceOf({ assignee: "no-such-desk", status: "parked" }, declared) === undefined,
  "while a row resolving to no seat at all is a different answer — undefined, not a seat with no person"
);

// ---------------------------------------------------------------- leg (d)

console.log("\n(d) the answer arrives in a later request");

await run("answer", { taskId: "over-limit", feedback: "approved — refund it" });
const answered = (await run("inspect", { taskId: "over-limit" })).output as z.infer<typeof rowSchema>;
check("d", answered.status === "completed", `the row settled "${answered.status}"`);
check(
  "d",
  (answered.output as { answer?: string } | undefined)?.answer === "approved — refund it",
  `and the seat recorded the answer as the row's outcome (nothing here checks who sent it): ${JSON.stringify(answered.output)}`
);

// ----------------------------------------------------------------- verdict

console.log("");
if (failures.length === 0) {
  console.log("PASS — a person occupies the same roster slot, on a kind that parks.");
  process.exit(0);
}
const unique = [...new Set(failures)].sort();
console.log(`FAIL — ${failures.length} check(s), at leg(s): ${unique.join(", ")}`);
// The control grades itself. (c) and (d) read the row (b) parks, so they follow
// it down — that is a real dependency, not a second defect, and the claim worth
// self-checking is that (b) is where it STARTS. A control that went red at (a)
// would have demonstrated a broken harness instead of a missing park.
if (CONTROL === "no-park" && failures[0] !== "b") {
  console.log(`CONTROL SELF-CHECK FAILED: no-park must go red first at leg (b), got ${failures[0]}`);
}
process.exit(1);
