/**
 * Claude Code mode: the session flow with the Claude Code block, and the
 * mode's own check of whether this host can run it.
 *
 * Server only. The block runs as background work (`detached`) with its work
 * recorded (`recordWork`), so its plan lands in the shared plan record.
 *
 * **A tool call waits on the user.** The read-only tools (`PRE_ALLOWED_TOOLS`)
 * run unasked; any other call stops the turn, the conversation shows the
 * approval card, and the user's Allow, Deny or Allow for this run resumes the
 * same conversation (the session flow's `approveTools`, FIX-2432).
 *
 * **Kitchen Sink confines no run.** It runs with no sandbox, so a call the
 * user allows writes, commits and runs commands wherever the server's OS user
 * can — this checkout included, not just the session's worktree, and the
 * read-only tools read anywhere it can. Kitchen Sink is a showcase meant to
 * run on a machine where that is fine. Run the server as a separate OS user,
 * or in a container, when it is not.
 *
 * The run still starts with an allowlisted environment. That filters what it
 * is handed and nothing more: a command it starts as the same OS user can
 * still read the server's own environment (on Linux, from `/proc`).
 *
 * What it loads from the repository depends on whether the operator trusts it
 * (`lib/harness-trust.ts`). Untrusted, the default, it loads nothing: no
 * `CLAUDE.md`, no skills, no settings. Trusted, it loads the repository's
 * Claude Code project settings, `CLAUDE.md` and skills with every hook off
 * (a turn can write a hook into `.claude/settings.json`, and it would run by
 * itself on the next turn, in no transcript), and it is handed the keys the
 * operator named.
 *
 * Under `KITCHEN_SINK_TEST_MODE=1` the Agent SDK is replaced by the scripted
 * Claude Code (`lib/scripted-claude-code.ts`) and the check passes, unless
 * `KITCHEN_SINK_REAL_HARNESS=1` asks for the real one, which the goal check
 * does so its controls apply to a real run.
 */
import { mkdirSync } from "node:fs";
import { harnessEnv } from "@flow-state-dev/core";
import {
  CLAUDE_CODE_PASS,
  checkClaudeCodeReadiness,
  claudeCodeAgent,
  listClaudeModels,
  type ClaudeModelList,
  type ResolveClaudeAgent,
} from "@flow-state-dev/claude-code/sdk";

import { goalControl } from "./goal-control";
import { harnessTrust, type RepoLine } from "./harness-trust";
import type { HarnessTrust } from "./harness-workspace";
import type { HarnessSessionFeeds } from "@flow-state-dev/harness-manager";
import type { HarnessBlock, HarnessReadiness } from "@flow-state-dev/core/types";
import { kitchenSinkHarnessFlow } from "./harness-session-flow";
import { worktreeRoot } from "./harness-worktree";
import { flowKindOf, modeById } from "./modes";
import type { ModeAvailability, ModeCheck } from "./harness-gate";
import { fromReadiness } from "./mode-readiness";
import type { ModelChoices } from "./harness-models";
import { scriptedClaudeCode } from "./scripted-claude-code";

/** Claude Code mode's flow kind, from the mode list: the rail lists its sessions by it. */
export const CLAUDE_CODE_SESSION = flowKindOf(modeById("claude-code"));

/**
 * The environment a Claude Code run gets, and the one its sign-in is probed
 * with: the Claude Code package's own pass-list, and the keys a trusting
 * operator named (what a run starts with, not what it could read: see the
 * header).
 */
export function claudeCodeEnv(
  env: Record<string, string | undefined> = process.env,
  trust: HarnessTrust = harnessTrust(),
): Record<string, string> {
  return harnessEnv({ pass: [...CLAUDE_CODE_PASS, ...trust.pass], env });
}

/** What a Claude Code run loads from the repository: its setting sources and a settings layer above them. */
export interface ClaudeCodeRepoOptions {
  readonly settingSources: ["project"] | [];
  readonly settings?: { readonly disableAllHooks: true };
}

/**
 * What a Claude Code run loads from the repository. Untrusted: nothing, since
 * a hook a turn added would run on the next turn. Trusted: the project's
 * settings, `CLAUDE.md` and skills, with a settings layer above them that turns
 * every hook off. Never the operator's own user settings.
 *
 * The goal control `hooks-on` drops the layer, so the goal leg that no hook
 * runs can be seen to fail.
 */
export function claudeCodeRepoOptions(trust: HarnessTrust = harnessTrust()): ClaudeCodeRepoOptions {
  if (!trust.trusted) return { settingSources: [] };
  return goalControl() === "hooks-on"
    ? { settingSources: ["project"] }
    : { settingSources: ["project"], settings: { disableAllHooks: true } };
}

