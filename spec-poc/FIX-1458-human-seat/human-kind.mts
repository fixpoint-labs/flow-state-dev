/**
 * The candidate portable piece: what a *human seat* is, written out.
 *
 * Throwaway POC code for spec/FIX-1458. Nothing here ships. The claim it exists
 * to make falsifiable is that a human seat needs **no new framework noun** —
 * it is an ordinary hireable worker kind whose closed config schema declares
 * one extra setting (`principal:`), and whose board worker parks the row
 * instead of running a model.
 *
 * Two exports, and the split is the point:
 *
 * - `defineHumanSeatFlow()` — the KIND. `workerConfigSchema()` composed with
 *   two of its own settings, exactly the way the shipped manager-queue lab's
 *   `builder` kind composes `answersFor:`. `hireWorkforce` is not touched.
 * - `humanDrain()` — the DRAIN. The whole behavioural difference between a
 *   person and an agent in one block: park with a reason when nobody has
 *   looked at this yet, return the person's words when they have.
 */
import { handler } from "@flow-state-dev/core";
import type { BlockContext, ResourceCollectionRef } from "@flow-state-dev/core/types";
import type { JsonObject } from "@flow-state-dev/core";
import { defineFlow } from "@flow-state-dev/core";
import {
  getOrCreateTaskCollection,
  type TaskCollectionRef,
  type TaskWorkerInput,
} from "@flow-state-dev/orchestration/tasks";
import { taskWorkerInputSchema } from "@flow-state-dev/orchestration/task-board";
import { workerConfigSchema } from "@flow-state-dev/workforce";
import { z } from "zod";

/** The kind name a `WORKER.md` puts in `flow:` to say "a person sits here". */
export const HUMAN_KIND = "human";

/**
 * The seat's settings bag: the four the hire step imposes, plus two of its own.
 *
 * `principal` is the whole human-specific surface — one string naming who the
 * seat is, inside the org the seat runs under. It is **optional**, and that is
 * a rule rather than a convenience (BR-3): an absent setting is not an
 * undeclared one, so a human seat nobody has been named to still hires, and
 * every read says so rather than inventing a person. Only a `principal:` on a
 * kind that never declared the key is refused, and it refuses the whole roster.
 *
 * `answersFor` is the desk key the board files rows against, kept a DIFFERENT
 * spelling from the seat id on purpose (ER-7): the board's assignee registry
 * and the roster resolve to each other, they are not one noun.
 */
export const humanSeatConfigSchema = () =>
  workerConfigSchema().extend({
    principal: z.string().optional(),
    answersFor: z.string(),
  });

/** A hireable kind a `WORKER.md` reaches with `flow: human`. */
export function defineHumanSeatFlow() {
  return defineFlow({
    kind: HUMAN_KIND,
    cardinality: "collection",
    configSchema: humanSeatConfigSchema(),
    actions: {},
  });
}

/** An ordinary agent-shaped kind, for the contrast arm. It declares no `principal:`. */
export function defineDeskFlow() {
  return defineFlow({
    kind: "desk",
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
 * The human seat's board worker. The entire difference from an agent seat.
 *
 * First pass — nobody has looked at this — park the row with the reason the
 * person will read. The board's result recorders deliberately do not write over
 * a row its own worker parked (FIX-1234), so the park survives the return.
 *
 * Second pass — the row came back carrying `feedback`, which is what
 * `unpark(id, answer)` writes — the person has answered, so the seat records it
 * and the row settles.
 */
export function humanDrain(options: { ledgerId: string; ask: string; name?: string }) {
  return handler({
    // One drain per desk, so the name is per-desk too: the board's worker router
    // refuses two routes spelling the same name, and a team can seat more than
    // one person.
    name: options.name ?? "human-seat-drain",
    inputSchema: taskWorkerInputSchema,
    outputSchema: z.object({ answeredBy: z.string(), answer: z.string() }),
    execute: async (input: TaskWorkerInput, ctx) => {
      if (input.feedback === undefined) {
        const tasks = await boardTasks(ctx, options.ledgerId);
        await tasks.awaitReview(input.taskId, options.ask);
        return { answeredBy: "", answer: "" };
      }
      return { answeredBy: "person", answer: input.feedback };
    },
  });
}

/**
 * The audience, derived rather than stored.
 *
 * A row is *waiting on you* when it is parked or blocked — the grouping the
 * shipped manager-queue lab already uses (`goals/manager-queue-lab/lab/queue.mts`).
 * What that view cannot say today is WHO. This resolves it the long way, which
 * is the point: the row names a desk, the roster names which seat answers for
 * that desk, and that seat's own file names the person. Three facts, no new
 * field, and nothing here is written down anywhere.
 *
 * Three endings, and the middle one is BR-3. A row whose desk resolves to a
 * human seat names that seat, and names a person only when the seat's file
 * does — a seat nobody is named to reads as *waiting on the desk, on no
 * person*, which is a different answer from *this row resolves to nobody at
 * all* and must not collapse into it.
 */
export function audienceOf(
  row: { assignee?: string; status: string; feedback?: string },
  roster: ReadonlyArray<{ id: string; kind: string; answersFor?: string; principal?: string }>
): { seatId: string; principal: string | undefined } | undefined {
  if (row.status !== "parked" && row.status !== "blocked") return undefined;
  if (row.assignee === undefined) return undefined;
  const seat = roster.find((s) => s.answersFor === row.assignee);
  if (seat === undefined || seat.kind !== HUMAN_KIND) return undefined;
  return { seatId: seat.id, principal: seat.principal };
}
