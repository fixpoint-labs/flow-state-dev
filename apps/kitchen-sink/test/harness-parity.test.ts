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
 * The last block holds a line sent while a turn runs (FIX-2254): it reaches
 * the run exactly once in every mode, into the running turn where the run
 * offered to take it (Cursor), else as the next turn. Run with
 * `GOAL_CONTROL=drop-refused` it must fail for Cursor's refused line, and
 * with `GOAL_CONTROL=drop-fallback` for Claude Code and Codex.
 *
 * The SDKs are replaced by each mode's scripted harness (`lib/scripted-*.ts`),
 * so this runs with no model, no process and no network. Everything past that
 * seam — translation, emission, the handle — is the real adapter.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createInMemoryStores } from "@flow-state-dev/engine";
import { testFlow } from "@flow-state-dev/testing";

import { claudeCodeSessionFlow } from "@/lib/claude-code-mode";
import { codexSessionFlow } from "@/lib/codex-mode";
import { cursorSessionFlow } from "@/lib/cursor-mode";
import { resetModeAvailabilityForTests } from "@/lib/harness-gate";
import { sendLine, type LineSender } from "@/lib/harness-line";
import { scriptedReceived } from "@/lib/scripted-received";
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

/**
 * A goal control for the line row, read before the per-test stubs clear
 * `GOAL_CONTROL`. Handed to {@link sendLine} as the page hands it its own.
 */
const LINE_CONTROL = process.env.GOAL_CONTROL || undefined;

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

describe.each(HARNESSES)("$mode, a line sent while a turn runs (FIX-2254)", (harness) => {
  /** How long a `[slow]` turn holds here: long enough to send a line into it. */
  const HOLD_MS = 1_500;

  beforeEach(() => {
    scriptedReceived.length = 0;
    for (const pauses of [scriptedPauses, scriptedCodexPauses, scriptedCursorPauses]) pauses.slowMs = HOLD_MS;
  });
  afterEach(() => {
    for (const pauses of [scriptedPauses, scriptedCodexPauses, scriptedCursorPauses]) pauses.slowMs = 0;
  });

  /** Start a held turn, then send `line` into it the way the page does. */
  async function lineMidTurn(directives: string) {
    const stores = createInMemoryStores();
    const flow = harness.flow();
    const sessionId = `s-line-${harness.mode}-${Math.random().toString(36).slice(2)}`;
    const run = (action: string, input: unknown) =>
      testFlow({ flow, action, userId: "u", sessionId, input, stores });
    const prompt = `${harness.prompt} [slow]${directives}`;
    const first = run("turn", { prompt });
    // The run has its prompt, and a run that can steer has offered its steer.
    for (let waited = 0; !scriptedReceived.includes(prompt); waited += 10) {
      if (waited > 5_000) throw new Error(`${harness.mode}: the turn never reached the run`);
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    await new Promise((resolve) => setTimeout(resolve, 50));

    const line = `Also rename the flag (${harness.mode}).`;
    let steered: { taken: boolean; live: boolean } | undefined;
    const turns: Promise<unknown>[] = [];
    const sender: LineSender = {
      steer: async (text) => {
        const result = await run("steer", { prompt: text });
        expect(result.error, `${harness.mode} steer`).toBeUndefined();
        steered = result.output as { taken: boolean; live: boolean };
        return steered;
      },
      turn: async (text) => {
        turns.push(run("turn", { prompt: text }));
      },
    };
    const outcome = await sendLine(line, true, sender, LINE_CONTROL);
    const results = (await Promise.all([first, ...turns])) as Array<{ status: string }>;
    expect(results.map((r) => r.status), harness.mode).toEqual(results.map(() => "completed"));
    const stored = (await stores.session.get(sessionId)) as { state?: { turns?: Record<string, { steered?: string[] | null }> } } | undefined;
    const recorded = Object.values(stored?.state?.turns ?? {}).flatMap((turn) => turn.steered ?? []);
    return { line, outcome, steered: steered!, recorded, reached: scriptedReceived.filter((text) => text.includes(line)) };
  }

  it("reaches the run exactly once: live where the run offered a steer, else as the next turn", async () => {
    const { line, outcome, steered, recorded, reached } = await lineMidTurn("");

    expect(reached, `${harness.mode} lines the run was handed`).toHaveLength(1);
    // Read from the run, not the mode: a run that can steer offered one.
    expect(steered.live, `${harness.mode} live`).toBe(harness.mode === "cursor");
    expect(outcome).toBe(steered.live ? "taken" : "after-this-turn");
    // The running turn's record says what it took, which is what the page shows.
    expect(recorded).toEqual(steered.live ? [line] : []);
  }, 30_000);

  it.runIf(harness.mode === "cursor")("reaches the run exactly once when the running turn refuses it", async () => {
    const { outcome, steered, reached } = await lineMidTurn("[steer-refuse]");

    expect(reached, "lines the run was handed").toHaveLength(1);
    expect(steered).toEqual({ taken: false, live: true });
    expect(outcome).toBe("after-this-turn");
  }, 30_000);
});

describe("the session flow, for every mode", () => {
  it("names no harness: whether a line joins the running turn is the run's answer", () => {
    // The parity row above is only a claim about every harness while the flow
    // that serves them can't branch on one.
    for (const file of ["lib/harness-session-flow.ts", "lib/harness-line.ts"]) {
      const source = readFileSync(join(import.meta.dirname, "..", file), "utf8");
      expect(source, file).not.toMatch(/from "@flow-state-dev\/(claude-code|codex|cursor)/);
      expect(source, file).not.toMatch(/mode === /);
    }
  });
});
