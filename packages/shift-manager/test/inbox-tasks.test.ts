/**
 * What Inbox and Tasks derive for design v2's content: the
 * ask session's last tool calls before the ask (BR-18) and the user's
 * replies after it, the empty Inbox's sentence (BR-19), and Tasks' TIME,
 * queued count and summary line (BR-14).
 *
 * Each is graded against items and rows built the way the Lab stores them,
 * in an order the store would not return them in, so a derivation that leans
 * on the read's order fails here.
 */
import { describe, expect, it } from "vitest";
import type { OutputItem } from "@flow-state-dev/core/items";
import { askSessionOf } from "../src/lib/ask-session";
import { elapsed, emptyInboxSentence, isQueued, tasksSummary } from "../src/lib/tasks";
import { inboxItemAt, type LoadedSnapshot } from "../src/lib/derive";
import { inboxSection, type Ask, type BoardRow, type Worker } from "../src/lib/reads";

let index = 0;
function item(fields: Record<string, unknown>): OutputItem {
  index += 1;
  return { id: `i${index}`, status: "completed", requestId: "r1", itemIndex: index, provenance: {}, ts: 1_000 * index, ...fields } as unknown as OutputItem;
}
const tool = (name: string, args: Record<string, unknown>, output: unknown) => item({ type: "tool_output", blockName: name, toolCall: { callId: `c${index}`, name, arguments: JSON.stringify(args) }, output });
const user = (text: string) => item({ type: "message", role: "user", content: [{ type: "output_text", text }] });

describe("FROM THE SESSION and the replies (BR-18, I17, I18)", () => {
  it("lists the last three tool calls before the ask, oldest first, and the user's lines after it", () => {
    const early = tool("Read", { path: "a.ts" }, "12 lines");
    const calls = [tool("Bash", { command: "pnpm test" }, "31 passed"), tool("Edit", { path: "b.ts" }, { ok: true }), tool("Write", { path: "c.ts" }, "")];
    const before = user("before the ask");
    const ask = item({ type: "suspension", suspensionId: "s1", reason: "human_approval", message: "Ship it?" });
    const after = tool("Read", { path: "after.ts" }, "not before the ask");
    const reply = user("go ahead");
    // The read hands items back out of order; the derivation must not care.
    const read = [reply, calls[2]!, ask, early, after, calls[0]!, before, calls[1]!];

    const got = askSessionOf(read, ask)!;
    expect(got.calls.map((c) => [c.tool, c.target, c.result])).toEqual([
      ["Bash", "pnpm test", "31 passed"],
      ["Edit", "b.ts", "done"],
      ["Write", "c.ts", "done"],
    ]);
    expect(got.replies.map((r) => r.text)).toEqual(["go ahead"]);
    expect(got.replies[0]!.at).toBe((reply as { ts: number }).ts);
  });

  it("an ask with nothing before it has no calls, and its session's earlier lines are not replies", () => {
    const earlier = user("filed this");
    const ask = item({ type: "suspension", suspensionId: "s2", reason: "human_approval" });
    expect(askSessionOf([ask, earlier], ask)).toEqual({ calls: [], replies: [] });
  });

  it("an ask its session's read doesn't hold places nothing, rather than reading every item as before it", () => {
    const ask = item({ type: "suspension", suspensionId: "s3", reason: "human_approval" });
    expect(askSessionOf([tool("Read", { path: "x" }, "1"), user("hi")], ask)).toBeNull();
  });
});

const row = (id: string, status: string, extra: Partial<BoardRow> = {}): BoardRow => ({
  boardRef: `${extra.ownerSessionId ?? "s_feature"}.tasks`,
  ownerSessionId: extra.ownerSessionId ?? "s_feature",
  id,
  title: id,
  goal: null,
  status,
  assignee: null,
  priority: null,
  labels: [],
  deps: [],
  run: null,
  error: null,
  questions: [],
  steers: [],
  createdAt: null,
  updatedAt: null,
  startedAt: null,
  completedAt: null,
  ...extra,
});

function snapshot(rows: BoardRow[], asks: Ask[] = [], workers: Worker[] = []): LoadedSnapshot {
  const byHolder = new Map<string, BoardRow[]>();
  for (const r of rows) byHolder.set(r.ownerSessionId, [...(byHolder.get(r.ownerSessionId) ?? []), r]);
  const boards: LoadedSnapshot["boards"] = Object.fromEntries([...byHolder].map(([id, rs]) => [id, { ok: true, value: { refs: [rs[0]!.boardRef], rows: rs } }]));
  return {
    orgId: "org",
    readAt: 0,
    inventory: { ok: true, value: { workers } },
    boards,
    asks: { ok: true, value: asks },
    inbox: inboxSection({ ok: true, value: asks }, boards, []),
  } as unknown as LoadedSnapshot;
}

