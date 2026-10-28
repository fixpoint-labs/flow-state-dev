/**
 * V5 — a worker's door (FIX-1690, BR-1, BR-2).
 *
 * An app sends a user's line into a worker's session through the door the
 * worker's inventory row names, without knowing the worker's flow. So the hire
 * reads it off the worker flow once: `respond`, the public action with
 * `userMessage` and a `{ message }` input every worker flow declares.
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

/** A worker flow with no door: its one action takes `{ note }` and writes no user item. */
const quietFlow = defineFlow({
  kind: "quiet",
  cardinality: "collection",
  configSchema: workerConfigSchema(),
  actions: {
    run: { inputSchema: note, block: work },
    // Takes `{ message }` but declares no `userMessage`: not a door.
    log: { inputSchema: message, block: echo },
  },
});

/** A worker flow with two doors. */
const twoDoorFlow = defineFlow({
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

/** A worker flow with one door, `respond`, beside an action of its own. */
const deskFlow = defineFlow({
  kind: "desk",
  cardinality: "collection",
  configSchema: workerConfigSchema(),
  actions: {
    note: { inputSchema: note, block: work },
    respond: { inputSchema: message, block: echo, userMessage: (i: { message: string }) => i.message },
  },
});

/** A worker flow whose one user-message action is named something other than `respond`. */
const chatFlow = defineFlow({
  kind: "chatter",
  cardinality: "collection",
  configSchema: workerConfigSchema(),
  actions: {
    chat: { inputSchema: message, block: echo, userMessage: (i: { message: string }) => i.message },
  },
});

const flows = { desk: deskFlow };

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
  it("is `respond` on the built-in agent worker flow", () => {
    const [worker] = mintWorkers([record("eng.lead")], { workerFlows: flows });
    expect(worker!.kind).toBe("agent");
    expect(workerDoorOf(worker!)).toEqual({ door: "respond" });
  });

  it("is `respond` on a worker flow of an app's own", () => {
    const [worker] = mintWorkers([record("eng.desk", "desk")], { workerFlows: flows });
    expect(workerDoorOf(worker!)).toEqual({ door: "respond" });
  });

  // An app sends a user's line to `respond` on any worker without reading
  // anything first, so a door under another name is one it can't reach.
  it("refuses a worker flow whose user-message action has another name, naming the action to rename", () => {
    const message = refusalOf(() => mintWorkers([record("eng.chat", "chatter")], { workerFlows: { chatter: chatFlow } }));
    expect(message).toContain('worker flow "chatter"');
    expect(message).toContain('rename "chat" to "respond"');
    expect(message).toContain("nothing was hired");
  });

  it("refuses a worker flow with no door when it is registered, and hires nothing", () => {
    const message = refusalOf(() => mintWorkers([record("eng.quiet", "quiet")], { workerFlows: { quiet: quietFlow } }));
    expect(message).toContain('worker flow "quiet" has no door');
    expect(message).toContain("nothing was hired");
  });

  it("refuses a worker flow with two doors when it is registered, naming both, and prints no warning", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const message = refusalOf(() =>
      mintWorkers([record("eng.chatty", "two-door")], { workerFlows: { "two-door": twoDoorFlow } }),
    );
    expect(message).toContain('worker flow "two-door" has 2 doors ("message", "say")');
    expect(warn).not.toHaveBeenCalled();
  });

  it("is written on the worker's inventory row at boot", async () => {
    const workers = mintWorkers([record("eng.lead"), record("eng.desk", "desk")], {
      workerFlows: flows,
    });
    const sent: unknown[] = [];
    await openInventory(
      { workers },
      {
        run: async (request) => void sent.push(request.input),
        userId: "u",
        orgId: "org",
        workerWriter: { flowKind: "inventory-writer" },
      },
    );
    expect(sent).toEqual([
      {
        workers: [
          { id: "eng.desk", kind: "desk", door: "respond", rules: false, hired: false, incarnation: null, name: null, teamName: null },
          { id: "eng.lead", kind: "agent", door: "respond", rules: true, hired: false, incarnation: null, name: null, teamName: null },
        ],
      },
    ]);
  });

  // Standing rules (FIX-1945): an app shows a rules screen off this flag, and
  // an app's own `agent` may leave the rules action out. Reading the flag off
  // the flow's kind would offer that worker a screen whose every call fails.
  it("says a worker keeps standing rules from its flow's actions, not the flow's name", async () => {
    const theirAgent = defineFlow({
      kind: "agent",
      cardinality: "collection",
      configSchema: workerConfigSchema(),
      actions: { respond: { inputSchema: message, block: echo, userMessage: (i: { message: string }) => i.message } },
    });
    const workers = mintWorkers([record("eng.lead")], { workerFlows: { agent: theirAgent } });
    const sent: { workers: { rules: boolean }[] }[] = [];
    await openInventory(
      { workers },
      {
        run: async (request) => void sent.push(request.input as never),
        userId: "u",
        orgId: "org",
        workerWriter: { flowKind: "inventory-writer" },
      },
    );
    expect(workers[0]!.kind).toBe("agent");
    expect(sent[0]!.workers[0]!.rules).toBe(false);
  });
});

