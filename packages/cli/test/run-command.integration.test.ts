import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createInMemoryStores } from "@flow-state-dev/engine";
import { executeRunCommand, type FlowRunResult, type FlowEvent } from "../src/commands/run";
import { discoverFlows, getSearchedDirs } from "../src/resolve-flow";
import { CliError } from "../src/resolve-block";
import { EXIT_DISCOVERY_ERROR, EXIT_INVALID_ARGS } from "../src/exit-codes";

const fixturesDir = resolve(import.meta.dirname, "fixtures");

// Capture stdout writes as NDJSON lines
let stdoutLines: string[];
let stderrLines: string[];
const originalStdoutWrite = process.stdout.write;
const originalStderrWrite = process.stderr.write;

beforeEach(() => {
  stdoutLines = [];
  stderrLines = [];
  process.stdout.write = vi.fn((chunk: any) => {
    const text = typeof chunk === "string" ? chunk : chunk.toString();
    for (const line of text.split("\n")) {
      if (line.trim().length > 0) {
        stdoutLines.push(line);
      }
    }
    return true;
  }) as any;
  process.stderr.write = vi.fn((chunk: any) => {
    const text = typeof chunk === "string" ? chunk : chunk.toString();
    for (const line of text.split("\n")) {
      if (line.trim().length > 0) {
        stderrLines.push(line);
      }
    }
    return true;
  }) as any;
  process.exitCode = undefined;
});

