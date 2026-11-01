/**
 * The run a task's row names, and every read and the one write the task screen
 * makes against it.
 *
 * The row's run link names a session and a request, never a flow. The run's
 * flow is the one its session records as its owner (`flowId`), read once when
 * the task opens: a worker can hand its rows to another flow than the board's,
 * and a flow-scoped route answers 404 for a request its flow does not own. So
 * the request's status, its live stream and the abort all go through that
 * flow, never the board's.
 *
 * Nothing here looks for a run any other way: no listing, no key rebuilt from
 * the task, no "latest session of this worker".
 */
import { compareItemOrder, type ResourceManifest } from "@flow-state-dev/client";
import { itemsForTask, type OutputItem } from "@flow-state-dev/core/items";
import {
  OBSERVED_PLAN,
  OBSERVED_PLAN_LIST,
  OBSERVED_PULL_REQUESTS,
  planKeySegment,
  planRowsPrefix,
  readPlanTarget,
  type RequestStatus,
} from "@flow-state-dev/core/types";
import type { Client } from "@flow-state-dev/client";
import { describeFailure, type Failure } from "./reads";

/** A run the screen can open: the row's link, and the flow its session names. */
export type OpenRun = { sessionId: string; requestId: string; attempt: number; flowId: string };

/** A read that failed, with the Lab's own words. */
export class RunReadError extends Error {
  constructor(readonly failure: Failure) {
    super(failure.message);
  }
}

function fail(error: unknown): never {
  throw error instanceof RunReadError ? error : new RunReadError(describeFailure(error));
}

/**
 * The flow that owns `sessionId`: the one the run's request, stream and abort
 * go through. A session that names no owner is refused rather than guessed at.
 */
export async function resolveRunFlow(client: Client, sessionId: string): Promise<string> {
  let flowId: string | undefined;
  try {
    flowId = (await client.sessions.get(sessionId)).flowId;
  } catch (error) {
    fail(error);
  }
  if (flowId == null || flowId.length === 0) {
    throw new RunReadError({
      message: "The run's session names no owning flow, so there is nothing to open it through.",
    });
  }
  return flowId;
}

/** What one read of the run's request record says: its status, and when it ended, if it has. */
export type RunRecordRead = { status: RequestStatus; endedAtMs?: number };

/** The run's request record, read through the run's flow. */
export async function readRunRecord(client: Client, run: Pick<OpenRun, "flowId" | "requestId">): Promise<RunRecordRead> {
  try {
    const snapshot = await client.flow(run.flowId).request(run.requestId).status();
    return snapshot.completedAtMs === undefined ? { status: snapshot.status } : { status: snapshot.status, endedAtMs: snapshot.completedAtMs };
  } catch (error) {
    return fail(error);
  }
}

/** The run's request status alone. */
export async function readRunStatus(client: Client, run: Pick<OpenRun, "flowId" | "requestId">): Promise<RequestStatus> {
  return (await readRunRecord(client, run)).status;
}

/** Items per session-state page. */
const ITEM_PAGE = 200;
/** How many pages the Session reads before it says there is more than it shows. */
const ITEM_PAGES = 5;

/** A session's stored items, oldest first, and whether there were more than were read. */
export type SessionItems = { items: OutputItem[]; truncated: boolean };

/**
 * The run session's stored items, oldest first. At most {@link ITEM_PAGES}
 * pages; past that the answer says so rather than reading on.
 */
export async function readSessionItems(client: Client, sessionId: string): Promise<SessionItems> {
  const items: OutputItem[] = [];
  let offset = 0;
  try {
    for (let page = 0; page < ITEM_PAGES; page += 1) {
      const state = await client.sessions.state(sessionId, { includeItems: true, offset, limit: ITEM_PAGE });
      items.push(...(state.items ?? []));
      if (state.pagination?.hasMore !== true) return { items: items.sort(compareItemOrder), truncated: false };
      offset = state.pagination.nextOffset ?? offset + ITEM_PAGE;
    }
  } catch (error) {
    fail(error);
  }
  return { items: items.sort(compareItemOrder), truncated: true };
}

/** Where a live request stream reports to. */
export type RequestFollower = {
  /** A finished item the request stored. */
  onItem(item: OutputItem): void;
  /** The request's status moved; `at` is the event's time, which for a terminal status is when the run ended. */
  onStatus(status: string, at?: number): void;
  onError(failure: Failure): void;
};

/**
 * Follow the run's request live, through the run's flow. The stream replays
 * what the request already emitted and then its new items as they are kept.
 * Only finished, non-transient items are passed on: an item the store does not
 * hold yet is not drawn.
 */
