/**
 * Real-path driver for the channels-in-the-reference-app goal check. Copied
 * into `apps/kitchen-sink` and run there as a real ESM file by run.mts (via
 * `runHarness`), because the subject here IS that app's own wiring: its
 * `fsdev.config.ts` opens the channels at module scope, and only a file
 * executed with the app as cwd resolves both its `@/*` aliases and its
 * `node_modules`.
 *
 * OBSERVES ONLY — every assertion lives in run.mts. This file must not decide
 * whether anything passed; it reports what happened on one `__GOAL__` line.
 *
 * Two things here are load-bearing and easy to undo by accident:
 *
 *   - **`console.warn` is captured before the config is imported.** The
 *     unattended-board warning is emitted during the hire, which happens while
 *     that module evaluates. A static import would have run before any patch,
 *     so the config is imported DYNAMICALLY, after the patch is installed.
 *   - **Nothing here opens a channel.** The `openAtImport` read below exists to
 *     show that the CONFIG opened them — this file must never call an open of
 *     its own, or V11 grades the harness. It is read immediately after the
 *     import, before the router, so a channel opened lazily on first use would
 *     not be counted.
 *
 *     It does NOT distinguish an awaited open from a fire-and-forget one, and
 *     no read placed here could. ESM blocks every importer until the config
 *     finishes evaluating, so the pre-await state is unobservable from an
 *     importer and all that is left is a race. Measured on this app: with the
 *     open made fire-and-forget, one extra `setImmediate` before this read is
 *     enough for all three sessions to be there. That property is graded
 *     structurally instead, as V11b in run.mts.
 *
 * Not typechecked by `goals/tsconfig.json` — its imports resolve against
 * apps/kitchen-sink. See goals/README.md → "Harnesses".
 */
/**
 * Every address this file probes, handed over by run.mts on `GOAL_TREE`.
 *
 * **Nothing here is typed as a literal, and that is load-bearing.** run.mts
 * reads the channel ids, the kind each channel selected, the board names, the
 * draining seat and a member to post as off the tree at run time, and passes
 * them in. A harness that spelled them itself would agree with the tree only by
 * coincidence: rename a channel folder and a correct implementation would fail
 * the goal on the harness's stale address, which is the opposite of the
 * "read off the tree" promise goal.md makes.
 *
 * `appUserId` is the id the app's own pages call as, not an id this check
 * invents — a channel only the goal can reach is a channel no user has.
 */
interface TreeSpec {
  channels: Array<{ id: string; address: string }>;
  boardHolder: { id: string; address: string; boards: string[] };
  attendedBoard: string;
  unwiredBoard: string;
  seatAddress: string;
  seatKind: string;
  author: string;
  /** Declared members, per channel id — who a fan-out on that channel addresses. */
  membersByChannel: Record<string, string[]>;
  channelOwner: string;
  appUserId: string;
  /** The organization the app resolves every caller to, where the boards' rows live. */
  orgId: string;
}

const TREE = JSON.parse(process.env.GOAL_TREE ?? "") as TreeSpec;
const USER_ID = TREE.channelOwner;
const out: Record<string, unknown> = { ok: false };

/** Every `console.warn` the boot emitted, in order. */
const warnings: string[] = [];
const realWarn = console.warn;
console.warn = (...args: unknown[]) => {
  warnings.push(args.map((a) => String(a)).join(" "));
};

// The app's real wiring, evaluated now. Hiring, the channel bind and the
// channel open all happen inside this await.
const { flowstate } = await import("./lib/flowstate");

// ---- V11: which channels the BOOT opened, before this file calls anything -
// The next statements after the import, before the router: one await to reach
// the stores, then one session read per channel. Early so that a channel
// opened lazily on the first call would not be counted — not because being
// early wins a race against a loose open. See the header.
const openAtImport: string[] = [];
{
  const stores = (await flowstate.getRuntime()).stores;
  for (const { id } of TREE.channels) {
    if ((await stores.session.get(id)) !== undefined) openAtImport.push(id);
  }
}
out.openAtImport = openAtImport;

const generated = await import("./workforce/workforce.gen");

console.warn = realWarn;
out.warnings = warnings;
out.channelKindNames = Object.keys(generated.channelKinds);

const router = await flowstate.getRouter();

