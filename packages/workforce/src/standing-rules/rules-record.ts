/**
 * Where a worker keeps its standing rules for one user (FIX-1945 S1): the
 * `standing-rules` record, one per worker in each user's own scope.
 *
 * Keyed like the worker's skills drawer, and beside it rather than in it: user
 * scope, isolated per worker flow copy, and one record per worker the turn was
 * verified to run as. The skills collection lets a browser create, update and
 * delete entries, which would skip the validator; this record allows browser
 * reads only, so the rule tools and the rules action are its only writers.
 *
 * Reads and writes go through {@link readStandingRules} and
 * {@link writeStandingRules}, which name the record from the session's verified
 * worker, never from input (BP-031).
 */
import { defineResourceCollection } from "@flow-state-dev/core";
import { updateStateWith } from "@flow-state-dev/core/helpers";
import { encodeUserSegment } from "@flow-state-dev/core/types";
import type { BlockContext, ResourceCollectionRef } from "@flow-state-dev/core/types";
import { verifiedWorkerOf } from "../workers/verified-worker";
import {
  EMPTY_RULES,
  applyRuleEdit,
  standingRulesStateSchema,
  type RuleEdit,
  type RuleEditOutcome,
  type StandingRules
} from "./rules-list";

/** The accessor a flow declares the record under. **Pinned**: BR-12 rests on it. */
export const STANDING_RULES_RESOURCE = "standing-rules";

/**
 * The record's key on a copy minted for one worker, where the flow copy is
 * already that worker's and the session names none.
 */
const OWN_COPY_KEY = "worker";

/** The record: browser reads of its state, and no browser writes. */
export const standingRulesCollection = defineResourceCollection({
  pattern: `${STANDING_RULES_RESOURCE}/*`,
  scope: "user",
  // One bucket per worker flow copy, as the skills drawer: a worker moved to
  // another flow finds none there.
  flowIsolation: true,
  // Read when the turn reads it, not when the request starts: a store that
  // can't serve it then fails the read, which the turn survives, rather than
  // the whole request.
  prefetchMode: "lazy",
  stateSchema: standingRulesStateSchema,
  client: {
    state: { read: true },
    content: { read: false, create: false, update: false, delete: false },
    expose: ["version", "rules"]
  }
});

/** The running request's record, or `undefined` on a flow that doesn't declare it. */
function collectionOf(ctx: BlockContext): ResourceCollectionRef | undefined {
  const ref = (ctx.resources as Record<string, unknown> | undefined)?.[STANDING_RULES_RESOURCE];
  return typeof ref === "object" && ref !== null && "getOrCreate" in ref ? (ref as ResourceCollectionRef) : undefined;
}

/** The record's key for this request: its verified worker, or the copy's own on a copy minted for one worker. */
function keyOf(ctx: BlockContext): string {
  const worker = verifiedWorkerOf(ctx.session as object);
  return worker === undefined ? OWN_COPY_KEY : encodeUserSegment(worker);
}

/** A stored list read through its schema, so a malformed record reads as an error, not as rules. */
function parsed(state: unknown): StandingRules {
  const result = standingRulesStateSchema.safeParse(state ?? {});
  if (!result.success) throw new Error(`The standing rules record is malformed: ${result.error.message}`);
  return result.data;
}

/**
 * This request's worker's rules for the request's user, read now. Throws
 * when the record can't be read; a turn catches that and runs without rules.
 */
export async function readStandingRules(ctx: BlockContext): Promise<StandingRules> {
  const collection = collectionOf(ctx);
  if (collection === undefined) throw new Error(`This flow doesn't declare "${STANDING_RULES_RESOURCE}".`);
  const ref = await collection.getOptional(keyOf(ctx));
  return ref === undefined ? EMPTY_RULES : parsed(ref.state);
}

/**
 * Apply one edit through the one validator, as the list read at `version`,
 * and store it. A refusal stores nothing. A write that loses a race against
 * another writer re-checks against the winner's list, so it is refused as
 * stale rather than landing on a list it never read.
 *
 * @throws When the record can't be written; nothing claims it was.
 */
export async function writeStandingRules(
  ctx: BlockContext,
  version: number,
  edit: RuleEdit,
  sessionId: string | null
): Promise<RuleEditOutcome> {
  const collection = collectionOf(ctx);
  if (collection === undefined) throw new Error(`This flow doesn't declare "${STANDING_RULES_RESOURCE}".`);
  const ref = await collection.getOrCreate(keyOf(ctx), EMPTY_RULES);
  const now = Date.now();
  const outcome = await updateStateWith(ref as never, (current: unknown) => {
    const result = applyRuleEdit(parsed(current), version, edit, { sessionId, now });
    return { state: result.ok ? result.list : current, result };
  });
  if (outcome === undefined) throw new Error("The standing rules write never ran.");
  return outcome;
}
