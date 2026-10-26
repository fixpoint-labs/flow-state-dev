/**
 * The item contract all three harness modes owe, held against all three at once.
 *
 * Kitchen Sink is the one place that runs Claude Code, Codex and Cursor over
 * the same session flow, so it is the one place a rule can be stated once and
 * checked against every harness. Each mode's own suite proves what that
 * harness does; this proves the three AGREE, which is the claim a reader of
 * the rail makes when they move between `/claude-code`, `/codex` and `/cursor`
 * and expect the same page to work.
 *
 * Each case below is a rule about items, not about a vendor. A harness added
 * later joins this table and is held to the same list — which is the point:
 * the three adapters share a contract (`@flow-state-dev/core`'s
 * `types/harness.ts`) and no shared implementation, so nothing but a check
 * like this notices when one of them drifts.
 *
 * Red states produced before this was trusted:
 *   - settle a tool item with a re-read `getItemCount()`, as Claude Code and
 *     Codex both did until this suite caught it: the unique-index case fails
 *     for those two and passes for Cursor, which already kept the opened index.
 *   - drop `finalizeOpenItems` from a harness's failure path: the nothing-left-
 *     open case fails for it.
 *
 * The SDKs are replaced by each mode's scripted harness (`lib/scripted-*.ts`),
 * so this runs with no model, no process and no network. Everything past that
 * seam — translation, emission, the handle — is the real adapter.
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
 * One harness mode: its flow with the scripted SDK behind it, and a prompt
 * that makes its script run a tool.
 *
 * The prompts differ because the scripts do, not because the rule does: Codex
 * runs a command on every turn, Claude Code runs five under `[bash]`, and
 * Cursor's only tool call is the to-do update under `[plan]`. What each case
 * then asserts is identical for all three.
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
    // The floor the rest of this file stands on: a case that asserted a
    // property of an empty list would pass for a harness that emitted nothing.
    const items = await itemsOfOneTurn(harness);
    expect(items.length).toBeGreaterThan(0);
    expect(items.some((i) => i.type === "message")).toBe(true);
    expect(items.some((i) => i.type === "tool_output")).toBe(true);
  });

  it("gives every item its own itemIndex", async () => {
    // `itemIndex` orders a request's items, and core's replay picks among
    // same-id traces by the highest one (`blocks/internal/replay-log.ts`). Two
    // items sharing an index make that order a guess. The trap is settling an
    // item the stream already holds: `getItemCount()` counts items by id and
    // does not grow on a settle, so re-reading it there returns the index the
    // NEXT item is about to take.
    const items = await itemsOfOneTurn(harness);
    const indices = items.map((i) => i.itemIndex);
    expect(indices.every((i) => typeof i === "number")).toBe(true);
    expect(new Set(indices).size).toBe(items.length);
  });

  it("stamps the request, the block and a timestamp on every item", async () => {
    // The fields a reader of the rail needs to attribute an item at all. A
    // harness that omitted one would render items the page cannot place.
    const items = await itemsOfOneTurn(harness);
    for (const item of items) {
      expect(typeof item.id, `${harness.mode} id`).toBe("string");
      expect(typeof item.requestId, `${harness.mode} requestId`).toBe("string");
      expect(typeof item.ts, `${harness.mode} ts`).toBe("number");
      expect(typeof item.provenance?.blockName, `${harness.mode} provenance`).toBe("string");
    }
  });

  it("leaves nothing open when the turn is over", async () => {
    // A tool item still `in_progress` after the run ended renders as a call
    // that never came back — the state every adapter's `finalizeOpenItems`
    // exists to prevent, and the one a reader would read as a hung run.
    const items = await itemsOfOneTurn(harness);
    const open = items.filter((i) => i.status === "in_progress");
    expect(open, `${harness.mode} left items open`).toEqual([]);
  });
});
