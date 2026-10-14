/**
 * Claude Code mode: the session flow with the Claude Code block, and the
 * mode's own check of whether this host can run it.
 *
 * Server only. The block runs as background work (`detached`) with its work
 * recorded (`recordWork`), so its plan lands in the shared plan record. It
 * asks for no approval: the sandbox is the fence. Writes stay in the
 * session's worktree, never the repository's `.git` (so the run edits files
 * but cannot commit), and the run starts with an allowlisted environment.
 * `KITCHEN_SINK_HARNESS_UNSANDBOXED=1` (`lib/harness-sandbox.ts`) removes the
 * fence and leaves no other: the run still asks for no approval, so it writes,
 * commits and runs commands wherever the server's OS user can.
 * That filters what the run is handed; it is not a boundary. A command the run
 * starts as the same OS user can still read the server's own environment (on
 * Linux, from `/proc`). Run the server as a separate OS user or in a container
 * when that matters.
 *
 * Under `KITCHEN_SINK_TEST_MODE=1` the Agent SDK is replaced by the scripted
 * Claude Code (`lib/scripted-claude-code.ts`) and the check passes, unless
 * `KITCHEN_SINK_REAL_HARNESS=1` asks for the real one, which the goal check
 * does so its controls apply to a real run.
 */
import { accessSync, constants, existsSync, mkdirSync } from "node:fs";
import { delimiter, join } from "node:path";
import { harnessEnv } from "@flow-state-dev/core";
import {
  claudeCodeAgent,
  containmentSandbox,
  listClaudeModels,
  probeClaudeAccount,
  type ClaudeAccountProbe,
  type ClaudeModelList,
  type ResolveClaudeAgent,
} from "@flow-state-dev/claude-code/sdk";

import { goalControl } from "./goal-control";
import { harnessUnsandboxed, unsandboxedHint, unsandboxedNote } from "./harness-sandbox";
import { harnessSessionFlow, type HarnessBlock, type HarnessFeeds } from "./harness-session-flow";
import { worktreeRoot } from "./harness-worktree";
import { flowKindOf, modeById } from "./modes";
import type { ModeAvailability, ModeCheck } from "./harness-gate";
import type { ModelChoices } from "./harness-models";
import { scriptedClaudeCode } from "./scripted-claude-code";

/** Claude Code mode's flow kind, from the mode list: the rail lists its sessions by it. */
export const CLAUDE_CODE_SESSION = flowKindOf(modeById("claude-code"));

/**
 * The only variables of the server's environment a Claude Code run is handed
 * (what it starts with, not what it could read: see the header), the same list
 * Shift Manager's Claude Code harness passes. `PATH` (its shell
 * and git are found through it), `HOME`, `USER` and `SHELL` (its sign-in, git
 * identity and Bash tool), `TMPDIR`, the two ways it can be given a
 * credential, and the proxy and CA settings a proxied network needs. Add a
 * name here, never a spread of `process.env`.
 */
export const CLAUDE_CODE_PASS = [
  "PATH",
  "HOME",
  "USER",
  "SHELL",
  "TMPDIR",
  "ANTHROPIC_API_KEY",
  "CLAUDE_CODE_OAUTH_TOKEN",
  "HTTPS_PROXY",
  "https_proxy",
  "HTTP_PROXY",
  "http_proxy",
  "ALL_PROXY",
  "all_proxy",
  "NO_PROXY",
  "no_proxy",
  "NODE_EXTRA_CA_CERTS",
] as const;

/** The environment a Claude Code run gets, and the one its sign-in is probed with. */
export function claudeCodeEnv(env: Record<string, string | undefined> = process.env): Record<string, string> {
  return harnessEnv({ pass: CLAUDE_CODE_PASS, env });
}

/** Whether this server runs the scripted Claude Code instead of the SDK. */
export function claudeCodeIsScripted(env: Record<string, string | undefined> = process.env): boolean {
  return env.KITCHEN_SINK_TEST_MODE === "1" && env.KITCHEN_SINK_REAL_HARNESS !== "1";
}

