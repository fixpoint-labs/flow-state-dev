/**
 * The lab's server, put together from package pieces: the workers in
 * `workforce/`, the built-in agent flow with memory composed in, the lab's one
 * coding flow, and a store. `fsdev.config.mts` calls
 * {@link openTeammates} and default-exports the `FlowState` it returns.
 *
 * - **Chief of Staff, researcher and writer** run on the built-in `agent` flow, so each
 *   has `sendMessage` and one conversation where messages land. Memory is
 *   composed in through `uses` (read) and `afterAnswer` (record each turn).
 *   A history summary keeps what was said before the history window: its
 *   capability goes in `uses` and its fold runs as `beforeAnswer`, so a turn
 *   is summarized before it leaves the window the worker reads word for word.
 *   The flow's tool catalog holds web search and fetch, and `uses` adds
 *   reading the working folder's source; each worker's `tools:` line picks its
 *   own from them.
 * - **Claude Code, Codex and Cursor** are the coding workers, one per
 *   harness, on the lab's coding flow (`src/flows/coder.ts`): it takes the
 *   tasks a teammate files and runs each through its worker's harness, in a
 *   worktree of the working folder. Before a task starts, the harness's own
 *   sign-in check runs; one this machine isn't set up for fails the task with
 *   a sentence that names it and says what's missing.
 * - **The working folder** is one git checkout the operator names. It is the
 *   host's constant run source, so every coding run and every read of the
 *   workers' source tools works in it. There are no projects: no worker has a
 *   project tool, and nothing a model writes can name another folder.
 * - **Teammates** you hire from the page are rows of your own roster, written
 *   through the roster flow `hireWorkforce` registers; nothing restarts.
 *
 * Durable, on SQLite: a worker message a busy host turned away is sent again
 * on its session's wake, and a restart keeps every conversation.
 */
import { existsSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CODEX_PASS, codexAgent, probeCodexAccount } from "@flow-state-dev/codex";
import { harnessEnv } from "@flow-state-dev/core";
import type { HarnessBlock } from "@flow-state-dev/core/types";
import { CLAUDE_CODE_PASS, claudeCodeAgent, probeClaudeAccount } from "@flow-state-dev/claude-code/sdk";
import { cursorAgent, cursorSignIn } from "@flow-state-dev/cursor";
import { createFlowState } from "@flow-state-dev/engine";
import { system } from "@flow-state-dev/memory";
import { sqliteStores } from "@flow-state-dev/store-sqlite";
import { utility } from "@flow-state-dev/core";
import { fetch, search } from "@flow-state-dev/tools";
import {
  AGENT_FLOW,
  consultSessionsCapability,
  createWorkerInstallation,
  defineAgentWorkerFlow,
  hireWorkforce,
  projectSourceTools,
} from "@flow-state-dev/workforce";
import { readDeclaredRoster } from "@flow-state-dev/workforce/loader";
import { z } from "zod";
import { localWorkspaceHost } from "@flow-state-dev/workspace";
import { CODER_FLOW, coderFlow, type Harness } from "./src/flows/coder.ts";

/** The workers, beside this file. */
const TEAMMATES_TREE = fileURLToPath(new URL("./workforce", import.meta.url));

/** The smaller model a consult of another conversation reads on. */
const UTILITY_MODEL = "openai/gpt-6-luna";

export interface TeammatesOptions {
  /** The SQLite file the lab keeps everything in. */
  store: string;
  /** The model Chief of Staff, researcher and writer answer on, and memory records with. */
  model: string;
  /** The user the page acts as. */
  userId: string;
  /**
   * The working folder: an absolute path to a git checkout on this machine.
   * Every coding run works in a worktree of it, and the workers' source reads
   * read it. Unset or missing fails the start.
   */
  workdir: string | undefined;
  /** Where coding runs' worktrees go. */
  runsRoot: string;
  /** The workers' tree. Defaults to {@link TEAMMATES_TREE}. */
  tree?: string;
  /** Wall-clock budget for one coding run. Defaults to 20 minutes. */
  runTimeoutMs?: number;
  /** The harness a coding worker runs on when its file names none. Defaults to `cursor`. */
  harness?: string;
}

