// @vitest-environment happy-dom
/**
 * A task's time and stall signal, and a pane's per-state counts, as every
 * app draws them from one registry item.
 *
 * Why it matters: a person tells a task that is working from one whose run
 * has stopped without opening it. *Working* times this attempt's run, so a
 * retried task never reads its earlier attempts as this one's work. *Quiet*
 * is the board's own rule, a lapsed lease, so a live run in one long step
 * (which keeps renewing) never reads quiet, and a row with no live run does,
 * however recently something else wrote it. A feed that lost the server says
 * nothing about the run, so nothing reads quiet while it is stale.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { TaskTime, agoText, taskCounts, taskSignal, type TaskSignalView } from "../../registry/components/task-signals";

afterEach(cleanup);

const NOW = 10_000_000;
const MIN = 60_000;
const view = (state: string, times: Partial<TaskSignalView["times"]> = {}): TaskSignalView => ({ state, times: { updatedAt: null, completedAt: null, ...times } });

describe("taskSignal", () => {
  it("times a running row from this attempt's run start, not from anything older", () => {
    const signal = taskSignal(view("running", { updatedAt: NOW - 5_000 }), { startedAt: NOW - (4 * MIN + 12_000), leaseUntil: NOW + 90_000 }, NOW);
    expect(signal).toEqual({ kind: "working", text: "working · 4m 12s" });
  });

  it("gives no clock to a running row whose run hasn't linked itself yet", () => {
    expect(taskSignal(view("running"), { leaseUntil: NOW + 90_000 }, NOW)).toBeNull();
  });

  it("keeps a live run in one long step working: its lease is renewed, however old updatedAt is", () => {
    const signal = taskSignal(view("running", { updatedAt: NOW - 39 * MIN }), { startedAt: NOW - 40 * MIN, leaseUntil: NOW + 1 }, NOW);
    expect(signal?.kind).toBe("working");
  });

  it("reads a running row whose lease has lapsed as quiet, counted from its last write", () => {
    const signal = taskSignal(view("running", { updatedAt: NOW - 40 * MIN }), { startedAt: NOW - 45 * MIN, leaseUntil: NOW - 38 * MIN }, NOW);
    expect(signal).toEqual({ kind: "quiet", text: "quiet for 40m" });
    // The deadline itself is lapsed, as the board reads it.
    expect(taskSignal(view("running", { updatedAt: NOW - 2 * MIN }), { startedAt: NOW - 3 * MIN, leaseUntil: NOW }, NOW)?.kind).toBe("quiet");
  });

  it("never reads quiet while the feed is stale", () => {
    const lapsed = { startedAt: NOW - 45 * MIN, leaseUntil: NOW - 38 * MIN };
    expect(taskSignal(view("running", { updatedAt: NOW - 40 * MIN }), lapsed, NOW, { stale: true })?.kind).toBe("working");
  });

  it("never reads a running task no lease holds as working: no run is on it (kept open, waiting on a pull request), so it reads idle since its last write", () => {
    // A task parked for days with no live run must not read "working · 72h"; nor
    // "waiting", which a pane's counts use for a task held for a person.
    const parked = taskSignal(view("running", { updatedAt: NOW - 3 * 24 * 60 * MIN }), { startedAt: NOW - 4 * 24 * 60 * MIN }, NOW);
    expect(parked).toEqual({ kind: "idle", text: "idle · 3d" });
    expect(taskSignal(view("running", { updatedAt: NOW - 24 * MIN }), { startedAt: NOW - 30 * MIN, leaseUntil: null }, NOW)?.text).toBe("idle · 24m");
    // A stale feed doesn't make it working either: its last reading had no run.
    expect(taskSignal(view("running", { updatedAt: NOW - 24 * MIN }), { startedAt: NOW - 30 * MIN }, NOW, { stale: true })?.kind).toBe("idle");
    expect(taskSignal(view("running"), {}, NOW)).toEqual({ kind: "idle", text: "idle" });
  });

  it("says nothing of a running row it was given no run for: it can't tell a live lease from none", () => {
    expect(taskSignal(view("running", { updatedAt: NOW - MIN }), undefined, NOW)).toBeNull();
    expect(taskSignal(view("running", { updatedAt: NOW - MIN }), null, NOW)).toBeNull();
  });

  it("reads quiet and idle spans on the one ladder its ages use: minutes, hours, days", () => {
    const lapsed = { startedAt: NOW - 3 * 24 * 60 * MIN, leaseUntil: NOW - 2 * 24 * 60 * MIN };
    expect(taskSignal(view("running", { updatedAt: NOW - 50 * 60 * MIN }), lapsed, NOW)?.text).toBe("quiet for 2d");
    expect(taskSignal(view("running", { updatedAt: NOW - 63 * MIN }), { ...lapsed, leaseUntil: NOW - MIN }, NOW)?.text).toBe("quiet for 1h");
    expect(taskSignal(view("running", { updatedAt: NOW - 3 * 60 * MIN }), {}, NOW)?.text).toBe("idle · 3h");
  });

  it("says how long ago an ended row ended, from completedAt, else its last write", () => {
    expect(taskSignal(view("done", { updatedAt: NOW - 3 * MIN, completedAt: NOW - 12 * MIN }), undefined, NOW)).toEqual({ kind: "ended", text: "12m ago" });
    expect(taskSignal(view("failed", { updatedAt: NOW - 2 * 60 * MIN }), undefined, NOW)?.text).toBe("2h ago");
    expect(taskSignal(view("cancelled", { updatedAt: NOW - 10_000 }), undefined, NOW)?.text).toBe("just now");
    expect(taskSignal(view("done"), undefined, NOW)).toBeNull();
  });

  it("says nothing for a queued, held or waiting row", () => {
    for (const state of ["queued", "held", "waiting"]) {
      expect(taskSignal(view(state, { updatedAt: NOW - MIN }), { startedAt: NOW - MIN, leaseUntil: NOW - 1 }, NOW)).toBeNull();
    }
  });
});

describe("agoText", () => {
  it("reads minutes, hours and days", () => {
    expect([agoText(59_000), agoText(12 * MIN), agoText(3 * 60 * MIN), agoText(50 * 60 * MIN)]).toEqual(["just now", "12m ago", "3h ago", "2d ago"]);
  });
});

describe("taskCounts", () => {
  it("counts running, waiting, failed and done, in that order, without zeros", () => {
    const states = ["done", "running", "failed", "waiting", "running", "queued", "held", "cancelled", ...Array(27).fill("done")];
    expect(taskCounts(states.map((state) => ({ state })))).toBe("2 running · 1 waiting · 1 failed · 28 done");
    expect(taskCounts([{ state: "done" }])).toBe("1 done");
    expect(taskCounts([{ state: "queued" }])).toBe("");
    expect(taskCounts([])).toBe("");
  });
});

describe("TaskTime", () => {
  it("draws the signal with its kind and the tone the app maps it to, or the fallback when there is none", () => {
    const tone = (kind: string) => (kind === "quiet" ? "text-warning" : "text-info");
    render(<TaskTime view={view("running", { updatedAt: NOW - 7 * MIN })} run={{ startedAt: NOW - 9 * MIN, leaseUntil: NOW - 5 * MIN }} now={NOW} tone={tone} />);
    const quiet = screen.getByText("quiet for 7m");
    expect(quiet.getAttribute("data-task-signal")).toBe("quiet");
    expect(quiet.className).toContain("text-warning");
    cleanup();
    render(<TaskTime view={view("queued")} now={NOW} fallback="queued" />);
    expect(screen.getByText("queued")).toBeTruthy();
  });
});
