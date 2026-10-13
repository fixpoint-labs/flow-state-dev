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

import { latestTurn, planPanelState, turnNotice, UNKNOWN_CONVERSATION, type PlanPanelInput, type TurnRecord } from "@/lib/harness-turn";

const blank: TurnRecord = { asked: null, confirmed: null, failure: null, stopped: null, error: null, at: 1 };

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
    expect(planPanelState({ ...base, turn: 2 })).toEqual({ kind: "none", turn: 2 });
  });

  it("tells a reported empty list from nothing reported (BR-17)", () => {
    const marker = { topic: "r/s#1", status: "complete", count: 0, reason: null };
    expect(planPanelState({ ...base, markers: [marker] })).toEqual({ kind: "empty", turn: 1 });
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
