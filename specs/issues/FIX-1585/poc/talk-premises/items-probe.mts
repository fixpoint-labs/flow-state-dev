/**
 * FIX-1585 settle-claim POC — does a channel's transcript hold up when it is
 * rebuilt from the posts' own durable items instead of a `pushState` copy in
 * session state?
 *
 * Needs the "C" patch applied first (temporary, see the two PATCH comments in
 * `packages/workforce/src/channel/channel-flow.ts`): `appendPost` emits
 * `ctx.emit.component("channel-post", line)` instead of
 * `ctx.session.pushState("transcript", line)`, and `readChannelFor` rebuilds
 * the transcript from `ctx.session.items.all({ itemTypes: ["component"] })`
 * filtered to `component === "channel-post"`, appended after any legacy
 * `state.transcript` lines, deduped by id.
 *
 * Without the patch (control / on main): P9 and P11 must go red — there is no
 * `channel-post` component item, and `read`'s transcript comes only from
 * `state.transcript`, so a legacy-only line seeded directly is never joined
 * by a posted one.
 *
 * The client's `sendAction` response carries no `output` field (see
 * `ExecuteActionResponse`), so reading what `read` actually returned goes
 * through the request's own `block_trace` item (`item_types=block_trace`
 * bypasses the client-visibility filter that would otherwise hide it) rather
 * than the action-call response.
 *
 *   cd apps/kitchen-sink && pnpm exec tsx ../../specs/issues/FIX-1585/poc/talk-premises/items-probe.mts
 */
import { createClient, createSessionClient } from "../../../../../packages/client/src/index.ts";
import flowstate from "../../../../../apps/kitchen-sink/fsdev.config.ts";

const fetcher = async (input: RequestInfo | URL, init?: RequestInit) => {
  const router = await flowstate.getRouter();
  const url = new URL(String(input), "http://kitchen-sink.local");
  const path = url.pathname
    .replace(/^\/api\/flows\/?/, "")
    .split("/")
    .filter((s) => s.length > 0)
    .map(decodeURIComponent);
  const method = (init?.method ?? "GET").toUpperCase() as "GET" | "POST" | "PATCH" | "DELETE";
  return await router[method](new Request(url, init), { params: { path } });
};

const USER = "devuser";
const sessions = createSessionClient({ fetcher });
const channel = createClient({ flowKind: "channel", userId: USER, fetcher });

let failed = false;
function check(id: string, ok: boolean, detail: string) {
  console.log(`${ok ? "PASS" : "FAIL"} ${id} — ${detail}`);
  if (!ok) failed = true;
}
const text = (x: unknown) => JSON.stringify(x) ?? "undefined";
const marker = `fix-1585-items-${Date.now()}`;

/**
 * Call `read` and return what it actually returned, by polling the request's
 * own `channel-read` block_trace item (the action-call response itself
 * carries no output — see the header).
 */
