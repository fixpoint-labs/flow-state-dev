/**
 * `inbox/**` — a question a run asked, as a durable row rather than a paused
 * request.
 *
 * A background coding run that hits a real ambiguity cannot ask anybody. This
 * collection is where it asks: the manager writes the question here, parks its
 * board row, and returns. Nothing is held open while a person thinks, and an
 * answer arriving tomorrow morning still has somewhere to land.
 *
 * ## The key: `<issue>/<phase>/<attempt>/<fingerprint>`, and its reader is a person
 *
 * **No epic segment, and that is a lock rather than a deferral.** The board is
 * partitioned by epic because a board is a *claim pool*, where sharing storage
 * lets one epic claim or settle another's row. An inbox row is never claimed.
 * What exempts it is who reads it: an unfiltered `inbox/` listing spanning
 * epics is *a person's inbox*, which is the product rather than a boundary
 * crossed. The rule this applies is `run-record.ts`'s, from the other side —
 * *a key two boards write whose reader is a **job** needs the board's
 * discriminator; a key whose reader is a **person** does not.*
 *
 * **What is NOT the reason: "issue ids are globally unique."** They are not
 * sufficient. The key is attempt-keyed and the attempt comes from *a board's*
 * counter, so two epics driving one issue-phase keep independent counters and
 * both can produce attempt 1. The discriminator still buys nothing a person's
 * inbox wants — that is what earns the lock — but the collision argument does
 * not, and deriving the lock from it would be reasoning from a false premise.
 *
 * **Issue-first** so `list("<issue>/<phase>/")` is one contiguous range.
 * **Hash-keyed rather than counted**, because a counter needs committed state
 * and the ask step has none: a replay would number one question twice.
 * **The attempt segment keeps the hash safe** — without it a later attempt
 * asking the identical question lands on the already-answered row, and the
 * manager folds a stale answer into the prompt instead of asking.
 *
 * ## One create-only write, and two conditional transitions
 *
 * The step that posts a question commits no output, so it re-executes on
 * recovery. **Nothing but {@link askQuestion} ever writes an `open` row**, and
 * it writes create-only: `upsert(topic, {}, {...})` has nothing to apply on
 * the patch branch, so a second execution is a read.
 *
 * The two other writers move a row OFF `open` and neither can reopen one.
 * Both are **conditional transitions, not patches** — the invariant is
 * enforced rather than asserted. A literal patch would let a withdrawal that
 * raced an accepted answer overwrite `answered` with `withdrawn`, destroying
 * an answer the operator watched land. That is reachable rather than
 * theoretical: `status` and the `answer` guard both withdraw an `open` row
 * whose task is terminal, and either can be in flight while an answer commits.
 *
 * ## Two accessors, two costs — named rather than designed around
 *
 * Checked in `packages/engine/src/context/resource-registry.ts`:
 *
 * - **The ask is a genuine point lookup.** `getOptional` / `upsert` go through
 *   `ensureInstance` → `getInstance(resolvedKey)`, so `prefetchMode: "lazy"`
 *   means the create-only write loads one row rather than every question the
 *   user has ever been asked.
 * - **A prefixed `list` is NOT filtered at the source.** `list(prefix)` calls
 *   `ensurePrefix()` → `getByPrefix(collectionKeyPrefix)`, and that prefix is
 *   the *pattern's* (`inbox/`), not the caller's; the caller's is applied in
 *   memory afterwards. So the prompt fold and `status` load the user's whole
 *   inbox across every epic and then discard what does not match.
 *
 * BP-033's *filter at the source* is not available on this registry's list
 * path, so the honest statement is that these reads are bounded by the user's
 * retained inbox rather than by the issue-phase. The key does not move to
 * chase it, and nothing prunes answered rows — retention is a hot-path cost
 * here, not only a storage one.
 *
 * ## A named limit: two tenants sharing a user id share this inbox
 *
 * The framework tenant-qualifies **session** storage but keys **user** scope on
 * the bare id. This collection is `scope: "user"` with `flowIsolation: false`,
 * so wherever one user id is reachable by two tenants, one tenant's operator
 * can list and answer the other's questions. **The key does not move for it** —
 * the reader is a person and the unfiltered listing is the product, the same
 * reasoning that keeps the epic segment out. The board's identical exposure is
 * closed on the board, where a discriminator already exists to carry it.
 *
 * ## Key vocabulary — LAB-138's rule, inherited
 *
 * A string handed *to* the collection carries no `inbox/` prefix; one that came
 * *out* of it does, and the accessor is `ref.path`. See `run-record.ts`.
 */
