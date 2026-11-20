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
import { inboxItems, taskActionName } from "@flow-state-dev/orchestration/inbox";
import { elapsed, isQueued, nothingWaitingSentence, summaryLine } from "../src/lib/tasks";
import type { InboxAsk, InboxViewValue } from "../src/lib/inbox";
import { itemAtRoute } from "../src/lib/inbox-list";
import type { LoadedSnapshot } from "../src/lib/derive";
import { inboxSection, type Ask, type BoardTaskView, type Worker } from "../src/lib/reads";

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
    const ask = item({ type: "suspension", suspensionId: "s1", reason: "user_approval", message: "Ship it?" });
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
    const ask = item({ type: "suspension", suspensionId: "s2", reason: "user_approval" });
    expect(askSessionOf([ask, earlier], ask)).toEqual({ calls: [], replies: [] });
  });

  it("an ask its session's read doesn't hold places nothing, rather than reading every item as before it", () => {
    const ask = item({ type: "suspension", suspensionId: "s3", reason: "user_approval" });
    expect(askSessionOf([tool("Read", { path: "x" }, "1"), user("hi")], ask)).toBeNull();
  });
});

const row = (id: string, status: string, extra: Partial<BoardTaskView> = {}): BoardTaskView => ({
  boardRef: `${extra.ownerSessionId ?? "s_feature"}.tasks`,
  ownerSessionId: extra.ownerSessionId ?? "s_feature",
  id,
  title: id,
  goal: null,
  context: null,
  attachments: [],
  status,
  assignee: null,
  priority: null,
  labels: [],
  deps: [],
  run: null,
  error: null,
  holds: [],
  steers: [],
  spend: null,
  createdAt: null,
  updatedAt: null,
  startedAt: null,
  completedAt: null,
  ...extra,
});

function snapshot(rows: BoardTaskView[], asks: Ask[] = [], workers: Worker[] = []): LoadedSnapshot {
  const byHolder = new Map<string, BoardTaskView[]>();
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

/**
 * The inbox view's answer over `tasks` and the asks no row claims, as the
 * server builds it: orchestration's list over the rows (each answered on its
 * conversation's board) and the asks.
 */
function viewOf(tasks: BoardTaskView[], asks: Array<Pick<InboxAsk, "suspensionId" | "workerId"> & { sessionId?: string }> = []): InboxViewValue {
  return {
    tasks: tasks.map((r) => ({ ...r, owner: r.ownerSessionId })),
    items: inboxItems<InboxAsk>({
      rows: tasks.map((r) => ({ ...r, board: r.boardRef, holder: { sessionId: r.ownerSessionId, action: taskActionName("updateTask", "tasks") } })),
      suspensions: asks.map(({ sessionId = "s_ask", ...ask }) => ({
        sessionId,
        flowId: "agent",
        requestId: `req_${ask.suspensionId}`,
        suspensionId: ask.suspensionId,
        kind: "approval",
        prompt: "ok?",
        since: 0,
        detail: { ...ask, sessionId, requestId: `req_${ask.suspensionId}`, flowKind: "agent", kind: "approval", message: "ok?", createdAt: 0, shape: "approval" } as unknown as InboxAsk,
      })),
      flowOf: () => "coordinator",
    }),
  };
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
    const tasks = [
      row("A", "in_progress", { assignee: "eng.coder" }),
      // Held on a question for you: running, and one Inbox item of its own (FIX-2131).
      row("B", "in_progress", {
        ownerSessionId: "s_desk",
        holds: [{ id: "q-B", actor: "user", openedAt: 1, source: { kind: "task", closedBy: [{ by: "answer" }] }, ask: { kind: "question", prompt: "Which one?" } }],
      }),
      row("C", "pending"),
      row("D", "completed", { ownerSessionId: "s_other" }),
    ];
    // Who is on shift is the view's too (FIX-2775): the tasks, the Inbox and the on-shift count are one answer.
    expect(summaryLine({ ok: true, value: viewOf(tasks, [{ suspensionId: "a1", workerId: "eng.em" }]) }, workers)).toBe("2 in flight · 2 need you · 2 on shift · 2 streams");
  });

  it("an Inbox link written with a suspension id still opens the task's item that holds it", () => {
    const held = row("T", "in_progress", {
      run: { sessionId: "s_run", requestId: "req_1", attempt: 1 },
      holds: [
        {
          id: "susp_legacy",
          actor: "user",
          openedAt: 1,
          source: { kind: "suspension", requestId: "req_1", suspensionId: "susp_legacy" },
          ask: { kind: "approval", prompt: "Ship it?" },
        },
      ],
    });
    const { items } = viewOf([held]);
    const item = itemAtRoute(items, "susp_legacy");
    expect(item?.id).toBe(`task:${held.boardRef}:T`);
    expect(itemAtRoute(items, item!.id)).toBe(item);
    expect(itemAtRoute(items, "nothing")).toBeNull();
  });

  // A report's link is written before its ask exists, so it names the session the ask will wait in.
  it("an Inbox link written with a session opens the lone ask waiting in it, found only among the user's own asks", () => {
    const report = "error-report~fp-0123456789abcdef";
    const held = row("T", "in_progress", { run: { sessionId: "s_run", requestId: "req_sp_task", attempt: 1 } });
    const { items } = viewOf([held], [
      { suspensionId: "sp_report", workerId: "error-reporter", sessionId: report },
      { suspensionId: "sp_task", workerId: "eng.coder", sessionId: "s_run" },
    ]);
    expect(itemAtRoute(items, report)?.id).toBe("sp_report");
    // Anything else opens what an unknown id opens: another user's report session, one whose ask was answered, a task's run.
    expect(itemAtRoute(items, "error-report~fp-fedcba9876543210")).toBeNull();
    expect(itemAtRoute(items, "s_run")).toBeNull();
    expect(itemAtRoute(items, "nothing")).toBeNull();
  });

  it("an Inbox that didn't load says so in the summary, never 0 need you, which reads as all clear", () => {
    const line = summaryLine({ ok: false, failure: { message: "asks offline" } }, []);
    // With no answer there are no rows to count either: the line says the Inbox didn't load.
    expect(line).toBe("0 in flight · Inbox didn't load · 0 on shift · 0 streams");
    expect(line).not.toMatch(/need/);
  });

  it("the empty Inbox names the runs still going (BR-19, I8)", () => {
    expect(nothingWaitingSentence(viewOf([row("A", "in_progress", { assignee: "eng.coder" }), row("B", "in_progress")]))).toBe(
      "Nothing needs you. 2 sessions are still running.",
    );
    expect(nothingWaitingSentence(viewOf([row("A", "completed", { assignee: "eng.coder" }), row("B", "in_progress")]))).toBe(
      "Nothing needs you. 1 session is still running.",
    );
  });

  it("counts sessions, not rows: two running rows in one run session are one session, and an unlinked row is its own", () => {
    const inOne = (id: string, attempt: number) => row(id, "in_progress", { run: { sessionId: "s_coder", requestId: `req_${id}`, attempt } });
    expect(nothingWaitingSentence(viewOf([inOne("A", 1), inOne("B", 1)]))).toBe(
      "Nothing needs you. 1 session is still running.",
    );
    expect(nothingWaitingSentence(viewOf([inOne("A", 1), inOne("B", 1), row("C", "in_progress")]))).toBe(
      "Nothing needs you. 2 sessions are still running.",
    );
  });
});
