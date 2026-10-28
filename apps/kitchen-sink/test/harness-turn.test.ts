/**
 * What a harness session page says about a turn, derived from the records
 * alone (`specs/issues/FIX-1915/PLAN.md` S9, S10; BR-3, BR-4, BR-9, BR-14 to
 * BR-17). The browser checks (V7, V8) drive these through the page; these pin
 * each state's rule.
 *
 * Red states produced before these were trusted:
 *   - return the rows for an undeclared record: the undeclared case fails.
 *   - sort runs as plain strings: the retried-run case shows attempt 2's rows.
 *   - read a stop before the confirmation as a refusal: the stopped case fails.
 *   - read the stop off the request summary alone: the stop-item case fails.
 */
import { describe, expect, it } from "vitest";

import {
  earliestTurnOf,
  latestTurn,
  planPanelState,
  planRowStage,
  planSource,
  PREDATES_REASON,
  turnNotice,
  turnNumbers,
  UNKNOWN_CONVERSATION,
  type PlanPanelInput,
  type TurnRecord,
} from "@/lib/harness-turn";

const blank: TurnRecord = { asked: null, confirmed: null, failure: null, stopped: null, error: null, at: 1, steered: null };

describe("turnNotice", () => {
  it("says nothing while the turn runs", () => {
    expect(turnNotice({ ...blank, asked: "c1" }, "running", "c1")).toBeNull();
  });

  it("a stop is a stop, even before a confirmation and with a refusal-shaped failure (BR-9)", () => {
    const stopped = { ...blank, asked: "c1", stopped: true, failure: UNKNOWN_CONVERSATION };
    expect(turnNotice(stopped, "failed", "c1")).toEqual({ kind: "stopped", conversation: "c1" });
    expect(turnNotice({ ...blank, asked: "c1" }, "stopped", "c1")).toEqual({ kind: "stopped", conversation: "c1" });
  });

  it("refused only on the harness's unknown-conversation failure (BR-3)", () => {
    const refused = { ...blank, asked: "c1", confirmed: "c1", failure: UNKNOWN_CONVERSATION, error: "No conversation" };
    expect(turnNotice(refused, "failed", "c1")).toEqual({ kind: "refused", conversation: "c1", error: "No conversation" });
    const other = { ...blank, asked: "c1", failure: "other", error: "boom" };
    expect(turnNotice(other, "failed", "c1")).toEqual({ kind: "error", error: "boom", conversation: "c1" });
  });

  it("started, continued and moved come from the turn's own ask and confirmation (BR-1, BR-2, BR-4)", () => {
    expect(turnNotice({ ...blank, confirmed: "c1" }, "completed", "c1")).toEqual({ kind: "started", conversation: "c1" });
    expect(turnNotice({ ...blank, asked: "c1", confirmed: "c1" }, "completed", "c1")).toEqual({ kind: "continued", conversation: "c1" });
    expect(turnNotice({ ...blank, asked: "c1", confirmed: "c2" }, "completed", "c2")).toEqual({
      kind: "moved",
      conversation: "c2",
      previous: "c1",
    });
  });
});

describe("latestTurn", () => {
  const msg = (requestId: string) => ({ requestId, type: "message" });
  const stop = (requestId: string) => ({ requestId, type: "status", detail: { code: "system.request_aborted" } });

  it("is null before the first turn, and numbers turns in the order they started", () => {
    expect(latestTurn({ items: [], streaming: false, request: null })).toBeNull();
    const turn = latestTurn({ items: [msg("r1"), msg("r1"), msg("r2"), msg("r2")], streaming: false, request: { id: "r2", status: "completed" } });
    expect(turn).toEqual({ requestId: "r2", number: 2, status: "completed" });
  });

  it("a stop item marks the turn stopped even while the summary still says it runs (BR-9)", () => {
    const turn = latestTurn({ items: [msg("r1"), stop("r1")], streaming: false, request: { id: "r1", status: "in_progress" } });
    expect(turn?.status).toBe("stopped");
    // An earlier turn's stop says nothing about the latest.
    expect(latestTurn({ items: [msg("r1"), stop("r1"), msg("r2")], streaming: true, request: null })?.status).toBe("running");
  });

  it("runs while streaming, or until the summary names the turn; then reads the summary", () => {
    expect(latestTurn({ items: [msg("r2")], streaming: true, request: { id: "r2", status: "completed" } })?.status).toBe("running");
    expect(latestTurn({ items: [msg("r2")], streaming: false, request: { id: "r1", status: "completed" } })?.status).toBe("running");
    for (const [status, want] of [["incomplete", "completed"], ["failed", "failed"], ["interrupted", "failed"], ["aborted", "stopped"], ["suspended", "running"]] as const) {
      expect(latestTurn({ items: [msg("r2")], streaming: false, request: { id: "r2", status } })?.status).toBe(want);
    }
  });
});