import { createHash } from "node:crypto";
import { defineResourceCollection } from "@flow-state-dev/core";
import { updateStateWith } from "@flow-state-dev/core/helpers";
import type { BlockContext } from "@flow-state-dev/core/types";
import { z } from "zod";
import { assertSafeSegment } from "./workspace";

/** Accessor key and storage prefix for the inbox. */
export const INBOX = "inbox" as const;

/**
 * Where a question is in its life. **Forward-only**, and enforced by the two
 * conditional transitions below rather than asserted here.
 *
 * There is deliberately no `consumed` status. The prompt fold is idempotent by
 * construction, and a consumed flag would reintroduce exactly the
 * write-a-row-a-replay-can-reset problem the create-only ask exists to close.
 */
export const questionStatusSchema = z.enum(["open", "answered", "withdrawn"]);
export type QuestionStatus = z.infer<typeof questionStatusSchema>;

/**
 * One question, and the answer when it arrives.
 *
 * Every field carries a default (BP-023/BP-030). Not decoration: the registry's
 * persist path `safeParse`s the merged state and falls back to `{}` on failure,
 * so a schema with a required field would blank a row rather than refuse the
 * write — silently, and only for rows written under an older shape.
 */
export const questionStateSchema = z.object({
  /** The run's own words. The only part of a row that comes from outside. */
  question: z.string().default(""),
  /** The board task that asked. Server-derived, never caller-supplied (BP-031). */
  askedBy: z.string().nullable().default(null),
  /** When, in epoch ms. The fold's ordering key. */
  askedAt: z.number().nullable().default(null),
  status: questionStatusSchema.default("open"),
  /** The operator's words. Null until answered (BP-023). */
  answer: z.string().nullable().default(null),
  answeredAt: z.number().nullable().default(null),
});

export type QuestionState = z.infer<typeof questionStateSchema>;

/**
 * The collection.
 *
 * `llmWritable: false` — conductor's own blocks are the only writers. The
 * question's *words* come from the run; its *identity* does not (BP-031).
 * `llmReadable` is left off for the same reason: no phase's readable set needs
 * it, and the read surface is the flow's zero-model `status` action.
 */
export const inboxCollection = defineResourceCollection({
  pattern: `${INBOX}/**`,
  // Same principal as the board and the run record, so a question written
  // inside the child session is read by the coordinator session that
  // answers it — with no `sharedToLineage` anywhere.
  scope: "user",
  // BP-027: a user-scoped collection defaults to shared across flows.
  flowIsolation: false,
  // Load-bearing on the ask path and only there — see the accessor split above.
  prefetchMode: "lazy",
  stateSchema: questionStateSchema,
  llmWritable: false,
});

/**
 * How much of the question's hash names its row.
 *
 * 16 hex characters — 64 bits. A counter is unavailable (the ask step commits
 * no state), so the hash is the identity, and the width is what keeps two
 * different questions from one attempt off one row.
 */
const FINGERPRINT_LENGTH = 16;

/** Name a question by its words, so asking it twice in one attempt is one row. */
export function questionFingerprint(question: string): string {
  return createHash("sha256")
    .update(question.trim(), "utf8")
    .digest("hex")
    .slice(0, FINGERPRINT_LENGTH);
}

/** The bare topic for one question. Never carries the `inbox/` prefix. */
export function questionTopic(
  issue: string,
  phase: string,
  attempt: number,
  fingerprint: string,
): string {
  return [
    assertSafeSegment("issue", issue),
    assertSafeSegment("phase", phase),
    assertAttempt(attempt),
    fingerprint,
  ].join("/");
}

/** The bare prefix covering every question ever asked about one issue-phase. */
export function questionTopicPrefix(issue: string, phase: string): string {
  return `${assertSafeSegment("issue", issue)}/${assertSafeSegment("phase", phase)}/`;
}

/** The coordinates a question key carries. */
export interface QuestionCoordinates {
  issue: string;
  phase: string;
  attempt: number;
  fingerprint: string;
}

/**
 * Read a question key back into its coordinates, or `undefined` if it is not
 * one.
 *
 * **The one place caller-supplied text becomes a key**, so it is the one place
 * the grammar is checked: the operator names the row they are answering, and
 * every segment goes back through the same validation that built it. A name
 * that does not parse can never reach a task id or a storage key (BP-031).
 */
