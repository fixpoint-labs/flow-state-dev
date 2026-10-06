/**
 * What Inbox and Tasks derive for design v2's content: the
 * ask session's last tool calls before the ask (BR-18) and the person's
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
import type { LoadedSnapshot } from "../src/lib/derive";
import type { Ask, BoardRow, Seat } from "../src/lib/reads";

let index = 0;
function item(fields: Record<string, unknown>): OutputItem {
  index += 1;
  return { id: `i${index}`, status: "completed", requestId: "r1", itemIndex: index, provenance: {}, ts: 1_000 * index, ...fields } as unknown as OutputItem;
}
const tool = (name: string, args: Record<string, unknown>, output: unknown) => item({ type: "tool_output", blockName: name, toolCall: { callId: `c${index}`, name, arguments: JSON.stringify(args) }, output });
const user = (text: string) => item({ type: "message", role: "user", content: [{ type: "output_text", text }] });

describe("FROM THE SESSION and the replies (BR-18, I17, I18)", () => {
  it("lists the last three tool calls before the ask, oldest first, and the person's lines after it", () => {
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
  boardRef: "eng.feature.work",
  mailboxId: extra.mailboxId ?? "eng.feature",
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
  createdAt: null,
  updatedAt: null,
  startedAt: null,
  completedAt: null,
  ...extra,
});

function snapshot(rows: BoardRow[], asks: Ask[] = [], seats: Seat[] = []): LoadedSnapshot {
  const byMailbox = new Map<string, BoardRow[]>();
  for (const r of rows) byMailbox.set(r.mailboxId, [...(byMailbox.get(r.mailboxId) ?? []), r]);
  return {
    orgId: "org",
    readAt: 0,
    inventory: { ok: true, value: { seats, workstreams: [], declared: {} } },
    boards: Object.fromEntries([...byMailbox].map(([id, rs]) => [id, { ok: true, value: { refs: [rs[0]!.boardRef], rows: rs } }])),
    asks: { ok: true, value: asks },
  } as unknown as LoadedSnapshot;
}

describe("Tasks (BR-14, K1, K4, K8)", () => {
  it("TIME is elapsed from the row's start in v2's form, and a row that never started has none", () => {
    expect(elapsed(row("A", "in_progress", { startedAt: 10_000 }), 10_000 + 400_000)).toBe("6m 40s");
    expect(elapsed(row("A", "in_progress", { startedAt: 0 }), 5_000)).toBe("0m 05s");
    expect(elapsed(row("A", "in_progress", { startedAt: 0 }), 12 * 60_000 + 30_000)).toBe("12m");
    expect(elapsed(row("A", "in_progress", { startedAt: null }), 5_000)).toBeNull();
    // Only a running row's clock runs: a queued or parked row shows no TIME.
    expect(elapsed(row("A", "pending", { startedAt: 0 }), 5_000)).toBeNull();
    expect(elapsed(row("A", "parked", { startedAt: 0 }), 5_000)).toBeNull();
  });

  it("queued is every row in the QUEUED column, blocked ones included", () => {
    expect(["pending", "blocked", "mystery", "in_progress", "parked", "errored"].filter((s) => isQueued(row("x", s)))).toEqual(["pending", "blocked", "mystery"]);
  });

  it("the summary counts what is in flight (not queued, not done), the asks, the shift and the streams in flight", () => {
    const seats = [
      { id: "eng.coder", seatId: "eng.coder", name: "coder", team: "eng", kind: null },
      { id: "eng.em", seatId: "eng.em", name: "em", team: "eng", kind: null },
      { id: "eng.idle", seatId: "eng.idle", name: "idle", team: "eng", kind: null },
    ] as unknown as Seat[];
    const asks = [{ seatId: "eng.em" }] as unknown as Ask[];
    const s = snapshot(
      [
        row("A", "in_progress", { assignee: "eng.coder" }),
        row("B", "parked", { mailboxId: "ops.desk" }),
        row("C", "pending"),
        row("D", "completed", { mailboxId: "ops.other" }),
      ],
      asks,
      seats,
    );
    expect(tasksSummary(s)).toBe("2 in flight · 1 needs you · 1 on shift · 1 on call · 2 streams");
  });

  it("the empty Inbox names the runs still going and who is on call (BR-19, I8)", () => {
    const seats = [{ id: "eng.coder", seatId: "eng.coder", name: "coder", team: "eng", kind: null }] as unknown as Seat[];
    expect(emptyInboxSentence(snapshot([row("A", "in_progress", { assignee: "eng.coder" }), row("B", "in_progress")], [], seats))).toBe(
      "Nothing needs you. 2 sessions are still running and 0 workers are on call.",
    );
    expect(emptyInboxSentence(snapshot([row("A", "parked", { assignee: "eng.coder" }), row("B", "in_progress")], [], seats))).toBe(
      "Nothing needs you. 1 session is still running and 1 worker is on call.",
    );
  });

  it("counts sessions, not rows: two running rows in one run session are one session, and an unlinked row is its own", () => {
    const seats = [{ id: "eng.coder", seatId: "eng.coder", name: "coder", team: "eng", kind: null }] as unknown as Seat[];
    const inOne = (id: string, attempt: number) => row(id, "in_progress", { run: { sessionId: "s_coder", requestId: `req_${id}`, attempt } });
    expect(emptyInboxSentence(snapshot([inOne("A", 1), inOne("B", 1)], [], seats))).toBe(
      "Nothing needs you. 1 session is still running and 0 workers are on call.",
    );
    expect(emptyInboxSentence(snapshot([inOne("A", 1), inOne("B", 1), row("C", "in_progress")], [], seats))).toBe(
      "Nothing needs you. 2 sessions are still running and 0 workers are on call.",
    );
  });
});
