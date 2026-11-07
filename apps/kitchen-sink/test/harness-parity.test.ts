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
import { createTestContext, testBlock, testFlow } from "@flow-state-dev/testing";

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
    flow: () => claudeCodeSessionFlow({ resolveClaudeAgent: scriptedClaudeCode(), approveTools: false }),
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

/**
 * The contract every harness owes a HOST (FIX-2458): the jobs an app does with
 * a harness before and around a run, done the same way for all three, so an
 * app that offers more than one coding agent writes each job once.
 *
 * Read only as a host reads it: each package's public entry, imported as a
 * namespace when the cell runs (a missing name fails its own cell, not the
 * file), driven only through the seams the package documents (an SDK
 * importer or module, a client resolver, Codex's program), and judged against
 * core's shared shapes and readers. No harness's internals are imported, and
 * no error class is named: a host branches on core's readers.
 *
 * Red under main at the merge base: the Cursor list cell (no `listCursorModels`),
 * the Claude Code list cell (its list was `listClaudeModels`), the base-list
 * cell (no `HARNESS_BASE_PASS`), the no-hand-list cell, the Codex and Cursor
 * stop cells for every reason, and Claude Code's stop cells for a timeout and
 * a plain `Error`. The Codex list cell, the pass-list cells, Claude Code's
 * reason-less stop and every not-a-stop cell pass there, which shows the
 * block reaches the code.
 */