async function call(
  method: "GET" | "POST" | "DELETE",
  segs: string[],
  body?: unknown,
  /** Appended to the URL only — `params.path` stays the route's own segments. */
  query?: string,
): Promise<{ status: number; body: any }> {
  const req = new Request("http://goal/api/flows/" + segs.join("/") + (query ?? ""), {
    method,
    headers: { "content-type": "application/json", accept: "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const res = await router[method](req, { params: { path: segs } } as never);
  const text = await res.text();
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, body: json };
}

/** A block trace carries its return value as `{ kind: "inline", value }`. */
function unwrap(output: unknown): unknown {
  return typeof output === "object" &&
    output !== null &&
    (output as { kind?: unknown }).kind === "inline"
    ? (output as { value: unknown }).value
    : output;
}

/**
 * Run one action and wait for its request to reach a terminal status.
 *
 * Only a `completed` request counts as having run: the engine persists what a
 * turn emitted before it died, so accepting any terminal status would let a
 * half-finished drain read as a drain.
 */
async function act(
  address: string,
  sessionId: string,
  action: string,
  input: unknown,
): Promise<{ status: number; output?: unknown; requestStatus?: string; error?: unknown }> {
  const dispatched = await call("POST", [address, sessionId, "actions", action], {
    userId: USER_ID,
    input,
  });
  if (dispatched.status >= 400) {
    return { status: dispatched.status, error: dispatched.body };
  }
  const requestId = dispatched.body?.request?.id ?? dispatched.body?.requestId;
  if (typeof requestId !== "string" || requestId === "") {
    return { status: dispatched.status, error: `no request id: ${JSON.stringify(dispatched.body)}` };
  }
  const stores = (await flowstate.getRuntime()).stores;
  const deadline = Date.now() + 35_000;
  while (Date.now() < deadline) {
    const record = (await stores.request.get(requestId)) as
      | { status?: string; error?: unknown; items?: Array<Record<string, unknown>> }
      | undefined;
    if (record?.status !== undefined && record.status !== "in_progress") {
      // An action's return value rides its block's own trace row; there is no
      // `output` field on the request record.
      const traces = (record.items ?? []).filter((item) => item.type === "block_trace");
      return {
        status: dispatched.status,
        requestStatus: record.status,
        output: unwrap(traces.length === 0 ? undefined : traces[traces.length - 1]!.output),
        error: record.error,
      };
    }
    await new Promise((r) => setTimeout(r, 20));
  }
  return { status: dispatched.status, requestStatus: "timed-out" };
}

// ---- the first router call ----------------------------------------------
const deskRead = await act(TREE.boardHolder.address, TREE.boardHolder.id, "read", {});
out.deskRead = { requestStatus: deskRead.requestStatus, output: deskRead.output, error: deskRead.error };

// ---- each channel's session, as the route hands it back -------------------
const sessions: Record<string, unknown> = {};
for (const { id } of TREE.channels) {
  const res = await call("GET", ["sessions", id]);
  sessions[id] = res.status >= 400 ? { error: res.body, status: res.status } : res.body?.session;
}
out.sessions = sessions;

// ---- V13: can a caller using the APP's own user id reach the channels? ----
// Listed and read as `appUserId` — what `app/page.tsx` and `app/devtool/page.tsx`
// pass — rather than as the id the config opened them under. Sessions are
// per-user: a channel opened as somebody nobody calls as is a channel the app
// ships and no user of it can see.
{
  const listed = await call(
    "GET",
    ["sessions"],
    undefined,
    "?userId=" + encodeURIComponent(TREE.appUserId),
  );
  const rows: Array<{ id?: string }> = Array.isArray(listed.body?.sessions)
    ? listed.body.sessions
    : [];
  out.visibleToAppUser = rows
    .map((row) => row.id)
    .filter((id): id is string => typeof id === "string");
}

// ---- V14: who each channel's fan-out reached, and who it delivered to -----
//
// One post per channel, then the fan-out's own trace rows. Two numbers come
// back per channel and they are deliberately separate:
//
//   `reached`   — how many members the fan-out block addressed. This is the
//                 framework's half and it does not change when an app goes
//                 silent: the sequencer is declared on the kind and still
//                 walks the roster.
//   `delivered` — how many of those deliveries the notify block actually made,
//                 read off each invocation's own reported outcome.
//
// **What `delivered` can and cannot see.** The delivery itself is a TRANSIENT
// item, and transient items are not persisted — they are absent from the
// request's item log, so there is nothing durable to count. What is durable is
// the notify block's trace, so `delivered` is the block's own report of what it
// did. A block that emitted and then reported otherwise would be believed. That
// gap is named here rather than left for a reader to find; closing it would
// mean making the app's own delivery durable for a test's convenience, which is
// a worse trade in a file people copy.
//
// The fan-out rides a SEPARATE request from the post, so this waits for a trace
// to appear rather than reading straight away — reading early returns nothing,
// which is indistinguishable from a channel that delivered nothing, and that is
// the exact thing being measured.
const NOTIFY_BLOCK = "kitchen-sink-notify-member";
const FAN_OUT_BLOCK = "channel-fan-out";
const notified: Record<string, { reached: number; delivered: string[]; problem?: string }> = {};
for (const channel of TREE.channels) {
  const posted = await act(channel.address, channel.id, "post", {
    body: `probe ${Date.now()}`,
    author: TREE.membersByChannel[channel.id]?.[0],
  });
  if (posted.requestStatus !== "completed") {
    notified[channel.id] = {
      reached: 0,
      delivered: [],
      problem: `the post ended "${posted.requestStatus}"`,
    };
    continue;
  }
  const stores = (await flowstate.getRuntime()).stores;
  const deadline = Date.now() + 15_000;
  let reached = 0;
  let delivered: string[] = [];
  let sawFanOut = false;
  while (Date.now() < deadline) {
    const requests = (await stores.request.list({ sessionId: channel.id })) as any[];
    const traces = requests.flatMap((r) =>
      (r.items ?? []).filter((item: any) => item.type === "block_trace"),
    );
    const fanOut = traces.filter((t: any) => t.blockName === FAN_OUT_BLOCK);
    sawFanOut = fanOut.length > 0;
    reached = fanOut.reduce(
      (n: number, t: any) => n + (t.output?.shape?.entries?.length ?? 0),
      0,
    );
    delivered = traces
      .filter((t: any) => t.blockName === NOTIFY_BLOCK)
      .map((t: any) => String(t.output?.value?.notified ?? ""))
      .filter((who: string) => who.length > 0);
    if (sawFanOut) break;
    await new Promise((r) => setTimeout(r, 25));
  }
  notified[channel.id] = sawFanOut
    ? { reached, delivered }
    : // A kind with no notify slot declares no fan-out at all, which is a
      // different thing from an app declining to deliver — reported as zero of
      // both rather than as a failure, so run.mts can tell them apart.
      { reached: 0, delivered: [] };
}
out.notified = notified;

// ---- file one row on each board, then drain -------------------------------
const followupGoal = `chase the printer quote ${Date.now()}`;
const escalationGoal = `the refund needs a person ${Date.now()}`;
out.followupGoal = followupGoal;
out.escalationGoal = escalationGoal;

const filedFollowup = await act(TREE.boardHolder.address, TREE.boardHolder.id, "fileTask", {
  board: TREE.attendedBoard,
  goal: followupGoal,
  assignee: TREE.seatKind,
  author: TREE.author,
});
out.filedFollowup = {
  requestStatus: filedFollowup.requestStatus,
  output: filedFollowup.output,
  error: filedFollowup.error,
};

const filedEscalation = await act(TREE.boardHolder.address, TREE.boardHolder.id, "fileTask", {
  board: TREE.unwiredBoard,
  goal: escalationGoal,
  assignee: TREE.seatKind,
  author: TREE.author,
});
out.filedEscalation = {
  requestStatus: filedEscalation.requestStatus,
  output: filedEscalation.output,
  error: filedEscalation.error,
};

// Handed nothing: no row id, no assignee, no worker name.
const drained = await act(TREE.seatAddress, "s_goal_drain", "drain", {});
out.drained = { requestStatus: drained.requestStatus, error: drained.error };

// ---- what the boards hold now --------------------------------------------
for (const board of TREE.boardHolder.boards) {
  const read = await act(TREE.boardHolder.address, TREE.boardHolder.id, "readBoard", { board });
  out[`board_${board}`] = { requestStatus: read.requestStatus, output: read.output, error: read.error };
}

// ---- storage, under the ids the framework minted --------------------------
// Read straight out of the store rather than through an action: the board's
// own report is generated on the path under test.
{
  const ORG_ID = TREE.orgId;
  const stores = (await flowstate.getRuntime()).stores;
  out.orgId = ORG_ID;

  const filed = filedFollowup.output as { boardId?: string; taskId?: string } | undefined;
  out.followupRowKey =
    filed?.boardId === undefined ? null : `${filed.boardId}/${filed.taskId}`;
  out.followupRowInStorage =
    filed?.boardId === undefined
      ? null
      : ((await stores.resourceState.get(
          "org",
          ORG_ID,
          `${filed.boardId}/${filed.taskId}`,
        )) ?? null);

  // The effect OUTSIDE the board: the note the worker body wrote.
  out.notes =
    filed?.taskId === undefined
      ? null
      : ((await stores.resourceState.get(
          "org",
          ORG_ID,
          `support-followup-notes/${filed.taskId}`,
        )) ?? null);
}

out.ok = true;
console.log("__GOAL__" + JSON.stringify(out));
