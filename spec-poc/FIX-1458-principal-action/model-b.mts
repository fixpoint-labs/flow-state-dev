/**
 * The candidate portable pieces of Model B, written out.
 *
 * Throwaway POC code for spec/FIX-1458. Nothing here ships. The claim it makes
 * falsifiable is that **the work plane changes and the org chart stays**: a
 * non-human seat owns the row and parks it, the person acts through a
 * **flow action bound to a principal**, and the flow decides what the answer
 * means and carries on.
 *
 * Four exports, and the split is the point:
 *
 * - `defineWorkerFlow()` — the KIND. An ordinary worker kind whose closed
 *   config schema declares `answersFor:` and an optional `reviewedBy:`. There
 *   is **no human kind**. The person is not a seat.
 * - `parkingDrain()` — the seat's own board worker: it owns the row, parks it
 *   with a reason when it needs a person, and records what came back. This is
 *   an agent doing its job, not a stand-in for somebody.
 * - `reviewAudienceOf()` — who owes a parked row, derived: row → desk → the
 *   seat that drains that desk → that seat's `reviewedBy:` principal.
 * - `principalBoundAnswer()` — the action. A sequencer whose first step reads
 *   the caller off **the request** (`ctx.user.identity`), compares it to the
 *   derived audience, and only then lets the board's `unparkAndDrain` run.
 *
 * The one line that carries the whole accountability claim is in
 * `principalGuard`: the caller comes from `ctx.user.identity.userId`, which the
 * transport's principal resolver stamps on the envelope, and **never** from
 * `input` (BP-031). `POC_CONTROL=trust-input` swaps exactly that line.
 */
import { handler, sequencer } from "@flow-state-dev/core";
import { defineFlow } from "@flow-state-dev/core";
import type { BlockContext, ResourceCollectionRef } from "@flow-state-dev/core/types";
import type { JsonObject } from "@flow-state-dev/core";
import {
  getOrCreateTaskCollection,
  type TaskCollectionRef,
  type TaskWorkerInput,
} from "@flow-state-dev/orchestration/tasks";
import { taskWorkerInputSchema } from "@flow-state-dev/orchestration/task-board";
import { workerConfigSchema } from "@flow-state-dev/workforce";
import { z } from "zod";

/** The kind every seat on this team runs. There is no second one for people. */
export const WORKER_KIND = "worker";

/**
 * The seat's settings bag: the four the hire step imposes, plus two of its own.
 *
 * `reviewedBy` is the **durable bind** — one string naming the principal who
 * answers for what this seat parks. It sits on an *agent* seat, which is the
 * whole difference from Model A: the person is who a seat's work is escalated
 * to, not who occupies a slot.
 *
 * It is **optional**, and that is a rule rather than a convenience: an absent
 * setting is not an undeclared one, so a seat nobody has been named to still
 * hires and every read says *waiting on the desk, on no person* rather than
 * inventing one. Only a `reviewedBy:` on a kind that never declared the key is
 * refused, and it refuses the whole roster.
 *
 * `answersFor` is the desk key the board files rows against, kept a DIFFERENT
 * spelling from the seat id on purpose: the board's assignee registry and the
 * roster resolve to each other, they are not one noun.
 */
export const workerSeatConfigSchema = () =>
  workerConfigSchema().extend({
    answersFor: z.string(),
    reviewedBy: z.string().optional(),
    // Declared only so leg (e) has a runtime-only imposed value to watch die in
    // a store round-trip. Nothing in Model B turns on it.
    tools: z.array(z.string()).default([]),
  });

/** The one hireable kind. A `WORKER.md` reaches it with `flow: worker`. */
export function defineWorkerFlow() {
  return defineFlow({
    kind: WORKER_KIND,
    cardinality: "collection",
    configSchema: workerSeatConfigSchema(),
    actions: {},
  });
}

/** The contrast kind for the refusal control: it declares no review bind. */
export function definePlainFlow() {
  return defineFlow({
    kind: "plain",
    cardinality: "collection",
    configSchema: workerConfigSchema().extend({ answersFor: z.string() }),
    actions: {},
  });
}

/** How any block under the drain reaches the board's own ledger. */
export function boardTasks(ctx: BlockContext, ledgerId: string): Promise<TaskCollectionRef> {
  return getOrCreateTaskCollection({
    ctx,
    backing: "resource",
    collectionId: ledgerId,
    collection: ctx.resources[ledgerId] as ResourceCollectionRef<JsonObject>,
  });
}

