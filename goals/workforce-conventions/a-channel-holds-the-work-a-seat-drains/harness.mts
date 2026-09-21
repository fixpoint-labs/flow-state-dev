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
const USER_ID = process.env.GOAL_USER_ID ?? "kitchen-sink";
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
  for (const id of ["support.desk", "support.ada-dm", "support.noticeboard"]) {
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
): Promise<{ status: number; body: any }> {
  const req = new Request("http://goal/api/flows/" + segs.join("/"), {
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
const deskRead = await act("channel", "support.desk", "read", {});
out.deskRead = { requestStatus: deskRead.requestStatus, output: deskRead.output, error: deskRead.error };

// ---- each channel's session, as the route hands it back -------------------
const sessions: Record<string, unknown> = {};
for (const id of ["support.desk", "support.ada-dm", "support.noticeboard"]) {
  const res = await call("GET", ["sessions", id]);
  sessions[id] = res.status >= 400 ? { error: res.body, status: res.status } : res.body?.session;
}
out.sessions = sessions;

// ---- file one row on each board, then drain -------------------------------
const followupGoal = `chase the printer quote ${Date.now()}`;
const escalationGoal = `the refund needs a person ${Date.now()}`;
out.followupGoal = followupGoal;
out.escalationGoal = escalationGoal;

const filedFollowup = await act("channel", "support.desk", "fileTask", {
  board: "followups",
  goal: followupGoal,
  assignee: "followup-runner",
  author: "support.ada",
});
out.filedFollowup = {
  requestStatus: filedFollowup.requestStatus,
  output: filedFollowup.output,
  error: filedFollowup.error,
};

const filedEscalation = await act("channel", "support.desk", "fileTask", {
  board: "escalations",
  goal: escalationGoal,
  assignee: "followup-runner",
  author: "support.ada",
});
out.filedEscalation = {
  requestStatus: filedEscalation.requestStatus,
  output: filedEscalation.output,
  error: filedEscalation.error,
};

// Handed nothing: no row id, no assignee, no worker name.
const drained = await act("support.wren", "s_goal_wren", "drain", {});
out.drained = { requestStatus: drained.requestStatus, error: drained.error };

// ---- what the boards hold now --------------------------------------------
for (const board of ["followups", "escalations"]) {
  const read = await act("channel", "support.desk", "readBoard", { board });
  out[`board_${board}`] = { requestStatus: read.requestStatus, output: read.output, error: read.error };
}

// ---- storage, under the ids the framework minted --------------------------
// Read straight out of the store rather than through an action: the board's
// own report is generated on the path under test.
{
  const { DEFAULT_ORG_ID } = await import("@flow-state-dev/core");
  const stores = (await flowstate.getRuntime()).stores;
  out.orgId = DEFAULT_ORG_ID;

  const filed = filedFollowup.output as { boardId?: string; taskId?: string } | undefined;
  out.followupRowKey =
    filed?.boardId === undefined ? null : `${filed.boardId}/${filed.taskId}`;
  out.followupRowInStorage =
    filed?.boardId === undefined
      ? null
      : ((await stores.resourceState.get(
          "org",
          DEFAULT_ORG_ID,
          `${filed.boardId}/${filed.taskId}`,
        )) ?? null);

  // The effect OUTSIDE the board: the note the worker body wrote.
  out.notes =
    filed?.taskId === undefined
      ? null
      : ((await stores.resourceState.get(
          "org",
          DEFAULT_ORG_ID,
          `support-followup-notes/${filed.taskId}`,
        )) ?? null);
}

out.ok = true;
console.log("__GOAL__" + JSON.stringify(out));
