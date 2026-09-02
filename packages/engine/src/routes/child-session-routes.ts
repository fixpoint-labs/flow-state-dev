/**
 * `GET /sessions/:sessionId/children` — the first hop from a conversation
 * to the background work hanging off it (FIX-1010).
 *
 * Two hops by design: this read returns one summary row per child session, and
 * the shipped `GET /sessions/:childId/requests` then returns that job's own
 * history. The route is classified **session-addressed on the path id** in
 * `route-auth.ts`, which is the whole of why it is a sub-resource rather than a
 * filter on the flat session listing: the framework resolves the parent record
 * and checks its owner before this handler runs.
 *
 * What it returns is **every** child session, not only detached ones. The
 * store predicate selects on parentage, and nothing on a session record marks
 * it as task-board work. Today the detached-start path is the only writer of
 * `parentSessionId`, but that is a fact about the current tree, not a filter
 * this route applies — a second writer would be returned here, which is
 * correct and must not read as a bug.
 */
import type { RequestStatus } from "@flow-state-dev/core/types";
import type { FlowRegistry } from "../registry/flow-registry";
import type { RequestStore, SessionRecord, StoreRegistry } from "../stores/types";
import { toBareSessionId } from "../stores/scope-keys";
import { jsonResponse, loadTenantSession } from "./route-utils";
import { DEFAULT_MAX_CHILD_SESSION_LIST_LIMIT } from "../runtime-config";
import type { ParsedFlowRoute } from "./parseFlowRoute";

/** Rows returned when the caller passes no `limit`. */
const CHILD_SESSION_LIST_DEFAULT_LIMIT = 25;
/**
 * Largest `limit` this route accepts when the host configures none. Lower than
 * the collection-state listing's 200 because the cost per row is different:
 * each row resolves its status from the request store, so the cap bounds read
 * amplification rather than only payload size.
 *
 * A deployment running large orchestrations raises it with
 * `maxChildSessionListLimit` — the list is all-time history, so it outgrows any
 * fixed number, and the right ceiling depends on what that deployment is
 * willing to spend per read.
 */
const CHILD_SESSION_LIST_MAX_LIMIT = DEFAULT_MAX_CHILD_SESSION_LIST_LIMIT;
/**
 * Largest `offset` this route accepts. A database walks and discards every row
 * up to the offset, and those rows are inside the caller's own owner and
 * tenant — so without a cap a nominally bounded read scans the parent's whole
 * child history and every boundary check still passes.
 */
const CHILD_SESSION_LIST_MAX_OFFSET = 10_000;

/**
 * Statuses that make a row `active` wherever in the job they appear.
 *
 * Deliberately **two** members, and deliberately not
 * `isTerminalRequestStatus` (`stores/subscribe-helpers.ts`), which answers a
 * different question — *should the stream stop* — and is a flat partition.
 * It counts `suspended` as terminal, which here would report a job waiting on
 * the user's own decision as finished, and it has no way to express
 * "`interrupted` is live only when it is the most recent run". A third
 * classification exists in the durability sweeper (*may I delete the resume
 * points*). Three shipped notions of "terminal", none named for its question:
 * pick by the question, do not import.
 */
const LIVE_STATUSES: readonly RequestStatus[] = ["in_progress", "suspended"];

/**
 * The statuses that mean "still going" when found on the job's **most recent**
 * run. Three members, not two, and the asymmetry with {@link LIVE_STATUSES} is
 * the rule rather than an oversight.
 *
 * `interrupted` is live only when nothing has superseded it. Supersession is
 * not directly detectable — `/retry` writes `retryOf` on the *successor* only,
 * and it lives in an unqueryable blob — but it does not need to be: a retry is
 * created *after* the record it supersedes, so a superseded record is never
 * the most recent run. This read is the most-recent lookup, so it is exactly
 * where `interrupted` gets its say, at no extra cost.
 *
 * Writing the two sets as one shared constant is the mistake this note exists
 * to prevent: a crash-interrupted run that nobody continued reads `active`
 * (it is still continuable), while the same record with a completed retry
 * beside it loses on recency and the row reads `completed`.
 */
