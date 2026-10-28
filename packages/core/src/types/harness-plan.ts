/**
 * The run's plan record: one shape every coding harness writes its own to-do
 * list into, and one writer for harnesses whose plan arrives as a whole list.
 *
 * A coding agent often keeps a to-do list while it works. A harness that
 * reports one records it here, in a session-scoped resource collection
 * separate from the run's items, so a reader can show what a run planned
 * without caring which harness ran it. It is a record of what the agent
 * planned, never a work queue: nothing in it starts work.
 *
 * This file owns:
 *
 * - {@link OBSERVED_PLAN} / {@link observedPlanCollection} /
 *   {@link observedPlanItemStateSchema} — the plan rows. The key and fields
 *   are the ones `@flow-state-dev/claude-code` shipped before the shape moved
 *   here, so rows already stored still read (BP-030). Fields stay nullable; a
 *   new one is added, never changed.
 * - {@link OBSERVED_PLAN_LIST} / {@link observedPlanListCollection} — one
 *   marker per run namespace saying whether the run's plan is `writing`,
 *   `complete` or `incomplete`, how many places it holds, and why it is
 *   incomplete. It is what lets a reader tell an empty plan from no plan, and a
 *   half-written plan from the plan.
 * - {@link replacePlanList} — writes a whole-list plan as rows keyed by place,
 *   and maintains the marker around the write.
 * - {@link harnessRunNamespace} — the per-invocation namespace a run's own
 *   records go under, and where it leaves a pointer to its conversation.
 * - {@link harnessConversationNamespace} / {@link planConversationPrefix} — the
 *   namespace one harness conversation's plan lives under, which every turn of
 *   that conversation writes, so a plan lasts as long as the conversation.
 * - {@link readPlanTarget} — where a reader finds a run's plan: its
 *   conversation's, or, for a run recorded before plans were kept per
 *   conversation, the run's own rows.
 *
 * It sits beside `./harness` (the run contract) rather than inside it: the
 * handle is what a run reports back, this is what a run records while it
 * works, and a harness may do either without the other.
 */
import { z } from "zod";
import type { BlockContext } from "./block";
import { defineResourceCollection } from "./resource-collection";

/** Accessor key AND storage prefix for the run's plan rows. */
export const OBSERVED_PLAN = "observed-plan" as const;

/** Accessor key AND storage prefix for the per-run plan list markers. */
export const OBSERVED_PLAN_LIST = "observed-plan-list" as const;

/**
 * How a recorded mutation settled.
 *
 * Three-valued, not a boolean: a mutation is recorded when its call is seen
 * and settled when its result arrives, so `pending` is a real state; and an
 * update the harness rejects is recorded as `failed` with the statuses left
 * where the harness has them.
 */
export type ObservedOutcome = "pending" | "applied" | "failed";

/** Runtime validator for {@link ObservedOutcome}. */
export const observedOutcomeSchema = z.enum(["pending", "applied", "failed"]);

/**
 * One plan row, keyed `<run namespace>/<item>`: the harness's own item id, or
 * the item's place in the list when the harness reports none (see
 * {@link replacePlanList}).
 *
 * `status` and `previousStatus` are free strings, not an enum: the vocabulary
 * belongs to the harness, and a value we have never seen records as itself
 * rather than throwing. `status` stays null until the harness reports one.
 * Every field is nullable with a null default (BP-023) so a row written by an
 * older or newer shape still parses.
 */
export const observedPlanItemStateSchema = z.object({
  /** The item's wording, as the run phrased it. */
  title: z.string().nullable().default(null),
  /** The status the harness last confirmed. */
  status: z.string().nullable().default(null),
  /** The status this row held before the last confirmed move. */
  previousStatus: z.string().nullable().default(null),
  /** How the last attempt on this item settled. */
  lastOutcome: observedOutcomeSchema.nullable().default(null),
  /** Epoch millis of the last attempt. */
  lastTouchedAt: z.number().nullable().default(null),
  /** The request that last wrote this row, so a reader can say which turn changed it. */
  requestId: z.string().nullable().default(null),
});

