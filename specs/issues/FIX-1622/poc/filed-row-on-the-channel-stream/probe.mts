/**
 * FIX-1622 spec POC: does a filed escalation reach an open view of the
 * channel, with no reload, through what already ships?
 *
 * Throwaway, retained as evidence. Nothing is patched. The probe boots
 * kitchen-sink's real `fsdev.config.ts` (roster, routed channel, `escalate`)
 * in test mode, so the model is kitchen-sink's scripted resolver and no key is
 * read, and calls the routes the page calls, in-process, on the in-memory
 * store.
 *
 *   cd apps/kitchen-sink
 *   KITCHEN_SINK_TEST_MODE=1 STORE_TYPE=memory AI_GATEWAY_API_KEY= pnpm exec tsx ../../specs/issues/FIX-1622/poc/filed-row-on-the-channel-stream/probe.mts
 *   KITCHEN_SINK_TEST_MODE=1 STORE_TYPE=memory AI_GATEWAY_API_KEY= GOAL_CONTROL=no-filing pnpm exec tsx ../../specs/issues/FIX-1622/poc/filed-row-on-the-channel-stream/probe.mts
 *
 * Under `GOAL_CONTROL=no-filing` the specialist still says it filed and files
 * nothing: F1 and F4 must go red, and every other check stays green.
 *
 * F6 registers one throwaway flow, in this process only, that writes a row
 * onto the same board from its own session: the boundary this design does not
 * cross (FIX-1506).
 */
import { createClient, createResourceClient, createSessionClient, createSessionSSEClient } from "../../../../../packages/client/src/index.ts";
import { defineFlow, handler } from "../../../../../packages/core/src/index.ts";
import { channelBoard } from "../../../../../packages/workforce/src/index.ts";
import { resolveChannelBoard } from "../../../../../packages/workforce/src/channel/channel-board.ts";
import { z } from "zod";

const { default: flowstate } = await import("../../../../../apps/kitchen-sink/fsdev.config.ts");
const router = await flowstate.getRouter();

const fetcher = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(String(input), "http://kitchen-sink.local");
  const path = url.pathname.replace(/^\/api\/flows\/?/, "").split("/").filter((s) => s.length > 0).map(decodeURIComponent);
  const method = (init?.method ?? "GET").toUpperCase() as "GET" | "POST" | "PATCH" | "DELETE";
  return await router[method](new Request(url, init), { params: { path } });
};

const USER = "devuser";
const CHANNEL = "support.help";
const BOARD = `${CHANNEL}.escalations`;
const CONTROL = process.env.GOAL_CONTROL ?? "";

const sessions = createSessionClient({ fetcher });
const resources = createResourceClient({ fetcher });
const channel = createClient({ flowKind: "channel", userId: USER, fetcher });

