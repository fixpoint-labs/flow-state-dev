/**
 * FIX-1590 POC — can a channel post run each member agent seat once, keyless,
 * through an internal receiver on the agent kind, and does a seat-authored
 * post wake nobody?
 *
 * Boots kitchen-sink's real `fsdev.config.ts` (roster, channel boot, test-mode
 * resolver) and calls the same HTTP routes the page calls, in-process, on the
 * dev (in-memory) profile. Needs `wake.patch` applied (see README.md).
 *
 *   cd apps/kitchen-sink
 *   KITCHEN_SINK_TEST_MODE=1 pnpm exec tsx ../../specs/issues/FIX-1590/poc/wake-premises/probe.mts
 *   KITCHEN_SINK_TEST_MODE=1 POC_STUB=1 pnpm exec tsx …/probe.mts      # control: name-only stub, must FAIL W1, W3, W4, W6
 *   KITCHEN_SINK_TEST_MODE=1 POC_NO_FILTER=1 pnpm exec tsx …/probe.mts # control: no author filter, must FAIL W5
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
const SEATS = ["support.ada", "support.grace", "support.iris", "support.otto", "support.wren"];
const AGENTS = ["support.iris", "support.otto"];

let failed = false;
function check(id: string, ok: boolean, detail: string) {
  console.log(`${ok ? "PASS" : "FAIL"} ${id} — ${detail}`);
  if (!ok) failed = true;
}
const text = (x: unknown) => JSON.stringify(x) ?? "undefined";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Every item in every session of a seat (dispatch runs included) that mentions `token`. */
async function heard(seat: string, token: string) {
  const listed = await sessions.listSessions({ flowId: seat, userId: USER, include: "dispatch-runs", limit: 50 });
  const rows = (listed as { sessions?: unknown[] }).sessions ?? (listed as unknown[]);
  const out: Array<{ sessionId: string; parent?: string; items: Array<{ type?: string; role?: string; text: string }> }> = [];
  for (const row of rows as Array<{ id: string; parentSessionId?: string | null }>) {
    const snap = await sessions.getSessionState(row.id, { includeItems: true, limit: 500 });
    const items = ((snap as { items?: unknown[] }).items ?? []) as Array<Record<string, unknown>>;
    const hits = items
      .filter((it) => it.type === "message")
      .map((it) => ({ type: it.type as string, role: it.role as string, text: text(it) }));
    const mentions = hits.filter((h) => h.text.includes(token));
    if (mentions.length > 0) out.push({ sessionId: row.id, parent: row.parentSessionId ?? undefined, items: hits });
  }
  return out;
}

async function settle(token: string, want: (seat: string) => boolean) {
  const result = new Map<string, Awaited<ReturnType<typeof heard>>>();
  for (let attempt = 0; attempt < 40; attempt++) {
    for (const seat of SEATS) result.set(seat, await heard(seat, token));
    const done = SEATS.every((seat) => !want(seat) || (result.get(seat) ?? []).some((s) => s.items.some((i) => i.role === "assistant" && i.text.includes("heard it"))));
    if (done && attempt > 4) break;
    await sleep(250);
  }
  return result;
}

// W1–W3: a post with no author runs each member agent seat once, and only them.
const token = `[scenario:wake] fix-1590-${Date.now()}`;
await channel.sendAction("post", { body: token }, { sessionId: "support.desk" });
const woke = await settle(token, (seat) => AGENTS.includes(seat));
for (const seat of AGENTS) {
  const convs = woke.get(seat) ?? [];
  const userTurns = convs.flatMap((c) => c.items.filter((i) => i.role === "user" && i.text.includes(token)));
  const replies = convs.flatMap((c) => c.items.filter((i) => i.role === "assistant" && i.text.includes("heard it")));
  check(`W1 ${seat}`, convs.length === 1 && userTurns.length === 1 && replies.length === 1,
    `conversations=${convs.length} userTurnsWithToken=${userTurns.length} scriptedReplies=${replies.length} parent=${convs[0]?.parent}`);
}
const others = SEATS.filter((s) => !AGENTS.includes(s));
check("W2 no other seat", others.every((s) => (woke.get(s) ?? []).length === 0),
  others.map((s) => `${s}=${(woke.get(s) ?? []).length}`).join(" "));
const ottoSession = woke.get("support.otto")?.[0]?.sessionId;
check("W3 listed as a dispatch run of the channel", woke.get("support.otto")?.[0]?.parent === "support.desk" || String(woke.get("support.otto")?.[0]?.parent ?? "").endsWith("support.desk"),
  `parent=${woke.get("support.otto")?.[0]?.parent}`);

// W6: the page's ordinary listing (no dispatch runs) does not show the run.
const plain = await sessions.listSessions({ flowId: "support.otto", userId: USER, limit: 50 });
const plainRows = ((plain as { sessions?: unknown[] }).sessions ?? (plain as unknown[])) as Array<{ id: string }>;
check("W6 hidden without include=dispatch-runs", ottoSession !== undefined && !plainRows.some((r) => r.id === ottoSession),
  `plainListing=${plainRows.length} containsRun=${plainRows.some((r) => r.id === ottoSession)}`);

// W4: a second post lands in the same conversation (one per seat per channel).
const token2 = `[scenario:wake] fix-1590-second-${Date.now()}`;
await channel.sendAction("post", { body: token2 }, { sessionId: "support.desk" });
const woke2 = await settle(token2, (seat) => AGENTS.includes(seat));
check("W4 same conversation", woke2.get("support.otto")?.[0]?.sessionId === ottoSession && ottoSession !== undefined,
  `first=${ottoSession} second=${woke2.get("support.otto")?.[0]?.sessionId}`);

// W5: a post a seat wrote wakes no seat.
const token3 = `[scenario:wake] fix-1590-seat-authored-${Date.now()}`;
await channel.sendAction("post", { body: token3, author: "support.otto" }, { sessionId: "support.desk" });
await sleep(4000);
const woke3 = new Map<string, Awaited<ReturnType<typeof heard>>>();
for (const seat of SEATS) woke3.set(seat, await heard(seat, token3));
check("W5 seat-authored post wakes nobody", SEATS.every((s) => (woke3.get(s) ?? []).length === 0),
  SEATS.map((s) => `${s}=${(woke3.get(s) ?? []).length}`).join(" "));

console.log(failed ? "RESULT: FAIL" : "RESULT: PASS");
process.exit(failed ? 1 : 0);
