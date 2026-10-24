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

describe("the fixture's threads", () => {
  async function threads() {
    const lab = createFixtureLab();
    const { id } = await lab.openSession("threads", "project-vendor-notes");
    let rows: TaskRow[] = [];
    lab.watchTasks(id, (next) => (rows = next));
    await lab.send(id, "Research three vendors for a status page, one thread each.");
    const row = (title: string) => rows.find((t) => t.title === title);
    return { lab, id, row };
  }

  it("leaves a thread's state alone when you talk in it without a question open, or resolve it before review", async () => {
    const { lab, id, row } = await threads();
    await vi.advanceTimersByTimeAsync(2000); // three threads filed, none waiting yet
    const a = row("Vendor A · pricing and uptime")!;
    await lab.sayInThread(id, a.id, "Check their status page too.");
    await lab.resolve(id, a.id);
    expect(row("Vendor A · pricing and uptime")?.status).toBe("in_progress");
    expect(row("Vendor A · pricing and uptime")?.waitingOn).toBeUndefined();
  });

  it("files threads with ordinary task assignees, and a code change with the coder's harness", async () => {
    const { lab, id, row } = await threads();
    await vi.advanceTimersByTimeAsync(2000);
    expect(row("Vendor B · regions")?.assignee).toBe("desk.thread");
    expect(row("Vendor B · regions")?.harness).toBeUndefined();
    await lab.send(id, "Add a CHANGELOG line for the vendor pick");
    await vi.advanceTimersByTimeAsync(800);
    expect(row("Add a CHANGELOG line for the vendor pick")).toMatchObject({ assignee: "desk.coder", harness: "claude-code" });
  });
});

describe("the fixture's threads, on review", () => {
  it("advances each thread by its own id, so two code requests with one title both reach review", async () => {
    const lab = createFixtureLab();
    const { id } = await lab.openSession("threads", "project-vendor-notes");
    let rows: TaskRow[] = [];
    lab.watchTasks(id, (next) => (rows = next));
    await lab.send(id, "Add a CHANGELOG line for the vendor pick");
    await vi.advanceTimersByTimeAsync(4000);
    await lab.send(id, "Add a CHANGELOG line for the vendor pick");
    await vi.advanceTimersByTimeAsync(4000);
    expect(rows.map((t) => t.waitingOn?.kind)).toEqual(["review", "review"]);
  });

  it("marks the line that asked for threads, not one queued behind it", async () => {
    const lab = createFixtureLab();
    const { id } = await lab.openSession("threads", "project-vendor-notes");
    let entries: { kind: string; text?: string; sentToThread?: boolean }[] = [];
    lab.watchThread(id, (view) => (entries = view.entries));
    await lab.send(id, "Research three vendors, one thread each.");
    await lab.send(id, "Also keep it short.");
    await vi.advanceTimersByTimeAsync(700); // the first thread is filed; the second line still waits
    const marked = entries.filter((e) => e.kind === "user" && e.sentToThread).map((e) => e.text);
    expect(marked).toEqual(["Research three vendors, one thread each."]);
  });

  it("matches a stop line against task titles literally, so a title with regex characters can't break the turn", async () => {
    const lab = createFixtureLab();
    const { id } = await lab.openSession("threads", "project-vendor-notes");
    let running = true;
    lab.watchThread(id, (view) => (running = view.running));
    await lab.send(id, "Add code [x");
    await vi.advanceTimersByTimeAsync(1300);
    await lab.send(id, "Thanks");
    await vi.advanceTimersByTimeAsync(2500);
    expect(running).toBe(false);
  });
});

describe("the fixture's stop line, with punctuation in titles", () => {
  it("cancels the thread whose file the line names, not the first one running", async () => {
    const lab = createFixtureLab();
    const { id } = await lab.openSession("threads", "project-vendor-notes");
    let rows: TaskRow[] = [];
    lab.watchTasks(id, (next) => (rows = next));
    await lab.send(id, "Add code first.ts");
    await vi.advanceTimersByTimeAsync(1300);
    await lab.send(id, "Add code second.ts");
    await vi.advanceTimersByTimeAsync(1300);
    await lab.send(id, "Stop second.ts");
    await vi.advanceTimersByTimeAsync(1000);
    expect(rows.find((t) => t.title === "Add code second.ts")?.status).toBe("cancelled");
    expect(rows.find((t) => t.title === "Add code first.ts")?.status).not.toBe("cancelled");
  });
});