async function readTranscript(
  sessionId: string
): Promise<{ transcript: Array<{ id: string; body: string; principal?: string }>; requestId: string }> {
  const res = await channel.sendAction("read", {}, { sessionId });
  const requestId = (res as { request?: { id: string } }).request?.id;
  if (requestId === undefined) throw new Error(`read: no request id in ${text(res)}`);
  for (let attempt = 0; attempt < 25; attempt++) {
    // The state route's default items limit (100) is well below the block_trace
    // count a long-running channel session accumulates (each post + its
    // "onPosted" fan-out emits several); a large explicit limit avoids the
    // target trace being paginated out.
    const snap = await sessions.getSessionState(sessionId, {
      includeItems: true,
      itemTypes: ["block_trace"],
      limit: 5000
    });
    const items = ((snap as { items?: unknown[] }).items ?? []) as Array<{
      requestId: string;
      blockName?: string;
      status?: string;
      output?: { kind: string; value?: unknown };
    }>;
    const trace = items.find((i) => i.requestId === requestId && i.blockName === "channel-read");
    if (trace !== undefined && trace.status === "completed") {
      const value =
        trace.output?.kind === "inline" ? (trace.output.value as { transcript?: unknown[] }) : undefined;
      return { transcript: (value?.transcript ?? []) as never, requestId };
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`read (request ${requestId}) did not complete in time`);
}

// ---------------------------------------------------------------------------
// P9 — a browser-style post (no author) leaves exactly one durable component
// item "channel-post", client-visible, whose data carries body/principal/
// authorVerified/id/at. Read via the same state route `useSession` uses
// (`include_items=true`), where items come back as raw OutputItems —
// `component`/`data` at the top level, not wrapped.
// ---------------------------------------------------------------------------
await channel.sendAction("post", { body: marker }, { sessionId: "support.desk" });

let componentItems: Array<{ component?: string; data?: Record<string, unknown> }> = [];
for (let i = 0; i < 25; i++) {
  const snap = await sessions.getSessionState("support.desk", {
    includeItems: true,
    itemTypes: ["component"]
  });
  componentItems = ((snap as { items?: unknown[] }).items ?? []) as typeof componentItems;
  if (componentItems.some((it) => text(it).includes(marker))) break;
  await new Promise((r) => setTimeout(r, 200));
}
const matches = componentItems.filter((it) => text(it).includes(marker));
const data = matches[0]?.data;
check(
  "P9",
  matches.length === 1 &&
    matches[0]?.component === "channel-post" &&
    data?.body === marker &&
    data?.principal === USER &&
    data?.authorVerified === false &&
    typeof data?.id === "string" &&
    typeof data?.at === "number",
  `component items matching marker: ${matches.length}; first: ${text(matches[0]).slice(0, 300)}`
);

// ---------------------------------------------------------------------------
// P10 — a refused post (author "devuser", not a member) leaves no
// "channel-post" item for it.
// ---------------------------------------------------------------------------
const refusedMarker = `${marker}-refused`;
let refusedRequestId: string | undefined;
let refusal = "";
try {
  const res = await channel.sendAction(
    "post",
    { body: refusedMarker, author: USER },
    { sessionId: "support.desk" }
  );
  refusedRequestId = (res as { request?: { id: string } }).request?.id;
} catch (e) {
  refusal = String(e);
}
let refusedStatus = "unknown";
for (let attempt = 0; attempt < 25 && refusedRequestId !== undefined; attempt++) {
  const requests = await sessions.listSessionRequests("support.desk");
  const found = (requests as unknown as Array<{ id: string; status: string; error?: unknown }>).find(
    (r) => r.id === refusedRequestId
  );
  refusedStatus = found?.status ?? "unlisted";
  if (found !== undefined && found.status !== "in_progress") {
    refusal = refusal || text(found.error ?? found);
    break;
  }
  await new Promise((r) => setTimeout(r, 200));
}
const afterRefusalSnap = await sessions.getSessionState("support.desk", {
  includeItems: true,
  itemTypes: ["component"]
});
const afterRefusalItems = ((afterRefusalSnap as { items?: unknown[] }).items ?? []) as unknown[];
const leakedItem = afterRefusalItems.some((it) => text(it).includes(refusedMarker));
check(
  "P10",
  !leakedItem && refusedStatus === "failed" && refusal.includes("author-not-a-member"),
  `no channel-post item for refused body; request ${refusedStatus}; ${refusal.slice(0, 160)}`
);

// ---------------------------------------------------------------------------
// P11 — `read` rebuilds the transcript from items (includes the posted
// line), and a legacy line seeded directly into `state.transcript` (a direct
// store write — the simplest way to plant one without the old `pushState`
// code path) is still returned, first (dual-read).
// ---------------------------------------------------------------------------
const legacyMarker = `${marker}-legacy`;
const runtime = await flowstate.getRuntime();
const sessionKey = "support.desk";
const before = await runtime.stores.session.get(sessionKey);
if (before === undefined) {
  check("P11", false, `no session record at "${sessionKey}" to seed a legacy line into`);
} else {
  const legacyLine = {
    id: crypto.randomUUID(),
    at: Date.now(),
    principal: USER,
    authorVerified: false as const,
    body: legacyMarker
  };
  const state = before.state as { transcript?: unknown[] };
  const nextState = { ...before.state, transcript: [...(state.transcript ?? []), legacyLine] };
  const setResult = await runtime.stores.session.set(
    sessionKey,
    { ...before, state: nextState },
    before.version
  );
  if (!setResult.ok) {
    check("P11", false, `direct seed write lost the CAS race: ${text(setResult)}`);
  } else {
    const { transcript } = await readTranscript(sessionKey);
    const legacyIdx = transcript.findIndex((l) => l.body === legacyMarker);
    const postedIdx = transcript.findIndex((l) => l.body === marker);
    check(
      "P11",
      legacyIdx === 0 && postedIdx > legacyIdx,
      `legacy line at index ${legacyIdx}, posted line at index ${postedIdx}, transcript length ${transcript.length}`
    );
  }
}

// ---------------------------------------------------------------------------
// P12 — how many of 30 posts does `read`'s rebuilt transcript still carry,
// with the notify fan-out wired (kitchen-sink wires notify, so each post also
// fires a separate "onPosted" request on the SAME channel session)? This
// settles whether fan-out requests count against the 50-turn historyWindow
// that `ctx.session.items.all()` — and so the `read` action itself — is
// windowed by. No assertion on the number; report it.
// ---------------------------------------------------------------------------
const p12Prefix = `fix-1585-p12-${Date.now()}-`;
const N = 30;
for (let i = 0; i < N; i++) {
  await channel.sendAction("post", { body: `${p12Prefix}${i}` }, { sessionId: "support.desk" });
}
// Let the fan-out hand-offs (separate "onPosted" requests on this same
// session) settle before reading, so the count reflects the steady state
// rather than a race with in-flight dispatches.
await new Promise((r) => setTimeout(r, 1500));
const { transcript: p12Transcript } = await readTranscript("support.desk");
const survivingCount = p12Transcript.filter((l) => l.body.startsWith(p12Prefix)).length;
const requests = await sessions.listSessionRequests("support.desk");
const totalRequests = (requests as unknown[]).length;
console.log(
  `P12 — posted ${N}, read back ${survivingCount}/${N} via items.all(); ` +
    `all 30 present: ${survivingCount === N}; total requests now on session: ${totalRequests}`
);

await flowstate.dispose();
process.exit(failed ? 1 : 0);