describe("the contract every harness owes a host", () => {
  /** The models every scripted SDK below answers with, in the shared shape they come back in. */
  const LISTED = [
    { id: "model-a", label: "Model A", description: "The first", isDefault: true },
    { id: "model-b", label: "Model B", isDefault: false },
  ];

  /** A stand-in Codex program answering `model/list` with {@link LISTED}, in the app-server's own rows. */
  function scriptedCodexProgram(): { path: string; pathDirs: string[] } {
    const path = join(scratch, "scripted-codex-app-server.mjs");
    const rows = LISTED.map((m) => ({ id: m.id, model: m.id, displayName: m.label, ...(m.description ? { description: m.description } : {}), hidden: false, isDefault: m.isDefault }));
    writeFileSync(
      path,
      [
        "#!/usr/bin/env node",
        'import { createInterface } from "node:readline";',
        'const say = (m) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...m }) + "\\n");',
        "for await (const line of createInterface({ input: process.stdin })) {",
        '  if (line.trim() === "") continue;',
        "  const m = JSON.parse(line);",
        '  if (m.method === "initialize") say({ id: m.id, result: {} });',
        `  else if (m.method === "model/list") say({ id: m.id, result: { data: ${JSON.stringify(rows)}, nextCursor: null } });`,
        "}",
      ].join("\n"),
      { mode: 0o755 },
    );
    return { path, pathDirs: [] };
  }

  /** Each harness as a host meets it: its entry, its pass-list's name, and its model list driven through its own seam. */
  const HOSTED = [
    {
      mode: "claude-code",
      entry: () => import("@flow-state-dev/claude-code/sdk") as Promise<Record<string, unknown>>,
      pass: "CLAUDE_CODE_PASS",
      list: "listClaudeCodeModels",
      // The SDK importer: Claude Code's `supportedModels()`, the default as its own row.
      seam: () => ({
        importSdk: async () => ({
          query: (args: { prompt: AsyncIterable<unknown> }) => {
            void (async () => {
              for await (const _ of args.prompt);
            })();
            return {
              supportedModels: async () => [
                { value: "default", resolvedModel: "model-a", displayName: "Default", description: "The first" },
                { value: "model-a", displayName: "Model A", description: "The first" },
                { value: "model-b", displayName: "Model B" },
              ],
              close: () => {},
            };
          },
        }),
      }),
    },
    {
      mode: "codex",
      entry: () => import("@flow-state-dev/codex") as Promise<Record<string, unknown>>,
      pass: "CODEX_PASS",
      list: "listCodexModels",
      // The program option: Codex's app-server, answering `model/list`.
      seam: () => ({ program: scriptedCodexProgram() }),
    },
    {
      mode: "cursor",
      entry: () => import("@flow-state-dev/cursor") as Promise<Record<string, unknown>>,
      pass: "CURSOR_PASS",
      list: "listCursorModels",
      // The SDK module the asking process loads: Cursor's `Cursor.models.list()`, which marks no model default.
      seam: () => ({
        sdkModule: `data:text/javascript,${encodeURIComponent(
          `export const Cursor = { models: { list: async () => ${JSON.stringify([
            { id: "model-a", displayName: "Model A", description: "The first", variants: [{ params: [], displayName: "Model A", isDefault: true }] },
            { id: "model-b", displayName: "Model B" },
          ])} } };`,
        )}`,
      }),
    },
  ] as const;

  it("core holds one environment base: the 13 names every harness's child needs", async () => {
    const { HARNESS_BASE_PASS } = (await import("@flow-state-dev/core/harness")) as Record<string, unknown>;
    expect(Array.isArray(HARNESS_BASE_PASS), "core/harness exports HARNESS_BASE_PASS").toBe(true);
    expect([...(HARNESS_BASE_PASS as string[])].sort()).toEqual(
      ["PATH", "HOME", "USER", "SHELL", "TMPDIR", "HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy", "ALL_PROXY", "all_proxy", "NO_PROXY", "no_proxy"].sort(),
    );
  });

  describe.each(HOSTED)("$mode", (harness) => {
    it("its pass-list holds every name of core's environment base", async () => {
      const { HARNESS_BASE_PASS } = (await import("@flow-state-dev/core/harness")) as Record<string, unknown>;
      const pass = (await harness.entry())[harness.pass] as readonly string[] | undefined;
      expect(pass, `${harness.mode} exports ${harness.pass}`).toBeDefined();
      for (const name of (HARNESS_BASE_PASS as string[] | undefined) ?? []) expect(pass, name).toContain(name);
    });

    it("lists its models as core's HarnessModelList, from what its SDK answered", async () => {
      const list = (await harness.entry())[harness.list] as
        | ((options: Record<string, unknown>) => Promise<{ status: string; models?: Array<Record<string, unknown>> }>)
        | undefined;
      expect(typeof list, `${harness.mode} exports ${harness.list}`).toBe("function");
      const found = await list!({ env: { PATH: process.env.PATH ?? "" }, timeoutMs: 10_000, ...harness.seam() });
      expect(found.status, JSON.stringify(found)).toBe("models");
      // The shared fields, compared alike for all three; Cursor's variants ride beside them.
      const shared = found.models!.map(({ id, label, description, isDefault }) => ({ id, label, ...(description === undefined ? {} : { description }), isDefault }));
      // Cursor's catalog marks no model default: a list with no default is a valid answer.
      const expected = harness.mode === "cursor" ? LISTED.map((m) => ({ ...m, isDefault: false })) : LISTED;
      expect(shared).toEqual(expected);
    });
  });

  /**
   * Each harness's block as a host builds it from the package's entry, behind
   * the scripted SDK Kitchen Sink's modes use (`lib/scripted-*.ts`): a
   * `[slow]` prompt holds the run long enough for a stop to land, `[fail]`
   * fails it, and `[refuse]` refuses the conversation it was asked to resume.
   */
  const RUNNABLE = [
    {
      mode: "claude-code",
      block: async (seam: (createDefault: unknown) => Record<string, unknown>) => {
        const { claudeCodeAgent, createDefaultResolveClaudeAgent } = (await import("@flow-state-dev/claude-code/sdk")) as Record<string, any>;
        return claudeCodeAgent({ resolveClaudeAgent: scriptedClaudeCode(), cwd: () => repo, ...seam(createDefaultResolveClaudeAgent) });
      },
      absent: (create: any) => ({ resolveClaudeAgent: create(async () => Promise.reject(new Error("Cannot find module '@anthropic-ai/claude-agent-sdk'"))) }),
    },
    {
      mode: "codex",
      block: async (seam: (createDefault: unknown) => Record<string, unknown>) => {
        const { codexAgent, createDefaultResolveCodexClient } = (await import("@flow-state-dev/codex")) as Record<string, any>;
        return codexAgent({ resolveCodexClient: scriptedCodex(), cwd: () => repo, ...seam(createDefaultResolveCodexClient) });
      },
      absent: (create: any) => ({ resolveCodexClient: create({}, async () => Promise.reject(new Error("Cannot find module '@openai/codex-sdk'"))) }),
    },
    {
      mode: "cursor",
      block: async (seam: (createDefault: unknown) => Record<string, unknown>) => {
        const { cursorAgent, createDefaultResolveCursorClient } = (await import("@flow-state-dev/cursor")) as Record<string, any>;
        return cursorAgent({ resolveCursorClient: scriptedCursor(), cwd: () => repo, model: "composer-2.5", ...seam(createDefaultResolveCursorClient) });
      },
      absent: (create: any) => ({ resolveCursorClient: create(async () => Promise.reject(new Error("Cannot find module '@cursor/sdk'"))) }),
    },
  ] as const;

  /** `harness`'s block, built from its entry with `options` and, for `absent`, a resolver over an SDK that won't load. */
  function blockOf(harness: (typeof RUNNABLE)[number], options: Record<string, unknown>, absent: boolean) {
    return harness.block((create) => ({ ...(absent ? harness.absent(create) : {}), ...options }));
  }

  /**
   * Run one turn of `harness`'s block on `prompt` through the host path
   * (`testBlock`, as a sequencer's step, the way the session flow runs it) and
   * return the error it failed with. `options` are added to the block's own
   * (`resume`); `absent` gives it an SDK that won't load.
   */
  async function failureOf(
    harness: (typeof RUNNABLE)[number],
    prompt: string,
    { options = {}, absent = false }: { options?: Record<string, unknown>; absent?: boolean } = {},
  ): Promise<unknown> {
    // A step, because Cursor's script reads its directives off the turn's input, which a block carries as its parent's.
    const block = (await blockOf(harness, options, absent)) as Parameters<typeof testBlock>[0];
    const { error } = await testBlock(block, { input: { prompt }, sequencer: { state: {} } });
    if (error === null) throw new Error(`${harness.mode}: the turn did not fail`);
    return error;
  }

  /**
   * Run one turn of `harness`'s block on `prompt`, stop it with `stop` once
   * the run has its prompt, and return what it threw.
   *
   * Called on the block's handler directly, not through `testBlock`: neither
   * `testBlock` nor `testFlow` takes a signal the caller fires (each builds its
   * own context), and a stop is the caller's signal firing.
   */
  async function stoppedBy(harness: (typeof RUNNABLE)[number], prompt: string, stop: (controller: AbortController) => void): Promise<unknown> {
    const block = await blockOf(harness, {}, false);
    const runtime = await createTestContext({});
    // Cursor's script reads its directives off the turn's input, which a block carries as its parent's.
    Object.defineProperty(runtime.ctx, "parent", { value: { input: { prompt } } });
    const controller = new AbortController();
    (runtime.ctx as { signal?: AbortSignal }).signal = controller.signal;
    scriptedReceived.length = 0;
    const running = (block as { config: { execute: (input: unknown, ctx: unknown) => Promise<unknown> } }).config.execute({ prompt }, runtime.ctx);
    for (let waited = 0; !scriptedReceived.includes(prompt); waited += 10) {
      if (waited > 5_000) throw new Error(`${harness.mode}: the run never had its prompt`);
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    stop(controller);
    try {
      await running;
    } catch (error) {
      return error;
    }
    throw new Error(`${harness.mode}: the turn did not throw`);
  }

  /** The ways a host stops a run: with no reason, a deadline, and a plain error (harness-manager's steer). */
  const STOPS = [
    { reason: "none", stop: (c: AbortController) => c.abort() },
    { reason: "a timeout", stop: (c: AbortController) => c.abort(new DOMException("The deadline passed.", "TimeoutError")) },
    { reason: "a plain Error", stop: (c: AbortController) => c.abort(new Error("[harness-manager] stopped for a steer")) },
  ] as const;

  describe.each(RUNNABLE)("$mode, telling a stop from a failure with core's readers", (harness) => {
    beforeEach(() => {
      for (const pauses of [scriptedPauses, scriptedCodexPauses, scriptedCursorPauses]) pauses.slowMs = 20_000;
    });
    afterEach(() => {
      for (const pauses of [scriptedPauses, scriptedCodexPauses, scriptedCursorPauses]) pauses.slowMs = 0;
    });

    it.each(STOPS)("a stop with $reason is abort-like", async ({ stop }) => {
      const { isAbortLike } = (await import("@flow-state-dev/core")) as Record<string, any>;
      const thrown = await stoppedBy(harness, "[slow] do some work", stop);
      expect(isAbortLike(thrown), `${harness.mode}: ${String(thrown)}`).toBe(true);
    }, 15_000);

    it("a run that failed is not abort-like", async () => {
      const { isAbortLike } = (await import("@flow-state-dev/core")) as Record<string, any>;
      // Codex's `[fail]` is a failed turn it reports, not a throw; `[fail-early]` throws.
      const thrown = await failureOf(harness, harness.mode === "codex" ? "[fail-early] do some work" : "[fail] do some work");
      expect(String(thrown)).toMatch(/fail/i);
      expect(isAbortLike(thrown), `${harness.mode}: ${String(thrown)}`).toBe(false);
    });

    it("an absent SDK is not abort-like", async () => {
      const { isAbortLike } = (await import("@flow-state-dev/core")) as Record<string, any>;
      const thrown = await failureOf(harness, "do some work", { absent: true });
      expect(String(thrown)).toMatch(/install/i);
      expect(isAbortLike(thrown), `${harness.mode}: ${String(thrown)}`).toBe(false);
    });

    it("a refused resume is not abort-like, and reads as an unknown conversation", async () => {
      const { isAbortLike } = (await import("@flow-state-dev/core")) as Record<string, any>;
      const { harnessFailureKind } = (await import("@flow-state-dev/core/harness")) as Record<string, any>;
      // Claude Code takes a conversation to resume only as background work: in a session its own state owns it.
      const resume = { resume: () => "conversation-gone", ...(harness.mode === "claude-code" ? { detached: true } : {}) };
      const thrown = await failureOf(harness, "[refuse] go on", { options: resume });
      expect(isAbortLike(thrown), `${harness.mode}: ${String(thrown)}`).toBe(false);
      expect(harnessFailureKind(thrown), `${harness.mode}: ${String(thrown)}`).toBe("unknown-conversation");
    });
  });

  it("Kitchen Sink keeps no hand list of Cursor's models", () => {
    const source = readFileSync(join(import.meta.dirname, "..", "lib/cursor-mode.ts"), "utf8");
    expect(source).not.toMatch(/CURSOR_MODELS\s*[:=]/);
    expect(source).toMatch(/listCursorModels/);
  });
});
