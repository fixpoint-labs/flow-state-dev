/**
 * V5 — a worker's door (FIX-1690, BR-1, BR-2).
 *
 * An app sends a person's line into a worker's session through the door the
 * worker's inventory row names, without knowing the worker's kind. So the hire
 * reads it off the kind once: the one public action with `userMessage` and a
 * `{ message }` input.
 *
 * A worker flow with none, or with two, is refused when it is registered
 * (FIX-1789), so every hired worker has exactly one.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { defineFlow, handler } from "@flow-state-dev/core";
import { mintWorkers } from "../src/hire";
import { openInventory } from "../src/inventory/open-inventory";
import type { WorkerManifest } from "../src/manifest";
import { workerDoorOf } from "../src/worker-door";
import { workerConfigSchema } from "../src/worker-config";

const message = z.object({ message: z.string() });
const echo = handler({ name: "door-echo", inputSchema: message, outputSchema: message, execute: (i) => i });
const note = z.object({ note: z.string() });
const work = handler({ name: "door-work", inputSchema: note, outputSchema: note, execute: (i) => i });

/** A kind with no door: its one action takes `{ note }` and writes no user item. */
const quietKind = defineFlow({
  kind: "quiet",
  cardinality: "collection",
  configSchema: workerConfigSchema(),
  actions: {
    run: { inputSchema: note, block: work },
    // Takes `{ message }` but declares no `userMessage`: not a door.
    log: { inputSchema: message, block: echo },
  },
});

/** A kind with two doors. */
const twoDoorKind = defineFlow({
  kind: "two-door",
  cardinality: "collection",
  configSchema: workerConfigSchema(),
  actions: {
    message: { inputSchema: message, block: echo, userMessage: (i: { message: string }) => i.message },
    say: { inputSchema: message, block: echo, userMessage: (i: { message: string }) => i.message },
    // `userMessage` but the wrong input: not a door, so not a third.
    work: { inputSchema: note, block: work, userMessage: (i: { note: string }) => i.note },
  },
});

/** A kind with one door, under a name other than the built-in's. */
const deskKind = defineFlow({
  kind: "desk",
  cardinality: "collection",
  configSchema: workerConfigSchema(),
  actions: {
    run: { inputSchema: note, block: work },
    ask: { inputSchema: message, block: echo, userMessage: (i: { message: string }) => i.message },
  },
});

const kinds = { desk: deskKind };

function record(id: string, flow?: string): WorkerManifest {
  return { id, declared: { description: id, ...(flow === undefined ? {} : { flow }) }, body: "" };
}

afterEach(() => vi.restoreAllMocks());

function refusalOf(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  return "";
}

describe("a worker's door (BR-1, BR-2)", () => {
  it("is the built-in agent kind's `run`", () => {
    const [worker] = mintWorkers([record("eng.lead")], { workerFlows: kinds });
    expect(worker!.kind).toBe("agent");
    expect(workerDoorOf(worker!)).toEqual({ door: "run" });
  });

  it("is the one public action a kind declares for a person's message", () => {
    const [worker] = mintWorkers([record("eng.desk", "desk")], { workerFlows: kinds });
    expect(workerDoorOf(worker!)).toEqual({ door: "ask" });
  });

  it("refuses a kind with no door when it is registered, and hires nothing", () => {
    const message = refusalOf(() => mintWorkers([record("eng.quiet", "quiet")], { workerFlows: { quiet: quietKind } }));
    expect(message).toContain('worker flow "quiet" has no door');
    expect(message).toContain("nothing was hired");
  });

  it("refuses a kind with two doors when it is registered, naming both, and prints no warning", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const message = refusalOf(() =>
      mintWorkers([record("eng.chatty", "two-door")], { workerFlows: { "two-door": twoDoorKind } }),
    );
    expect(message).toContain('worker flow "two-door" has 2 doors ("message", "say")');
    expect(warn).not.toHaveBeenCalled();
  });

  it("is written on the worker's inventory row at boot", async () => {
    const workers = mintWorkers([record("eng.lead"), record("eng.desk", "desk")], {
      workerFlows: kinds,
    });
    const sent: unknown[] = [];
    await openInventory(
      { workers, mailboxes: [] },
      {
        run: async (request) => void sent.push(request.input),
        userId: "u",
        orgId: "org",
        workerWriter: { flowKind: "mailbox" },
      },
    );
    expect(sent).toEqual([
      {
        workers: [
          { id: "eng.desk", kind: "desk", door: "ask", hired: false, incarnation: null },
          { id: "eng.lead", kind: "agent", door: "run", hired: false, incarnation: null },
        ],
      },
    ]);
  });
});

