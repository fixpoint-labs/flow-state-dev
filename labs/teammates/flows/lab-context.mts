// FIX-2624; FIX-2771.
/**
 * What the lab works on and with, as a user-scope view the page reads with no
 * session: the working folder and the problem a coding run's checkout of it
 * would be refused with, the setup and checks a coding worktree runs, the model, the models a teammate may reply with and
 * where each one's calls would go (`describeModelRoute`: names only, never a key), the default harness, and each worker's
 * declared delegates. The page draws its context strip and first-run lines
 * from it, through `appContextView` (`lab-context-ref.mts`); the host serves
 * the flow ({@link appContextFlow}). Its answer is the host's settings, the
 * same for every caller: it reads no resource, so it names no topic.
 */
import { defineFlow, defineView, handler } from "@flow-state-dev/core";
import { describeModelRoute } from "@flow-state-dev/core/models";
import { checkGitHubToken, type OperatorGitHubTokenRead } from "@flow-state-dev/workforce";
import { z } from "zod";
import { APP_CONTEXT_FLOW } from "./lab-context-ref.mts";

/** What the lab says at start and on its context strip when it has no token. */
export const GITHUB_NO_TOKEN = "GitHub polling is disabled: no token. Set GITHUB_TOKEN, or sign in with `gh auth login`, and restart.";

/** Check once at start; the context's first read waits for the same diagnosis the log reports. */
export async function gitHubProblem(github: OperatorGitHubTokenRead | undefined, options: Parameters<typeof checkGitHubToken>[1]): Promise<string | null> {
  if (github?.token === undefined) {
    console.warn(`teammates: ${GITHUB_NO_TOKEN}${github?.problem === undefined ? "" : ` (${github.problem})`}`);
    return GITHUB_NO_TOKEN;
  }
  const source = github.source ?? "the host";
  const check = await checkGitHubToken(github.token, options);
  if (check.ok) {
    console.warn(`teammates: GitHub token from ${source} works, as ${check.login}`);
    return null;
  }
  const problem = `GitHub polling will fail: GitHub refused the token from ${source} (${check.reason}).`;
  console.warn(`teammates: ${problem}`);
  return problem;
}

const appContextSchema = z.object({
  /** The working folder, as an absolute path. */
  folder: z.string(),
  /** Why a coding run's checkout of the folder would be refused, or `null` when it wouldn't. */
  folderProblem: z.string().nullable(),
  /** Why the lab can't poll GitHub (no token at start, or one GitHub refused), or `null` when it can. Absent from an older server. */
  githubProblem: z.string().nullable().optional(),
  /** The model the teammates answer on. */
  model: z.string(),
  /** The models a teammate may reply with (`TEAMMATES_MODELS`, and always `model`), each with where its calls would go or why they can't. Absent from an older server. */
  models: z.array(z.object({ id: z.string(), available: z.boolean(), via: z.string().optional(), reason: z.string().optional() })).optional(),
  /** The harness a coding worker whose file names none runs on. */
  harness: z.string(),
  /** The command each fresh coding worktree runs before its run (`TEAMMATES_SETUP`), or `null` when none. Display only: its arguments joined by spaces, quoting lost, so never run it. Absent from an older server. */
  setup: z.string().nullable().optional(),
  /** The commands a coding run's worktree must pass before its task is done (`TEAMMATES_CHECKS`). Display only, like `setup`. Absent from an older server. */
  checks: z.array(z.string()).optional(),
  /** Each worker's declared delegates, by worker id: ids, or `"all"`. A worker with none is absent. */
  delegates: z.record(z.string(), z.union([z.literal("all"), z.array(z.string())])),
});

/** What the lab works on and with, as the view answers it. */
export type AppContext = z.infer<typeof appContextSchema>;

/** What the host hands the view: the model list as ids, which the view gives routes. */
export type AppContextInput = Omit<AppContext, "models"> & { models?: readonly string[] };

/** The host's answer with each model given its route from this server's keys, by name only. */
export function withModelRoutes({ models, ...rest }: AppContextInput, env?: Record<string, string | undefined>): AppContext {
  return { ...rest, ...(models === undefined ? {} : { models: models.map((id) => ({ id, ...describeModelRoute(id, env) })) }) };
}

/** The lab's context view, answering `read()`. */
export function appContextViewOf(read: () => Promise<AppContextInput>) {
  return defineView({
    scope: "user",
    block: handler({
      name: "lab-context",
      description: "What the lab works on and with: the working folder and its problem if any, the setup and checks a coding worktree runs, the model and the models a teammate may reply with (with their routes), the default harness, and each worker's delegates.",
      inputSchema: z.object({}),
      outputSchema: appContextSchema,
      execute: async () => withModelRoutes(await read()),
    }),
  });
}

/** The view, for the page's ref (a type import: the page holds no block). */
export type AppContextView = ReturnType<typeof appContextViewOf>;

/** The flow that serves {@link appContextViewOf} as its `context` view. Register what it returns. */
export const appContextFlow = (read: () => Promise<AppContextInput>) =>
  defineFlow({ kind: APP_CONTEXT_FLOW, actions: {}, views: { context: appContextViewOf(read) } })({ id: APP_CONTEXT_FLOW });
