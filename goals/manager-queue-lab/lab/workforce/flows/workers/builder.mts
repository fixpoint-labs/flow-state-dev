/**
 * The `builder` worker kind — one file under `workforce/flows/workers/`,
 * basename = the kind id every builder `WORKER.md` names in its `flow:` line.
 *
 * Three seats are hired onto this one kind. What makes them different is the
 * routing key each answers for, and **that key reaches a seat two ways on
 * purpose**, because the whole of BR-4 lives in the gap between them:
 *
 * - **The map** — `assignees`, seat id -> desk key, supplied by the host. This
 *   is the implementation under test. It narrows what the seat's drain claims
 *   and it is the only thing VG's negative control moves.
 * - **The tree** — each `WORKER.md`'s own `answersFor:` line, which arrives in
 *   the seat's config bag and is reported back out from inside the running
 *   work. This is the oracle, and it is never read by any wiring here.
 *
 * Grading the map against itself would move the oracle along with the
 * implementation and the control would stay green. So the wiring reads the map
 * and never `answersFor`, and the work reports `answersFor` and never the map.
 *
 * ## The one line that goes wrong quietly
 *
 * Every drain claims through {@link deskDispatcher}, which narrows
 * `collection.claim` with an `eligibility` predicate on the row's assignee.
 * **Never a bare `claim`.** `ClaimOptions.eligibility` narrows the candidate set
 * *before* the CAS flip, and both backings compose it with `isClaimable` rather
 * than replacing it. Omit it and a seat's drain claims whatever is next —
 * including a row addressed to another desk — after which `keyedRouter` misses,
 * throws out of the router, and `.rescue()` writes `collection.fail` against
 * that row. The row does not merely mis-route; it settles `errored`.
 *
 * There is **no status arm** in that predicate either. `t.status === "pending"`
 * compiles, reads correctly, and silently opts the drain out of lapsed-lease
 * recovery, because the row it has to match is `in_progress`
 * (`ClaimOptions.eligibility` names this case).
 *
 * The one arm that *is* there beside the desk key is `assignee === undefined`,
 * and it is deliberate rather than sloppy: the lab declares no `defaultWorker`,
 * so a row filed for nobody has to be *admitted* somewhere before it can be
 * refused by name. Leave it out and such a row is claimed by no seat and sits
 * `pending` in silence — quiet, where BR-7 says loud.
 *
 * ## Why the work runs in a child session
 *
 * The seat under `workers` is a `dispatcher({ action, session: "per-task" })` —
 * a **same-flow hand-off**. The row is claimed by the drain and then run in its
 * own child session, on this same flow instance, at the `task` entry below. One
 * ledger declaration, one hop, and a child session per row that carries a
 * `parentSessionId` and none of the coordinator's transcript.
 *
 * Nothing here declares the ledger a second time: the entry is reachable from
 * this flow's own board, which is what the orphan-task-entry guard wants. The
 * two-declaration shape `goals/devforce-lab/lab/board.mts` carries is the
 * cross-flow tax, and it is not this.
 */

import { defineFlow, dispatcher, handler } from "@flow-state-dev/core";
import type { BlockContext } from "@flow-state-dev/core/types";
import { taskBoard, taskWorkerInputSchema } from "@flow-state-dev/orchestration/task-board";
import {
  MIN_LEASE_DURATION_MS,
  type TaskDispatcher,
  type TaskWorkerInput,
} from "@flow-state-dev/orchestration/tasks";
import { workerConfigSchema, type ChannelBoardCollection } from "@flow-state-dev/workforce";
import { appendFileSync } from "node:fs";
import { z } from "zod";
import { ledgerOf } from "../../../ledger.mts";

/** The kind id every builder `WORKER.md` names. **Pinned** — the basename must match. */
export const BUILDER_KIND = "builder";

/** The action the check calls to make a seat work its share of the board. */
export const DRAIN_ENTRY = "drain";

/** The task entry the same-flow hand-off addresses. Reachable only through the claim gate. */
export const WORK_ENTRY = "work";