/**
 * The run's plan rows.
 *
 * `**`, not `*`: a key carries a multi-segment run namespace and then the item.
 * `prefetchMode: "lazy"` because rows are namespaced per run and a session is
 * reused across runs, so an eager collection would load every earlier run's
 * rows before this one wrote a key. A writer only upserts and deletes by exact
 * key; `list()`/`count()` would load the whole prefix, so writers never call
 * them. `live` streams each change to an open page as it happens, rather than
 * at the end of the request.
 */
export const observedPlanCollection = defineResourceCollection({
  pattern: `${OBSERVED_PLAN}/**`,
  scope: "session",
  prefetchMode: "lazy",
  stateSchema: observedPlanItemStateSchema,
  client: {
    state: { read: true },
    expose: ["title", "status", "previousStatus", "lastOutcome", "lastTouchedAt", "requestId"],
    live: true,
  },
});

/**
 * Where a run's plan write stands.
 *
 * - `writing` — a write has started and not finished. Read once the run has
 *   ended, it means the write never finished, the same as `incomplete`.
 * - `complete` — the rows are the plan. With `count: 0`, the agent reported an
 *   empty list.
 * - `incomplete` — a write failed partway. The rows are what landed, not the
 *   plan, and `reason` says why.
 */
export type ObservedPlanListStatus = "writing" | "complete" | "incomplete";

/**
 * One marker per namespace, keyed by the namespace itself. Every field is
 * nullable: a harness that writes rows by id (Claude Code) writes only
 * `incomplete` markers, with no count.
 *
 * A marker plays one of two parts. Under a conversation namespace it says where
 * that conversation's plan write stands (`status`, `count`, `reason`). Under a
 * run namespace it carries `conversation`, the pointer from one run to the
 * conversation it worked in, which is how a reader that knows only the run
 * finds the plan.
 */
export const observedPlanListStateSchema = z.object({
  /** Where the run's plan write stands. See {@link ObservedPlanListStatus}. */
  status: z.enum(["writing", "complete", "incomplete"]).nullable().default(null),
  /** How many places the plan holds. A reader shows only places below it. */
  count: z.number().int().nonnegative().nullable().default(null),
  /** Why the plan is incomplete. */
  reason: z.string().nullable().default(null),
  /** On a run's marker: the conversation namespace the run wrote its plan to. */
  conversation: z.string().nullable().default(null),
});

/** The per-run plan list markers. Same storage notes as {@link observedPlanCollection}. */
export const observedPlanListCollection = defineResourceCollection({
  pattern: `${OBSERVED_PLAN_LIST}/**`,
  scope: "session",
  prefetchMode: "lazy",
  stateSchema: observedPlanListStateSchema,
  client: {
    state: { read: true },
    expose: ["status", "count", "reason", "conversation"],
    live: true,
  },
});

/**
 * Escape one value into ONE key segment of the plan record: `/`, `\`, control
 * characters, and a segment of exactly `..`, the four the resource path
 * normalizer rejects or splits on, are percent-escaped, and `%` first.
 *
 * The escaping is injective, so two distinct values never share a key: a
 * request id that holds a `/` keys under `%2F` rather than splitting into two
 * segments or merging with another request's rows. Every other value is
 * unchanged byte for byte, so a plain request id is its own segment. The one
 * boundary: injectivity holds among values encoded here, not across rows
 * written before ids were escaped, when an id that was literally `a%2Fb` keyed
 * itself raw, which is what `a/b` encodes to now.
 *
 * A writer builds a run's namespace from it (`<planKeySegment(requestId)>/<run>`);
 * a reader finds a request's rows with {@link planRowsPrefix}, which uses it.
 */
