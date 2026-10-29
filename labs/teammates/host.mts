/**
 * The lab's server, put together from package pieces: the workers in
 * `workforce/`, the built-in agent flow with memory composed in, the lab's one
 * coding flow, a projects flow, and a store. `fsdev.config.mts` calls
 * {@link openTeammates} and default-exports the `FlowState` it returns.
 *
 * - **lead, researcher and writer** run on the built-in `agent` flow, so each
 *   has `sendMessage` and one conversation where messages land. Memory is
 *   composed in through `uses` (read) and `afterAnswer` (record each turn).
 *   The flow's tool catalog holds Workforce's project tools, web search and
 *   fetch, and `uses` adds reading a project's source; each worker's
 *   `tools:` line picks its own from them.
 * - **coder** runs on the lab's coding flow (`src/flows/coder.ts`), which
 *   takes the tasks lead files and runs each through a harness, Claude Code
 *   or Codex, in the project of the conversation that filed it.
 * - **Projects** are the user's Workforce projects. lead creates them from
 *   chat and the page from its header; the ones the config names are created
 *   at start, as the lab's user. A project whose repository is a `file://`
 *   remote has its coding work cloned from it, and one the config maps to a
 *   checkout on this machine works in a worktree of that checkout.
 * - **Teammates** you hire from the page are rows of your own roster, written
 *   through the roster flow `hireWorkforce` registers; nothing restarts.
 *
 * Durable, on SQLite: a worker message a busy host turned away is sent again
 * on its session's wake, and a restart keeps every conversation.
 */
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { CODEX_PASS, codexAgent } from "@flow-state-dev/codex";
import { harnessEnv } from "@flow-state-dev/core";
import type { HarnessBlock } from "@flow-state-dev/core/types";
import { CLAUDE_CODE_PASS, claudeCodeAgent } from "@flow-state-dev/claude-code/sdk";
import { createFlowState, runAction } from "@flow-state-dev/engine";
import { system } from "@flow-state-dev/memory";
import { sqliteStores } from "@flow-state-dev/store-sqlite";
import { defineFlow } from "@flow-state-dev/core";
import { DEFAULT_ORG_ID } from "@flow-state-dev/core/types";
import { fetch, search } from "@flow-state-dev/tools";
import {
  AGENT_FLOW,
  createWorkerInstallation,
  defineAgentWorkerFlow,
  defineProjectBlocks,
  hireWorkforce,
  projectSourceTools,
  projectTools,
  projectWorkspaceCapability,
  projectWorkspace,
  setWorkProjectTool,
} from "@flow-state-dev/workforce";
import { readDeclaredRoster } from "@flow-state-dev/workforce/loader";
import { localWorkspaceHost } from "@flow-state-dev/workspace";
import { CODER_FLOW, coderFlow, type Harness } from "./src/flows/coder.ts";
import { PROJECTS_FLOW } from "./src/lib/projects-flow.ts";

/** The workers, beside this file. */
const TEAMMATES_TREE = fileURLToPath(new URL("./workforce", import.meta.url));

/** One project the lab starts with. */
export interface LabProject {
  id: string;
  title: string;
  /** An absolute path to a git checkout on this machine; its coding runs work in a worktree of it. */
  checkout?: string;
}

export interface TeammatesOptions {
  /** The SQLite file the lab keeps everything in. */
  store: string;
  /** The model lead, researcher and writer answer on, and memory records with. */
  model: string;
  /** The user the page and the start-up writes act as. */
  userId: string;
  /** The projects to create at start, unless the user already has them. */
  projects?: readonly LabProject[];
  /** Where coding runs' worktrees go. */
  runsRoot: string;
  /** The workers' tree. Defaults to {@link TEAMMATES_TREE}. */
  tree?: string;
  /** Wall-clock budget for one coding run. Defaults to 20 minutes. */
  runTimeoutMs?: number;
  /** The harness coder runs on when its row names none. Defaults to `claude-code`. */
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
  codex: ({ cwd, resume, onSession }) =>
    codexAgent({
      cwd,
      resume,
      onSession,
      client: { env: harnessEnv({ pass: CODEX_PASS }) },
      thread: { sandboxMode: "workspace-write" },
    } as never) as unknown as HarnessBlock,
};