/** The harnesses a coding worker may name in `harness:`. Each run gets only the environment its harness needs. */
const HARNESSES: Record<string, Harness> = {
  "claude-code": (feeds) =>
    claudeCodeAgent({
      ...feeds,
      env: harnessEnv({ pass: CLAUDE_CODE_PASS }),
      detached: true,
      recordWork: true,
      allowedTools: ["Read", "Write", "Edit", "Bash"],
      permissionMode: "acceptEdits",
    } as never) as unknown as HarnessBlock,
  codex: ({ cwd, resume, onSession, onActivity }) =>
    codexAgent({
      cwd,
      resume,
      onSession,
      onActivity,
      client: { env: harnessEnv({ pass: CODEX_PASS }) },
      thread: { sandboxMode: "workspace-write" },
    } as never) as unknown as HarnessBlock,
  cursor: ({ cwd, resume, onSession, onSteerable }) =>
    cursorAgent({
      cwd,
      resume,
      onSession,
      onSteerable,
      env: harnessEnv({ pass: CURSOR_PASS }),
      // A local Cursor run must name its model; Kitchen Sink's default.
      model: "composer-2.5",
      // Its sandbox is off, as Kitchen Sink runs it: the run works in its own worktree.
      agent: { mode: "agent", local: { sandboxOptions: { enabled: false } } },
      name: "cursor",
    } as never) as unknown as HarnessBlock,
};

/** The variables Cursor's runtime is handed: its shell's, its sign-in, and a proxied network's. */
const CURSOR_PASS = ["PATH", "HOME", "USER", "SHELL", "TMPDIR", "CURSOR_API_KEY", "HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy", "ALL_PROXY", "all_proxy", "NO_PROXY", "no_proxy", "NODE_EXTRA_CA_CERTS"];

/** A harness this machine can't run, in a sentence that names it and what's missing. */
const notSetUp = (harness: string, reason: string, fix: string) => `${harness} isn't set up on this machine: ${reason}. ${fix}, then start the task again.`;

/** Each harness's own sign-in check, run before a task on it starts. */
const READY: Record<string, () => Promise<string | undefined>> = {
  "claude-code": async () => {
    const env = harnessEnv({ pass: CLAUDE_CODE_PASS });
    let account = await probeClaudeAccount({ env });
    // A cold start can miss the probe's window: asked once more, as Kitchen Sink does.
    if (account.status === "none" && account.unanswered === true) account = await probeClaudeAccount({ env });
    return account.status === "account" ? undefined : notSetUp("Claude Code", account.reason, "Sign in with `claude`");
  },
  codex: async () => {
    const account = await probeCodexAccount({ env: harnessEnv({ pass: CODEX_PASS }), timeoutMs: 30_000 });
    return account.status === "account" ? undefined : notSetUp("Codex", account.reason, "Sign in with `codex login`");
  },
  cursor: async () => {
    const signIn = await cursorSignIn(harnessEnv({ pass: CURSOR_PASS })).catch((error: unknown) => ({
      status: "none" as const,
      reason: `the Cursor SDK didn't load (${error instanceof Error ? error.message : String(error)})`,
    }));
    return signIn.status === "none" ? notSetUp("Cursor", signIn.reason, "Set CURSOR_API_KEY or sign in to Cursor") : undefined;
  },
};

/**
 * The working folder, checked: an existing git checkout, as an absolute path.
 * Never a fallback: no folder named is an error, not the current directory.
 *
 * @throws When `workdir` is unset, missing, or not a git checkout.
 */
