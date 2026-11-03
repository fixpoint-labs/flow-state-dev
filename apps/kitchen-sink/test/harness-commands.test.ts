/**
 * The host's commands around a harness session's turns (FIX-2387): the setup
 * command a session's fresh worktree runs first (`KITCHEN_SINK_HARNESS_SETUP`),
 * and the checks a finished turn runs there (`KITCHEN_SINK_HARNESS_CHECKS`),
 * both recorded on the turn for the page's notice.
 *
 * The real Claude Code mode and flow on `createFlowState`, with only the Agent
 * SDK replaced by the scripted Claude Code, in a worktree cut from a real
 * temporary git repository. The repository's check is red unless setup left
 * its marker, so a recorded green check also proves setup ran first.
 *
 * Red states: unset the checks setting and no check is recorded (the last
 * flow case); drop `setup` from the host and the check reports SETUP-MARKER.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_ORG_ID } from "@flow-state-dev/core";
import { createFlowState, inMemoryStores, runAction } from "@flow-state-dev/engine";
import type { HarnessSessionState } from "@flow-state-dev/harness-manager";

import { CLAUDE_CODE_SESSION, claudeCodeSessionFlow } from "@/lib/claude-code-mode";
import { readHarnessCommands, readHarnessWorkspace } from "@/lib/harness-workspace";
import { scriptedClaudeCode, scriptedPauses } from "@/lib/scripted-claude-code";

const USER = "u";
const NODE = process.execPath;

let scratch: string;
let repo: string;

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" });
}

beforeAll(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), "ks-harness-commands-")));
  repo = join(scratch, "repo");
  execFileSync("git", ["init", "-q", "-b", "main", repo]);
  writeFileSync(
    join(repo, "check.mjs"),
    [
      `import { existsSync } from "node:fs";`,
      `if (!existsSync(".set-up")) { console.error("SETUP-MARKER missing"); process.exit(5); }`,
      `console.error("CHECK-MARKER: red on purpose"); process.exit(3);`,
    ].join("\n"),
  );
  writeFileSync(join(repo, ".gitignore"), ".set-up\n");
  git(repo, "add", ".");
  git(repo, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init");
  scriptedPauses.stepMs = 0;
  scriptedPauses.slowMs = 0;
});

afterAll(() => rmSync(scratch, { recursive: true, force: true }));

beforeEach(() => {
  vi.stubEnv("KITCHEN_SINK_HARNESS_WORKSPACE", repo);
  vi.stubEnv("XDG_STATE_HOME", join(scratch, `state-${Math.random().toString(36).slice(2)}`));
  vi.stubEnv("KITCHEN_SINK_TEST_MODE", "");
  vi.stubEnv("GOAL_CONTROL", "");
});

afterEach(() => vi.unstubAllEnvs());

const SETUP = `${NODE} -e "require('node:fs').writeFileSync('.set-up', '')"`;

describe("reading the command settings", () => {
  it("splits the checks on ; and the setup command into words", () => {
    const read = readHarnessCommands({ KITCHEN_SINK_HARNESS_SETUP: "pnpm install --frozen-lockfile", KITCHEN_SINK_HARNESS_CHECKS: "pnpm typecheck; pnpm test " });
    expect(read.reason).toBeUndefined();
    expect(read.setup?.command).toEqual(["pnpm", "install", "--frozen-lockfile"]);
    expect(read.checks).toEqual(["pnpm typecheck", "pnpm test"]);
  });

  it("names nothing when both are unset", () => {
    expect(readHarnessCommands({})).toEqual({ checks: [] });
  });

  it("turns the harness modes off on a command that needs a shell, naming the setting", () => {
    const env = { KITCHEN_SINK_HARNESS_WORKSPACE: repo, KITCHEN_SINK_HARNESS_SETUP: "pnpm install && pnpm build" };
    expect(readHarnessCommands(env).reason).toMatch(/^KITCHEN_SINK_HARNESS_SETUP: .*shell operator/);
    const workspace = readHarnessWorkspace(env);
    expect(workspace.ok).toBe(false);
    expect(workspace.ok ? "" : workspace.reason).toMatch(/KITCHEN_SINK_HARNESS_SETUP/);
    expect(readHarnessWorkspace({ KITCHEN_SINK_HARNESS_WORKSPACE: repo, KITCHEN_SINK_HARNESS_CHECKS: "pnpm test | tee out" }).ok).toBe(false);
  });
});

/** One turn of Claude Code mode, then the turn's record. */
async function oneTurn(sessionId: string) {
  const flow = claudeCodeSessionFlow({ resolveClaudeAgent: scriptedClaudeCode() });
  const state = createFlowState({
    flows: { [CLAUDE_CODE_SESSION]: flow },
    stores: { test: { primary: inMemoryStores() } },
    defaultProfile: "test",
    durable: true,
  } as never);
  const rt = await (state as unknown as { getRuntime(): Promise<{ stores: any; runtimeConfig: any }> }).getRuntime();
  const now = Date.now();
  await rt.stores.session.set(
    sessionId,
    { id: sessionId, flowKind: CLAUDE_CODE_SESSION, userId: USER, orgId: DEFAULT_ORG_ID, metadata: undefined, latestRequestId: undefined, state: { model: "scripted-claude-code" }, version: 0, createdAt: now, updatedAt: now, journal: [] } as never,
    "any" as never,
  );
  const result = (await runAction({
    flow,
    actionName: "turn",
    input: { prompt: "Say hello." },
    userId: USER,
    orgId: DEFAULT_ORG_ID,
    sessionId,
    stores: rt.stores,
    runtimeConfig: { ...rt.runtimeConfig },
  } as never)) as { requestId?: string; error?: { message?: string } };
  expect(result.error?.message).toBeUndefined();
  const session = ((await rt.stores.session.get(sessionId))?.state ?? {}) as HarnessSessionState;
  await state.dispose();
  return session.turns?.[result.requestId!] ?? null;
}

describe("a turn on a host with commands", () => {
  it("runs setup in the fresh worktree, then records the checks, red ones included", async () => {
    vi.stubEnv("KITCHEN_SINK_HARNESS_SETUP", SETUP);
    vi.stubEnv("KITCHEN_SINK_HARNESS_CHECKS", `${NODE} check.mjs`);
    const turn = await oneTurn("with-commands");
    expect(turn?.setup).toEqual({ state: "done", tail: null });
    expect(turn?.checks).toHaveLength(1);
    expect(turn?.checks?.[0]?.exitCode).toBe(3);
    expect(turn?.checks?.[0]?.tail).toContain("CHECK-MARKER");
    // A red check is information: the turn itself did not fail.
    expect(turn?.error ?? null).toBeNull();
  }, 60_000);

  it("runs no check and no setup when neither is set", async () => {
    const turn = await oneTurn("without-commands");
    expect(turn?.setup ?? null).toBeNull();
    expect(turn?.checks ?? null).toBeNull();
  }, 60_000);
});
