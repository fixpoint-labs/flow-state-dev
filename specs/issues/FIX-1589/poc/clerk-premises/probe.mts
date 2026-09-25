/**
 * FIX-1589 spec POC: does the clerk shape in SPEC.md work on kitchen-sink's
 * real wiring, keyless, on the scripted model?
 *
 * Throwaway and retained as evidence only. Nothing under `specs/` is built,
 * tested or walked by `fsdev gen`.
 *
 * Boots kitchen-sink's own `fsdev.config.ts` in test mode (the scripted model)
 * and calls the same HTTP routes the page calls, in-process:
 *
 *   cd apps/kitchen-sink
 *   git apply ../../specs/issues/FIX-1589/poc/clerk-premises/clerk.patch
 *   KITCHEN_SINK_TEST_MODE=1 pnpm exec tsx ../../specs/issues/FIX-1589/poc/clerk-premises/probe.mts
 *   git apply -R ../../specs/issues/FIX-1589/poc/clerk-premises/clerk.patch
 *
 * Without the patch (today's echo) Q1 and Q2 must FAIL: that is the control.
 */
process.env.KITCHEN_SINK_TEST_MODE = "1";

const warnings: string[] = [];
const warn = console.warn;
console.warn = (...args: unknown[]) => {
  warnings.push(args.map(String).join(" "));
  warn(...args);
};

const { createClient, createSessionClient, createResourceClient } = await import(
  "../../../../../packages/client/src/index.ts"
);
const { default: flowstate } = await import("../../../../../apps/kitchen-sink/fsdev.config.ts");

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
const resources = createResourceClient({ fetcher });
const ada = createClient({ flowKind: "support.ada", userId: USER, fetcher });

let failed = false;
function check(id: string, ok: boolean, detail: string) {
  console.log(`${ok ? "PASS" : "FAIL"} ${id} — ${detail}`);
  if (!ok) failed = true;
}
const text = (v: unknown) => JSON.stringify(v) ?? "undefined";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function ask(note: string) {
  const seat = await sessions.createSession({ flowKind: "support.ada", userId: USER });
  await ada.sendAction("answer", { note }, { sessionId: seat.id });
  let messages: Array<{ text: string; role: string }> = [];
  for (let i = 0; i < 40; i++) {
    const snap = await sessions.getSessionState(seat.id, { includeItems: true });
    const items = (snap.items ?? []) as Array<{ type: string; role?: string }>;
    messages = items
      .filter((it) => it.type === "message")
      .map((it) => ({ text: text(it), role: String(it.role) }));
    if (messages.some((m) => m.role === "assistant" && !m.text.includes('"status":"in_progress"'))) break;
    await sleep(150);
  }
  return { seat, messages };
}

const token = () => `clerk-token-${Math.random().toString(36).slice(2, 10)}`;

// Q1: a note gets a reply a model wrote, not the note handed back.
const t1 = token();
const note1 = `[scenario:clerk-answer] ${t1} where is my refund?`;
const a1 = await ask(note1);
const assistant = a1.messages.filter((m) => m.role === "assistant");
const replied = assistant.some((m) => m.text.includes("[clerk:answered]"));
const echoed = assistant.some((m) => m.text.includes(t1));
const said = (m: { text: string }) => /"(?:text|content)":"([^"]*)"/.exec(m.text)?.[1] ?? m.text.slice(0, 120);
check("Q1", replied && !echoed, `assistant said: ${assistant.map(said).join(" | ")}; carries the note's token: ${echoed}`);

// Q7: the reply carries the seat's desk tag from its own WORKER.md (ada: front).
check("Q7", assistant.some((m) => m.text.includes("[front desk] [clerk:answered]")), `desk tag then the model's words: ${assistant.some((m) => m.text.includes("[front desk] [clerk:answered]"))}`);

// Q6: the person's note is kept in the seat's conversation as their own turn.
const kept = a1.messages.some((m) => m.role === "user" && m.text.includes(t1));
check("Q6", kept, `user turns: ${a1.messages.filter((m) => m.role === "user").map(said).join(" | ") || "(none)"}`);

// Q2: a note the clerk files lands as a row on support.desk's escalations board,
// through the channel's own fileTask, authored as the seat.
const t2 = token();
const a2 = await ask(`[scenario:clerk-file] ${t2} the charger caught fire`);
let row: unknown;
let rows: unknown[] = [];
for (let i = 0; i < 40 && row === undefined; i++) {
  const page = await resources.listCollectionItems("support.desk", "support.desk.escalations", {});
  rows = ((page as { items?: unknown[] }).items ?? []) as unknown[];
  row = rows.find((r) => text(r).includes(t2));
  if (row === undefined) await sleep(150);
}
const saidFiled = a2.messages.some((m) => m.text.includes("[clerk:filed]"));
check("Q2", row !== undefined && saidFiled, `row: ${text(row).slice(0, 300)}; reply filed=${saidFiled}; rows on board=${rows.length}`);

// Q3: the row names the clerk seat as author (unverified claim), set by the kind, not the model.
const fileReqsForT2 = ((await sessions.listSessionRequests("support.desk")) as unknown as unknown[]).filter((r) =>
  text(r).includes(t2),
);
const authored = fileReqsForT2.some((r) => text(r).includes('\\"author\\":\\"support.ada\\"') || text(r).includes('"author":"support.ada"'));
check("Q3", authored, `fileTask request for the token names author support.ada: ${authored} (${fileReqsForT2.length} request(s))`);

// Q4: the boot still warns that escalations is unattended (filing is not attending).
const unattended = warnings.some((w) => w.includes('board "escalations"'));
check("Q4", unattended, `boot warnings mentioning escalations: ${unattended}`);

// Q5: the requests on support.desk include the fileTask the clerk dispatched.
const reqs = (await sessions.listSessionRequests("support.desk")) as unknown as Array<{ action?: string; status: string }>;
const fileReqs = reqs.filter((r) => text(r).includes("fileTask"));
check("Q5", fileReqs.length > 0, `fileTask requests on support.desk: ${fileReqs.map((r) => r.status).join(",")}`);

process.exit(failed ? 1 : 0);
