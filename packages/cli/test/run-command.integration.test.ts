import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { resolve } from "node:path";
import { createInMemoryStores } from "@flow-state-dev/server";
import { executeRunCommand, type FlowRunResult, type FlowEvent } from "../src/commands/run.js";
import { CliError } from "../src/resolve-block.js";

const fixturesDir = resolve(import.meta.dirname, "fixtures");

// Capture stdout writes as NDJSON lines
let stdoutLines: string[];
const originalStdoutWrite = process.stdout.write;

beforeEach(() => {
  stdoutLines = [];
  process.stdout.write = vi.fn((chunk: any) => {
    const text = typeof chunk === "string" ? chunk : chunk.toString();
    // Split by newlines to capture individual NDJSON events
    for (const line of text.split("\n")) {
      if (line.trim().length > 0) {
        stdoutLines.push(line);
      }
    }
    return true;
  }) as any;
  process.exitCode = undefined;
});

afterEach(() => {
  process.stdout.write = originalStdoutWrite;
  process.exitCode = undefined;
});

/** Parse all NDJSON lines from stdout into FlowEvent objects. */
function parsedEvents(): FlowEvent[] {
  return stdoutLines.map((line) => JSON.parse(line));
}

describe("fsdev run integration", () => {
  it("executes a handler flow with inline JSON input", async () => {
    const result = await executeRunCommand("echo", "respond", {
      input: '{"message": "hello"}',
      cwd: fixturesDir,
      stores: createInMemoryStores(),
    });

    expect(result.success).toBe(true);
    expect(result.flow.kind).toBe("echo");
    expect(result.flow.action).toBe("respond");
    expect(result.output).toEqual({ reply: "Echo: hello", source: "echo-flow" });
    expect(result.execution.durationMs).toBeGreaterThanOrEqual(0);
    expect(process.exitCode).toBe(0);
  });

  it("emits flow_complete NDJSON event on success", async () => {
    await executeRunCommand("echo", "respond", {
      input: '{"message": "test"}',
      cwd: fixturesDir,
      stores: createInMemoryStores(),
    });

    const events = parsedEvents();
    const completeEvent = events.find((e) => e.type === "flow_complete");
    expect(completeEvent).toBeDefined();
    expect(completeEvent!.type).toBe("flow_complete");
    expect((completeEvent as any).output).toEqual({ reply: "Echo: test", source: "echo-flow" });
    expect((completeEvent as any).durationMs).toBeGreaterThanOrEqual(0);
  });

  it("emits error NDJSON event on execution failure", async () => {
    const result = await executeRunCommand("throwing", "fail", {
      input: '{"message": "test"}',
      cwd: fixturesDir,
      stores: createInMemoryStores(),
    });

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error!.message).toContain("Intentional test error from flow");
    expect(process.exitCode).toBe(1);

    const events = parsedEvents();
    const errorEvent = events.find((e) => e.type === "error");
    expect(errorEvent).toBeDefined();
  });

  it("throws CliError for unknown flow kind", async () => {
    await expect(
      executeRunCommand("nonexistent", "action", {
        input: '{}',
        cwd: fixturesDir,
        stores: createInMemoryStores(),
      }),
    ).rejects.toThrow(CliError);

    await expect(
      executeRunCommand("nonexistent", "action", {
        input: '{}',
        cwd: fixturesDir,
        stores: createInMemoryStores(),
      }),
    ).rejects.toThrow(/Flow "nonexistent" not found/);
  });

  it("throws CliError for unknown action", async () => {
    await expect(
      executeRunCommand("echo", "nonexistent", {
        input: '{}',
        cwd: fixturesDir,
        stores: createInMemoryStores(),
      }),
    ).rejects.toThrow(CliError);

    await expect(
      executeRunCommand("echo", "nonexistent", {
        input: '{}',
        cwd: fixturesDir,
        stores: createInMemoryStores(),
      }),
    ).rejects.toThrow(/Action "nonexistent" not found/);
  });

  it("supports session reuse across invocations", async () => {
    const stores = createInMemoryStores();
    const sessionId = "test-session-reuse";

    // First invocation: counter starts at 0, increments to 1
    const result1 = await executeRunCommand("stateful", "increment", {
      input: '{"increment": 1}',
      session: sessionId,
      cwd: fixturesDir,
      stores,
    });

    expect(result1.success).toBe(true);
    expect(result1.output).toEqual({ count: 1 });

    // Second invocation: counter starts at 1, increments to 2
    const result2 = await executeRunCommand("stateful", "increment", {
      input: '{"increment": 1}',
      session: sessionId,
      cwd: fixturesDir,
      stores,
    });

    expect(result2.success).toBe(true);
    expect(result2.output).toEqual({ count: 2 });
  });

  it("reports durationMs and itemCount in execution metadata", async () => {
    const result = await executeRunCommand("echo", "respond", {
      input: '{"message": "timing"}',
      cwd: fixturesDir,
      stores: createInMemoryStores(),
    });

    expect(typeof result.execution.durationMs).toBe("number");
    expect(result.execution.durationMs).toBeGreaterThanOrEqual(0);
    expect(typeof result.execution.itemCount).toBe("number");
  });

  it("lists available flows in error message when flow not found", async () => {
    try {
      await executeRunCommand("nonexistent", "action", {
        input: '{}',
        cwd: fixturesDir,
        stores: createInMemoryStores(),
      });
    } catch (err) {
      expect(err).toBeInstanceOf(CliError);
      const message = (err as CliError).message;
      // The error should list discovered flow kinds
      expect(message).toContain("echo");
      expect(message).toContain("stateful");
      expect(message).toContain("throwing");
    }
  });

  it("lists available actions in error message when action not found", async () => {
    try {
      await executeRunCommand("echo", "nonexistent", {
        input: '{}',
        cwd: fixturesDir,
        stores: createInMemoryStores(),
      });
    } catch (err) {
      expect(err).toBeInstanceOf(CliError);
      const message = (err as CliError).message;
      expect(message).toContain("respond");
    }
  });
});
