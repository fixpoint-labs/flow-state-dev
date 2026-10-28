/**
 * A line sent while a long turn runs runs after it, in every harness mode
 * (FIX-2265).
 *
 * The page sends a line no running turn took as the session's next `turn`
 * (`lib/harness-line.ts`). That turn waits for the one running, through the
 * server's concurrency policy, so this drives the flow through the HTTP router,
 * where that policy is enforced: `testFlow` runs an action outside it.
 *
 * The running turn holds past the engine's `queue` wait budget (30 s). A turn
 * that waits only that long fails with `ConcurrencyQueueTimeoutError` and the
 * line never reaches the run, which is what a person saw after any turn
 * longer than half a minute.
 *
 * Red state produced before this was trusted: `concurrency: "queue"` on the
 * `turn` action (today's main before the fix). Each mode's line request fails
 * at the budget and the run is never handed the line.
 *
 * The SDKs are each mode's scripted harness (`lib/scripted-*.ts`), so this runs
 * with no model, no process and no network.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createFlowApiRouter, createFlowRegistry, createInMemoryStores } from "@flow-state-dev/engine";
import type { FlowInstance } from "@flow-state-dev/core/types";

import { CLAUDE_CODE_SESSION, claudeCodeSessionFlow } from "@/lib/claude-code-mode";
import { CODEX_SESSION, codexSessionFlow } from "@/lib/codex-mode";
import { CURSOR_SESSION, cursorSessionFlow } from "@/lib/cursor-mode";
import { resetModeAvailabilityForTests } from "@/lib/harness-gate";
import { scriptedReceived } from "@/lib/scripted-received";
import { scriptedClaudeCode, scriptedPauses } from "@/lib/scripted-claude-code";
import { scriptedCodex, scriptedCodexPauses } from "@/lib/scripted-codex";
import { scriptedCursor, scriptedCursorPauses } from "@/lib/scripted-cursor";

/** The engine's `queue` wait budget (`QUEUE_WAIT_TIMEOUT_MS`). */
const QUEUE_BUDGET_MS = 30_000;
/** How long the running turn holds: past the budget, so a budgeted wait runs out. */
const HOLD_MS = QUEUE_BUDGET_MS + 3_000;

const PAUSES = [scriptedPauses, scriptedCodexPauses, scriptedCursorPauses];

/** Each mode's flow kind and flow, with its scripted SDK. Prompts make Claude Code and Cursor hold too. */
const MODES = [
  { mode: "claude-code", kind: CLAUDE_CODE_SESSION, prompt: "do some work", flow: () => claudeCodeSessionFlow({ resolveClaudeAgent: scriptedClaudeCode() }) },
  { mode: "codex", kind: CODEX_SESSION, prompt: "do some work", flow: () => codexSessionFlow({ resolveCodexClient: scriptedCodex() }) },
  { mode: "cursor", kind: CURSOR_SESSION, prompt: "do some work", flow: () => cursorSessionFlow({ resolveCursorClient: scriptedCursor() }) },
] as const;

let scratch: string;
let repo: string;

beforeAll(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), "ks-harness-line-after-")));
  repo = join(scratch, "repo");
  execFileSync("git", ["init", "-q", "-b", "main", repo]);
  writeFileSync(join(repo, "README.md"), "hello\n");
  execFileSync("git", ["-C", repo, "add", "."]);
  execFileSync("git", ["-C", repo, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init"]);
});

afterAll(() => rmSync(scratch, { recursive: true, force: true }));

beforeEach(() => {
  vi.stubEnv("KITCHEN_SINK_HARNESS_WORKSPACE", repo);
  vi.stubEnv("XDG_STATE_HOME", join(scratch, "state"));
  vi.stubEnv("KITCHEN_SINK_TEST_MODE", "");
  vi.stubEnv("GOAL_CONTROL", "");
  scriptedReceived.length = 0;
  for (const pauses of PAUSES) {
    pauses.stepMs = 0;
    pauses.slowMs = HOLD_MS;
  }
});

afterEach(() => {
  vi.unstubAllEnvs();
  resetModeAvailabilityForTests();
  for (const pauses of PAUSES) pauses.slowMs = 0;
});

type Router = ReturnType<typeof createFlowApiRouter>;

async function post(router: Router, path: string[], body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const res = await router.POST(
    new Request(`http://localhost/api/flows/${path.join("/")}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: "u", ...body }),
    }),
    { params: { path } },
  );
  const json = (await res.json()) as Record<string, unknown>;
  expect(res.status, JSON.stringify(json)).toBeLessThan(300);
  return json;
}

/** Start a held turn in a new session of `mode`, then send a line as the next turn while it runs. */
async function lineAfterLongTurn(mode: (typeof MODES)[number]) {
  const registry = createFlowRegistry();
  const stores = createInMemoryStores();
  registry.register(mode.flow() as FlowInstance);
  const router = createFlowApiRouter({ registry, stores, staleSweepIntervalMs: 0 });

  const created = await post(router, [mode.kind, "sessions"], { state: { model: "m" } });
  const sessionId = String((created.session as { id?: string } | undefined)?.id ?? created.id);
  const prompt = `${mode.prompt} [slow] (${mode.mode})`;
  await post(router, [mode.kind, sessionId, "actions", "turn"], { input: { prompt }, sessionId });
  for (let waited = 0; !scriptedReceived.includes(prompt); waited += 20) {
    if (waited > 10_000) throw new Error(`${mode.mode}: the turn never reached the run`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }

  const line = `After that, reply BRAVO (${mode.mode}).`;
  await post(router, [mode.kind, sessionId, "actions", "turn"], { input: { prompt: line }, sessionId });

  const deadline = Date.now() + HOLD_MS + 20_000;
  while ((await stores.request.list({ sessionId })).some((r) => r.status === "in_progress")) {
    if (Date.now() > deadline) throw new Error(`${mode.mode}: the turns never finished`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const requests = (await stores.request.list({ sessionId })) as Array<{ status: string; input?: { prompt?: string }; result?: { error?: { message?: string } } }>;
  return { prompt, line, requests };
}

describe("a line sent while a turn longer than the queue budget runs (FIX-2265)", () => {
  it(
    "runs after that turn, in every mode",
    async () => {
      const runs = await Promise.all(MODES.map(lineAfterLongTurn));
      for (const [i, { prompt, line, requests }] of runs.entries()) {
        const mode = MODES[i]!.mode;
        const byPrompt = new Map(requests.map((r) => [r.input?.prompt, r]));
        expect(byPrompt.get(prompt)?.status, `${mode} running turn`).toBe("completed");
        expect(byPrompt.get(line)?.result?.error?.message, `${mode} line`).toBeUndefined();
        expect(byPrompt.get(line)?.status, `${mode} line`).toBe("completed");
        // The run was handed the line once, after the turn it waited for.
        const handed = scriptedReceived.filter((text) => text.includes(line));
        expect(handed, `${mode} lines the run was handed`).toHaveLength(1);
        expect(scriptedReceived.indexOf(handed[0]!), mode).toBeGreaterThan(scriptedReceived.indexOf(prompt));
      }
    },
    HOLD_MS + 40_000,
  );
});