export function workingFolder(workdir: string | undefined): string {
  if (workdir === undefined || workdir.trim() === "") {
    throw new Error("teammates: TEAMMATES_WORKDIR is not set. Set it to the git checkout the team works in.");
  }
  const folder = resolve(workdir);
  if (!existsSync(folder) || !statSync(folder).isDirectory()) {
    throw new Error(`teammates: TEAMMATES_WORKDIR names ${folder}, which is not a folder on this machine.`);
  }
  if (!existsSync(join(folder, ".git"))) {
    throw new Error(`teammates: TEAMMATES_WORKDIR names ${folder}, which is not a git checkout.`);
  }
  return folder;
}

/**
 * Build the lab's server.
 *
 * @throws When the working folder is unset, missing or not a git checkout, or the workers' tree doesn't load.
 */
export async function openTeammates(options: TeammatesOptions) {
  const workdir = workingFolder(options.workdir);
  const roster = await readDeclaredRoster(options.tree ?? TEAMMATES_TREE);
  if (roster.problems.length > 0) {
    throw new Error(`teammates: the workers did not load: ${roster.problems.map((p) => `${p.layer} ${p.path}`).join(", ")}`);
  }

  const mem = system({ model: options.model, working: { capacity: 7 }, episodic: true, semantic: true });
  const earlier = utility.historySummary({
    summarize: utility.summarizer({
      name: "earlier-turns",
      model: options.model,
      granularity: "detailed",
      // Named, or a small model summarizes the newer turns alone and drops the summary so far.
      objectives: [
        "The input's `summary` is the summary so far and `turns` are newer turns: write one summary of both, never of the turns alone.",
        "Your summary replaces the summary so far: everything it says must still be in yours, then add what the newer turns add.",
        "Keep every name, date, code and number the user or another worker stated, word for word. Small talk can shrink; those never go.",
      ],
    }),
  });
  // One host for coder's runs and the workers' reads, on one constant source: the working folder.
  const workspace = localWorkspaceHost({
    root: options.runsRoot,
    remotes: { allow: [] },
    localRepositories: [workdir],
    source: () => ({ kind: "repo", repo: workdir }),
  });
  let flows: Record<string, unknown> = {};
  const installation = createWorkerInstallation({ standardWorkers: roster.workers, workerFlows: () => flows as never });
  flows = {
    // Each teammate's `icon:` and `color:` lines ride on its roster row, so the page draws them.
    [AGENT_FLOW]: {
      flow: defineAgentWorkerFlow({
        installation,
        settings: { icon: z.string().optional(), color: z.string().optional() },
        model: options.model,
        catalog: {
          ...projectSourceTools(workspace),
          search: search(),
          fetch: fetch(),
        },
        uses: [
          mem.capability.presets({ recall: false, connect: false, semantic: true, episodic: true }),
          earlier.capability,
          // Offered to a worker whose file picks `consultSessions: [consult]` (Chief of Staff).
          consultSessionsCapability(installation),
        ],
        beforeAnswer: earlier.fold,
        afterAnswer: mem.captureFromItems,
        // researcher reads a whole repository a file at a time: room to dig before it answers.
        maxSteps: 100,
      }),
      showSettings: ["icon", "color"],
    },
    [CODER_FLOW]: coderFlow({
      harnesses: HARNESSES,
      defaultHarness: options.harness ?? "cursor",
      ready: READY,
      workspace,
      runTimeoutMs: options.runTimeoutMs ?? 20 * 60_000,
    }),
  };
  const copies = hireWorkforce(installation) as Array<{ id: string }>;

  const state = createFlowState({
    flows: Object.fromEntries(copies.map((copy) => [copy.id, copy])),
    stores: { default: { primary: sqliteStores({ filename: options.store }) } },
    durable: true,
    devtool: { userId: options.userId },
    // A consult reads on `intent/utility`: a smaller model than the workers answer on.
    models: { default: options.model, intents: { utility: [UTILITY_MODEL] } },
  } as never);

  return state;
}

/** Where a lab run keeps its store and runs by default: `.fsdev/` beside this file. */
const LAB_DATA = fileURLToPath(new URL("./.fsdev", import.meta.url));
export const defaultStore = () => join(LAB_DATA, "teammates.sqlite");