export function followRequest(client: Client, run: Pick<OpenRun, "flowId" | "requestId">, to: RequestFollower): { close(): void } {
  return client.flow(run.flowId).request(run.requestId).stream({
    onItemDone: (event) => {
      const item = event.item as OutputItem & { transient?: boolean };
      if (item.transient !== true) to.onItem(item);
    },
    onRequestStatus: (event) => to.onStatus(event.status, typeof event.ts === "number" ? event.ts : undefined),
    onError: (error) => to.onError(describeFailure(error)),
  });
}

/** An item's identity across reads: its request and its id. */
function itemKey(item: OutputItem): string {
  return `${item.requestId}\u0000${item.id}`;
}

/** No request sent from the screen. */
const NONE_SENT: ReadonlySet<string> = new Set();

/** Merge items, each `(request, id)` once, keeping the finished copy, in stored order. */
export function mergeItems(held: readonly OutputItem[], incoming: readonly OutputItem[]): OutputItem[] {
  const byKey = new Map<string, OutputItem>();
  for (const item of [...held, ...incoming]) {
    const key = itemKey(item);
    const seen = byKey.get(key);
    if (seen === undefined || compareItemOrder(item, seen) >= 0) byKey.set(key, item);
  }
  return [...byKey.values()].sort(compareItemOrder);
}

/**
 * What the Session shows of a session's items (BR-8): the items stamped with
 * this task's id, through the attribution helper the substrate and the UI
 * share, and whether the session also holds another task's work. A request
 * in `sent` shows too: its door turn stores no task stamp (FIX-2009).
 */
export function taskItems(
  items: readonly OutputItem[],
  boardRef: string,
  taskId: string,
  sent: ReadonlySet<string> = NONE_SENT,
): { items: OutputItem[]; shared: boolean } {
  const own = new Set(itemsForTask(items, boardRef, taskId).map(itemKey));
  return {
    items: items.filter((item) => own.has(itemKey(item)) || sent.has(item.requestId)),
    shared: items.some((item) => item.taskId !== undefined && item.taskId !== taskId),
  };
}

/** How long an Interrupt waits for the request record to leave `in_progress`. */
const SETTLE_TIMEOUT_MS = 30_000;
const SETTLE_POLL_MS = 250;

/** What an Interrupt came to. */
export type InterruptOutcome =
  /** The request record reads `aborted`, and says when, if it does. */
  | { kind: "aborted"; endedAtMs?: number }
  /** The request had already finished, with this status, before the abort landed (BR-12). */
  | { kind: "finished"; status: RequestStatus };

/**
 * Abort the run's request through its flow, then wait until the request record
 * itself says how it ended. Resolves only on the record's word; rejects when
 * the abort is refused or fails, or the record never settles.
 */
export async function interruptRun(
  client: Client,
  run: Pick<OpenRun, "flowId" | "requestId">,
  options: { timeoutMs?: number; pollMs?: number; signal?: AbortSignal } = {},
): Promise<InterruptOutcome> {
  const actions = client.flow(run.flowId);
  try {
    await actions.request(run.requestId).abort();
  } catch (error) {
    // 409: the request was already terminal. Anything else is a refusal.
    if (describeFailure(error).httpStatus !== 409) fail(error);
  }
  const until = Date.now() + (options.timeoutMs ?? SETTLE_TIMEOUT_MS);
  for (;;) {
    // The screen that asked has gone: stop reading on its behalf.
    if (options.signal?.aborted === true) throw new RunReadError({ message: "The screen closed before the run's record settled." });
    const { status, endedAtMs } = await readRunRecord(client, run);
    if (status === "aborted") return endedAtMs === undefined ? { kind: "aborted" } : { kind: "aborted", endedAtMs };
    if (status !== "in_progress") return { kind: "finished", status };
    if (Date.now() > until) {
      throw new RunReadError({ message: "The abort was recorded, but the run has not stopped yet. It may still be running." });
    }
    await new Promise((resolve) => setTimeout(resolve, options.pollMs ?? SETTLE_POLL_MS));
  }
}

/**
 * The storage prefixes a coding harness records its plan, file operations and
 * pull requests under, when it records them. Found in the run session's
 * manifest by these patterns; a flow that declares none records none.
 */
const RECORDED = {
  plan: `${OBSERVED_PLAN}/**`,
  markers: `${OBSERVED_PLAN_LIST}/**`,
  files: "observed-file-ops/**",
  pullRequests: `${OBSERVED_PULL_REQUESTS}/**`,
} as const;

/** One step of the plan the run recorded. */
export type PlanStep = { id: string; title: string; status: string | null };
/** One path the run's file tools touched. */
export type FileTouch = { path: string; kind: "created" | "edited" | null };
/** One pull request the run opened, or found on its branch. */
export type OpenedPullRequest = {
  url: string;
  repository: string | null;
  number: number | null;
  title: string | null;
  state: string | null;
  source: "tool" | "branch" | null;
};

