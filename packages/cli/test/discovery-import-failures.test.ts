/**
 * Regression tests for FIX-785: flow discovery must report modules that
 * throw during import instead of silently dropping them.
 *
 * Uses the dedicated fixtures-import-failure/ tree (one healthy flow, one
 * module that throws at import time) so the broken module doesn't inject
 * warnings into the shared fixtures/ discovery tests.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { resolve } from "node:path";
import { createInMemoryStores } from "@flow-state-dev/engine";
import { executeRunCommand } from "../src/commands/run";
import {
  discoverFlows,
  formatImportFailureWarning,
  formatFailedImportSection,
  type FlowImportFailure,
} from "../src/resolve-flow";
import { CliError } from "../src/resolve-block";

const fixturesDir = resolve(import.meta.dirname, "fixtures-import-failure");
const brokenFlowPath = resolve(fixturesDir, "flows/broken-flow/flow.ts");

// Capture stdout/stderr writes (stdout is reserved for NDJSON)
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

describe("flow discovery import failures", () => {
  it("continues discovery past a broken module and reports it via onImportFailed", async () => {
    const failures: FlowImportFailure[] = [];
    const flows = await discoverFlows({
      cwd: fixturesDir,
      onImportFailed: (failure) => failures.push(failure),
    });

    // The healthy flow is still discovered
    expect(flows.map((f) => f.kind)).toContain("good");

    // The broken module is reported exactly once, with path and cause
    expect(failures).toHaveLength(1);
    expect(failures[0].filePath).toBe(brokenFlowPath);
    expect(failures[0].message).toContain("boom on import");
    expect(failures[0].cause).toBeInstanceOf(Error);
  });

  it("stops candidate fallthrough after a failed import", async () => {
    const failures: FlowImportFailure[] = [];
    const flows = await discoverFlows({
      cwd: fixturesDir,
      onImportFailed: (failure) => failures.push(failure),
    });

    // broken-flow/ contains a valid index.ts behind the throwing flow.ts.
    // A failed import means the directory's flow is broken, not absent —
    // the fallback candidate must not be imported in its place.
    expect(flows.map((f) => f.kind)).not.toContain("broken-fallback");
    // And the failure is reported exactly once, for flow.ts only
    expect(failures).toHaveLength(1);
    expect(failures[0].filePath).toBe(brokenFlowPath);
  });

  it("falls through to index.ts when flow.ts imports cleanly but isn't a flow", async () => {
    const failures: FlowImportFailure[] = [];
    const flows = await discoverFlows({
      cwd: fixturesDir,
      onImportFailed: (failure) => failures.push(failure),
    });

    // helper-first/flow.ts is a plain helper module (no default flow export);
    // the barrel-style index.ts behind it is the real flow and must be found,
    // without any failure being reported for the non-flow candidate.
    expect(flows.map((f) => f.kind)).toContain("helper-first");
    expect(failures.map((f) => f.filePath)).toEqual([brokenFlowPath]);
  });

  it("ignores failures when no onImportFailed callback is provided", async () => {
    const flows = await discoverFlows({ cwd: fixturesDir });

    expect(flows.map((f) => f.kind)).toContain("good");
    // The library itself never writes to stderr
    expect(stderrLines).toHaveLength(0);
  });

  it("lists failed imports in the flow-not-found error", async () => {
    let caught: unknown;
    try {
      await executeRunCommand("nonexistent", "action", {
        input: "{}",
        cwd: fixturesDir,
        stores: createInMemoryStores(),
      });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(CliError);
    const message = (caught as CliError).message;
    expect(message).toContain('Flow "nonexistent" not found');
    expect(message).toContain("Available flows: good");
    expect(message).toContain("1 flow module(s) failed to import");
    expect(message).toContain(brokenFlowPath);
    expect(message).toContain("boom on import");
  });

  it("indents multi-line error messages in warnings and error sections", () => {
    const failure: FlowImportFailure = {
      filePath: "/repo/flows/x/flow.ts",
      message: "Error: line one\nline two",
      cause: undefined,
    };

    // Continuation lines must stay visually attached to their entry —
    // a column-0 continuation is indistinguishable from a new warning.
    expect(formatImportFailureWarning(failure)).toBe(
      "Warning: failed to import flow module: /repo/flows/x/flow.ts\n  Error: line one\n  line two\n",
    );
    expect(formatFailedImportSection([failure])).toBe(
      "\n1 flow module(s) failed to import:\n  /repo/flows/x/flow.ts: Error: line one\n    line two",
    );
  });

  it("warns on stderr about failed imports even when the run succeeds", async () => {
    const result = await executeRunCommand("good", "respond", {
      input: '{"message": "hello"}',
      cwd: fixturesDir,
      stores: createInMemoryStores(),
    });

    expect(result.success).toBe(true);
    expect(result.output).toEqual({ reply: "good: hello" });

    const warning = stderrLines.find((line) =>
      line.includes("Warning: failed to import flow module:"),
    );
    expect(warning).toBeDefined();
    expect(warning).toContain(brokenFlowPath);
    // Warnings stay off stdout — NDJSON purity
    for (const line of stdoutLines) {
      expect(line).not.toContain("Warning: failed to import");
    }
  });
});