const base: PlanPanelInput ={ declared: true, label: "Claude Code", turn: 1, ended: true, rows: [], markers: [] };
const row = (topic: string, title: string, status = "pending") => ({ topic, title, status });

describe("planPanelState", () => {
  it("names a harness that declares no plan record (BR-16)", () => {
    expect(planPanelState({ ...base, declared: false, rows: [row("r/s#1/1", "x")] })).toEqual({ kind: "undeclared", label: "Claude Code" });
  });

  it("before the first turn, and for a turn with nothing recorded (BR-15)", () => {
    expect(planPanelState({ ...base, turn: null })).toEqual({ kind: "no-turn" });
    expect(planPanelState({ ...base, turn: 2 })).toEqual({ kind: "none", scope: "turn", turn: 2 });
  });

  it("tells a reported empty list from nothing reported (BR-17)", () => {
    const marker = { topic: "r/s#1", status: "complete", count: 0, reason: null };
    expect(planPanelState({ ...base, markers: [marker] })).toEqual({ kind: "empty", scope: "turn", turn: 1 });
  });

  it("shows the rows in item order, the last run's only", () => {
    const state = planPanelState({
      ...base,
      rows: [row("r/s#2/10", "ten"), row("r/s#2/2", "two"), row("r/s#10/1", "retried")],
    });
    expect(state).toMatchObject({ kind: "rows", rows: [{ key: "1", title: "retried" }], incomplete: null });
    const one = planPanelState({ ...base, rows: [row("r/s#2/10", "ten"), row("r/s#2/2", "two")] });
    expect(one).toMatchObject({ rows: [{ key: "2" }, { key: "10" }] });
  });

  it("marks rows incomplete, and hides places past the marker's count (BR-14)", () => {
    const rows = [row("r/s#1/000000", "a"), row("r/s#1/000001", "b"), row("r/s#1/000002", "stale")];
    const incomplete = planPanelState({ ...base, rows, markers: [{ topic: "r/s#1", status: "incomplete", count: 2, reason: "write failed" }] });
    expect(incomplete).toMatchObject({ kind: "rows", rows: [{ title: "a" }, { title: "b" }], incomplete: { reason: "write failed" } });
    const writing = { topic: "r/s#1", status: "writing", count: 2, reason: null };
    expect(planPanelState({ ...base, rows, markers: [writing], ended: false })).toMatchObject({ incomplete: null });
    expect(planPanelState({ ...base, rows, markers: [writing], ended: true })).toMatchObject({ incomplete: { reason: null } });
  });
});

