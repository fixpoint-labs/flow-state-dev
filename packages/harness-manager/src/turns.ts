/**
 * `turns/**` — a person's message to a coding run, kept for the attempt that
 * will act on it (FIX-1690).
 *
 * The door (`./door`) writes one row per message, **before** it stops anything:
 * a crash between the keep and the stop leaves a kept turn and a running
 * attempt, never a stopped attempt with nothing to continue with. The next
 * attempt's prompt takes every turn kept for it, oldest first.
 *
 * ## Why a collection, and not the session's own history
 *
 * The next attempt may run in another session than the one the line landed
 * in, retention evicts old requests, and a refused door leaves a user item in
 * the session too — so history cannot tell a kept turn from a refused one.
 * The inbox keeps answers the same way.
 *
 * ## The key: `<issue>/<phase>/<forAttempt>/<id>`
 *
 * `forAttempt` is the attempt the turn was kept for: the row's `attempts` plus
 * one when it was kept. `id` names the door request that kept it, hashed so the
 * key grammar holds, which makes the keep **create-only**: a replay of the
 * door's step writes nothing new.
 *
 * ## Taken once, read the same on a replay
 *
 * An attempt takes every turn kept for it or for an earlier attempt that was
 * never delivered, and marks each `deliveredTo` its own number with a
 * conditional write (`null` → attempt). A replay of the same attempt's prompt
 * step reads the same set, because a turn already delivered to *this* attempt
 * still counts as its own. A later attempt does not see it again. Nothing is
 * ever deleted.
 *
 * ## Withdrawn when the door refuses
 *
 * A door that refuses after keeping its turn withdraws it, with the same kind
 * of conditional write: a turn no attempt took yet is marked `withdrawn` and
 * no attempt takes it; a turn an attempt already took stays delivered, and the
 * door answers as delivered instead of refusing. Exactly one of the two wins,
 * so a person is never told a line didn't arrive that an attempt acted on.
 *
 * `scope: "user"`, `flowIsolation: false`, like the inbox: the door runs as
 * the run's own person (it refuses anyone else), and the attempt runs as them
 * too, so both resolve the same rows.
 */
import { defineResourceCollection } from "@flow-state-dev/core";
import { updateStateWith } from "@flow-state-dev/core/helpers";
import type { BlockContext } from "@flow-state-dev/core/types";
import { z } from "zod";
import { hashKeySegment, issuePhasePrefix } from "./workspace";

/** Accessor key and storage prefix for kept turns. */
export const TURNS = "turns" as const;

/**
 * One person's turn. Every field defaults (BP-023/BP-030): the registry's
 * persist path blanks a row whose merged state fails to parse.
 */
export const turnStateSchema = z.object({
  /** The person's words, exactly as the door took them. */
  message: z.string().default(""),
  /** When the door kept it, in epoch ms. The fold's ordering key. */
  keptAt: z.number().nullable().default(null),
  /** The attempt it was kept for. */
  forAttempt: z.number().nullable().default(null),
  /** The attempt that took it into its prompt. Null until one has. */
  deliveredTo: z.number().nullable().default(null),
  /** The door that kept it refused, so no attempt takes it. */
  withdrawn: z.boolean().default(false),
});

export type TurnState = z.infer<typeof turnStateSchema>;

/** The collection. Written only by the door and the attempt's prompt step. */
export const turnCollection = defineResourceCollection({
  pattern: `${TURNS}/**`,
  scope: "user",
  flowIsolation: false,
  prefetchMode: "lazy",
  stateSchema: turnStateSchema,
  llmWritable: false,
});

/**
 * Keep a person's turn for `forAttempt` — create-only, so a replay of the
 * door's step is a read. Returns the turn's key, for {@link withdrawTurn}.
 */
export async function keepTurn(
  ctx: BlockContext,
  entry: { issue: string; phase: string; forAttempt: number; requestId: string; message: string },
): Promise<string> {
  // Named by the door request that kept it, hashed into the key grammar.
  const key = `${issuePhasePrefix(entry.issue, entry.phase)}${entry.forAttempt}/${hashKeySegment(entry.requestId)}`;
  await turnsRef(ctx).upsert(
    key,
    {},
    { message: entry.message, keptAt: Date.now(), forAttempt: entry.forAttempt, deliveredTo: null, withdrawn: false },
  );
  return key;
}

