/**
 * The item contract all three harness modes owe, held against all three at once.
 *
 * Kitchen Sink is the one place that runs Claude Code, Codex and Cursor over
 * the same session flow. Each mode's own suite proves that harness; this
 * proves the three agree. The SDKs are the scripted ones (`lib/scripted-*.ts`);
 * translation, emission and the handle are the real adapters.
 *
 * Red states produced before this was trusted:
 *   - settle a tool item with a re-read `getItemCount()`: the unique-index case
 *     fails for Claude Code and Codex, and passes for Cursor.
 *   - drop `finalizeOpenItems` from a failure path: the nothing-left-open case fails.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createInMemoryStores } from "@flow-state-dev/engine";
import { testFlow } from "@flow-state-dev/testing";

import { claudeCodeSessionFlow } from "@/lib/claude-code-mode";
import { codexSessionFlow } from "@/lib/codex-mode";
import { cursorSessionFlow } from "@/lib/cursor-mode";
import { resetModeAvailabilityForTests } from "@/lib/harness-gate";
import { scriptedClaudeCode, scriptedPauses } from "@/lib/scripted-claude-code";
import { scriptedCodex, scriptedCodexPauses } from "@/lib/scripted-codex";
import { scriptedCursor, scriptedCursorPauses } from "@/lib/scripted-cursor";

/** An item as the response stream carries it, in the fields this file reads. */
interface EmittedItem {
  id?: unknown;
  type?: unknown;
  status?: unknown;
  itemIndex?: unknown;
  requestId?: unknown;
  ts?: unknown;
  provenance?: { blockName?: unknown } | null;
}

/**
 * Prompts differ because the scripts do: Codex runs a command every turn,
 * Claude Code runs five under `[bash]`, Cursor's tool call is the to-do under `[plan]`.
 * Each case asserts the same thing.
 */
const HARNESSES = [
  {
    mode: "claude-code",
    prompt: "[bash] do some work",
    flow: () => claudeCodeSessionFlow({ resolveClaudeAgent: scriptedClaudeCode() }),
  },
  {
    mode: "codex",
    prompt: "do some work",
    flow: () => codexSessionFlow({ resolveCodexClient: scriptedCodex() }),
  },
  {
    mode: "cursor",
    prompt: "[plan] do some work",
    flow: () => cursorSessionFlow({ resolveCursorClient: scriptedCursor() }),
  },
] as const;

let scratch: string;
let repo: string;
let stateHome: string;

beforeAll(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), "ks-harness-parity-")));
  repo = join(scratch, "repo");
  stateHome = join(scratch, "state");
  execFileSync("git", ["init", "-q", "-b", "main", repo]);
  writeFileSync(join(repo, "README.md"), "hello\n");
  execFileSync("git", ["-C", repo, "add", "."]);
  execFileSync("git", ["-C", repo, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init"]);
  // Every script's pauses are for a browser watching a run, not for this.
  for (const pauses of [scriptedPauses, scriptedCodexPauses, scriptedCursorPauses]) {
    pauses.stepMs = 0;
    pauses.slowMs = 0;
  }
});

afterAll(() => rmSync(scratch, { recursive: true, force: true }));

beforeEach(() => {
  vi.stubEnv("KITCHEN_SINK_HARNESS_WORKSPACE", repo);
  vi.stubEnv("XDG_STATE_HOME", stateHome);
  vi.stubEnv("KITCHEN_SINK_TEST_MODE", "");
  vi.stubEnv("GOAL_CONTROL", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
  resetModeAvailabilityForTests();
});

/** Run one turn of `harness` and return the items it emitted. */
async function itemsOfOneTurn(harness: (typeof HARNESSES)[number]): Promise<EmittedItem[]> {
  const result = await testFlow({
    flow: harness.flow(),
    action: "turn",
    userId: "u",
    sessionId: `s-parity-${harness.mode}`,
    input: { prompt: harness.prompt },
    stores: createInMemoryStores(),
  });
  expect(result.error, harness.mode).toBeUndefined();
  expect(result.status, harness.mode).toBe("completed");
  return (result.items ?? []) as EmittedItem[];
}

describe.each(HARNESSES)("$mode, against the item contract every harness owes", (harness) => {
  it("runs the turn, and shows the model's reply and the tool it used", async () => {
    // An empty list would pass every later case.
    const items = await itemsOfOneTurn(harness);
    expect(items.length).toBeGreaterThan(0);
    expect(items.some((i) => i.type === "message")).toBe(true);
    expect(items.some((i) => i.type === "tool_output")).toBe(true);
  });

  it("gives every item its own itemIndex", async () => {
    // `itemIndex` orders a request's items. Replay picks same-id traces by the highest one.
    const items = await itemsOfOneTurn(harness);
    const indices = items.map((i) => i.itemIndex);
    expect(indices.every((i) => typeof i === "number")).toBe(true);
    expect(new Set(indices).size).toBe(items.length);
  });

  it("stamps the request, the block and a timestamp on every item", async () => {
    // Without these the rail cannot attribute the item.
    const items = await itemsOfOneTurn(harness);
    for (const item of items) {
      expect(typeof item.id, `${harness.mode} id`).toBe("string");
      expect(typeof item.requestId, `${harness.mode} requestId`).toBe("string");
      expect(typeof item.ts, `${harness.mode} ts`).toBe("number");
      expect(typeof item.provenance?.blockName, `${harness.mode} provenance`).toBe("string");
    }
  });

  it("leaves nothing open when the turn is over", async () => {
    // An `in_progress` item after the turn reads as a call that never came back.
    const items = await itemsOfOneTurn(harness);
    const open = items.filter((i) => i.status === "in_progress");
    expect(open, `${harness.mode} left items open`).toEqual([]);
  });
});
