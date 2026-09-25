/**
 * FIX-1594 spec POC — can an agent seat, driven by kitchen-sink's scripted
 * (keyless) model, post into a channel it belongs to, as itself?
 *
 * Throwaway, retained as evidence. Boots kitchen-sink's real `fsdev.config.ts`
 * (roster, channel boot, host principal) in test mode, with `wiring.patch`
 * applied, and calls the same HTTP routes the page calls, in-process.
 *
 *   git apply specs/issues/FIX-1594/poc/seat-posts/wiring.patch
 *   cd apps/kitchen-sink
 *   KITCHEN_SINK_TEST_MODE=1 pnpm exec tsx ../../specs/issues/FIX-1594/poc/seat-posts/probe.mts
 *   KITCHEN_SINK_TEST_MODE=1 NEGATIVE=1 pnpm exec tsx ../../specs/issues/FIX-1594/poc/seat-posts/probe.mts
 *   cd ../.. && git apply -R specs/issues/FIX-1594/poc/seat-posts/wiring.patch
 *
 * NEGATIVE=1 makes the tool drop the author; P1 and P2 must go red.
 */
import { createClient, createSessionClient } from "../../../../../packages/client/src/index.ts";

const g = globalThis as { __pocOttoSession?: string; __pocDropAuthor?: boolean };
if (process.env.NEGATIVE === "1") g.__pocDropAuthor = true;

const { default: flowstate } = await import("../../../../../apps/kitchen-sink/fsdev.config.ts");

const fetcher = async (input: RequestInfo | URL, init?: RequestInit) => {
  const router = await flowstate.getRouter();
  const url = new URL(String(input), "http://kitchen-sink.local");
  const path = url.pathname.replace(/^\/api\/flows\/?/, "").split("/").filter((s) => s.length > 0).map(decodeURIComponent);
  const method = (init?.method ?? "GET").toUpperCase() as "GET" | "POST" | "PATCH" | "DELETE";
  return await router[method](new Request(url, init), { params: { path } });
};

const USER = "devuser";
const sessions = createSessionClient({ fetcher });
const channel = createClient({ flowKind: "channel", userId: USER, fetcher });
const otto = createClient({ flowKind: "support.otto", userId: USER, fetcher });
const iris = createClient({ flowKind: "support.iris", userId: USER, fetcher });

let failed = false;
const check = (id: string, ok: boolean, detail: string) => {
  console.log(`${ok ? "PASS" : "FAIL"} ${id} — ${detail}`);
  if (!ok) failed = true;
};
const text = (v: unknown) => JSON.stringify(v) ?? "undefined";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
type Line = { body: string; author?: string; principal?: string };
const lines = async (id: string): Promise<Line[]> =>
  (((await sessions.getSession(id)).state as { transcript?: Line[] }).transcript ?? []);
const waitFor = async <T,>(read: () => Promise<T | undefined>, tries = 40): Promise<T | undefined> => {
  for (let i = 0; i < tries; i++) {
    const v = await read();
    if (v !== undefined) return v;
    await sleep(150);
  }
  return undefined;
};
const requestsOn = async (id: string) =>
  (await sessions.listSessionRequests(id)) as unknown as Array<{ id: string; actionName: string; source?: string; status: string }>;

// P1 — talked to directly, the scripted model's tool call lands a line in support.desk, authored support.otto.
const ottoSession = await sessions.createSession({ flowKind: "support.otto", userId: USER });
const before1 = (await lines("support.desk")).length;
await otto.sendAction("run", { message: `[poc:reply support.desk] direct ${Date.now()}` }, { sessionId: ottoSession.id });
const p1 = await waitFor(async () => (await lines("support.desk")).slice(before1).find((l) => l.body.includes("poc:reply-line")));
check("P1", p1?.author === "support.otto" && p1?.principal === USER, `new support.desk line: ${text(p1)}`);

// P2 — woken by a person's post (stand-in receiver), the same tool call lands a line authored support.otto,
// and that line wakes otto no second time (the fan-out reads the author).
g.__pocOttoSession = ottoSession.id;
const ottoRunsBefore = new Set((await requestsOn(ottoSession.id)).map((r) => r.id));
const before2 = (await lines("support.desk")).length;
await channel.sendAction("post", { body: `[poc:reply support.desk] woken ${Date.now()}` }, { sessionId: "support.desk" });
const p2 = await waitFor(async () => (await lines("support.desk")).slice(before2).find((l) => l.body.includes("poc:reply-line")));
await sleep(1500);
const ottoRuns = (await requestsOn(ottoSession.id)).filter((r) => !ottoRunsBefore.has(r.id));
check(
  "P2",
  p2?.author === "support.otto" && ottoRuns.length === 1 && ottoRuns[0]?.actionName === "receive",
  `woken line: ${text(p2)}; otto requests after the post: ${text(ottoRuns.map((r) => ({ a: r.actionName, s: r.source, st: r.status })))}`,
);
g.__pocOttoSession = undefined;

// P3 — the model cannot name the author: an `author` argument is refused by the tool's closed input.
const before3 = (await lines("support.desk")).length;
const s3 = await sessions.createSession({ flowKind: "support.otto", userId: USER });
await otto.sendAction("run", { message: `[poc:reply support.desk][poc:forge] ${Date.now()}` }, { sessionId: s3.id });
await sleep(2000);
const after3 = (await lines("support.desk")).slice(before3);
const req3 = (await requestsOn(s3.id)).at(-1);
check("P3", after3.every((l) => l.author !== "support.iris"), `lines written: ${text(after3)}; otto's turn: ${req3?.status}`);

// P4 — a channel otto is not a member of refuses the post; nothing is appended there.
const before4 = (await lines("support.ada-wren")).length;
const s4 = await sessions.createSession({ flowKind: "support.otto", userId: USER });
await otto.sendAction("run", { message: `[poc:reply support.ada-wren] ${Date.now()}` }, { sessionId: s4.id });
await sleep(2000);
const after4 = (await lines("support.ada-wren")).slice(before4);
const req4 = (await requestsOn(s4.id)).at(-1);
const channelReqs = (await requestsOn("support.ada-wren")) as unknown as Array<{ actionName: string; status: string; error?: unknown }>;
const refusal4 = channelReqs.map(text).find((t) => t.includes("author-not-a-member") && t.includes("support.otto"));
const snap4 = await sessions.getSessionState(s4.id, { includeItems: true });
const seenByTurn = ((snap4.items ?? []) as unknown[]).map(text).some((t) => t.includes("author-not-a-member"));
check(
  "P4",
  after4.length === 0 && refusal4 !== undefined,
  `ada-wren lines: ${after4.length}; refused on the channel's own request: ${refusal4 !== undefined}; ` +
    `otto's turn: ${req4?.status}, and the turn saw the refusal: ${seenByTurn} (dispatch is fire-and-forget)`,
);

// P5 — a seat whose tools: does not name it (iris) makes the same scripted call and nothing is posted.
const before5 = (await lines("support.desk")).length;
const s5 = await sessions.createSession({ flowKind: "support.iris", userId: USER });
await iris.sendAction("run", { message: `[poc:reply support.desk] iris ${Date.now()}` }, { sessionId: s5.id });
await sleep(2000);
const after5 = (await lines("support.desk")).slice(before5);
check("P5", after5.length === 0, `support.desk lines after iris's turn: ${after5.length}`);

await flowstate.dispose();
console.log(`exit=${failed ? 1 : 0}`);
process.exit(failed ? 1 : 0);