/** The remote a project with a checkout stores as its `repository`. */
const remoteOf = (checkout: string) => `file://${checkout}`;

/**
 * Build the lab's server and create its projects.
 *
 * @throws When the workers' tree doesn't load, or a project can't be created.
 */
export async function openTeammates(options: TeammatesOptions) {
  const roster = await readDeclaredRoster(options.tree ?? TEAMMATES_TREE);
  if (roster.problems.length > 0) {
    throw new Error(`teammates: the workers did not load: ${roster.problems.map((p) => `${p.layer} ${p.path}`).join(", ")}`);
  }

  const projects = options.projects ?? [];
  const checkouts = projects.flatMap((p) =>
    p.checkout === undefined ? [] : [{ remote: remoteOf(p.checkout), checkout: p.checkout, projects: [{ orgId: DEFAULT_ORG_ID, id: p.id }] }],
  );

  const mem = system({ model: options.model, working: { capacity: 7 }, episodic: true, semantic: true });
  // One host for coder's runs and the workers' reads, so a read sees the clone a run works from.
  const workspace = localWorkspaceHost({
    root: options.runsRoot,
    remotes: { allow: ["file"] },
    localRepositories: checkouts.map((c) => c.checkout),
    source: projectWorkspace({ checkouts }),
  });
  const projectBlocks = defineProjectBlocks();
  let flows: Record<string, unknown> = {};
  const installation = createWorkerInstallation({ standardWorkers: roster.workers, workerFlows: () => flows as never });
  flows = {
    [AGENT_FLOW]: defineAgentWorkerFlow({
      installation,
      model: options.model,
      catalog: {
        ...projectTools(projectBlocks),
        setWorkProject: setWorkProjectTool,
        ...projectSourceTools(workspace),
        search: search(),
        fetch: fetch(),
      },
      // The project collections the source reads go through.
      uses: [mem.capability.presets({ recall: false, connect: false, semantic: true, episodic: true }), projectWorkspaceCapability],
      afterAnswer: mem.captureFromItems,
    }),
    [CODER_FLOW]: coderFlow({
      harnesses: HARNESSES,
      defaultHarness: options.harness ?? "claude-code",
      workspace,
      runTimeoutMs: options.runTimeoutMs ?? 20 * 60_000,
    }),
  };
  const copies = hireWorkforce(installation) as Array<{ id: string }>;
  const projectsFlow = defineFlow({ kind: PROJECTS_FLOW, actions: projectBlocks.actions } as never) as { id?: string };

  const state = createFlowState({
    flows: { ...Object.fromEntries(copies.map((copy) => [copy.id, copy])), [PROJECTS_FLOW]: projectsFlow },
    stores: { default: { primary: sqliteStores({ filename: options.store }) } },
    durable: true,
    devtool: { userId: options.userId },
  } as never);

  // The projects, as the lab's user. One the user already has comes back unchanged.
  const runtime = await state.getRuntime();
  for (const project of projects) {
    const result = (await runAction({
      flow: projectsFlow,
      actionName: "createProject",
      input: { id: project.id, title: project.title, ...(project.checkout === undefined ? {} : { repository: remoteOf(project.checkout) }) },
      userId: options.userId,
      orgId: DEFAULT_ORG_ID,
      sessionId: `${PROJECTS_FLOW}-${options.userId}`,
      stores: runtime.stores,
      runtimeConfig: runtime.runtimeConfig,
    } as never)) as { error?: unknown };
    if (result.error !== undefined) {
      await state.dispose();
      throw new Error(`teammates: project "${project.id}" was not created: ${JSON.stringify(result.error)}`);
    }
  }
  return state;
}

/** Where a lab run keeps its store and runs by default: `.fsdev/` beside this file. */
const LAB_DATA = fileURLToPath(new URL("./.fsdev", import.meta.url));
export const defaultStore = () => join(LAB_DATA, "teammates.sqlite");