afterEach(() => {
  process.stdout.write = originalStdoutWrite;
  process.stderr.write = originalStderrWrite;
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

describe("monorepo flow discovery", () => {
  it("discovers flows from examples/*/src/flows/ in monorepo structure", async () => {
    const flows = await discoverFlows(fixturesDir);
    const kinds = flows.map((f) => f.kind);

    // Root-level flows (src/flows/ → fixtures/flows/)
    expect(kinds).toContain("echo");
    expect(kinds).toContain("stateful");
    expect(kinds).toContain("throwing");

    // Monorepo-scanned flow (examples/sample-app/src/flows/nested-flow/)
    expect(kinds).toContain("nested");
  });

  it("executes a monorepo-discovered flow via executeRunCommand", async () => {
    const result = await executeRunCommand("nested", "process", {
      input: '{"value": "from-monorepo"}',
      cwd: fixturesDir,
      stores: createInMemoryStores(),
    });

    expect(result.success).toBe(true);
    expect(result.flow.kind).toBe("nested");
    expect(result.flow.action).toBe("process");
    expect(result.output).toEqual({ result: "nested: from-monorepo" });
  });

  it("discovers flows from labs/*/src/flows/ in monorepo structure", async () => {
    const flows = await discoverFlows(fixturesDir);
    const kinds = flows.map((f) => f.kind);

    // Monorepo-scanned flow (labs/sample-lab/src/flows/labbed-flow/)
    expect(kinds).toContain("labbed");
  });

  it("includes labs/ directories in getSearchedDirs", () => {
    const searched = getSearchedDirs({ cwd: fixturesDir });
    expect(searched).toContain("labs/sample-lab/src/flows");
  });

  it("deduplicates flows by kind (first discovered wins)", async () => {
    const flows = await discoverFlows(fixturesDir);
    const kindCounts = new Map<string, number>();
    for (const flow of flows) {
      kindCounts.set(flow.kind, (kindCounts.get(flow.kind) ?? 0) + 1);
    }
    // Every kind should appear exactly once
    for (const [kind, count] of kindCounts) {
      expect(count, `kind "${kind}" should appear once`).toBe(1);
    }
  });
});

describe("--flow-dir explicit override", () => {
  it("restricts discovery to specified directories only", async () => {
    const flows = await discoverFlows({
      cwd: fixturesDir,
      flowDirs: ["examples/sample-app/src/flows"],
    });
    const kinds = flows.map((f) => f.kind);

    // Should find the nested flow from the explicit directory
    expect(kinds).toContain("nested");
    // Should NOT find root-level flows since we overrode discovery
    expect(kinds).not.toContain("echo");
    expect(kinds).not.toContain("stateful");
    expect(kinds).not.toContain("throwing");
  });

  it("supports multiple --flow-dir values", async () => {
    const flows = await discoverFlows({
      cwd: fixturesDir,
      flowDirs: ["flows", "examples/sample-app/src/flows"],
    });
    const kinds = flows.map((f) => f.kind);

    // Should find flows from both directories
    expect(kinds).toContain("echo");
    expect(kinds).toContain("nested");
  });

  it("passes --flow-dir through executeRunCommand", async () => {
    const result = await executeRunCommand("nested", "process", {
      input: '{"value": "explicit-dir"}',
      cwd: fixturesDir,
      flowDir: ["examples/sample-app/src/flows"],
      stores: createInMemoryStores(),
    });

    expect(result.success).toBe(true);
    expect(result.output).toEqual({ result: "nested: explicit-dir" });
  });

  it("shows --flow-dir paths in error message when flow not found", async () => {
    try {
      await executeRunCommand("nonexistent", "action", {
        input: '{}',
        cwd: fixturesDir,
        flowDir: ["custom/path"],
        stores: createInMemoryStores(),
      });
    } catch (err) {
      expect(err).toBeInstanceOf(CliError);
      const message = (err as CliError).message;
      expect(message).toContain("custom/path");
    }
  });
});

describe("exit codes", () => {
  it("uses exit code 4 (discovery) when flow is not found", async () => {
    try {
      await executeRunCommand("nonexistent", "action", {
        input: '{}',
        cwd: fixturesDir,
        stores: createInMemoryStores(),
      });
      expect.fail("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(CliError);
      expect((err as CliError).exitCode).toBe(EXIT_DISCOVERY_ERROR);
    }
  });

  it("uses exit code 2 (input) when action is not found", async () => {
    try {
      await executeRunCommand("echo", "nonexistent", {
        input: '{}',
        cwd: fixturesDir,
        stores: createInMemoryStores(),
      });
      expect.fail("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(CliError);
      expect((err as CliError).exitCode).toBe(EXIT_INVALID_ARGS);
    }
  });

  it("uses exit code 0 on successful execution", async () => {
    await executeRunCommand("echo", "respond", {
      input: '{"message": "hello"}',
      cwd: fixturesDir,
      stores: createInMemoryStores(),
    });

    expect(process.exitCode).toBe(0);
  });

  it("uses exit code 1 on execution error", async () => {
    await executeRunCommand("throwing", "fail", {
      input: '{"message": "test"}',
      cwd: fixturesDir,
      stores: createInMemoryStores(),
    });

    expect(process.exitCode).toBe(1);
  });
});

describe("stderr runtime logger", () => {
  it("emits [flow-state] action lifecycle events to stderr by default", async () => {
    await executeRunCommand("echo", "respond", {
      input: '{"message": "logger-default"}',
      cwd: fixturesDir,
      stores: createInMemoryStores(),
    });

    const startedLine = stderrLines.find((l) => l.startsWith("[flow-state] action execution started"));
    const completedLine = stderrLines.find((l) => l.startsWith("[flow-state] action execution completed"));
    expect(startedLine).toBeDefined();
    expect(completedLine).toBeDefined();
  });

  it("does not pollute stdout NDJSON with runtime log lines", async () => {
    await executeRunCommand("echo", "respond", {
      input: '{"message": "stdout-clean"}',
      cwd: fixturesDir,
      stores: createInMemoryStores(),
    });

    for (const line of stdoutLines) {
      expect(line.startsWith("[flow-state]")).toBe(false);
      // Every stdout line must be valid NDJSON
      expect(() => JSON.parse(line)).not.toThrow();
    }
  });

  it("--quiet suppresses all stderr runtime logs", async () => {
    await executeRunCommand("echo", "respond", {
      input: '{"message": "quiet"}',
      cwd: fixturesDir,
      stores: createInMemoryStores(),
      quiet: true,
    });

    expect(stderrLines.filter((l) => l.startsWith("[flow-state]"))).toEqual([]);
  });

  it("--log-level warn drops info-level lifecycle events", async () => {
    await executeRunCommand("echo", "respond", {
      input: '{"message": "warn-only"}',
      cwd: fixturesDir,
      stores: createInMemoryStores(),
      logLevel: "warn",
    });

    expect(stderrLines.find((l) => l.startsWith("[flow-state] action execution started"))).toBeUndefined();
    expect(stderrLines.find((l) => l.startsWith("[flow-state] action execution completed"))).toBeUndefined();
  });

  it("rejects unknown --log-level values with EXIT_INVALID_ARGS", async () => {
    await expect(
      executeRunCommand("echo", "respond", {
        input: '{"message": "bad-level"}',
        cwd: fixturesDir,
        stores: createInMemoryStores(),
        logLevel: "trace" as any,
      }),
    ).rejects.toThrow(/Invalid --log-level/);
  });
});

describe("--capture", () => {
  let captureDir: string;

  beforeEach(() => {
    captureDir = mkdtempSync(join(tmpdir(), "fsdev-capture-"));
  });

  afterEach(() => {
    rmSync(captureDir, { recursive: true, force: true });
  });

  it("writes the structured run payload to the capture file", async () => {
    const capturePath = join(captureDir, "run.json");

    const result = await executeRunCommand("echo", "respond", {
      input: '{"message": "capture-me"}',
      cwd: fixturesDir,
      stores: createInMemoryStores(),
      capture: capturePath,
      quiet: true,
    });

    const payload = JSON.parse(readFileSync(capturePath, "utf-8"));
    expect(payload.command.flow).toBe("echo");
    expect(payload.command.action).toBe("respond");
    expect(payload.command.input).toEqual({ message: "capture-me" });
    expect(Array.isArray(payload.events)).toBe(true);
    expect(payload.events.find((e: FlowEvent) => e.type === "flow_complete")).toBeDefined();
    expect(payload.result.success).toBe(true);
    expect(payload.result.exitCode).toBe(0);
    expect(result.success).toBe(true);
  });

  it("captures error events when the flow fails", async () => {
    const capturePath = join(captureDir, "fail.json");

    await executeRunCommand("throwing", "fail", {
      input: '{"message": "boom"}',
      cwd: fixturesDir,
      stores: createInMemoryStores(),
      capture: capturePath,
      quiet: true,
    });

    const payload = JSON.parse(readFileSync(capturePath, "utf-8"));
    expect(payload.result.success).toBe(false);
    expect(payload.result.exitCode).toBe(1);
    expect(payload.events.find((e: FlowEvent) => e.type === "error")).toBeDefined();
  });

  it("creates parent directories when --capture path is nested", async () => {
    const capturePath = join(captureDir, "nested", "subdir", "run.json");

    await executeRunCommand("echo", "respond", {
      input: '{"message": "deep"}',
      cwd: fixturesDir,
      stores: createInMemoryStores(),
      capture: capturePath,
      quiet: true,
    });

    const payload = JSON.parse(readFileSync(capturePath, "utf-8"));
    expect(payload.command.flow).toBe("echo");
  });

  it("still emits NDJSON to stdout when --capture is set (additive)", async () => {
    const capturePath = join(captureDir, "additive.json");

    await executeRunCommand("echo", "respond", {
      input: '{"message": "both"}',
      cwd: fixturesDir,
      stores: createInMemoryStores(),
      capture: capturePath,
      quiet: true,
    });

    const events = stdoutLines.map((line) => JSON.parse(line));
    expect(events.find((e) => e.type === "flow_complete")).toBeDefined();
  });
});

describe("seed state", () => {
  it("seeds session state with inline JSON via --seed-session", async () => {
    const stores = createInMemoryStores();

    const result = await executeRunCommand("stateful", "increment", {
      input: '{"increment": 1}',
      seedSession: '{"count": 10}',
      cwd: fixturesDir,
      stores,
    });

    expect(result.success).toBe(true);
    // Should start from seeded value 10 and increment by 1
    expect(result.output).toEqual({ count: 11 });
  });

  it("seeds session state from file via --seed-session", async () => {
    const stores = createInMemoryStores();
    const seedFile = resolve(fixturesDir, "seed-session.json");

    const result = await executeRunCommand("stateful", "increment", {
      input: '{"increment": 1}',
      seedSession: seedFile,
      cwd: fixturesDir,
      stores,
    });

    expect(result.success).toBe(true);
    expect(result.output).toEqual({ count: 6 });
  });

  it("throws CliError for invalid seed JSON", async () => {
    await expect(
      executeRunCommand("stateful", "increment", {
        input: '{"increment": 1}',
        seedSession: '{invalid json}',
        cwd: fixturesDir,
        stores: createInMemoryStores(),
      }),
    ).rejects.toThrow(CliError);
  });
});

const appConfigDir = resolve(import.meta.dirname, "fixtures-config", "app");

interface ConfigStashes {
  __fsdevModelCalls: string[];
  __fsdevTestStores?: { session: { get: (id: string) => Promise<unknown> } };
}

describe("fsdev run with fsdev.config.ts", () => {
  it("executes the flow from the config's registry and resolves models through the config resolver", async () => {
    const result = await executeRunCommand("gen", "respond", {
      input: '{"message": "hi"}',
      cwd: appConfigDir,
      session: "cfg-sess",
    });

    expect(result.success).toBe(true);
    const stashes = globalThis as unknown as ConfigStashes;
    // The config's resolver was used (the generator's configured model id flows
    // through it), not a CLI-default resolver.
    expect(stashes.__fsdevModelCalls).toContain("config/default-model");
    // stdout stays NDJSON-pure: loading the config (which logs its active
    // profile) must not leak a non-JSON line onto stdout.
    expect(() => parsedEvents()).not.toThrow();
    expect(parsedEvents().some((e) => e.type === "flow_complete")).toBe(true);
  });

  it("writes through the config's store instances", async () => {
    await executeRunCommand("gen", "respond", {
      input: '{"message": "hi"}',
      cwd: appConfigDir,
      session: "shared-sess",
    });

    const stashes = globalThis as unknown as ConfigStashes;
    expect(stashes.__fsdevTestStores).toBeDefined();
    // The run's session landed in the registry the config's adapter resolved —
    // the in-miniature form of "CLI runs appear in the app's .fsdev/data".
    const persisted = await stashes.__fsdevTestStores!.session.get("shared-sess");
    expect(persisted).toBeDefined();
  });

  it("routes --model through the config's resolver", async () => {
    await executeRunCommand("gen", "respond", {
      input: '{"message": "hi"}',
      cwd: appConfigDir,
      model: "forced/model",
      session: "model-sess",
    });

    const stashes = globalThis as unknown as ConfigStashes;
    expect(stashes.__fsdevModelCalls).toContain("forced/model");
  });

  it("rejects --flow-dir together with a config", async () => {
    await expect(
      executeRunCommand("gen", "respond", {
        input: '{"message": "hi"}',
        cwd: appConfigDir,
        flowDir: ["./flows"],
      }),
    ).rejects.toMatchObject({ exitCode: EXIT_INVALID_ARGS });
  });

  it("reports a flow missing from the config registry", async () => {
    const err = await executeRunCommand("nope", "respond", {
      input: "{}",
      cwd: appConfigDir,
    }).catch((e) => e);
    expect(err).toBeInstanceOf(CliError);
    expect(err.exitCode).toBe(EXIT_DISCOVERY_ERROR);
    expect(err.message).toContain("in fsdev config");
  });

  it("--no-config bypasses a present config and falls back to discovery", async () => {
    const err = await executeRunCommand("gen", "respond", {
      input: '{"message": "hi"}',
      cwd: appConfigDir,
      config: false,
    }).catch((e) => e);
    expect(err).toBeInstanceOf(CliError);
    expect(err.exitCode).toBe(EXIT_DISCOVERY_ERROR);
    // The discovery-path "not found" error names searched dirs; the config-path
    // error does not. Seeing "Searched:" proves the config was bypassed.
    expect(err.message).toContain("Searched:");
  });

  it("runs the same config twice in one process (cache-busting guards dispose)", async () => {
    const first = await executeRunCommand("gen", "respond", {
      input: '{"message": "one"}',
      cwd: appConfigDir,
      session: "twice-1",
    });
    const second = await executeRunCommand("gen", "respond", {
      input: '{"message": "two"}',
      cwd: appConfigDir,
      session: "twice-2",
    });
    expect(first.success).toBe(true);
    expect(second.success).toBe(true);
  });
});
