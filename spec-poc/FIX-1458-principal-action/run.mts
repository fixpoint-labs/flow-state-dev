/**
 * spec/FIX-1458 — Model B, run rather than argued.
 *
 * Throwaway. Nothing here ships. Run it:
 *
 *   pnpm tsx --tsconfig spec-poc/FIX-1458-principal-action/tsconfig.json spec-poc/FIX-1458-principal-action/run.mts
 *   POC_CONTROL=trust-input ...   # must FAIL, and FIRST at leg (d)
 *   POC_CONTROL=no-park     ...   # must FAIL, and FIRST at leg (b)
 *
 * ## The question
 *
 * Model B says the **work plane** changes and the **org chart** stays: a
 * non-human seat owns the row and parks it with a reason, the person acts
 * through a **flow action bound to a principal**, the flow decides what the
 * answer means and carries on, and one listing still shows people beside
 * agent seats. Prose cannot settle any of that. This runs it.
 *
 * ## The legs
 *
 * (a) The tree hires three seats and **none of them is a person**. One agent
 *     seat carries the durable bind `reviewedBy: u_dana`; one carries none.
 *     The org chart reads seats and people out of that one tree. Control: the
 *     same bind on a kind that never declared the key refuses the whole roster
 *     by the key's name.
 * (b) An **agent-owned** row parks, carrying the reason its own seat wrote, and
 *     the drain exits `parked-for-review` — while another row on the same board
 *     completes inline. A second drain does not re-take the parked row.
 * (c) Who owes it is derivable and stored nowhere: row → desk → the seat that
 *     drains it → that seat's `reviewedBy:`. Null arm: the unbound desk's row
 *     names the seat and no person, which must not collapse into the answer
 *     for a row that resolves to no seat at all.
 * (d) The **principal-bound action**. The caller is read off the request, not
 *     the payload. A stranger is refused and the row stays parked; a stranger
 *     *claiming* to be Dana in the payload is refused the same way; a row owed
 *     to nobody refuses everyone; and Dana's own request unparks it — in a
 *     LATER request, with the flow deciding what her words meant.
 * (e) The **durable bind** survives a store round-trip: the authored settings
 *     JSON-round-trip and re-hire to the same bind, while the runtime-only
 *     `seatTools` the factory imposes does not survive and must be re-resolved.
 *
 * ## What this does NOT grade, stated rather than implied
 *
 * - **There is no HTTP transport here.** `runAction({ userId })` is the seam a
 *   real host's `resolvePrincipal` fills, so what leg (d) proves is that the
 *   guard reads THAT seam and not the payload — not that any particular host
 *   authenticates well. The control is aimed exactly at that distinction.
 * - `openChannels` / `openInventory` are not run. The org chart here is read
 *   off the tree; whether people should become first-class inventory rows is
 *   the open wall, and this deliberately does not answer it.
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
  WORKER_KIND,
  type AnswerVerdict,
  type DeclaredSeat,
  defineWorkerFlow,
  definePlainFlow,
  orgChart,
  parkingDrain,
  principalBoundAnswer,
  reviewAudienceOf,
} from "./model-b.mts";

const HERE = dirname(fileURLToPath(import.meta.url));
const CONTROL = process.env.POC_CONTROL ?? "";

const DANA = "u_dana";
const MALLORY = "u_mallory";
const BOOT = "u_boot";
const ORG_ID = "org_acme";
// Three sessions, and the reason is leg (d0): a session is bound to ONE user,
// so the board a person answers into cannot live in the seat's session. The
// ledger is org-scoped; every principal arrives in their own session.
const SESSION_OPS = "s_ops";
const SESSION_DANA = "s_dana";
const SESSION_MALLORY = "s_mallory";
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

console.log("\n(a) the org chart — three seats, no person among them, one durable bind");

const roster = await readDeclaredRoster(join(HERE, "workforce"));
check("a", roster.problems.length === 0, `tree loaded clean (${roster.problems.length} problems)`);

/** One tool block, so leg (e) has a runtime-only imposed value to watch die. */
const ledgerLookup = handler({
  name: "ledger-lookup",
  inputSchema: z.object({ id: z.string() }),
  outputSchema: z.object({ amount: z.number() }),
  execute: async () => ({ amount: 0 }),
});

