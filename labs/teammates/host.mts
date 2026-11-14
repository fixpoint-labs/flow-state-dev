// fallow-ignore-file duplicate-export -- each lab is its own app, and its host exposes the same openLab and operatorGitHubToken as the others on purpose.
/**
 * The lab's server, put together from package pieces: the workers in
 * `workforce/`, the built-in agent flow with memory composed in, the lab's one
 * coding flow, and a store. `fsdev.config.mts` calls
 * {@link openTeammates} and default-exports the `FlowState` it returns.
 *
 * - **Lead, researcher and writer** run on the built-in `agent` flow, so each
 *   has `sendMessage` and one conversation where messages land. Memory is
 *   composed in through `uses` (read) and `afterAnswer` (record each turn).
 *   A history summary keeps what was said before the history window: its
 *   capability goes in `uses` and its fold runs as `beforeAnswer`, so a turn
 *   is summarized before it leaves the window the worker reads word for word.
 *   The flow's tool catalog holds web search and fetch, and `uses` adds
 *   reading the working folder's source; each worker's `tools:` line picks its
 *   own from them.
 * - **Claude Code, Codex and Cursor** are the coding workers, one per
 *   harness, on the harness kit's coding worker flow (`coder`): it takes the
 *   tasks a teammate files and runs each through its worker's harness, in a
 *   worktree of the working folder. Before a task starts, the harness's
 *   readiness is checked; one this machine isn't set up for fails the task
 *   with a sentence that names it and says what to run.
 * - **Readiness** is the harness kit's: put in the workers' context so Lead
 *   files coding work only on a ready harness, and served as the `harnesses`
 *   flow's `readiness` view, read with no session, which `{ refresh: true }`
 *   reads again.
 * - **The working folder** is one git checkout the operator names. It is the
 *   host's constant run source, so every coding run and every read of the
 *   workers' source tools works in it. There are no projects: no worker has a
 *   project tool, and nothing a model writes can name another folder. So the
 *   operator also names its checks (`checks`), the commands a coding run's
 *   worktree must pass before its task is done, and a `setup` command each
 *   fresh worktree runs first so the checks find what they need.
 * - **The lab's context** (the `lab-context` flow's `context` view, read with
 *   no session): the
 *   working folder, the model, the default harness, which workers each worker
 *   hands work to, and, when the folder doesn't ignore `.fsdev/`, the same
 *   problem a coding run's checkout would be refused with (checked at start,
 *   never fatal). The page draws its context strip and first-run lines from it.
 * - **Teammates** you hire from the page are rows of your own roster, written
 *   through the workforce kit's roster flow; nothing restarts.
 * - **Routines**: Lead, researcher and writer hold the routine tools, so you
 *   can ask one to follow a GitHub pull request or to do something on a clock,
 *   and to list, pause or delete what it follows. A pull request's events are
 *   polled (no public URL) on the operator's own GitHub token, for the
 *   operator alone; `fsdev dev` ticks the polls and the clock routines, each
 *   from a SQLite file of its own beside the store.
 *
 * Durable, on SQLite: a worker message a busy host turned away is sent again
 * on its session's wake, and a restart keeps every conversation.
 */
import { execFileSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { claudeCode } from "@flow-state-dev/claude-code";
import { codexHarness } from "@flow-state-dev/codex";
import { defineFlow, defineView, handler } from "@flow-state-dev/core";
import type { BlockContext, ModelResolver } from "@flow-state-dev/core/types";
import { cursorHarness } from "@flow-state-dev/cursor";
import { ASK_MARKER_IGNORED, assertPositiveInt, scriptedHarness, type Harness } from "@flow-state-dev/harness-manager";
import { codingDrainBudgetMs, harnesses } from "@flow-state-dev/harness-manager/kit";
import { createFlowState } from "@flow-state-dev/engine";
import { system } from "@flow-state-dev/memory";
import { createScheduledTransportAdapter } from "@flow-state-dev/scheduled";
import { createSQLiteScheduleIndex, sqliteStores } from "@flow-state-dev/store-sqlite";
import { initializeSchema } from "@flow-state-dev/store-sqlite/host";
import Database from "better-sqlite3";
import { utility } from "@flow-state-dev/core";
import { fetch, search } from "@flow-state-dev/tools";
import { githubSubscriptionProvider, projectSourceTools } from "@flow-state-dev/workforce";
import { workforce } from "@flow-state-dev/workforce/kit";
import { readWorkforceFolder } from "@flow-state-dev/workforce/loader";
import { z } from "zod";
import { checkoutCommandProblem, localWorkspaceHost, parseCheckoutCommand, type WorkspaceSetup } from "@flow-state-dev/workspace";

/** The workers, beside this file. */
const TEAMMATES_TREE = fileURLToPath(new URL("./workforce", import.meta.url));

/** The smaller model a consult of another conversation reads on. */
const UTILITY_MODEL = "openai/gpt-6-luna";

export interface TeammatesOptions {
  /** The SQLite file the lab keeps everything in. */
  store: string;
  /** The model Lead, researcher and writer answer on, and memory records with. */
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
  /** A command each fresh worktree runs before its coding run starts (`pnpm install`). Absent: none. */
  setup?: WorkspaceSetup;
  /**
   * The commands a coding run's worktree must pass before its task is done,
   * run in order with no shell. Absent or empty: a run is done when its
   * harness says it finished.
   */
  checks?: readonly string[];
  /**
   * For goal checks only: every coding worker runs on harness-manager's
   * scripted harness instead of its own, which narrates five steps this far
   * apart and finishes, with no model and no sign-in. Absent: the real harnesses.
   */
  scriptedHarnessStepMs?: number;
  /**
   * For goal checks only: how long a request's heartbeat may be silent before
   * the server takes it as interrupted (the engine's `staleSweepThresholdMs`),
   * which is what lets the board take a dead run's row back. Absent: the
   * engine's default, one minute.
   */
  staleThresholdMs?: number;
  /** Resolves every model the host calls, in place of the gateway: the contract tests pass a scripted one. Absent: the gateway. */
  modelResolver?: ModelResolver;
  /**
   * The operator's GitHub token ({@link operatorGitHubToken}): a GitHub routine
   * reads GitHub with it, for {@link userId} only. Absent: a GitHub routine is
   * refused, naming `GITHUB_TOKEN`; clock routines still run.
   */
  githubToken?: string;
  /** GitHub's REST API root. Absent: GitHub's own. A goal check names its stub. */
  githubApiUrl?: string;
}

/** How long a coding run's checks may take together. */
const CHECKS_TIMEOUT_MS = 10 * 60_000;

/** The model a Cursor run uses: a local Cursor run must name one. */
const CURSOR_MODEL = "composer-2.5";

/** The flow whose `context` view answers what the lab works on and with (`labContextSchema`). */
const LAB_CONTEXT_FLOW = "lab-context";

/** What the page's context strip and first run read: the lab's settings and the declared delegates. */
const labContextSchema = z.object({
  /** The working folder, as an absolute path. */
  folder: z.string(),
  /** Why a coding run's checkout of the folder would be refused, or `null` when it wouldn't. */
  folderProblem: z.string().nullable(),
  /** The model the teammates answer on. */
  model: z.string(),
  /** The harness a coding worker whose file names none runs on. */
  harness: z.string(),
  /** Each worker's declared delegates, by worker id: ids, or `"all"`. A worker with none is absent. */
  delegates: z.record(z.string(), z.union([z.literal("all"), z.array(z.string())])),
});

// FIX-2624.
/**
 * The lab's context as a user-scope view: what the page's context strip and
 * first run read, with no session. The answer is the host's settings, the same
 * for every caller; it reads no resource, so it names no topic.
 *
 * @param read The lab's settings, as the host holds them.
 */
export function labContextView(read: () => Promise<z.infer<typeof labContextSchema>>) {
  return defineView({
    scope: "user",
    block: handler({
      name: "lab-context",
      description: "What the lab works on and with: the working folder and its problem if any, the model, the default harness, and each worker's delegates.",
      inputSchema: z.object({}),
      outputSchema: labContextSchema,
      execute: read,
    }),
  });
}

/** The lab-context view, for the page's `viewRef` (a type import: the page holds no block). */
export type LabContextView = ReturnType<typeof labContextView>;

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
 * The coding-run budget, checked: `TEAMMATES_RUN_TIMEOUT_MS` as a whole number
 * of milliseconds, or `undefined` (the host's default) when unset. The check is
 * harness-manager's own `assertPositiveInt`, so a value no timer can hold fails
 * here, at start, rather than on a claimed run.
 *
 * @throws When the setting is not a positive whole number a timer can hold.
 */
export function runTimeout(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  return assertPositiveInt("TEAMMATES_RUN_TIMEOUT_MS", Number(value));
}

/**
 * The setup command `TEAMMATES_SETUP` names: one command, split into words as
 * a check is, run with no shell. `undefined` when unset or blank.
 *
 * @throws When the command can't be split, or uses a shell operator.
 */
export function setupCommand(value: string | undefined): WorkspaceSetup | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  const parsed = parseCheckoutCommand(value.trim());
  if ("problem" in parsed) throw new Error(`TEAMMATES_SETUP: ${parsed.problem}`);
  return { command: parsed.words };
}

/**
 * The checks `TEAMMATES_CHECKS` names, `;`-separated: `pnpm typecheck; pnpm test`.
 * Each is one command with no shell, so a `;` can only separate two of them.
 * `undefined` when unset or blank.
 *
 * @throws When a command can't be split into words, or uses a shell operator.
 */
export function checkCommands(value: string | undefined): string[] | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  const commands = value.split(";").map((command) => command.trim()).filter((command) => command !== "");
  for (const command of commands) {
    const problem = checkoutCommandProblem(command);
    if (problem !== undefined) throw new Error(`TEAMMATES_CHECKS: ${problem}`);
  }
  return commands;
}

