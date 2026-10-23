/**
 * The names the shell and its flow agree on — which flows the rail groups,
 * which coordinators it lists, and what a worker's composer sends.
 *
 * A leaf module on purpose (BP-019): the page is a client bundle and the flow
 * is server code, and both import these. Nothing here imports anything, so the
 * page gets the names without pulling the flow into the browser.
 *
 * The workers themselves are not here: the right panel reads the user's
 * roster through Workforce's client (`@flow-state-dev/workforce/browser`),
 * which answers with each worker's flow and description.
 *
 * The flow names and coordinator ids are written down rather than derived,
 * because the only place that knows them at run time is the server-side tree
 * under `workforce/`, which a browser cannot read. `test/workforce-shell.test.ts`
 * holds them to that tree and fails when a flow or a coordinator changes there
 * and not here.
 */

/** The flow the stream talks to. */
export const SHELL_FLOW = "chat-agent";

/**
 * The coordinator flow's name: a worker whose `flow:` names it hands each post
 * to its delegates. Its panel shows the conversation's lines, each under who
 * wrote it, rather than a conversation with one worker.
 */
export const COORDINATOR_FLOWS = ["coordinator"] as const;

/** Whether a picked flow is a coordinator's, whose panel shows lines under their writers' names. */
export function isCoordinatorFlow(flow: string): boolean {
  return (COORDINATOR_FLOWS as readonly string[]).includes(flow);
}

/**
 * The coordinators the tree declares, by worker id: what the rail lists under
 * the coordinator flow. Each is the user's own conversation with that
 * coordinator, found or started by its id (`lib/rail-sessions.ts`).
 */
export const SHELL_COORDINATORS = ["support.help"] as const;

/** What a coordinator's composer sends: the user's post, through the flow's door. */
export const COORDINATOR_ASK = { action: "respond", field: "message" } as const;

/**
 * The worker flows a user talks to one worker on: the built-in `agent`, plus
 * every flow under `workforce/flows/workers/`, of which this app has none. Each
 * runs as one copy, holding every worker's conversations on it.
 */
export const WORKER_FLOWS = ["agent"] as const;

/**
 * What a worker's composer sends: the one action its worker flow answers a user with,
 * and that action's one input field. A worker flow with nothing to answer with says
 * so instead, and its workers get no composer, only this reason.
 */
export type WorkerAsk =
  | { readonly action: string; readonly field: string }
  | { readonly none: string };

/**
 * Each worker flow's answer, written down rather than picked from the served
 * schemas: a worker flow that grew a second one-string action would be picked from
 * silently, where a missing or wrong entry here fails
 * `test/workforce-shell.test.ts` instead.
 */
export const WORKER_ASKS = {
  agent: { action: "respond", field: "message" },
} as const satisfies Record<(typeof WORKER_FLOWS)[number], WorkerAsk>;

/**
 * The delegate a coordinator handed a post to, read off the run's `topic`: the
 * key Workforce's coordinator derives each delegate's session from,
 * `delegate:<[worker, target]>`. Every worker on a flow shares its copy, so
 * the run's `flowId` names the flow (`agent`), not the worker. `undefined` for
 * any other run.
 */
export function delegateOfRun(run: { readonly topic?: string }): string | undefined {
  const match = /^delegate:(.+)$/.exec(run.topic ?? "");
  if (match === null) return undefined;
  try {
    const key = JSON.parse(match[1]!) as unknown;
    return Array.isArray(key) && typeof key[0] === "string" ? key[0] : undefined;
  } catch {
    return undefined;
  }
}

/** A worker flow's answer, or `undefined` for a flow the shell does not know. */
export function workerAskFor(flow: string): WorkerAsk | undefined {
  return (WORKER_ASKS as Record<string, WorkerAsk | undefined>)[flow];
}

/**
 * The tag an earlier version of this page put on the assistant session its
 * "Hire another" ran on. The button is gone, but a store kept across the
 * upgrade still holds that session, and it must never be the conversation the
 * page opens by default (BP-030).
 */
export const LEGACY_WORKER_HIRES_TAG = "worker-hires";

/**
 * The conversation the page opens on: the most recent of the assistant's
 * sessions, passing over one an earlier page's hire ran on. `undefined` when
 * there is none, and the page starts a new one.
 *
 * @param sessions The assistant's sessions, newest first.
 */
export function defaultConversation<T extends { readonly tags?: readonly string[] }>(
  sessions: readonly T[],
): T | undefined {
  return sessions.find((session) => !(session.tags?.includes(LEGACY_WORKER_HIRES_TAG) ?? false));
}