/** Test seams for the block: a stand-in for the Agent SDK. */
export interface ClaudeCodeSeams {
  /** Replaces the SDK (and the scripted one test mode picks). */
  readonly resolveClaudeAgent?: ResolveClaudeAgent;
}

/**
 * The Claude Code block, built from the session flow's feeds.
 *
 * `systemPrompt` is left unset on purpose, which starts the run from Claude
 * Code's own preset. A plain string there would turn off its planning tool,
 * and the plan panel would never fill.
 */
export function claudeCodeBlock(feeds: HarnessFeeds, seams: ClaudeCodeSeams = {}): HarnessBlock {
  const resolveClaudeAgent = seams.resolveClaudeAgent ?? (claudeCodeIsScripted() ? scriptedClaudeCode() : undefined);
  return claudeCodeAgent({
    cwd: feeds.cwd,
    resume: feeds.resume,
    onSession: feeds.onSession,
    model: feeds.model,
    detached: true,
    // Declares no plan record, so goal leg **p** can be seen to fail.
    recordWork: goalControl() !== "no-record",
    permissionMode: "bypassPermissions",
    // The run doesn't load the worktree's own Claude Code settings: a turn can
    // edit `.claude/settings.json`, and a hook it added would run outside the
    // sandbox on the next turn.
    settingSources: [],
    env: claudeCodeEnv(),
    // Unsandboxed on request only: with no sandbox and `bypassPermissions`,
    // nothing confines the run (`lib/harness-sandbox.ts`).
    ...(harnessUnsandboxed()
      ? {}
      : {
          sandbox: async (ctx: Parameters<HarnessFeeds["worktree"]>[0]) => {
            const worktree = await feeds.worktree(ctx);
            const fence = containmentSandbox(worktree);
            return {
              ...fence,
              // The worktree's `.git` points git at the repository. A run that could
              // rewrite it could point the person's next git command at hooks of its own.
              filesystem: { ...fence.filesystem, denyWrite: [join(worktree, ".git")] },
              failIfUnavailable: true,
            };
          },
        }),
    ...(resolveClaudeAgent !== undefined ? { resolveClaudeAgent } : {}),
    name: "claude-code",
    // Claude Code's handle is core's plus its own fields, and a block's hooks
    // take its output as a parameter, so the extended block isn't assignable
    // to core's neutral `HarnessBlock` (core's own note on that type). Shift
    // Manager's harness casts the same way.
  }) as unknown as HarnessBlock;
}

/** Claude Code mode's session flow. `seams` is for tests. */
export function claudeCodeSessionFlow(seams: ClaudeCodeSeams = {}) {
  // No `defaultModel`: a session from before models could be picked runs on
  // Claude Code's own default, as it did.
  return harnessSessionFlow({ kind: CLAUDE_CODE_SESSION, agent: (feeds) => claudeCodeBlock(feeds, seams) });
}

/** The model the scripted Claude Code offers. It runs no model; the id only travels. */
export const SCRIPTED_CLAUDE_MODEL = "scripted-claude-code";

/**
 * What Claude Code mode's New session offers: Claude Code's own list, over the
 * run's environment, each model under the id it resolves to, its default
 * preselected.
 *
 * When the list can't be read, nothing is offered and New session can't start
 * a session; the reason says why, and the next load asks again. There is no
 * fallback id: Kitchen Sink keeps no Claude model name of its own, which would
 * age as Claude Code's default moves, and a session must be born with a
 * concrete model (D1). Claude Code that can't list its models is unlikely to
 * run a turn either.
 */
export async function claudeCodeModelChoices(
  list: (env: Record<string, string>) => Promise<ClaudeModelList> = (env) => listClaudeModels({ env }),
): Promise<ModelChoices> {
  if (claudeCodeIsScripted()) {
    return {
      models: [{ id: SCRIPTED_CLAUDE_MODEL, label: "Scripted Claude Code" }],
      defaultId: SCRIPTED_CLAUDE_MODEL,
      reason: null,
      fallbackId: null,
    };
  }
  const found = await list(claudeCodeEnv());
  if (found.status === "failed") {
    return {
      models: [],
      defaultId: null,
      reason: `Claude Code's model list can't be read (${found.reason}), so a new session can't name its model. Reload to try again.`,
      fallbackId: null,
    };
  }
  const preselected = found.models.find((model) => model.isDefault) ?? found.models[0]!;
  return {
    models: found.models.map(({ id, label }) => ({ id, label })),
    defaultId: preselected.id,
    reason: null,
    fallbackId: null,
  };
}