/**
 * The operator's GitHub token: `GITHUB_TOKEN`, else what `gh auth token`
 * answers, read once at start and never from a request. `undefined` when
 * neither has one.
 */
export function operatorGitHubToken(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const named = env.GITHUB_TOKEN?.trim();
  if (named !== undefined && named !== "") return named;
  try {
    const signedIn = execFileSync("gh", ["auth", "token"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 10_000 }).trim();
    return signedIn === "" ? undefined : signedIn;
  } catch {
    return undefined;
  }
}

/**
 * GitHub for routines, read with the operator's token and for the operator
 * alone: a GitHub routine another user asks for, or one asked for with no
 * token, is refused naming `GITHUB_TOKEN`, and the token is never lent.
 */
function operatorGitHub(operator: string, token: string | undefined, apiUrl: string | undefined) {
  const reads = (ctx: BlockContext) => (ctx.session.identity as { userId?: string }).userId === operator;
  const github = githubSubscriptionProvider({ token: (ctx) => (reads(ctx) ? token : undefined), ...(apiUrl === undefined ? {} : { apiUrl }) });
  return {
    ...github,
    async canRead(key: string, ctx: BlockContext) {
      if (token === undefined) throw new Error("GitHub routines need GITHUB_TOKEN: set it, or sign in with `gh auth login`, and start the lab again. Nothing was saved.");
      if (!reads(ctx)) throw new Error(`GitHub routines read GitHub with this lab's GITHUB_TOKEN, which serves only ${operator}. Nothing was saved.`);
      return github.canRead(key, ctx);
    },
  };
}

/** A schedule index in a SQLite file of its own: the index has one table, and one index ticks one flow. */
function scheduleIndexAt(filename: string) {
  const db = new Database(filename);
  initializeSchema(db);
  return createSQLiteScheduleIndex(db);
}

/**
 * Build the lab's server.
 *
 * @throws When the working folder is unset, missing or not a git checkout, or the workers' tree doesn't load.
 */