// A conversation's plan is the plan of every turn in it: a turn that touches
// one row, or none, must not make the others vanish, and the label must say
// which turn last changed it rather than pretend the latest turn wrote it all.
describe("planPanelState — a conversation's plan", () => {
  const turns = new Map([["req_1", 1], ["req_2", 2], ["req_3", 3]]);
  const conv = (rows: PlanPanelInput["rows"], predates = false, markers: PlanPanelInput["markers"] = []) =>
    planPanelState({ ...base, turn: 3, rows, markers, conversation: { turns, predates } });
  const at = (item: string, title: string | null, status: string, requestId: string) => ({
    topic: `conversation/sess_1/${item}`,
    title,
    status,
    requestId,
  });

  it("shows every row of the conversation, labelled with the turn that last changed one", () => {
    const state = conv([at("1", "List the files", "completed", "req_1"), at("2", "Count the lines", "completed", "req_2"), at("3", "Sort", "pending", "req_1")]);
    expect(state).toMatchObject({ kind: "rows", scope: "conversation", turn: 2, incomplete: null });
    expect(state.kind === "rows" && state.rows.map((r) => r.title)).toEqual(["List the files", "Count the lines", "Sort"]);
  });

  it("ignores a run's pointer, which is not a list marker", () => {
    const pointer = { topic: "req_3/root#0", status: null, count: null, reason: null, conversation: "conversation/sess_1" };
    expect(conv([at("1", "a", "pending", "req_1")], false, [pointer])).toMatchObject({ kind: "rows", incomplete: null });
    expect(conv([], false, [pointer])).toEqual({ kind: "none", scope: "conversation", turn: null });
  });

  it("says the plan may be incomplete when the conversation began before plans were kept across turns", () => {
    expect(conv([at("2", null, "completed", "req_3")], true)).toMatchObject({ incomplete: { reason: PREDATES_REASON } });
    // A failed write's own reason comes first.
    const failed = { topic: "conversation/sess_1", status: "incomplete", count: null, reason: "write failed" };
    expect(conv([at("2", null, "completed", "req_3")], true, [failed])).toMatchObject({ incomplete: { reason: "write failed" } });
  });

  it("an emptied list is empty, and a row from a turn it can't number has no label", () => {
    const emptied = { topic: "conversation/sess_1", status: "complete", count: 0, reason: null };
    expect(conv([], false, [emptied])).toEqual({ kind: "empty", scope: "conversation", turn: null });
    expect(conv([at("1", "a", "pending", "req_gone")])).toMatchObject({ kind: "rows", turn: null });
  });
});

// Which plan the panel reads decides whether a person sees the plan at all:
// a turn that never reached the harness must not hide the conversation's plan,
// and a session recorded per turn must still show its own rows.
describe("planSource", () => {
  it("follows the turn's pointer, whatever the binding says", () => {
    expect(planSource("conversation/a", true, "conversation/b")).toEqual({ kind: "conversation", namespace: "conversation/a" });
  });

  it("reads the bound conversation while a turn runs and before its pointer is written", () => {
    expect(planSource(null, false, "conversation/b")).toEqual({ kind: "conversation", namespace: "conversation/b" });
  });

  it("an ended turn with no pointer reads its own rows, then the bound conversation when it has none", () => {
    expect(planSource(null, true, "conversation/b")).toEqual({ kind: "turn", whenEmpty: "conversation/b" });
    expect(planSource(null, false, null)).toEqual({ kind: "turn", whenEmpty: null });
  });
});

describe("turnNumbers and earliestTurnOf", () => {
  it("numbers turns as latestTurn does", () => {
    const items = [{ requestId: "a", type: "message" }, { requestId: "b", type: "message" }, { requestId: "a", type: "status" }];
    expect([...turnNumbers(items)]).toEqual([["a", 1], ["b", 2]]);
  });

  it("finds the conversation's earliest recorded turn, by when it started", () => {
    const record = (asked: string | null, confirmed: string | null, at: number) =>
      ({ asked, confirmed, failure: null, stopped: null, error: null, at }) as TurnRecord;
    const turns = { r3: record("s1", "s1", 30), r1: record(null, "s0", 10), r2: record(null, "s1", 20) };
    expect(earliestTurnOf(turns, (id) => id === "s1")).toBe("r2");
    expect(earliestTurnOf(turns, (id) => id === "nope")).toBeNull();
    expect(earliestTurnOf(null, () => true)).toBeNull();
  });
});

// A harness names a plan row's status in its own words, and says nothing at all
// until it confirms a first move: Claude Code's create records no status, so a
// row nobody has started yet holds null. The panel must read that as "to do",
// not as a missing value.
describe("planRowStage", () => {
  it("reads a row with no status as not started, since a create records none", () => {
    expect(planRowStage(null)).toEqual({ stage: "pending", label: "To do" });
  });

  it("reads the common words of the harnesses in any spelling", () => {
    for (const word of ["pending", "Pending", "todo", "not_started", "notStarted", "", "  "]) expect(planRowStage(word).stage).toBe("pending");
    for (const word of ["in_progress", "in-progress", "In Progress", "running", "inProgress"]) {
      expect(planRowStage(word)).toEqual({ stage: "active", label: "In progress" });
    }
    for (const word of ["completed", "complete", "done"]) expect(planRowStage(word)).toEqual({ stage: "done", label: "Done" });
  });

  it("keeps a word it does not know, as the harness said it", () => {
    expect(planRowStage("deleted")).toEqual({ stage: "other", label: "deleted" });
  });
});