/** What the mode's check asks of the host. Each a seam for tests. */
export interface ClaudeCodeHostChecks {
  /** Whether the server runs as root, where Claude Code refuses to skip its prompts. */
  readonly isRoot: () => boolean;
  /** Why Claude Code's sandbox can't start here, or `null` when it can. */
  readonly sandboxMissing: (env: Record<string, string>) => string | null;
  /** Claude Code's answer about its sign-in, over the run's own environment. */
  readonly probe: (env: Record<string, string>) => Promise<ClaudeAccountProbe>;
  /** Make the worktree root, or throw why it can't be made. */
  readonly makeRoot: (repository: string) => void;
}

/** Whether `name` is an executable on `path`. */
function onPath(name: string, path: string | undefined): boolean {
  return (path ?? "").split(delimiter).some((dir) => {
    if (dir === "") return false;
    try {
      accessSync(join(dir, name), constants.X_OK);
      return true;
    } catch {
      return false;
    }
  });
}

/** The sandbox Claude Code starts: `sandbox-exec` on macOS, bubblewrap with socat on Linux. */
function sandboxMissing(env: Record<string, string>): string | null {
  if (process.platform === "darwin") {
    return existsSync("/usr/bin/sandbox-exec") ? null : "Claude Code's sandbox is not available: sandbox-exec was not found.";
  }
  if (process.platform === "linux") {
    const missing = ["bwrap", "socat"].filter((name) => !onPath(name, env.PATH));
    return missing.length === 0
      ? null
      : `Claude Code's sandbox is not available: install ${missing.join(" and ")} (bubblewrap) so it can confine the run.`;
  }
  return `Claude Code's sandbox is not available on ${process.platform}.`;
}

/** The host's own answers. */
export const HOST_CHECKS: ClaudeCodeHostChecks = {
  isRoot: () => process.getuid?.() === 0 || process.geteuid?.() === 0,
  sandboxMissing,
  probe: (env) => probeClaudeAccount({ env }),
  makeRoot: (repository) => {
    mkdirSync(worktreeRoot(repository), { recursive: true });
  },
};

/**
 * Claude Code mode's own check, for the gate's mode-check slot: the server
 * isn't root, the sandbox can start, the worktree root can be made, and
 * Claude Code finds its SDK and a sign-in over the environment the run gets.
 * The first that fails is the reason. Under `KITCHEN_SINK_HARNESS_UNSANDBOXED=1`
 * the sandbox isn't checked, and the available mode's note says the run is
 * unsandboxed.
 */
export function claudeCodeModeCheck(checks: ClaudeCodeHostChecks = HOST_CHECKS): ModeCheck {
  return async ({ repository }): Promise<ModeAvailability> => {
    if (claudeCodeIsScripted()) return { available: true };
    if (checks.isRoot()) {
      return { available: false, reason: "The server runs as root. Claude Code runs without approval prompts only as an ordinary user." };
    }
    const env = claudeCodeEnv();
    const unsandboxed = harnessUnsandboxed();
    const sandbox = unsandboxed ? null : checks.sandboxMissing(env);
    if (sandbox !== null) {
      return { available: false, reason: `${sandbox} ${unsandboxedHint("Claude Code")}` };
    }
    try {
      checks.makeRoot(repository);
    } catch (error) {
      return {
        available: false,
        reason: `The folder for session worktrees can't be made: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
    const account = await checks.probe(env);
    if (account.status === "sdk-missing") return { available: false, reason: `The Claude Code SDK is not installed. ${account.reason}` };
    if (account.status === "none") {
      return { available: false, reason: `Claude Code is not signed in on this host (${account.reason}). Sign in with \`claude\`, then restart.` };
    }
    return unsandboxed ? { available: true, note: unsandboxedNote("Claude Code") } : { available: true };
  };
}