/**
 * The seat's board worker — an agent that owns its row.
 *
 * First pass: it needs a person, so it parks the row with the reason that
 * person will read. The board's result recorders deliberately do not write over
 * a row its own worker parked, so the park survives the drain's return.
 *
 * Second pass: the row came back carrying `feedback` — what the action wrote —
 * so **the flow decides what the answer means** and settles the row. That
 * branch is the point of Model B: the person supplied input, the machine is
 * still the one running.
 */
export function parkingDrain(options: { ledgerId: string; ask: string; name?: string }) {
  return handler({
    // One drain per desk, so the name is per-desk too: the board's worker router
    // refuses two routes spelling the same name. (Carried over from round 1 —
    // it is a fact about the board, not about human seats, so it survives the
    // model flip unchanged.)
    name: options.name ?? "parking-drain",
    inputSchema: taskWorkerInputSchema,
    outputSchema: z.object({ decidedBy: z.string(), outcome: z.string() }),
    execute: async (input: TaskWorkerInput, ctx) => {
      if (input.feedback === undefined) {
        const tasks = await boardTasks(ctx, options.ledgerId);
        await tasks.awaitReview(input.taskId, options.ask);
        return { decidedBy: "", outcome: "" };
      }
      // The flow's own reading of what a person said. An approval releases the
      // refund; anything else sends it back. The substrate has no opinion.
      const approved = input.feedback.toLowerCase().startsWith("approve");
      return {
        decidedBy: "flow",
        outcome: approved ? `released: ${input.feedback}` : `sent back: ${input.feedback}`,
      };
    },
  });
}

/** One seat as the roster read it out of the tree. The oracle for every read. */
export type DeclaredSeat = {
  id: string;
  kind: string;
  answersFor?: string;
  reviewedBy?: string;
};

/**
 * Who owes a parked row, derived and stored nowhere.
 *
 * A row is *waiting on you* when it is parked or blocked — the grouping the
 * shipped manager-queue lab already uses. What that view cannot say today is
 * WHO. This resolves it the long way, and the long way is the point: the row
 * names a desk, the roster names which seat drains that desk, and that seat's
 * own file names the principal its parked work is escalated to. Three facts,
 * no new field, nothing written down.
 *
 * Three endings, and the middle one is the null arm. A row whose desk resolves
 * to a seat names that seat, and names a person only when the seat's file does
 * — a seat nobody is named to reads as *waiting on the desk, on no person*,
 * which is a different answer from *this row resolves to nobody at all* and
 * must not collapse into it.
 */
export function reviewAudienceOf(
  row: { assignee?: string; status: string },
  roster: ReadonlyArray<DeclaredSeat>
): { seatId: string; principal: string | undefined } | undefined {
  if (row.status !== "parked" && row.status !== "blocked") return undefined;
  if (row.assignee === undefined) return undefined;
  const seat = roster.find((s) => s.answersFor === row.assignee);
  if (seat === undefined) return undefined;
  return { seatId: seat.id, principal: seat.reviewedBy };
}

/**
 * The org chart: seats and people in one listing, read off the tree.
 *
 * Every seat is a row. Every principal any seat is bound to is a row too, and
 * it carries the seats that name it — so a person appears **because somebody
 * owes them a sign-off**, not because they occupy a slot. Derived, like the
 * audience: there is no principal registry and nothing here is written down.
 *
 * What this shape cannot yet express is a person on the chart whom no seat
 * names. That is a real limit and it is the open wall, not a bug in this
 * function.
 */
export function orgChart(roster: ReadonlyArray<DeclaredSeat>): {
  seats: Array<{ id: string; kind: string }>;
  people: Array<{ principal: string; reviewsFor: string[] }>;
} {
  const seats = roster.map((s) => ({ id: s.id, kind: s.kind })).sort((a, b) => (a.id < b.id ? -1 : 1));
  const byPrincipal = new Map<string, string[]>();
  for (const seat of roster) {
    if (seat.reviewedBy === undefined) continue;
    const list = byPrincipal.get(seat.reviewedBy) ?? [];
    list.push(seat.id);
    byPrincipal.set(seat.reviewedBy, list);
  }
  const people = [...byPrincipal.entries()]
    .map(([principal, reviewsFor]) => ({ principal, reviewsFor: reviewsFor.sort() }))
    .sort((a, b) => (a.principal < b.principal ? -1 : 1));
  return { seats, people };
}