describe("Tasks (BR-14, K1, K4, K8)", () => {
  it("TIME is elapsed from the row's start in v2's form, and a row that never started has none", () => {
    expect(elapsed(row("A", "in_progress", { startedAt: 10_000 }), 10_000 + 400_000)).toBe("6m 40s");
    expect(elapsed(row("A", "in_progress", { startedAt: 0 }), 5_000)).toBe("0m 05s");
    expect(elapsed(row("A", "in_progress", { startedAt: 0 }), 12 * 60_000 + 30_000)).toBe("12m");
    expect(elapsed(row("A", "in_progress", { startedAt: null }), 5_000)).toBeNull();
    // Only a running row's clock runs: a queued row shows no TIME.
    expect(elapsed(row("A", "pending", { startedAt: 0 }), 5_000)).toBeNull();
  });

  it("queued is every row in the QUEUED column, blocked ones included", () => {
    expect(["pending", "held", "mystery", "in_progress", "errored"].filter((s) => isQueued(row("x", s)))).toEqual(["pending", "held", "mystery"]);
  });

  it("the summary counts what is in flight (not queued, not done), the asks, the shift and the streams in flight", () => {
    const workers = [
      { id: "eng.coder", workerId: "eng.coder", name: "coder", team: "eng", kind: null },
      { id: "eng.em", workerId: "eng.em", name: "em", team: "eng", kind: null },
      { id: "eng.idle", workerId: "eng.idle", name: "idle", team: "eng", kind: null },
    ] as unknown as Worker[];
    const asks = [{ workerId: "eng.em", item: { suspensionId: "a1" }, since: 0 }] as unknown as Ask[];
    const s = snapshot(
      [
        row("A", "in_progress", { assignee: "eng.coder" }),
        // Held on a question for you: running, and one Inbox item of its own (FIX-2131).
        row("B", "in_progress", {
          ownerSessionId: "s_desk",
          questions: [{ id: "q-B", actor: "user", openedAt: 1, source: { kind: "row", closedBy: [{ by: "answer" }] }, ask: { kind: "question", prompt: "Which one?" } }],
        }),
        row("C", "pending"),
        row("D", "completed", { ownerSessionId: "s_other" }),
      ],
      asks,
      workers,
    );
    expect(tasksSummary(s)).toBe("2 in flight · 2 need you · 2 on shift · 2 streams");
  });

  it("an Inbox link written with a suspension id still opens the task's item that holds it", () => {
    const held = row("T", "in_progress", {
      run: { sessionId: "s_run", requestId: "req_1", attempt: 1 },
      questions: [
        {
          id: "susp_legacy",
          actor: "user",
          openedAt: 1,
          source: { kind: "suspension", requestId: "req_1", suspensionId: "susp_legacy" },
          ask: { kind: "approval", prompt: "Ship it?" },
        },
      ],
    });
    const s = snapshot([held]);
    const item = inboxItemAt(s, "susp_legacy");
    expect(item?.id).toBe(`task:${held.boardRef}:T`);
    expect(inboxItemAt(s, item!.id)).toBe(item);
    expect(inboxItemAt(s, "nothing")).toBeNull();
  });

  it("an Inbox that didn't load says so in the summary, never 0 need you, which reads as all clear", () => {
    const s = { ...snapshot([row("A", "in_progress")]), inbox: { ok: false, failure: { message: "asks offline" } } } as LoadedSnapshot;
    const line = tasksSummary(s);
    expect(line).toBe("1 in flight · Inbox didn't load · 0 on shift · 1 stream");
    expect(line).not.toMatch(/need/);
  });

  it("the empty Inbox names the runs still going (BR-19, I8)", () => {
    const workers = [{ id: "eng.coder", workerId: "eng.coder", name: "coder", team: "eng", kind: null }] as unknown as Worker[];
    expect(emptyInboxSentence(snapshot([row("A", "in_progress", { assignee: "eng.coder" }), row("B", "in_progress")], [], workers))).toBe(
      "Nothing needs you. 2 sessions are still running.",
    );
    expect(emptyInboxSentence(snapshot([row("A", "completed", { assignee: "eng.coder" }), row("B", "in_progress")], [], workers))).toBe(
      "Nothing needs you. 1 session is still running.",
    );
  });

  it("counts sessions, not rows: two running rows in one run session are one session, and an unlinked row is its own", () => {
    const workers = [{ id: "eng.coder", workerId: "eng.coder", name: "coder", team: "eng", kind: null }] as unknown as Worker[];
    const inOne = (id: string, attempt: number) => row(id, "in_progress", { run: { sessionId: "s_coder", requestId: `req_${id}`, attempt } });
    expect(emptyInboxSentence(snapshot([inOne("A", 1), inOne("B", 1)], [], workers))).toBe(
      "Nothing needs you. 1 session is still running.",
    );
    expect(emptyInboxSentence(snapshot([inOne("A", 1), inOne("B", 1), row("C", "in_progress")], [], workers))).toBe(
      "Nothing needs you. 2 sessions are still running.",
    );
  });
});