const LIVE_WHEN_MOST_RECENT = [
  "in_progress",
  "suspended",
  "interrupted"
] as const satisfies readonly RequestStatus[];

/**
 * Whether a most-recent run counts as still going.
 *
 * A type predicate rather than a bare `.includes` because both branches are
 * load-bearing: the false branch narrows to {@link TerminalRequestStatus},
 * which is what lets {@link TERMINAL_WIRE_STATUS} be a total map and lets this
 * set stay the single place the live statuses are written.
 */
function isLiveWhenMostRecent(
  status: RequestStatus
): status is (typeof LIVE_WHEN_MOST_RECENT)[number] {
  return (LIVE_WHEN_MOST_RECENT as readonly RequestStatus[]).includes(status);
}

/**
 * What a row says about the job's runs — **not** about the state of the work
 * itself. Where a job is backed by a task, the task's own lifecycle is the
 * richer and more authoritative account, and a UI showing both must pick one
 * rather than merging them.
 *
 * `active` means one thing and only one thing: **not finished**. It covers
 * queued, running, and paused waiting for a person alike, and deliberately
 * does not distinguish them — a request is persisted `in_progress` at enqueue,
 * before any worker picks it up, so "running" would claim a worker was on a
 * job nothing had touched. A richer breakdown arrives later as a *separate
 * optional field*, so every value here keeps its meaning; encoding a sub-state
 * inside `status` is what that shape exists to prevent.
 *
 * `interrupted` is **not** a member. Under the recency rule above it is either
 * `active` (most recent, so continuable) or superseded and ignored, so it can
 * never be the emitted value.
 */
export type ChildSessionStatus =
  | "active"
  | "completed"
  | "failed"
  | "incomplete"
  | "aborted";

/**
 * What is left of `RequestStatus` once {@link isLiveWhenMostRecent} has had its
 * say. **Derived, never listed** — writing these four out again would let the
 * two halves of the classification drift apart silently.
 */
type TerminalRequestStatus = Exclude<
  RequestStatus,
  (typeof LIVE_WHEN_MOST_RECENT)[number]
>;

/**
 * How a finished run reads on the wire.
 *
 * Every entry is an identity today, so `status as ChildSessionStatus` would be
 * shorter and would behave identically — **until it didn't.** A cast assumes
 * the two unions stay 1:1 and asserts it once, at author time, forever. This
 * map is total over {@link TerminalRequestStatus}, so a new terminal status
 * added to `RequestStatus` upstream is a **compile error here** rather than an
 * unannounced value arriving on a contract clients switch on. That is the only
 * reason the indirection exists.
 *
 * Collapsing entries — merging `aborted` into `failed`, say — would tell a
 * customer their work broke when they themselves cancelled it.
 */
export const TERMINAL_WIRE_STATUS: Record<
  TerminalRequestStatus,
  ChildSessionStatus
> = {
  completed: "completed",
  failed: "failed",
  incomplete: "incomplete",
  aborted: "aborted"
};

/** One background job, as this route reports it. */
export type ChildSessionSummary = {
  /** Bare child session id — the address for hop 2. */
  id: string;
  /** Bare id of the conversation this job hangs off. */
  parentSessionId: string;
  createdAt: number;
  updatedAt: number;
  /** What body of work the job is for. Written by the detached-start path. */
  topic?: string;
  /** Which worker the job is routed to. Written by the detached-start path. */
  coordinate?: string;
  /**
   * Absent when the job has no run of this conversation's identity at all —
   * absence is not a status and is deliberately not defaulted to anything.
   */
  status?: ChildSessionStatus;
};

type ChildSessionRouteContext = {
  registry: FlowRegistry;
  stores: StoreRegistry;
  /** Tenant id from the request header (FIX-682). */
  tenantId?: string;
  /**
   * Largest `limit` this listing accepts (FIX-1012). Absent →
   * {@link CHILD_SESSION_LIST_MAX_LIMIT}.
   */
  maxListLimit?: number;
};