const seats = hireWorkforce(roster.workers, {
  kinds: { [WORKER_KIND]: defineWorkerFlow(), plain: definePlainFlow() },
  seatBlocks: { "ops.refunds-bot": { "ledger-lookup": ledgerLookup } },
});
check("a", seats.length === 3, `hired ${seats.length} seats: ${seats.map((s) => s.id).join(", ")}`);
check(
  "a",
  seats.every((s) => s.kind === WORKER_KIND),
  `every seat is the one ordinary worker kind: ${[...new Set(seats.map((s) => s.kind))].join(", ")}`
);
// The invent-kill, graded rather than asserted in prose: no seat IS a person.
check(
  "a",
  seats.every((s) => s.kind !== "human") && roster.workers.every((w) => w.declared.principal === undefined),
  "no seat is a person — no `human` kind exists and no file declares `principal:` as a seat's identity"
);

/** What the TREE says, read at run time. The oracle for every later leg. */
const declared: DeclaredSeat[] = roster.workers.map((w) => ({
  id: w.id,
  kind: (w.declared.flow as string | undefined) ?? "agent",
  answersFor: w.declared.answersFor as string | undefined,
  reviewedBy: w.declared.reviewedBy as string | undefined,
}));
let rosterView: ReadonlyArray<DeclaredSeat> = declared;

check(
  "a",
  declared.find((d) => d.id === "ops.refunds-bot")?.reviewedBy === DANA,
  "the bind is on an AGENT seat and comes from the tree, not from this file"
);
check(
  "a",
  declared.find((d) => d.id === "ops.audit-bot")?.reviewedBy === undefined,
  "and a sibling seat on the same kind carries no bind at all — absent is not undeclared"
);

const chart = orgChart(declared);
check("a", chart.seats.length === 3, `the org chart lists ${chart.seats.length} seats`);
check(
  "a",
  chart.people.length === 1 && chart.people[0]?.principal === DANA,
  `and one person beside them: ${JSON.stringify(chart.people)}`
);
check(
  "a",
  chart.people[0]?.reviewsFor.join(",") === "ops.refunds-bot",
  "the person appears because a seat owes them a sign-off, not because they occupy a slot"
);

// Control: the same bind on a kind that never declared the key.
const refusalTree = await readDeclaredRoster(join(HERE, "refusal-tree"));
let refusal = "";
try {
  hireWorkforce(refusalTree.workers, { kinds: { plain: definePlainFlow() } });
} catch (error) {
  refusal = error instanceof Error ? error.message : String(error);
}
check(
  "a",
  refusal.includes("reviewedBy"),
  refusal === ""
    ? "CONTROL DID NOT FIRE: a kind with no `reviewedBy:` hired the bind anyway"
    : `control refuses by the key's name: ${refusal.split("\n")[0].slice(0, 140)}`
);

// ---------------------------------------------------------------- the board

const ledger = defineTaskCollection({
  id: LEDGER_ID,
  // ORG, not session — see leg (d0). A session belongs to one user, so a board
  // a second principal has to reach cannot be scoped to the first one's.
  scope: "org",
  stateSchema: z.object({ amount: z.number() }),
});

/** The intake desk: files and does the rows nobody has to look at. */
const intakeDrain = handler({
  name: "intake-desk-drain",
  inputSchema: taskWorkerInputSchema,
  outputSchema: z.object({ decidedBy: z.string(), outcome: z.string() }),
  execute: async (input: TaskWorkerInput) => ({ decidedBy: "seat", outcome: `refunded ${input.taskId}` }),
});

/**
 * The `no-park` control: a seat that answers its own escalation instead of
 * parking it. It is the shape somebody writes when they think a row that needs
 * a person is just a row that takes longer, and leg (b) is what must catch it.
 * It swaps BOTH parking desks, because the defect it models is a wrong idea
 * about the kind rather than one badly written desk — with only one swapped,
 * the other desk's park keeps the drain's exit reason green and the control
 * grades weaker than it reads. (Round 1 found that the hard way.)
 */