export function parseQuestionTopic(topic: string): QuestionCoordinates | undefined {
  const segments = topic.split("/");
  if (segments.length !== 4) return undefined;
  const [issue, phase, attempt, fingerprint] = segments as [string, string, string, string];
  if (!/^\d+$/.test(attempt)) return undefined;
  if (!/^[0-9a-f]+$/.test(fingerprint)) return undefined;
  try {
    assertSafeSegment("issue", issue);
    assertSafeSegment("phase", phase);
  } catch {
    return undefined;
  }
  return { issue, phase, attempt: Number(attempt), fingerprint };
}

/** One question as this module hands it back: the bare topic plus its state. */
export interface QuestionRow extends QuestionCoordinates {
  /** The bare topic — the name {@link answerQuestion} and the operator use. */
  topic: string;
  state: QuestionState;
}

/**
 * Post this attempt's question — **create-only, and the single ask path.**
 *
 * `upsert(topic, {}, initial)`: on the create branch the row is written from
 * `initial`; on the patch branch there is nothing to apply, so a replay of the
 * step that created it is a read. Verified against an already-`answered` row —
 * a replay cannot erase an answer.
 */
export async function askQuestion(
  ctx: BlockContext,
  topic: string,
  entry: { question: string; askedBy: string; askedAt: number },
): Promise<void> {
  await inboxRef(ctx).upsert(
    topic,
    {},
    {
      question: entry.question,
      askedBy: entry.askedBy,
      askedAt: entry.askedAt,
      status: "open",
      answer: null,
      answeredAt: null,
    },
  );
}

/** What a conditional transition did, and what it saw. */
export interface QuestionWrite {
  outcome: "applied" | "refused";
  /** The status the write landed against — `null` when no row exists. */
  observed: QuestionStatus | null;
}

/**
 * Accept an answer: **conditional `open` → `answered`, atomically.**
 *
 * `updateState` re-runs the updater against refreshed state on every
 * compare-and-swap retry, so the status is read and the transition decided
 * inside the same write. A read-then-`patchState` guard would pass every
 * behaviour in this lab's suite except the one that races two answers, and
 * would silently lose the first under real concurrency.
 */
export function answerQuestion(
  ctx: BlockContext,
  topic: string,
  answer: string,
): Promise<QuestionWrite> {
  return transitionFromOpen(ctx, topic, "answered", {
    answer,
    answeredAt: Date.now(),
  });
}

/**
 * Withdraw a question: **conditional `open` → `withdrawn`.**
 *
 * A withdrawn row is never deleted — it is the question history a later
 * attempt and a late answer both read, and a late answer against it is
 * reported back rather than applied.
 */
export function withdrawQuestion(ctx: BlockContext, topic: string): Promise<QuestionWrite> {
  return transitionFromOpen(ctx, topic, "withdrawn", {});
}

/**
 * Every question ever asked about this issue-phase, **oldest first**.
 *
 * Ordered on `askedAt`, then the attempt, then the fingerprint — three keys
 * because the first two can tie (two questions in one millisecond, two
 * attempts stamped identically by a coarse clock) and a fold whose order
 * depends on storage enumeration is a prompt that changes between replays.
 */
export async function listQuestions(
  ctx: BlockContext,
  issue: string,
  phase: string,
): Promise<QuestionRow[]> {
  const refs = await inboxRef(ctx).list(questionTopicPrefix(issue, phase));
  const rows: QuestionRow[] = [];
  for (const ref of refs) {
    const topic = topicFromPath(ref.path);
    const coordinates = parseQuestionTopic(topic);
    if (coordinates === undefined) continue;
    rows.push({
      ...coordinates,
      topic,
      state: questionStateSchema.parse(ref.state ?? {}),
    });
  }
  return rows.sort(
    (a, b) =>
      (a.state.askedAt ?? 0) - (b.state.askedAt ?? 0) ||
      a.attempt - b.attempt ||
      (a.fingerprint < b.fingerprint ? -1 : a.fingerprint > b.fingerprint ? 1 : 0),
  );
}

/** Read one question, or `undefined` when nothing has asked it. */
export async function readQuestion(
  ctx: BlockContext,
  topic: string,
): Promise<QuestionState | undefined> {
  const ref = await inboxRef(ctx).getOptional(topic);
  return ref === undefined ? undefined : questionStateSchema.parse(ref.state ?? {});
}