/**
 * Withdraw a kept turn because its door is refusing. Conditional inside the
 * write, against {@link takeTurns}: `"withdrawn"` when no attempt took it,
 * `"delivered"` when one already did (the door then must not refuse).
 */
export async function withdrawTurn(ctx: BlockContext, key: string): Promise<"withdrawn" | "delivered"> {
  const ref = await turnsRef(ctx).getOptional(key);
  if (ref === undefined) return "withdrawn";
  const outcome = await updateStateWith<Record<string, unknown>, "withdrawn" | "delivered">(ref, (current) => {
    const parsed = turnStateSchema.safeParse(current ?? {});
    if (parsed.success && parsed.data.deliveredTo !== null) return { state: current, result: "delivered" };
    return { state: { ...current, withdrawn: true }, result: "withdrawn" };
  });
  // No outcome means the write never ran: the door refuses, as it would have.
  return outcome ?? "withdrawn";
}

/**
 * Take the turns attempt `attempt` acts on, oldest first: every turn kept for
 * it or an earlier attempt that no attempt took yet, plus those this attempt
 * already took (a replay). Marks each taken one `deliveredTo: attempt`.
 */
export async function takeTurns(
  ctx: BlockContext,
  issue: string,
  phase: string,
  attempt: number,
): Promise<string[]> {
  const rows = (await turnsRef(ctx).list(issuePhasePrefix(issue, phase)))
    .map((ref) => ({ ref, state: turnStateSchema.parse(ref.state ?? {}) }))
    .filter(
      ({ state }) =>
        state.forAttempt !== null &&
        state.forAttempt <= attempt &&
        !state.withdrawn &&
        (state.deliveredTo === null || state.deliveredTo === attempt),
    )
    .sort(
      (a, b) =>
        (a.state.keptAt ?? 0) - (b.state.keptAt ?? 0) ||
        (a.ref.path < b.ref.path ? -1 : a.ref.path > b.ref.path ? 1 : 0),
    );

  const taken: string[] = [];
  for (const { ref, state } of rows) {
    // Conditional, inside the write: a turn another attempt took, or its door
    // withdrew, between the list and here is not this attempt's.
    const mine = await updateStateWith<Record<string, unknown>, boolean>(ref, (current) => {
      const parsed = turnStateSchema.safeParse(current ?? {});
      const deliveredTo = parsed.success ? parsed.data.deliveredTo : null;
      if (deliveredTo === attempt) return { state: current, result: true };
      if (deliveredTo !== null || (parsed.success && parsed.data.withdrawn)) {
        return { state: current, result: false };
      }
      return { state: { ...current, deliveredTo: attempt }, result: true };
    });
    if (mine) taken.push(state.message);
  }
  return taken;
}

/**
 * The prompt section that hands kept turns to an attempt. Says whose words
 * they are and that they are neither a failure nor an answer: a model told
 * "your last attempt stopped because: fix the tests" reads a person's
 * instruction as a failure.
 */
export function turnsPromptSection(turns: readonly string[]): string {
  return [
    "A person sent you this while you were working. It is their message to you, in their words:",
    ...turns.map((turn) => `  ${turn.split("\n").join("\n  ")}`),
  ].join("\n");
}

interface TurnRef {
  path: string;
  state: unknown;
  updateState(
    updater: (current: Record<string, unknown>) => Record<string, unknown>,
  ): Promise<void>;
}

interface TurnsRef {
  upsert(
    key: string,
    update: Record<string, unknown>,
    createOnly?: Record<string, unknown>,
  ): Promise<unknown>;
  list(prefix?: string): Promise<TurnRef[]>;
  getOptional(key: string): Promise<TurnRef | undefined>;
}

/** Resolve the collection, failing loudly rather than keeping a turn nowhere. */
function turnsRef(ctx: BlockContext): TurnsRef {
  const ref = (ctx.resources as Record<string, unknown> | undefined)?.[TURNS];
  if (ref === undefined || typeof (ref as TurnsRef).upsert !== "function") {
    throw new Error(
      `[harness-manager] the "${TURNS}" collection is not registered on this flow, so a ` +
        `person's message could not be kept for the run.`,
    );
  }
  return ref as TurnsRef;
}