/**
 * The identity every read on this route conjoins, taken from the **stored
 * parent record** rather than from the principal (BP-031) — the parent is
 * already resolved and tenant-checked, so these are trusted server-side
 * values, and they work on the framework default resolver where no principal
 * exists.
 *
 * Route authorization checks the *parent* only, and the parentage predicate
 * matches on parentage and tenant alone; nothing constrains a child to share
 * its parent's owner, org or flow. Without these clauses a child written by
 * any second writer of `parentSessionId` would be returned across a boundary
 * nothing checked — and the flow-kind one is an *authentication* boundary: a
 * public parent authorizes anonymously, so a child stamped with a protected
 * flow's kind would be handed to a caller hop 2 refuses.
 *
 * Every key is present, including when its value is `undefined`: an absent
 * `tenantId` or `orgId` key applies **no** filter, while an explicit
 * `undefined` exact-matches unbound records. That difference is a
 * data-isolation boundary, not a nicety.
 */
type ParentIdentity = {
  userId: string;
  flowKind: string;
  orgId: string | undefined;
  tenantId: string | undefined;
};

function parentIdentity(
  parent: SessionRecord,
  tenantId: string | undefined
): ParentIdentity {
  return {
    userId: parent.userId,
    flowKind: parent.flowKind,
    orgId: parent.orgId,
    tenantId
  };
}

/**
 * Resolve one job's status with two bounded reads (FIX-1010).
 *
 * **Read 1 — the existence check, issued unordered.** "Does a non-terminal run
 * exist" has no ordering in it, so it cannot be inverted by a tie, a late
 * write or a clock collision — which is what dissolves the case an ordered
 * single read gets wrong (an earlier run finishing after a later one starts).
 * Unordered is a correctness bound, not an optimisation: a job accumulates
 * `suspended` records whenever an approval gate expires, and those are exactly
 * the rows this read selects, so a trailing sort would grow without bound
 * while `LIMIT 1` alone stops at the first match.
 *
 * **Read 2 — the most recent run, and deliberately not filtered to terminal
 * statuses.** The two reads are not atomic, and a run enqueued between them
 * breaks the premise "read 1 was empty, therefore every run is terminal".
 * Both obvious repairs fail: emitting read 2's row as-is would put
 * `in_progress` on the wire, and filtering read 2 to terminal statuses would
 * report a stale outcome while work is demonstrably active. Reclassifying is
 * correct because read 2 is itself one consistent query — if the most recent
 * run it sees is non-terminal, a non-terminal run existed at that instant.
 *
 * Read 1 still earns its place: it catches a non-terminal run that is *not*
 * the most recent, which read 2 alone cannot see.
 *
 * When every run is terminal and they disagree, the row reports the **most
 * recent** outcome — so a job that failed and was retried successfully reads
 * `completed`. A row that reads `failed` forever after the failure was fixed
 * is an alarm the user has no way to clear, and the failed attempt is still
 * one hop away in the job's own history.
 */
async function resolveChildSessionStatus(
  store: RequestStore,
  childSessionId: string,
  identity: ParentIdentity
): Promise<ChildSessionStatus | undefined> {
  const live = await store.list({
    sessionId: childSessionId,
    status: LIVE_STATUSES,
    orderBy: "none",
    limit: 1,
    ...identity
  });
  if (live.length > 0) return "active";

  const [mostRecent] = await store.list({
    sessionId: childSessionId,
    orderBy: "startedAtMs",
    limit: 1,
    ...identity
  });
  if (mostRecent === undefined) return undefined;
  if (isLiveWhenMostRecent(mostRecent.status)) return "active";

  // Terminal outcomes pass through unchanged, but through a total map rather
  // than a cast — see {@link TERMINAL_WIRE_STATUS}.
  return TERMINAL_WIRE_STATUS[mostRecent.status];
}

/**
 * Project the two labels the detached-start writer stamps onto the row.
 *
 * Read straight off `SessionRecord`, where both fields are declared: the
 * writer (`context/create-request-host.ts`) sets them from the routing seed it
 * derived the child key from, so the compiler now checks that this read and
 * that write agree. It was a structural cast while the writer was another
 * issue's to build.
 *
 * Both stay optional on the wire, and the guard is `== null` rather than a
 * truthiness check (BP-030): a child written before the fields existed reads
 * `undefined`, a store that nulls absent keys hands back `null`, and both mean
 * *unlabelled* — a row a UI shows without a name, never an error. An ordinary
 * child session that is not background work has neither, which is the same
 * signal a client needs to decide whether a row is labelable.
 *
 * The labels decide nothing here or anywhere else — see `SessionRecord.topic`.
 */
