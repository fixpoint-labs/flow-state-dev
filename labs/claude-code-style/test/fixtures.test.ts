/**
 * The fixture's stop script, driven through the adapter on fake timers. The
 * screen tests can't pin these orderings: asking to stop names a task, and a
 * task that finishes while the stop is under way stays finished.
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
});