const noParkDrain = handler({
  name: "parking-drain-no-park",
  inputSchema: taskWorkerInputSchema,
  outputSchema: z.object({ decidedBy: z.string(), outcome: z.string() }),
  execute: async () => ({ decidedBy: "seat", outcome: "released: looks fine" }),
});

const board = taskBoard({
  name: BOARD,
  collection: ledger,
  concurrency: 1,
  dispatcher: "fifo",
  workers: {
    // Desk keys are a different spelling from the seat ids on purpose: the
    // board's assignee registry and the roster RESOLVE to each other.
    "approvals-desk":
      CONTROL === "no-park" ? noParkDrain : parkingDrain({ ledgerId: LEDGER_ID, ask: ASK }),
    "intake-desk": intakeDrain,
    "audit-desk":
      CONTROL === "no-park"
        ? noParkDrain
        : parkingDrain({ ledgerId: LEDGER_ID, ask: AUDIT_ASK, name: "parking-drain-audit" }),
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
      assignee: "intake-desk",
      input: { amount: 12 },
    });
    await tasks.addTask({
      id: "unbound",
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

/**
 * The action under test. `roster` is passed as a THUNK so leg (d)'s repointed
 * control can swap the tree's answer without rebuilding the flow — the check
 * has to follow the tree, not a map it also wrote.
 */
const answerAction = principalBoundAnswer({
  name: `${BOARD}-answer`,
  ledgerId: LEDGER_ID,
  roster: () => rosterView,
  unparkAndDrain: board.unparkAndDrain as never,
  ...(CONTROL === "trust-input" ? { mode: "trust-input" as const } : {}),
});

const flow = defineFlow({
  kind: BOARD,
  actions: {
    seed: { block: seed },
    drain: { block: board.drain },
    inspect: { block: inspect },
    answer: { block: answerAction },
  },
  resources: { [LEDGER_ID]: ledger },
})({ id: BOARD });

const stores = createInMemoryStores();
const registry = { get: (kind: string) => (kind === BOARD ? flow : undefined) } as never;

async function run(
  actionName: string,
  input: unknown,
  userId: string = BOOT,
  sessionId: string = SESSION_OPS
) {
  return runAction({
    flow,
    registry,
    stores,
    actionName,
    input,
    userId,
    orgId: ORG_ID,
    sessionId,
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

const readRow = async (taskId: string) =>
  (await run("inspect", { taskId })).output as z.infer<typeof rowSchema>;

// ---------------------------------------------------------------- leg (b)

console.log("\n(b) an agent owns the row, and parks it — nobody is standing in for a person");

await run("seed", {});
const firstDrain = await run("drain", {});
const parked = await readRow("over-limit");
const done = await readRow("routine");

check("b", parked.status === "parked", `the escalated row is "${parked.status}" after the drain returned`);
check("b", parked.feedback === ASK, `it carries the reason its own seat wrote: ${JSON.stringify(parked.feedback)}`);
check("b", done.status === "completed", `another row on the same board is "${done.status}"`);
check(
  "b",
  terminationReason(firstDrain) === "parked-for-review",
  `the drain exited "${terminationReason(firstDrain)}" — the request ends, the row does not`
);

// A second drain: `onReview: "exit"` ended the request at the first park, so the
// audit row is behind it. It doubles as the cheap version of "nobody answers":
// the row the first drain parked must still be parked, still carrying its reason.
await run("drain", {});
const stillParked = await readRow("over-limit");
check(
  "b",
  stillParked.status === "parked" && stillParked.feedback === ASK,
  `a second drain does not re-take the parked row — still "${stillParked.status}" with its reason`
);

// ---------------------------------------------------------------- leg (c)

console.log("\n(c) who owes it — derived from the row and the tree, stored nowhere");

const unbound = await readRow("unbound");
const audience = reviewAudienceOf({ ...parked, status: parked.status ?? "" }, declared);
check("c", audience?.seatId === "ops.refunds-bot", `the desk "${parked.assignee}" resolves to seat ${audience?.seatId}`);
check("c", audience?.principal === DANA, `and that seat's file says its parked work is owed to ${audience?.principal}`);
check(
  "c",
  reviewAudienceOf({ ...done, status: done.status ?? "" }, declared) === undefined,
  "a settled row waits on nobody"
);

const unboundAudience = reviewAudienceOf({ ...unbound, status: unbound.status ?? "" }, declared);
check("c", unbound.status === "parked", `the unbound desk's row is "${unbound.status}" — same kind, same park`);
check(
  "c",
  unboundAudience?.seatId === "ops.audit-bot" && unboundAudience.principal === undefined,
  `and the read names the seat with no person: ${JSON.stringify(unboundAudience)}`
);
check(
  "c",
  reviewAudienceOf({ assignee: "no-such-desk", status: "parked" }, declared) === undefined,
  "while a row resolving to no seat at all is a different answer — undefined, not a seat with no person"
);

// ---------------------------------------------------------------- leg (d)

console.log("\n(d) the principal-bound action — the caller comes off the request, not the payload");

/** Every `answer` run returns the guard's verdict as the action's output. */
const answer = async (input: unknown, userId: string, sessionId: string): Promise<AnswerVerdict> =>
  (await run("answer", input, userId, sessionId)).output as AnswerVerdict;

// d0 · the boundary the POC found rather than assumed. A session belongs to ONE
// user, and the runtime refuses a request that arrives on somebody else's
// before any block runs. So a person cannot answer INTO the seat's session, and
// the board a second principal has to reach cannot be session-scoped to the
// first. That is a constraint on the design, not a bug — and it is why the
// ledger above is org-scoped and every principal below arrives in their own.
let boundaryRefusal = "";
try {
  await answer({ taskId: "over-limit", feedback: "approve it" }, DANA, SESSION_OPS);
} catch (error) {
  boundaryRefusal = error instanceof Error ? error.message : String(error);
}
check(
  "d",
  boundaryRefusal.includes("owned by user"),
  boundaryRefusal === ""
    ? "a second principal walked into the seat's own session unchallenged"
    : `answering into the seat's session is refused by the runtime: ${boundaryRefusal.slice(0, 120)}`
);

// d1 · a stranger. Authenticated as somebody — just not the one this is owed to.
const strangerVerdict = await answer({ taskId: "over-limit", feedback: "approve it" }, MALLORY, SESSION_MALLORY);
const afterStranger = await readRow("over-limit");
check("d", strangerVerdict.allowed === false, `the stranger is refused: ${strangerVerdict.refusedBecause}`);
check("d", strangerVerdict.caller === MALLORY, `and the guard saw the REQUEST's principal: ${strangerVerdict.caller}`);
check(
  "d",
  afterStranger.status === "parked" && afterStranger.output === undefined,
  `the row is untouched — still "${afterStranger.status}", nothing recorded on it`
);

// d2 · the impostor arm, and the one the control swaps. Same stranger, now
// CLAIMING to be Dana in the payload. Identity is not a field a caller fills in.
const impostorVerdict = await answer(
  { taskId: "over-limit", feedback: "approve it", claimedPrincipal: DANA },
  MALLORY,
  SESSION_MALLORY
);
const afterImpostor = await readRow("over-limit");
check(
  "d",
  impostorVerdict.allowed === false && impostorVerdict.caller === MALLORY,
  `a payload claiming to be ${DANA} changes nothing — the guard still reads ${impostorVerdict.caller}`
);
check("d", afterImpostor.status === "parked", `and the row is still "${afterImpostor.status}"`);

// d3 · a row owed to nobody refuses everybody. An unbound desk is not an open
// door — the null arm has a red state of its own rather than a shrug.
const unboundVerdict = await answer({ taskId: "unbound", feedback: "approve it" }, DANA, SESSION_DANA);
check(
  "d",
  unboundVerdict.allowed === false && unboundVerdict.owedTo === "",
  `the unbound desk's row refuses even ${DANA}: ${unboundVerdict.refusedBecause}`
);

// d4 · the repointed-roster control, inline. Change which seat drains the desk
// in the tree's answer and NOTHING else; the same request must flip from
// allowed to refused. This is what stops d5 grading a constant.
rosterView = declared.map((s) =>
  s.id === "ops.refunds-bot" ? { ...s, reviewedBy: "u_someone_else" } : s
);
const repointedVerdict = await answer({ taskId: "over-limit", feedback: "approve it" }, DANA, SESSION_DANA);
rosterView = declared;
check(
  "d",
  repointedVerdict.allowed === false && repointedVerdict.owedTo === "u_someone_else",
  `repointing the bind in the tree flips Dana's own request to refused: ${repointedVerdict.refusedBecause}`
);

// d5 · the person. Her own request, in a LATER request than the one that parked
// it, and the flow — not the person — decides what her words meant.
const danaVerdict = await answer(
  { taskId: "over-limit", feedback: "approve — refund it" },
  DANA,
  SESSION_DANA
);
const settled = await readRow("over-limit");
check("d", danaVerdict.allowed === true, `${DANA}'s own request is allowed: caller ${danaVerdict.caller} owedTo ${danaVerdict.owedTo}`);
check("d", settled.status === "completed", `and the row settled "${settled.status}" in a later request`);
check(
  "d",
  (settled.output as { outcome?: string } | undefined)?.outcome === "released: approve — refund it",
  `with the FLOW deciding what she meant, not the substrate: ${JSON.stringify(settled.output)}`
);

// ---------------------------------------------------------------- leg (e)

console.log("\n(e) the durable bind — what a store owes, split by provenance");

const hired = seats.find((s) => s.id === "ops.refunds-bot");
const hiredSettings = (hired?.config ?? {}) as Record<string, unknown>;
check("e", hiredSettings["reviewedBy"] === DANA, `the hired seat carries the bind: ${hiredSettings["reviewedBy"]}`);
check(
  "e",
  Array.isArray(hiredSettings["seatTools"]) && (hiredSettings["seatTools"] as unknown[]).length === 1,
  `and the runtime-only value the factory imposed: seatTools holds ${(hiredSettings["seatTools"] as unknown[])?.length} live block(s)`
);

// What a store can carry: JSON. Round-trip the settings and watch which half
// survives. This is D2's provenance split with a red state instead of an
// argument.
const roundTripped = JSON.parse(JSON.stringify(hiredSettings)) as Record<string, unknown>;
check("e", roundTripped["reviewedBy"] === DANA, "the AUTHORED bind survives a JSON round-trip — a store can keep it");
const revivedTool = (roundTripped["seatTools"] as Array<Record<string, unknown>> | undefined)?.[0];
check(
  "e",
  revivedTool !== undefined && typeof revivedTool["execute"] !== "function",
  `while the imposed block comes back without its behaviour (execute is ${typeof revivedTool?.["execute"]}) — re-resolve it at hire, never store it`
);

// And the bind is what a redeploy needs: re-hire from the tree alone and the
// same person is still owed the same seat's parked work.
const rehired = hireWorkforce(roster.workers, {
  kinds: { [WORKER_KIND]: defineWorkerFlow(), plain: definePlainFlow() },
  seatBlocks: { "ops.refunds-bot": { "ledger-lookup": ledgerLookup } },
});
check(
  "e",
  (rehired.find((s) => s.id === "ops.refunds-bot")?.config as { reviewedBy?: string } | undefined)?.reviewedBy === DANA,
  "a re-hire from the same tree comes back bound to the same person"
);

// ----------------------------------------------------------------- verdict

console.log("");
if (failures.length === 0) {
  console.log("PASS — an agent owns the row, a principal-bound action answers it, the org chart still names the person.");
  process.exit(0);
}
const unique = [...new Set(failures)].sort();
console.log(`FAIL — ${failures.length} check(s), at leg(s): ${unique.join(", ")}`);
// Each control grades itself. A control that goes red somewhere other than the
// leg it names has demonstrated a different defect — usually a broken harness —
// and saying so is the difference between a control and a hope.
const expectedFirst = CONTROL === "no-park" ? "b" : CONTROL === "trust-input" ? "d" : "";
if (expectedFirst !== "" && failures[0] !== expectedFirst) {
  console.log(
    `CONTROL SELF-CHECK FAILED: "${CONTROL}" must go red FIRST at leg (${expectedFirst}), got (${failures[0]})`
  );
}
process.exit(1);