/** What the guard decided, and what the action returns either way. */
export const answerVerdictSchema = z.object({
  allowed: z.boolean(),
  taskId: z.string(),
  feedback: z.string().optional(),
  /** The caller the REQUEST carried. Never read off the payload. */
  caller: z.string(),
  /** The principal the row's audience resolved to, or `""` when it has none. */
  owedTo: z.string(),
  refusedBecause: z.string().optional(),
});

export type AnswerVerdict = z.infer<typeof answerVerdictSchema>;

/** What a caller sends. Note what is NOT here: any claim about who they are. */
export const answerInputSchema = z.object({
  taskId: z.string(),
  feedback: z.string(),
  /**
   * The control's lever, and it exists to be ignored. A caller may *claim* a
   * principal in the payload; the guard must not believe it. `trust-input`
   * swaps the guard for one that does, which is the defect this whole leg is
   * built to catch (BP-031).
   */
  claimedPrincipal: z.string().optional(),
});

export type AnswerInput = z.infer<typeof answerInputSchema>;

/**
 * The guard: the whole of Model B's accountability claim, in one block.
 *
 * It reads the caller from `ctx.user.identity` — the principal the runtime
 * stamped on this request from the transport's own resolver — derives who the
 * row is owed to, and refuses a mismatch. A row owed to nobody is refused too:
 * an unbound desk is not an open door.
 *
 * `mode: "trust-input"` is the negative control. Same block, same everything,
 * except the caller comes from the payload.
 */
export function principalGuard(options: {
  ledgerId: string;
  roster: () => ReadonlyArray<DeclaredSeat>;
  mode?: "request" | "trust-input";
}) {
  return handler({
    name: "principal-guard",
    inputSchema: answerInputSchema,
    outputSchema: answerVerdictSchema,
    execute: async (input: AnswerInput, ctx): Promise<AnswerVerdict> => {
      const caller =
        options.mode === "trust-input"
          ? // THE CONTROL. A caller-supplied claim, believed.
            (input.claimedPrincipal ?? "")
          : // THE CLAIM. Server-derived identity, off the request envelope.
            (ctx.user.identity.userId ?? ctx.user.identity.id ?? "");

      const tasks = await boardTasks(ctx, options.ledgerId);
      const row = tasks.get(input.taskId);
      const audience = reviewAudienceOf(
        { assignee: row?.assignee, status: row?.status ?? "" },
        options.roster()
      );
      const owedTo = audience?.principal ?? "";

      if (owedTo === "") {
        return {
          allowed: false,
          taskId: input.taskId,
          caller,
          owedTo,
          refusedBecause: "this row is owed to no principal — there is nobody this answer could be",
        };
      }
      if (caller !== owedTo) {
        return {
          allowed: false,
          taskId: input.taskId,
          caller,
          owedTo,
          refusedBecause: `this row is owed to ${owedTo}, and the request is ${caller || "(nobody)"}`,
        };
      }
      return { allowed: true, taskId: input.taskId, feedback: input.feedback, caller, owedTo };
    },
  });
}

/**
 * The principal-bound flow action, assembled.
 *
 * Guard first, then — and only on the allowed branch — the board's own
 * `unparkAndDrain`, reached through a connector so the refusal never touches
 * it. The sequencer returns the verdict either way, so a refusal is a **value**
 * a caller can read rather than a throw.
 *
 * This is the composition Model B rests on, and nothing in it is new
 * machinery: `unparkAndDrain` is the shipped return trip, and the request
 * principal is the shipped auth contract. What did not exist before is
 * anything joining them.
 */
export function principalBoundAnswer(options: {
  name: string;
  ledgerId: string;
  roster: () => ReadonlyArray<DeclaredSeat>;
  unparkAndDrain: Parameters<ReturnType<typeof sequencer>["step"]>[0];
  mode?: "request" | "trust-input";
}) {
  return sequencer({
    name: options.name,
    inputSchema: answerInputSchema,
  })
    .step(
      principalGuard({
        ledgerId: options.ledgerId,
        roster: options.roster,
        ...(options.mode !== undefined ? { mode: options.mode } : {}),
      })
    )
    .tapIf(
      (verdict: AnswerVerdict) => verdict.allowed,
      (verdict: AnswerVerdict) => ({ taskId: verdict.taskId, feedback: verdict.feedback }),
      options.unparkAndDrain as never
    );
}