export async function openTeammates(options: TeammatesOptions) {
  const workdir = workingFolder(options.workdir);
  const tree = options.tree ?? TEAMMATES_TREE;
  // Who each worker hands work to, for the first run's lines: read off the tree the workforce kit installs.
  // The kit's own read is the one that claims the folder; this one only reads.
  const delegates = Object.fromEntries(
    (await readWorkforceFolder({ path: tree, claim: () => undefined })).workers.flatMap((w) => {
      const declared = w.declared.delegates;
      return declared === "all" || Array.isArray(declared) ? [[w.id, declared as "all" | string[]]] : [];
    }),
  );

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
    ...(options.setup === undefined ? {} : { setup: options.setup }),
  });
  const runTimeoutMs = options.runTimeoutMs ?? 20 * 60_000;
  const checks = { commands: options.checks ?? [], timeoutMs: CHECKS_TIMEOUT_MS };
  const defaultHarness = options.harness ?? "cursor";
  // The folder's ignore rule, read once at start with the check a run's checkout gets; never fatal.
  const folderProblem = workspace.checkRepository!(workdir, { ignored: ASK_MARKER_IGNORED }).then(
    (answer) => (answer.usable ? null : answer.problem),
    (error: unknown) => `couldn't check the folder: ${error instanceof Error ? error.message : String(error)}`,
  );
  void folderProblem.then((problem) => problem !== null && console.warn(`teammates: ${problem}`));
  // A goal's scripted harness (harness-manager's) stands in for every harness under its own id, and is always ready.
  const scripted = options.scriptedHarnessStepMs;
  const stub = (id: string, label: string): Harness => ({
    id,
    label,
    agent: scriptedHarness({ stepEveryMs: scripted! }).slot,
    readiness: async () => ({ ready: true }),
    pass: [],
  });
  // Clock routines and GitHub's polls tick from two files beside the store (`fsdev dev` ticks both).
  const beside = (index: string) => options.store.replace(/(\.[^./\\]+)?$/, `-${index}$1`);
  const github = operatorGitHub(options.userId, options.githubToken, options.githubApiUrl);

  const contextFlow = defineFlow({
    kind: LAB_CONTEXT_FLOW,
    views: {
      context: labContextView(async () => ({
        folder: workdir,
        folderProblem: await folderProblem,
        model: options.model,
        harness: defaultHarness,
        delegates,
      })),
    },
  } as never)({ id: LAB_CONTEXT_FLOW } as never) as { id: string };

  const state = createFlowState({
    kits: [
      workforce({
        directory: tree,
        agent: {
          // Each teammate's `icon:` and `color:` lines ride on its roster row, so the page draws them.
          settings: { icon: z.string().optional(), color: z.string().optional() },
          showSettings: ["icon", "color"],
          model: options.model,
          catalog: {
            ...projectSourceTools(workspace),
            search: search(),
            fetch: fetch(),
          },
          uses: [mem.capability.presets({ recall: false, connect: false, semantic: true, episodic: true }), earlier.capability],
          beforeAnswer: earlier.fold,
          afterAnswer: mem.captureFromItems,
          // researcher reads a whole repository a file at a time: room to dig before it answers.
          maxSteps: 100,
        },
        routines: {
          index: scheduleIndexAt(beside("clock")),
          providers: [github],
          poll: { index: scheduleIndexAt(beside("poll")) },
        },
        github: { provider: github, poll: true },
      }),
      // A run that committed waits for your review, and the working folder's checks pass first.
      harnesses({ workspace, defaultHarness, review: true, checks, runTimeoutMs, logReadiness: true }),
      scripted === undefined ? claudeCode() : claudeCode().without(harnesses.slots.harnesses, "claude-code"),
    ],
    fill: {
      [harnesses.slots.harnesses]:
        scripted === undefined
          ? [codexHarness(), cursorHarness({ model: CURSOR_MODEL } as never)]
          : [stub("claude-code", "Claude Code"), stub("codex", "Codex"), stub("cursor", "Cursor")],
    },
    flows: [contextFlow],
    stores: { default: { primary: sqliteStores({ filename: options.store }) } },
    // The route `serve()`'s tick dispatches each due clock routine and poll to.
    adapters: [createScheduledTransportAdapter()],
    durable: true,
    // A shutdown waits for a coding run still going, its checks and judge included, rather than the engine's 30 s default.
    dispatchDrainTimeoutMs: codingDrainBudgetMs({ runTimeoutMs, checks }),
    ...(options.staleThresholdMs === undefined ? {} : { staleSweepThresholdMs: options.staleThresholdMs }),
    // Every request is the lab's own user, in the lab's own org, never a user the request names: the operator-only GitHub token is gated on it, and serve()'s tick, which names no user, is admitted as it. A configured resolver can't claim the development org, so the lab names its own.
    resolvePrincipal: () => ({ userId: options.userId, orgId: "teammates-lab" }),
    devtool: { userId: options.userId },
    // A consult reads on `intent/utility`: a smaller model than the workers answer on.
    models: { default: options.model, intents: { utility: [UTILITY_MODEL] } },
    ...(options.modelResolver === undefined ? {} : { modelResolver: options.modelResolver }),
  } as never);

  return state;
}

/** Where a lab run keeps its store and runs by default: `.fsdev/` beside this file. */
const LAB_DATA = fileURLToPath(new URL("./.fsdev", import.meta.url));
export const defaultStore = () => join(LAB_DATA, "teammates.sqlite");