function readChildSessionLabels(
  record: SessionRecord
): Pick<ChildSessionSummary, "topic" | "coordinate"> {
  return {
    ...(record.topic == null ? {} : { topic: record.topic }),
    ...(record.coordinate == null ? {} : { coordinate: record.coordinate })
  };
}

/**
 * Parse a bounded pagination parameter. Returns the fallback when absent, or a
 * message naming the accepted range when the value is unusable.
 *
 * Deliberately **not** a silent clamp: a caller that asked for 5000 and got
 * 100 rows back with no signal would page wrongly and never know.
 */
function boundedParam(
  raw: string | null,
  name: string,
  min: number,
  max: number,
  fallback: number
): number | { error: string } {
  if (raw === null) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!/^\d+$/.test(raw.trim()) || !Number.isSafeInteger(parsed)) {
    return { error: `${name} must be an integer ${min}–${max}` };
  }
  if (parsed < min || parsed > max) {
    return { error: `${name} must be ${min}–${max}` };
  }
  return parsed;
}

export async function handleListSessionChildren(
  request: Request,
  route: Extract<ParsedFlowRoute, { kind: "list_session_children" }>,
  ctx: ChildSessionRouteContext
): Promise<Response> {
  const parent = await loadTenantSession(
    ctx.stores.session,
    route.sessionId,
    ctx.tenantId
  );
  if (parent === undefined) {
    // Same shape the sibling session reads emit, and the same answer a parent
    // in another tenant gets — a cross-tenant probe is indistinguishable from
    // absent.
    return jsonResponse(404, { error: `Unknown session "${route.sessionId}"` });
  }

  const url = new URL(request.url);
  const maxLimit = ctx.maxListLimit ?? CHILD_SESSION_LIST_MAX_LIMIT;
  const limit = boundedParam(
    url.searchParams.get("limit"),
    "limit",
    1,
    maxLimit,
    // Raising the ceiling does not move the default: that would change the
    // page size under every unparameterized caller on the deployment, and a
    // client that wants more now asks for it. The clamp is for the opposite
    // case — a host that lowers the ceiling below the default, where an
    // unclamped default would exceed its own maximum.
    Math.min(CHILD_SESSION_LIST_DEFAULT_LIMIT, maxLimit)
  );
  if (typeof limit !== "number") return jsonResponse(400, limit);
  const offset = boundedParam(
    url.searchParams.get("offset"),
    "offset",
    0,
    CHILD_SESSION_LIST_MAX_OFFSET,
    0
  );
  if (typeof offset !== "number") return jsonResponse(400, offset);

  const identity = parentIdentity(parent, ctx.tenantId);
  const children = await ctx.stores.session.list({
    parentage: { parentOf: route.sessionId },
    // Ordered on `createdAt, id` — both immutable. Under the store's default
    // `updatedAt` ordering a child that starts a run mid-walk rewrites its own
    // `updatedAt` and jumps to the front, so one child crosses the page
    // boundary and is never returned while another is returned twice, with the
    // caller unable to detect either. A tie-breaker cannot repair a sort key
    // that mutates.
    orderBy: "createdAt",
    limit,
    offset,
    ...identity
  });

  const summaries = await Promise.all(
    children.map(async (child): Promise<ChildSessionSummary> => {
      // Request records key on the bare session id, not the namespaced
      // storage key.
      const id = toBareSessionId(child.id, ctx.tenantId);
      const status = await resolveChildSessionStatus(
        ctx.stores.request,
        id,
        identity
      );
      return {
        id,
        parentSessionId: route.sessionId,
        createdAt: child.createdAt,
        updatedAt: child.updatedAt,
        ...readChildSessionLabels(child),
        ...(status !== undefined ? { status } : {})
      };
    })
  );

  // A named field set, never `...record`. The sibling listing returns whole
  // session records, which here would put every child's `state`, `resources`
  // and append-only `journal` on the wire — unbounded per row, multiplied by
  // the page.
  return jsonResponse(200, { children: summaries });
}