/**
 * Withdraw every `open` row an EARLIER attempt left behind.
 *
 * The create-only write commits before the outcome is selected, so a process
 * that dies between the create and the arms leaves attempt 1's row `open` with
 * no arm having decided it. Left alone, that orphan satisfies the answer's
 * proceed guard once attempt 2 parks — so answering it re-queues the run while
 * attempt 2's real question is still open.
 *
 * Reconciling at the start of each attempt means **at most one `open` row can
 * exist for an issue-phase**, which is what the proceed guard and recovery's
 * nothing-open condition were both already assuming. Strictly earlier, so a
 * replay of *this* attempt's own opening step never withdraws the question it
 * is about to ask.
 */
export async function withdrawEarlierQuestions(
  ctx: BlockContext,
  issue: string,
  phase: string,
  attempt: number,
): Promise<string[]> {
  const withdrawn: string[] = [];
  for (const row of await listQuestions(ctx, issue, phase)) {
    if (row.attempt >= attempt) continue;
    if (row.state.status !== "open") continue;
    const write = await withdrawQuestion(ctx, row.topic);
    if (write.outcome === "applied") withdrawn.push(row.topic);
  }
  return withdrawn;
}

/**
 * The one conditional transition, shared by both writers off `open`.
 *
 * The updater is handed the state the write is landing against — refreshed on
 * every CAS retry — so the status it reports is the basis that actually
 * committed, not the one this caller happened to read first. Returning `state`
 * unchanged is the driver's no-op, so a refusal writes nothing and fires no
 * change event.
 *
 * `updateStateWith` rather than assigning to a binding outside the callback:
 * the callback can run more than once, and carrying the observation out through
 * its own return is what makes "the basis that committed" a property of the
 * helper rather than of which invocation happened to be last.
 */
async function transitionFromOpen(
  ctx: BlockContext,
  topic: string,
  next: Exclude<QuestionStatus, "open">,
  fields: Record<string, unknown>,
): Promise<QuestionWrite> {
  const ref = await inboxRef(ctx).getOptional(topic);
  if (ref === undefined) return { outcome: "refused", observed: null };

  const observed = await updateStateWith<Record<string, unknown>, QuestionStatus | null>(
    ref,
    (current) => {
      const parsed = questionStateSchema.safeParse(current ?? {});
      const status = parsed.success ? parsed.data.status : null;
      if (status !== "open") return { state: current, result: status };
      return { state: { ...current, ...fields, status: next }, result: status };
    },
  );

  return {
    outcome: observed === "open" ? "applied" : "refused",
    observed: observed ?? null,
  };
}

/** Strip the injected `inbox/` prefix a stored path carries. */
function topicFromPath(path: string): string {
  const lead = `${INBOX}/`;
  return path.startsWith(lead) ? path.slice(lead.length) : path;
}

/** The attempt segment. Server-derived, so a malformed one is a conductor bug. */
function assertAttempt(attempt: number): string {
  if (!Number.isInteger(attempt) || attempt < 0) {
    throw new Error(
      `[conductor] attempt "${attempt}" is not a usable inbox key segment — the attempt ` +
        `comes from the board's own counter, so a non-integer here means the key was ` +
        `built from something other than the worker input.`,
    );
  }
  return String(attempt);
}

/** One instance of the inbox, with the conditional write the transitions need. */
interface QuestionRef {
  path: string;
  state: unknown;
  updateState(
    updater: (current: Record<string, unknown>) => Record<string, unknown>,
  ): Promise<void>;
}

/** The slice of the collection this module uses. Structural, like `run-record`. */
interface InboxRef {
  getOptional(key: string): Promise<QuestionRef | undefined>;
  upsert(
    key: string,
    update: Record<string, unknown>,
    createOnly?: Record<string, unknown>,
  ): Promise<unknown>;
  list(prefix?: string): Promise<QuestionRef[]>;
}

/** Resolve the inbox, failing loudly rather than asking into the void. */
function inboxRef(ctx: BlockContext): InboxRef {
  const ref = (ctx.resources as Record<string, unknown> | undefined)?.[INBOX];
  if (ref === undefined || typeof (ref as InboxRef).upsert !== "function") {
    throw new Error(
      `[conductor] the "${INBOX}" collection is not registered on this flow — a question ` +
        `cannot be posted or answered, and a silent miss here is a run parked on a ` +
        `question nobody can ever see.`,
    );
  }
  return ref as InboxRef;
}