/**
 * Claim a row on the shortest lease the substrate allows, and do not settle it.
 *
 * The only way to produce a **genuinely** lapsed lease — a row whose worker
 * died — on the real path. Staging one by writing the store would prove the
 * view agrees with a row this lab wrote, which is not what BR-10 and BR-11
 * claim; this leaves a real claim, in this seat's own session, that really
 * expires.
 */
export const HOLD_ENTRY = "hold";

/**
 * The lab's own setting: the desk this seat answers for, as its own file says.
 *
 * **The oracle, and read by nothing that routes.** It is reported back out of a
 * running row so a check can ask whether the row that arrived was addressed to
 * the desk this seat's file claims.
 */
const ANSWERS_FOR_KEY = "answersFor";

/** What a builder seat's settings bag holds: the contract, plus its own desk. */
export function builderSettingsSchema() {
  return workerConfigSchema().extend({
    [ANSWERS_FOR_KEY]: z.string().min(1),
  });
}

/** The parts of the bag this module reads where the bag's type is erased. */
interface BuilderConfig {
  answersFor: string;
}

/** One line the work leaves behind — a real file, outside the board entirely. */
export const workLineSchema = z.object({
  /** The seat instance that ran it, off `ctx.flow.id`. */
  seat: z.string(),
  /** What that seat's OWN FILE says it answers for — the oracle, from the tree. */
  declaredAssignee: z.string(),
  /** The row, so the check can look its `assignee` up on the ledger. */
  taskId: z.string(),
  /** The row's goal, verbatim, so the work is graded against what was filed. */
  goal: z.string(),
  /** The child session this row ran in, off `ctx.session.identity.id`. */
  session: z.string(),
});

export type WorkLine = z.infer<typeof workLineSchema>;

/**
 * A claim narrowed to one seat's desk.
 *
 * Per **seat**, resolved at claim time off `ctx.flow.id`, because three seats
 * share one kind and therefore one board object: a key captured when the board
 * was built would be one key for all three.
 *
 * A seat the map does not name claims nothing at all, rather than falling back
 * to a bare claim — the failure a fallback produces is a seat quietly eating
 * another desk's rows, which is the one thing this predicate exists to prevent.
 */
function deskDispatcher(assignees: Record<string, string>): TaskDispatcher {
  return {
    async claim(collection, workerId, ctx) {
      const seat = String((ctx.flow as { id?: string }).id ?? "");
      const desk = assignees[seat];
      if (desk === undefined) return null;
      return collection.claim(workerId, {
        // No status arm — claimability is the substrate's call, and adding one
        // opts this drain out of lapsed-lease recovery. The `undefined` arm is
        // what lets a row filed for nobody be refused by name (BR-7).
        eligibility: (task) => task.assignee === desk || task.assignee === undefined,
      });
    },
  };
}

export interface BuilderWorkerFlowOptions {
  /** The channel's own ledger — the one the `CHANNEL.md` declared by name. */
  board: ChannelBoardCollection;
  /**
   * Which desk keys have a body on this board — the board's vocabulary.
   *
   * Distinct from {@link BuilderWorkerFlowOptions.assignees}, which says which
   * SEAT claims which key. One stub runs every desk, so this associates no key
   * with any seat and is therefore not the thing under test.
   */
  desks: readonly string[];
  /**
   * Seat id -> desk key: **the implementation under test.**
   *
   * The app's, supplied by the caller and never read off the tree, which is the
   * only thing that lets VG's negative control point one desk at the wrong seat
   * while the tree still says where the row should have gone.
   */
  assignees: Record<string, string>;
  /**
   * The drain width — how many rows one seat runs at once.
   *
   * **The switch, and the whole of what this issue owes on it** (BR-17, D3). At
   * `1` a second row for a busy desk queues behind the first; above `1` the
   * seat takes a second copy of the work. Which of those is right is an
   * epic-level call this lab does not make — it is wired so either runs, from
   * one knob, with no edit to the tree and none to the checks.
   */
  drainWidth: number;
  /** Where a finished row leaves its line. A side effect outside the board. */
  outbox: string;
  /** Bound on the drain loop, so a seat with nothing to claim stops rather than hangs. */
  maxIterations?: number;
  /** How long an idle drain waits between polls. */
  idlePollMs?: number;
}