/** The header's line for a Claude Code session, read off the options its run gets. */
export function claudeCodeRepoLine(trust: HarnessTrust = harnessTrust()): RepoLine {
  const options = claudeCodeRepoOptions(trust);
  const conventions =
    options.settingSources.length === 0 ? "not loaded" : options.settings?.disableAllHooks === true ? "loaded, hooks off" : "loaded, hooks on";
  return { conventions, keys: trust.pass };
}

/** Whether this server runs the scripted Claude Code instead of the SDK. */
export function claudeCodeIsScripted(env: Record<string, string | undefined> = process.env): boolean {
  return env.KITCHEN_SINK_TEST_MODE === "1" && env.KITCHEN_SINK_REAL_HARNESS !== "1";
}

/**
 * The tools a Claude Code run uses without asking: the read-only ones. Any
 * other call waits on the user's answer (see the header). Widen it here.
 */
export const PRE_ALLOWED_TOOLS = ["Read", "Glob", "Grep"] as const;

/** Test seams for the block: a stand-in for the Agent SDK. */
export interface ClaudeCodeSeams {
  /** Replaces the SDK (and the scripted one test mode picks). */
  readonly resolveClaudeAgent?: ResolveClaudeAgent;
  /**
   * `false` builds the session flow without tool approvals, for a test of
   * something else on a host without durable execution (a turn with approvals
   * on is refused there). The shipped flow has them on.
   */
  readonly approveTools?: boolean;
}

/**
 * The Claude Code block, built from the session flow's feeds.
 *
 * `systemPrompt` is left unset on purpose, which starts the run from Claude
 * Code's own preset. A plain string there would turn off its planning tool,
 * and the plan panel would never fill.
 */
export function claudeCodeBlock(feeds: HarnessSessionFeeds, seams: ClaudeCodeSeams = {}): HarnessBlock {
  const resolveClaudeAgent = seams.resolveClaudeAgent ?? (claudeCodeIsScripted() ? scriptedClaudeCode() : undefined);
  const trust = harnessTrust();
  return claudeCodeAgent({
    cwd: feeds.cwd,
    resume: feeds.resume,
    onSession: feeds.onSession,
    model: feeds.model,
    detached: true,
    // Declares no plan record, so goal leg **p** can be seen to fail.
    recordWork: goalControl() !== "no-record",
    // Records no pull request in the turn, so goal leg **r1** can be seen to fail.
    recordPullRequests: goalControl() !== "no-pr-record",
    // A call that isn't pre-allowed waits on the user (`approveTools` on the
    // session flow): the read-only tools run unasked, everything else asks.
    ...(feeds.onToolApproval !== undefined ? { onToolApproval: feeds.onToolApproval } : {}),
    permissionMode: "default",
    allowedTools: [...PRE_ALLOWED_TOOLS],
    // Untrusted, nothing from the repository; trusted, its conventions with
    // every hook off (see the header).
    ...claudeCodeRepoOptions(trust),
    env: claudeCodeEnv(process.env, trust),
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
  return kitchenSinkHarnessFlow({
    kind: CLAUDE_CODE_SESSION,
    // On, unless a test without durable execution turns it off (the seam) or
    // the `no-approval` goal control does, so goal leg **a** can be seen to fail.
    approveTools: seams.approveTools !== false && goalControl() !== "no-approval",
    agent: (feeds) => claudeCodeBlock(feeds, seams),
  });
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
  /** Whether Claude Code can run over the run's own environment: its SDK and sign-in, from the Claude Code package. */
  readonly readiness: (env: Record<string, string>) => Promise<HarnessReadiness>;
  /** Make the worktree root, or throw why it can't be made. */
  readonly makeRoot: (repository: string) => void;
}

/** The host's own answers. */
export const HOST_CHECKS: ClaudeCodeHostChecks = {
  isRoot: () => process.getuid?.() === 0 || process.geteuid?.() === 0,
  readiness: (env) => checkClaudeCodeReadiness({ env }),
  makeRoot: (repository) => {
    mkdirSync(worktreeRoot(repository), { recursive: true });
  },
};

/**
 * Claude Code mode's own check, for the gate's mode-check slot: the server
 * isn't root, the worktree root can be made, and Claude Code is ready over the
 * environment the run gets (the Claude Code package's readiness check: its SDK
 * and a sign-in, asked once more when Claude Code is slow to answer). The first
 * that fails is the reason. Nothing is asked about a sandbox: Kitchen Sink runs Claude Code
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
    return fromReadiness(await checks.readiness(env));
  };
}