/** What a run recorded, per section: its rows, `null` when the harness records none. */
export type RecordedWork = {
  plan: { rows: PlanStep[]; truncated: boolean } | null;
  files: { rows: FileTouch[]; truncated: boolean } | null;
  pullRequests: { rows: OpenedPullRequest[]; truncated: boolean } | null;
};

/** Rows per recorded-collection read. One page; past it the section says there is more. */
const RECORDED_PAGE = 200;

function recordedRef(manifest: ResourceManifest, pattern: string): string | undefined {
  return manifest.resources.find((r) => r.kind === "collection" && r.pattern === pattern && r.client.state?.read === true)?.ref;
}

/**
 * The plan and files the run recorded, read once. File rows are keyed
 * `<request>/<invocation>/<path>`, so one prefix read selects everything this
 * request did and nothing an earlier run in the same session did. The plan is
 * the harness conversation's: the run leaves a pointer to it under its own
 * request, and a run from before plans were kept by conversation has its plan
 * under the request, as files are. Pull requests are keyed by the pull
 * request, not the request, since a session keeps one row per pull request
 * across its turns: each row names the request that opened it, and only this
 * run's are kept.
 */
export async function readRecordedWork(client: Client, run: Pick<OpenRun, "sessionId" | "requestId">): Promise<RecordedWork> {
  let manifest: ResourceManifest;
  try {
    manifest = await client.resources.getResourceManifest(run.sessionId);
  } catch (error) {
    fail(error);
  }
  // Escaped the way the recorder keys it, so a request id holding a `/` still selects its own rows.
  const underRequest = (pattern: string) => `${pattern.slice(0, -"/**".length)}/${planKeySegment(run.requestId)}/`;
  const read = async (pattern: string, prefix = underRequest(pattern)) => {
    const ref = recordedRef(manifest, pattern);
    if (ref === undefined) return null;
    try {
      const page = await client.resources.listCollectionItems(run.sessionId, ref, { limit: RECORDED_PAGE, topicPrefix: prefix });
      return { items: page.items, truncated: page.nextCursor != null };
    } catch (error) {
      fail(error);
    }
  };
  const readPlan = async () => {
    if (recordedRef(manifest, RECORDED.plan) === undefined) return null;
    const pointers = await read(RECORDED.markers, planRowsPrefix(run.requestId, OBSERVED_PLAN_LIST));
    const markers = (pointers?.items ?? []).map((item) => ({
      topic: item.topic,
      conversation: field(item.clientData, "conversation") as string | null | undefined,
    }));
    return read(RECORDED.plan, readPlanTarget(run.requestId, markers).rowsPrefix);
  };
  const field = (data: unknown, key: string) => (data as Record<string, unknown> | undefined)?.[key];
  const [plan, files, pullRequests] = await Promise.all([
    readPlan(),
    read(RECORDED.files),
    read(RECORDED.pullRequests, `${OBSERVED_PULL_REQUESTS}/`),
  ]);
  const text = (data: unknown, key: string) => (typeof field(data, key) === "string" ? (field(data, key) as string) : null);
  /** The key segments after `<request>/<invocation>/`, or a plan's `conversation/<id>/`. */
  const rest = (topic: string) => topic.split("/").slice(2).join("/");
  return {
    plan:
      plan === null
        ? null
        : {
            truncated: plan.truncated,
            rows: plan.items.map((item) => ({
              id: rest(item.topic),
              title: typeof field(item.clientData, "title") === "string" ? (field(item.clientData, "title") as string) : rest(item.topic),
              status: typeof field(item.clientData, "status") === "string" ? (field(item.clientData, "status") as string) : null,
            })),
          },
    files:
      files === null
        ? null
        : {
            truncated: files.truncated,
            rows: files.items.map((item) => {
              const kind = field(item.clientData, "lastKind");
              return { path: rest(item.topic), kind: kind === "created" || kind === "edited" ? kind : null };
            }),
          },
    pullRequests:
      pullRequests === null
        ? null
        : {
            truncated: pullRequests.truncated,
            rows: pullRequests.items
              .filter((item) => field(item.clientData, "requestId") === run.requestId && text(item.clientData, "url") !== null)
              .sort((a, b) => Number(field(a.clientData, "firstSeenAt") ?? 0) - Number(field(b.clientData, "firstSeenAt") ?? 0))
              .map((item) => {
                const source = field(item.clientData, "source");
                const number = field(item.clientData, "number");
                return {
                  url: text(item.clientData, "url")!,
                  repository: text(item.clientData, "repository"),
                  number: typeof number === "number" ? number : null,
                  title: text(item.clientData, "title"),
                  state: text(item.clientData, "state"),
                  source: source === "tool" || source === "branch" ? source : null,
                };
              }),
          },
  };
}