export function planKeySegment(value: string): string {
  const escaped = value
    .replace(/%/g, "%25")
    .replace(/\//g, "%2F")
    .replace(/\\/g, "%5C")
    .replace(/[\x00-\x1f]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`);
  // Dots survive the escaping above, so `..` needs its own branch. Exactly
  // `..`: `.` and `...` are accepted keys and stay as they are.
  return escaped === ".." ? "%2E%2E" : escaped;
}

/**
 * The storage-key prefix every run of one request keeps its rows under, in the
 * plan record (`observed-plan`) or its list markers (`observed-plan-list`).
 * Pass it as a collection read's `topicPrefix` to select what one request
 * planned and nothing an earlier request in the same session did.
 *
 * Built with {@link planKeySegment}, the escaping writers use, so a reader
 * never hand-copies it.
 *
 * @param requestId The request whose rows to select, as the framework names it.
 * @param key Which collection: the plan rows (default) or the list markers.
 */
export function planRowsPrefix(
  requestId: string,
  key: typeof OBSERVED_PLAN | typeof OBSERVED_PLAN_LIST = OBSERVED_PLAN,
): string {
  return `${key}/${planKeySegment(requestId)}/`;
}

/** One item of a whole-list plan, as the harness reported it. */
export interface PlanListItem {
  /** The item's wording. */
  title: string | null;
  /** The harness's own status word for it. */
  status: string | null;
}

/**
 * The slice of a collection ref {@link replacePlanList} uses. Structural, and
 * deliberately without `list`/`count`, which load a lazy collection's whole
 * prefix.
 */
export interface PlanListCollection {
  getOptional(key: string): Promise<{ readonly state: Record<string, unknown> } | undefined>;
  upsert(key: string, update: Record<string, unknown>): Promise<unknown>;
  delete(key: string): Promise<void>;
}

/** The slice of the marker collection ref {@link replacePlanList} uses. */
export type PlanListMarkerCollection = Pick<PlanListCollection, "getOptional" | "upsert">;

/** How a {@link replacePlanList} call ended. */
export type ReplacePlanListResult =
  | { status: "complete" }
  | { status: "incomplete"; reason: string };

/**
 * A place's row key: zero-padded, so the resource route's lexicographic key
 * order is also list order.
 */
function placeKey(namespace: string, place: number): string {
  return `${namespace}/${String(place).padStart(6, "0")}`;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/**
 * Write a plan that arrived as the whole list into the plan record, replacing
 * the run's previous list.
 *
 * Row *n* holds the list's *n*th item (keyed `<namespace>/<n, zero-padded>`),
 * with `lastOutcome: "applied"`: the helper writes only lists the harness
 * confirmed. Where a place's wording is unchanged and its status changed, the
 * earlier status becomes `previousStatus`; a repeated status leaves it as it
 * was; a reworded place clears it. Places past the new end are deleted.
 *
 * Around the rows, the run's marker in {@link observedPlanListCollection} goes
 * `writing` (with the new count) first and `complete` last. If any write
 * throws, the marker ends `incomplete` with the error, and the function
 * returns rather than throws: a plan that cannot be stored in full never fails
 * the run.
 *
 * `options.requestId` is stamped on every row it writes, so a reader can say
 * which turn last changed the plan.
 *
 * **One writer per namespace at a time.** The previous count is read
 * from the marker and each place's previous row by its own key; the prefix is
 * never listed. A row past the end left behind by a failed write doesn't show,
 * because a reader shows only places below the marker's count.
 *
 * ```ts
 * await replacePlanList(
 *   ctx.resources[OBSERVED_PLAN],
 *   ctx.resources[OBSERVED_PLAN_LIST],
 *   runNamespace,
 *   todos.map((t) => ({ title: t.text, status: t.state })),
 * );
 * ```
 */
export async function replacePlanList(
  plan: PlanListCollection,
  marker: PlanListMarkerCollection,
  namespace: string,
  items: readonly PlanListItem[],
  options: { now?: () => number; requestId?: string } = {},
): Promise<ReplacePlanListResult> {
  const now = options.now ?? Date.now;
  const requestId = options.requestId ?? null;
  const count = items.length;
  try {
    const before = await marker.getOptional(namespace);
    // Another writer may have stored a count the trim loop cannot walk; read
    // it as no previous list. Rows it leaves sit past the new count, unshown.
    const storedCount = before?.state.count;
    const previousCount =
      Number.isSafeInteger(storedCount) && (storedCount as number) > 0 ? (storedCount as number) : 0;
    await marker.upsert(namespace, { status: "writing", count, reason: null });

    for (const [place, item] of items.entries()) {
      const key = placeKey(namespace, place);
      const prior = (await plan.getOptional(key))?.state;
      const update: Record<string, unknown> = {
        title: item.title,
        status: item.status,
        lastOutcome: "applied",
        lastTouchedAt: now(),
        requestId,
      };
      if (prior === undefined || stringOrNull(prior.title) !== item.title) {
        // A new or reworded item: its history belongs to a different item.
        update.previousStatus = null;
      } else {
        const priorStatus = stringOrNull(prior.status);
        // Only a real change moves the pointer; a repeated status leaves it.
        if (priorStatus !== null && priorStatus !== item.status) {
          update.previousStatus = priorStatus;
        }
      }
      await plan.upsert(key, update);
    }

    for (let place = count; place < previousCount; place += 1) {
      await plan.delete(placeKey(namespace, place));
    }

    await marker.upsert(namespace, { status: "complete", count, reason: null });
    return { status: "complete" };
  } catch (err) {
    const reason = `the plan list could not be written in full: ${
      err instanceof Error ? err.message : String(err)
    }`;
    try {
      await marker.upsert(namespace, { status: "incomplete", count, reason });
    } catch {
      // Nothing left to record it in. The marker still reads `writing` (or
      // is absent), which a reader treats as incomplete once the run ends.
    }
    return { status: "incomplete", reason };
  }
}

/**
 * The key namespace for ONE harness run: `<requestId>/<invocation>`. Every
 * harness that writes the plan record (and Claude Code's other work records)
 * keys its rows under it, so one run is one namespace whichever harness ran.
 *
 * **The request id alone is not the run's identity, and using it as one is a
 * silent data-merging bug.** A generator holding a harness as a tool can call
 * it several times inside a single request — the framework's own tool executor
 * disambiguates each call by `stepNumber:toolCallId` precisely because that
 * happens. Every such call is a separate coding run: its own files, its own
 * to-do ids (the harness numbers those per agent session, so two runs both
 * having a task `5` is ordinary), and its own gap ordinals, which restart at 1
 * per recorder and would therefore overwrite each other outright.
 *
 * `blockPath` is the framework's per-invocation identity — derived from the
 * block tree and the model step, so it is unique per call AND stable across a
 * replay, which a minted id would not be. Slashes are flattened so one
 * invocation stays one key segment.
 *
 * Two segments rather than one, deliberately: the request id stays the leading
 * segment, so `topicPrefix=<collection>/<requestId>/` still selects everything
 * one request did, while `<collection>/<requestId>/<invocation>/` narrows to a
 * single run. Replacing the request id outright would have made a row
 * impossible to correlate back to the request that caused it.
 *
 * Both parts are escaped into a single segment each — see
 * {@link planKeySegment} for why that escaping must not be lossy.
 */
export function harnessRunNamespace(ctx: BlockContext): string {
  const identity = (
    ctx as { _blockIdentity?: { blockPath?: string; attempt?: number } }
  )._blockIdentity;
  const path = identity?.blockPath;
  // A context without a block identity (a direct `execute`, a mock) has exactly
  // one invocation by construction, so a constant is the honest discriminator.
  //
  // The path is escaped too, and for the same reason the request id is: its
  // user-controlled parts (a router branch name, a model-supplied tool name or
  // call id) are escaped on the way in by the blockInstanceId grammar's own
  // rules, which cover `%/[]:` — but not a backslash and not a control
  // character, both of which this grammar cares about.
  const step =
    typeof path === "string" && path.length > 0
      ? planKeySegment(path.replace(/\//g, "."))
      : "0";
  // …and the ATTEMPT, because a retried block re-enters at the SAME path.
  // `executeBlock`'s retry loop increments an attempt counter and rebuilds the
  // instance id from `(request, path, attempt)` while leaving the path
  // untouched — so the framework's own invocation identity has three parts and
  // this had two. Two attempts of one retried run would otherwise share a
  // namespace: paths overwritten, and gap ordinals (which restart at 1 per
  // recorder) clobbering the earlier attempt's outright.
  const attempt = identity?.attempt ?? (ctx as { attempt?: number }).attempt ?? 0;
  return `${planKeySegment(ctx.request.identity.id)}/${step}#${attempt}`;
}

/** The leading key segment of every conversation namespace. */
const CONVERSATION_SEGMENT = "conversation";

/**
 * The key namespace for ONE harness conversation's plan:
 * `conversation/<conversation id>`. Every turn of the conversation writes its
 * plan here, so a later turn updates the plan an earlier one recorded instead
 * of starting a new one, and a new conversation starts with none.
 *
 * The id is the one the harness confirmed (Claude Code's session id, Cursor's
 * agent id): the conversation's identity, where {@link harnessRunNamespace} is
 * one invocation's. The plan record is session-scoped and a session binds one
 * harness, so the vendor's id alone keeps two conversations apart.
 *
 * It can't be read as a run namespace: a run namespace's second segment always
 * ends in `#<attempt>`, and a conversation id is the harness's own, escaped
 * with {@link planKeySegment} into one segment.
 */
export function harnessConversationNamespace(conversationId: string): string {
  return `${CONVERSATION_SEGMENT}/${planKeySegment(conversationId)}`;
}

/**
 * The storage-key prefix one conversation's plan rows are kept under. Pass it
 * as a collection read's `topicPrefix`. The conversation's list marker is the
 * one entry whose topic is {@link harnessConversationNamespace} itself.
 */
export function planConversationPrefix(conversationId: string): string {
  return `${OBSERVED_PLAN}/${harnessConversationNamespace(conversationId)}/`;
}

/** A plan list marker as a collection read lists it, topic under its collection. */
export interface PlanMarkerRead {
  readonly topic: string;
  readonly conversation?: string | null;
}

/**
 * Where to read one request's plan, from that request's run markers (the
 * markers listed under {@link planRowsPrefix}`(requestId, OBSERVED_PLAN_LIST)`).
 *
 * - `conversation` — a run of the request left a pointer: the plan is the
 *   conversation's, its rows under `rowsPrefix` and its marker keyed
 *   `namespace`.
 * - `run` — no run left one: the request was recorded before plans were kept
 *   per conversation (BP-030), or it never confirmed a conversation. Its own
 *   rows are under `rowsPrefix` and its markers are the ones passed in, as
 *   before.
 *
 * With several pointers (a retried block), the last run's wins, by key order.
 * The one reader rule both apps share, so the fallback never forks.
 */
export function readPlanTarget(
  requestId: string,
  markers: readonly PlanMarkerRead[],
): { readonly kind: "conversation"; readonly namespace: string; readonly rowsPrefix: string } | { readonly kind: "run"; readonly rowsPrefix: string } {
  const pointer = markers
    .filter((m) => typeof m.conversation === "string" && m.conversation.length > 0)
    .sort((a, b) => a.topic.localeCompare(b.topic, "en", { numeric: true }))
    .at(-1)?.conversation;
  if (typeof pointer === "string") {
    return { kind: "conversation", namespace: pointer, rowsPrefix: `${OBSERVED_PLAN}/${pointer}/` };
  }
  return { kind: "run", rowsPrefix: planRowsPrefix(requestId) };
}
