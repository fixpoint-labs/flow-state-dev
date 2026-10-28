/**
 * Claude Code mode: the session flow with the Claude Code block, and the
 * mode's own check of whether this host can run it.
 *
 * Server only. The block runs as background work (`detached`) with its work
 * recorded (`recordWork`), so its plan lands in the shared plan record.
 *
 * **Kitchen Sink confines no run.** It asks for no approval and runs with no
 * sandbox, so it writes, commits and runs commands wherever the server's OS
 * user can — this checkout included, not just the session's worktree. Kitchen
 * Sink is a showcase meant to run on a machine where that is fine. Run the
 * server as a separate OS user, or in a container, when it is not.
 *
 * The run still starts with an allowlisted environment. That filters what it
 * is handed and nothing more: a command it starts as the same OS user can
 * still read the server's own environment (on Linux, from `/proc`).
 *
 * Under `KITCHEN_SINK_TEST_MODE=1` the Agent SDK is replaced by the scripted
 * Claude Code (`lib/scripted-claude-code.ts`) and the check passes, unless
 * `KITCHEN_SINK_REAL_HARNESS=1` asks for the real one, which the goal check
 * does so its controls apply to a real run.
 */
import { mkdirSync } from "node:fs";
import { harnessEnv } from "@flow-state-dev/core";
import {
  claudeCodeAgent,
  listClaudeModels,
  probeClaudeAccount,
  type ClaudeAccountProbe,
  type ClaudeModelList,
  type ResolveClaudeAgent,
} from "@flow-state-dev/claude-code/sdk";

import { goalControl } from "./goal-control";
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
const SCRIPTED_CLAUDE_MODEL = "scripted-claude-code";

/**
 * How long to wait for Claude Code's model list. It answers in about a second
 * on an idle machine and took up to a minute on a loaded one, so the package's
 * 10 s default read a busy host as one that can't list its models.
 */
const MODEL_LIST_TIMEOUT_MS = 60_000;

/**
 * Claude Code's own list. When it can't be read, nothing is offered and New
 * session can't start: Kitchen Sink keeps no Claude model name of its own,
 * which would age as Claude Code's default moves, and a session must be born
 * with a concrete model (D1). The next load asks again. Claude Code that
 * can't list its models is unlikely to run a turn either.
 */
export async function claudeCodeModelChoices(
  list: (env: Record<string, string>) => Promise<ClaudeModelList> = (env) => listClaudeModels({ env, timeoutMs: MODEL_LIST_TIMEOUT_MS }),
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
  /** Claude Code's answer about its sign-in, over the run's own environment. */
  readonly probe: (env: Record<string, string>) => Promise<ClaudeAccountProbe>;
  /** Make the worktree root, or throw why it can't be made. */
  readonly makeRoot: (repository: string) => void;
}

/** The host's own answers. */
export const HOST_CHECKS: ClaudeCodeHostChecks = {
  isRoot: () => process.getuid?.() === 0 || process.geteuid?.() === 0,
  probe: (env) => probeClaudeAccount({ env }),
  makeRoot: (repository) => {
    mkdirSync(worktreeRoot(repository), { recursive: true });
  },
};

/**
 * Claude Code mode's own check, for the gate's mode-check slot: the server
 * isn't root, the worktree root can be made, and Claude Code finds its SDK and
 * a sign-in over the environment the run gets. The first that fails is the
 * reason. Nothing is asked about a sandbox: Kitchen Sink runs Claude Code
 * without one (see the header).
 */
export function claudeCodeModeCheck(checks: ClaudeCodeHostChecks = HOST_CHECKS): ModeCheck {
  return async ({ repository }): Promise<ModeAvailability> => {
    if (claudeCodeIsScripted()) return { available: true };
    if (checks.isRoot()) {
      return { available: false, reason: "The server runs as root. Claude Code runs without approval prompts only as an ordinary user." };
    }
    const env = claudeCodeEnv();
    try {
      checks.makeRoot(repository);
    } catch (error) {
      return {
        available: false,
        reason: `The folder for session worktrees can't be made: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
    // The gate keeps this answer until restart, so a start of Claude Code too
    // slow to answer is asked once more before it counts against the person.
    let account = await checks.probe(env);
    if (account.status === "none" && account.unanswered === true) account = await checks.probe(env);
    if (account.status === "sdk-missing") return { available: false, reason: `The Claude Code SDK is not installed. ${account.reason}` };
    if (account.status === "none") {
      return {
        available: false,
        reason:
          account.unanswered === true
            ? `${account.reason}, so its sign-in is unknown. Restart the server to ask again.`
            : `Claude Code is not signed in on this host (${account.reason}). Sign in with \`claude\`, then restart.`,
      };
    }
    return { available: true };
  };
}