let failed = false;
const check = (id: string, ok: boolean, detail: string) => {
  console.log(`${ok ? "PASS" : "FAIL"} ${id} — ${detail}`);
  if (!ok) failed = true;
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const t0 = Date.now();
const at = () => `+${((Date.now() - t0) / 1000).toFixed(1)}s`;

type Seen = { at: number; requestId: string; item: Record<string, unknown> };

/** Open one session stream the way `useSession({ live: true })` does, and keep every item it delivers. */
function follow(sessionId: string, itemTypes?: string[]) {
  const seen: Seen[] = [];
  let runs = 0;
  const handle = createSessionSSEClient({
    sessionId,
    fetcher,
    ...(itemTypes === undefined ? {} : { itemTypes }),
    onItem: ({ requestId, item }) => seen.push({ at: Date.now(), requestId, item: item as unknown as Record<string, unknown> }),
    onRuns: () => {
      runs += 1;
    },
    onStop: ({ status }) => console.log(`  stream on ${sessionId} stopped: ${status}`),
  });
  return { seen, handle, runs: () => runs };
}

// The panel's read session today: the assistant's own, a different session from the writer.
const assistant = await sessions.createSession({ flowKind: "chat-agent", userId: USER });

// Two open views, each following one session: the channel (what a view of the
// board's own channel would follow, filtered to components as a panel would ask)
// and the assistant's session (what the panel reads through today).
const onChannel = follow(CHANNEL, ["component"]);
const onChannelAll = follow(CHANNEL);
const onAssistant = follow(assistant.id);
await sleep(1500);

const token = `case-token-${Math.random().toString(36).slice(2, 10)}`;
const sentAt = Date.now();
console.log(`${at()} post: [route:support.devices] [scenario:needs-a-person] ${token}`);
await channel.sendAction("post", { body: `[route:support.devices] [scenario:needs-a-person] ${token} the charger caught fire` }, { sessionId: CHANNEL });

// When the row is first readable through the board's read, and when the stream first carries it.
let rowKeptAt: number | undefined;
let rowOnStreamAt: number | undefined;
const isFiledChange = (s: Seen) =>
  s.item.type === "component" &&
  s.item.component === "task-change" &&
  (s.item.data as { collectionId?: string } | undefined)?.collectionId === BOARD &&
  JSON.stringify(s.item.data).includes(token);
for (let i = 0; i < 150 && (rowKeptAt === undefined || rowOnStreamAt === undefined); i++) {
  if (rowKeptAt === undefined) {
    const page = await resources.listCollectionItems(CHANNEL, BOARD, {});
    if (JSON.stringify(page.items).includes(token)) rowKeptAt = Date.now();
  }
  if (rowOnStreamAt === undefined) {
    const hit = onChannel.seen.find(isFiledChange);
    if (hit !== undefined) rowOnStreamAt = hit.at;
  }
  await sleep(100);
}
// Let the specialist's line land and a few more reads pass on every stream.
await sleep(4000);

const secs = (ms: number | undefined) => (ms === undefined ? "never" : `+${((ms - sentAt) / 1000).toFixed(1)}s after the post`);
const filed = onChannel.seen.filter(isFiledChange);
const change = filed[0];
const data = change?.item.data as { kind?: string; task?: Record<string, unknown> } | undefined;

// F1 — the filing reaches a view of the channel's own session as a task-change for this board.
check(
  "F1",
  change !== undefined && data?.kind === "added" && data.task?.status === "pending",
  `channel stream (components) carried ${filed.length} task-change for ${BOARD} with the token: ` +
    `kind=${data?.kind} status=${String(data?.task?.status)} request=${change?.requestId}; ` +
    `row readable ${secs(rowKeptAt)}, on the stream ${secs(rowOnStreamAt)}`,
);

// F1b — that request is the channel's own fileTask, in the channel's session.
const requests = (await sessions.listSessionRequests(CHANNEL)) as unknown as Array<{ id: string; actionName?: string; status: string }>;
const writer = requests.find((r) => r.id === change?.requestId);
const summary = writer === undefined ? null : { action: writer.actionName, status: writer.status, session: (writer as { sessionId?: string }).sessionId, source: (writer as { source?: string }).source };
check("F1b", change === undefined || writer?.actionName === "fileTask", `the request that kept it: ${JSON.stringify(summary)}`);

// F2 — the assistant's session, the panel's read session today, hears nothing about it.
// Not vacuous: that stream is open and following (it named the session's runs at least once).
const assistantHits = onAssistant.seen.filter((s) => JSON.stringify(s.item).includes(token) || JSON.stringify(s.item).includes(BOARD));
check(
  "F2",
  assistantHits.length === 0 && onAssistant.runs() >= 1,
  `assistant-session stream, open (${onAssistant.runs()} runs notice(s)), carried ${assistantHits.length} item(s) naming the token or the board (${onAssistant.seen.length} items in all)`,
);

// F3 — no stream carries a resource_change: it is transient, never kept, so a store-read stream cannot carry it.
// F3b — why: the writer's own kept items hold none. (That one is emitted live, on the fileTask request's own
// stream, is docs/architecture/items.md's claim; no browser holds that request's stream.)
const changes = [...onChannelAll.seen, ...onAssistant.seen].filter((s) => s.item.type === "resource_change");
check("F3", changes.length === 0, `resource_change items on any session stream: ${changes.length}`);
const kept = ((writer as { items?: Array<{ type?: string }> } | undefined)?.items ?? []).map((i) => i.type);
check("F3b", change === undefined || !kept.includes("resource_change"), `the fileTask request's kept items: ${JSON.stringify(kept)}`);

// F4 — a re-read through the channel's session returns the row, through the board's browser projection only;
// the assistant's session reads the same row (same organization).
const viaChannel = (await resources.listCollectionItems(CHANNEL, BOARD, {})).items.filter((r) => JSON.stringify(r).includes(token));
const viaAssistant = (await resources.listCollectionItems(assistant.id, BOARD, {})).items.filter((r) => JSON.stringify(r).includes(token));
const fields = Object.keys((viaChannel[0]?.clientData ?? {}) as object).sort();
check(
  "F4",
  viaChannel.length === 1 && viaAssistant.length === 1 && !fields.includes("metadata") && !fields.includes("input"),
  `rows with the token: via channel ${viaChannel.length}, via assistant ${viaAssistant.length}; fields read: ${fields.join(",")}`,
);

// F6 — the boundary: a row written onto the same board by a request in ANOTHER session (a stand-in for
// whoever might one day work the board from their own session) is readable, and never reaches the
// channel's view. This is the cross-session delivery FIX-1506 tracks.
const board = channelBoard(CHANNEL, "escalations");
const otherWriter = defineFlow({
  kind: "poc-other-writer",
  resources: { [board.id]: board },
  actions: {
    write: {
      block: handler({
        name: "poc-other-write",
        inputSchema: z.object({ goal: z.string() }),
        outputSchema: z.object({ taskId: z.string() }),
        execute: async (input: { goal: string }, ctx) => {
          const ledger = await resolveChannelBoard(ctx as never, board.id);
          const task = await ledger!.addTask({ goal: input.goal });
          return { taskId: task.id };
        },
      }),
    },
  },
})();
flowstate.register(otherWriter);
const elsewhere = await sessions.createSession({ flowKind: "poc-other-writer", userId: USER });
const otherToken = `other-token-${Math.random().toString(36).slice(2, 10)}`;
const other = createClient({ flowKind: "poc-other-writer", userId: USER, fetcher });
// Not vacuous: the writer's own session does keep the change, as the channel's does for a filing.
const onElsewhere = follow(elsewhere.id, ["component"]);
await sleep(1500);
await other.sendAction("write", { goal: `Written elsewhere: ${otherToken}` }, { sessionId: elsewhere.id });
await sleep(4000);
const otherRead = (await resources.listCollectionItems(CHANNEL, BOARD, {})).items.filter((r) => JSON.stringify(r).includes(otherToken));
const otherOnChannel = onChannelAll.seen.filter((s) => JSON.stringify(s.item).includes(otherToken));
const otherOnWriter = onElsewhere.seen.filter((s) => s.item.component === "task-change" && JSON.stringify(s.item).includes(otherToken));
onElsewhere.handle.close();
check(
  "F6",
  otherRead.length === 1 && otherOnChannel.length === 0 && otherOnWriter.length === 1,
  `a row written from another session: readable through the channel ${otherRead.length}; its task-change on the ` +
    `writer's own stream ${otherOnWriter.length}, on the channel's stream ${otherOnChannel.length} (4 s later)`,
);

// F5 — what the change item itself carries (recorded, not graded against a design): wider than the read.
const carried = Object.keys((data?.task ?? {}) as object).sort();
console.log(`INFO F5 — the task-change item carries: ${carried.join(",")}`);
console.log(
  `INFO — channel stream (components): ${onChannel.seen.length} items (${[...new Set(onChannel.seen.map((s) => String(s.item.component)))].join(", ")}); ` +
    `channel stream (all): ${onChannelAll.seen.length} items; runs notices on the channel: ${onChannel.runs()}`,
);
const lines = onChannel.seen.filter((s) => s.item.component === "channel-post").map((s) => (s.item.data as { author?: string; body?: string }));
console.log(`INFO — channel lines streamed: ${JSON.stringify(lines.map((l) => [l.author ?? "(person)", (l.body ?? "").slice(0, 60)]))}`);

onChannel.handle.close();
onChannelAll.handle.close();
onAssistant.handle.close();
await flowstate.dispose();
console.log(`control=${CONTROL || "none"} exit=${failed ? 1 : 0}`);
process.exit(failed ? 1 : 0);
