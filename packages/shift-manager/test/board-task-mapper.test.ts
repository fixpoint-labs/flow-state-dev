/**
 * One mapper from a stored board task to what a screen shows. The inbox view
 * answers its tasks through workforce's `boardTaskOf`, and the snapshot's
 * boards through `toBoardTaskView`; while both exist they must read an entry
 * the same way, or a task reads one way on Tasks and another on its route.
 */
import { describe, expect, it } from "vitest";
import { boardTaskOf } from "@flow-state-dev/workforce/browser";
import { toBoardTaskView } from "../src/lib/reads";

const BOARD = "sess_lead.tasks";

const both = (stored: unknown) => [toBoardTaskView(BOARD, "sess_lead", "t_fallback", stored), boardTaskOf(BOARD, "sess_lead", "t_fallback", stored)] as const;

describe("a stored board task, read by the snapshot and by the inbox view", () => {
  it("reads its goal as its title when it was filed with none, the same through both", () => {
    const [snapshot, view] = both({ id: "t1", goal: "Ship the release notes", status: "pending" });
    expect(snapshot.title).toBe("Ship the release notes");
    expect(view).toEqual(snapshot);
  });

  it("reads a run link with a non-number attempt as no run, the same through both", () => {
    const [snapshot, view] = both({ id: "t2", goal: "g", status: "in_progress", run: { sessionId: "s", requestId: "r", attempt: Number.NaN } });
    expect(snapshot.run).toBeNull();
    expect(view).toEqual(snapshot);
  });

  it("drops a hold that doesn't parse, keeps the stored status, and names a task with no id by its key", () => {
    const [snapshot, view] = both({ goal: "g", status: "blocked", holds: [{ nonsense: true }] });
    expect([snapshot.id, snapshot.status, snapshot.holds]).toEqual(["t_fallback", "blocked", []]);
    expect(view).toEqual(snapshot);
  });
});