/**
 * Build the builder kind.
 *
 * @param options The ledger, the board's desk vocabulary, the seat map under
 *   test, the drain width, and where finished work leaves its line.
 * @returns The flow factory `hireWorkforce` mints one copy of per builder record.
 */
export function defineBuilderWorkerFlow(options: BuilderWorkerFlowOptions) {
  const outbox = options.outbox;

  /**
   * The work itself: small, deterministic, and real.
   *
   * Deliberately narrow while Q1 is open — a stub that writes a file a check
   * reads back, not a coding run. A gate that goes red for reasons unrelated to
   * routing has stopped being a gate.
   *
   * It reports only what it alone can know: which seat it is, what its own file
   * says it answers for, and which session it woke in. The row's `assignee`
   * comes off the ledger, where the coordinator put it — asking the worker for
   * it would let one side of the comparison answer for both.
   */
  const runRow = handler({
    name: "builder-run-row",
    inputSchema: taskWorkerInputSchema,
    outputSchema: workLineSchema,
    execute: async (input: TaskWorkerInput, ctx: BlockContext): Promise<WorkLine> => {
      const config = ctx.flow.config as unknown as BuilderConfig;
      const line: WorkLine = {
        seat: String((ctx.flow as { id?: string }).id ?? "<unknown>"),
        declaredAssignee: config.answersFor,
        taskId: input.taskId,
        goal: input.goal,
        session: String(ctx.session.identity.id),
      };
      appendFileSync(outbox, `${JSON.stringify(line)}\n`, "utf8");
      return line;
    },
  });

  const board = taskBoard({
    name: `${BUILDER_KIND}-desk-board`,
    boardId: `${BUILDER_KIND}-desk-board`,
    collection: options.board,
    concurrency: options.drainWidth,
    dispatcher: deskDispatcher(options.assignees),
    maxIterations: options.maxIterations ?? 400,
    idlePollMs: options.idlePollMs ?? 25,
    // One stub per desk key. A row whose assignee is not among them — including
    // a row with no assignee at all — misses the router and is refused by name,
    // which is BR-7. No `defaultWorker`: a floor would make that refusal quiet.
    workers: Object.fromEntries(
      options.desks.map((desk) => [
        desk,
        dispatcher<TaskWorkerInput>({
          name: `${BUILDER_KIND}-hand-off-${desk}`,
          action: WORK_ENTRY,
          session: "per-task",
        }),
      ]),
    ),
  });

  /**
   * Claim one of this seat's rows on the minimum lease and walk away.
   *
   * Narrowed by the same desk predicate the drain uses, so the row it takes is
   * one this seat is entitled to. Nothing renews the lease — a row claimed by
   * hand gets no renewal driver — so it lapses on its own, which is precisely
   * the state a worker that died leaves behind.
   */
  const holdRow = handler({
    name: "builder-hold-row",
    resources: { [options.board.id]: options.board },
    inputSchema: z.object({}).optional(),
    outputSchema: z.object({ taskId: z.string().nullable(), leaseMs: z.number() }),
    execute: async (_input: unknown, ctx: BlockContext) => {
      const seat = String((ctx.flow as { id?: string }).id ?? "");
      const desk = options.assignees[seat];
      const ledger = await ledgerOf(ctx, options.board.id);
      const claimed = await ledger.claim(`hold:${seat}`, {
        eligibility: (task) => task.assignee === desk,
        leaseDurationMs: MIN_LEASE_DURATION_MS,
      });
      return { taskId: claimed?.id ?? null, leaseMs: MIN_LEASE_DURATION_MS };
    },
  });

  return defineFlow({
    kind: BUILDER_KIND,
    cardinality: "collection",
    configSchema: builderSettingsSchema(),
    actions: {
      [DRAIN_ENTRY]: {
        block: board.drain,
        description: "Work this seat's share of the channel's board.",
      },
      [HOLD_ENTRY]: {
        block: holdRow,
        description: "Claim one row on the minimum lease and do not settle it.",
      },
    },
    task: { actions: { [WORK_ENTRY]: { block: runRow } } },
  } as never);
}
