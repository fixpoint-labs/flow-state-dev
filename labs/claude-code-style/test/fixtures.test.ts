/**
 * The fixtures, driven through the adapter. The stop script runs on fake
 * timers, since the screen tests can't pin its orderings: asking to stop names
 * a task, and a task that finishes while the stop is under way stays finished.
 * The project list follows the rule a run follows: only where the person may work.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LabAdapter, TaskRow } from "../src/adapter";
import { createFixtureLab } from "../src/fixtures";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

async function start(): Promise<{ lab: LabAdapter; id: string; status: (title: string) => string | undefined }> {
  const lab = createFixtureLab();
  const { id } = await lab.openSession("session", "project-vendor-notes");
  let rows: TaskRow[] = [];
  lab.watchTasks(id, (next) => (rows = next));
  await lab.send(id, "Compare Acme and Globex for us.");
  return { lab, id, status: (title) => rows.find((t) => t.title === title)?.status };
}

describe("the fixture's stop script", () => {
  it("cancels the task the person named, not the first one running", async () => {
    const { lab, id, status } = await start();
    await vi.advanceTimersByTimeAsync(1900); // both tasks filed, Acme not yet settled
    await lab.interrupt(id);
    await lab.send(id, "Stop the Globex research.");
    await vi.advanceTimersByTimeAsync(800);
    expect(status("Research Globex")).toBe("cancelled");
    expect(status("Research Acme")).toBe("in_progress");
  });

  it("leaves a task completed when it settles before the cancel lands", async () => {
    const { lab, id, status } = await start();
    await vi.advanceTimersByTimeAsync(3600); // Acme settles at 4200; the cancel would land at 4300
    await lab.interrupt(id);
    await lab.send(id, "Stop the Acme research.");
    await vi.advanceTimersByTimeAsync(800);
    expect(status("Research Acme")).toBe("completed");
  });

  it("stops nothing else when the named task has already finished", async () => {
    const { lab, id, status } = await start();
    await vi.advanceTimersByTimeAsync(4500); // Acme settled at 4200; Globex still running
    await lab.interrupt(id);
    await lab.send(id, "Stop the Acme research.");
    await vi.advanceTimersByTimeAsync(800);
    expect(status("Research Acme")).toBe("completed");
    expect(status("Research Globex")).toBe("in_progress");
  });
});

describe("the fixture's projects", () => {
  it("offers only projects the person may work in, and refuses a session on one they can only read", async () => {
    const lab = createFixtureLab();
    expect((await lab.listProjects()).map((p) => p.name)).toEqual(["vendor-notes", "onboarding-app"]);
    await expect(lab.openSession("session", "project-billing-service")).rejects.toThrow(/not-a-member/);
  });
});
