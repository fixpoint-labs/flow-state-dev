/**
 * Act on an in-process host the way a person's app does: through the one
 * client (`createClient`) over the engine's `createInProcessFetch`, as a
 * verified caller, reading an action's answer back from the session's ended
 * request.
 *
 *   const alice = actingAs(state, userId);
 *   const out = await alice.act("lead", sessionId, "createTask_tasks", { goal, assignee });
 *   await untilIdle(runtime.stores);
 *
 * The host's `resolvePrincipal` must read the caller from the `x-user` header.
 */
import { createClient, type Client, type ClientFetch } from "@flow-state-dev/client";
import { createInProcessFetch } from "@flow-state-dev/engine";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** One raw route call, and what it answered. */
export type RouteAnswer = { status: number; text: string };

/** How long `act` waits for a request to end. */
const ACT_TIMEOUT_MS = 10_000;

/**
 * A host in this process, driven as `userId` (sent in `x-user`): its client,
 * a raw route call for a goal that grades a route's own answer, and the two
 * steps a person's app takes.
 *
 * @param app The host's `FlowState`, or its router.
 */
export function actingAs(app: Parameters<typeof createInProcessFetch>[0], userId: string) {
  const inProcess = createInProcessFetch(app);
  const fetcher: ClientFetch = (input, init) => {
    const headers = new Headers(init?.headers);
    headers.set("x-user", userId);
    return inProcess(input, { ...init, headers });
  };
  const client: Client = createClient({ userId, fetcher });

  /** One route, as this caller, and what it answered: for a goal that grades the route itself. */
  const call = async (method: "GET" | "POST", path: string[], body?: unknown, query = ""): Promise<RouteAnswer> => {
    const response = await fetcher(`/api/flows/${path.join("/")}${query}`, {
      method,
      headers: { "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    return { status: response.status, text: await response.text() };
  };

  /**
   * Run `action` on `sessionId` of `flow` and return its answer, read back from
   * the session's ended request as an app reads it.
   *
   * @throws When the host refuses the action, the request never ends, is not
   *   in the session's requests, or ended failed or without an answer.
   */
  // `any`, not `unknown`: each goal reads its own action's output shape.
  const act = async (flow: string, sessionId: string, action: string, input: unknown): Promise<any> => {
    const sent = await client
      .flow(flow)
      .send(action, input, { sessionId })
      .catch((error: unknown) => {
        const refused = error as { status?: number; body?: unknown };
        throw new Error(`${action} was refused (${refused.status}): ${JSON.stringify(refused.body)}`);
      });
    const { status } = await sent.wait({ pollMs: 10, timeoutMs: ACT_TIMEOUT_MS }).catch(() => {
      throw new Error(`${action} never ended (request ${sent.id})`);
    });
    const listed = await client.sessions.requests(sessionId, { includeResultOutput: true, limit: 100 });
    const found = listed.find((request) => request.id === sent.id);
    if (found === undefined) throw new Error(`${action}'s request ${sent.id} is not among session ${sessionId}'s requests`);
    if (found.result?.error !== undefined) throw new Error(`${action} failed: ${JSON.stringify(found.result.error)}`);
    if (found.result === undefined || !("output" in found.result)) throw new Error(`${action} ended ${status} without an answer`);
    return found.result.output;
  };

  /** Open a session of `flow` with `state`, as this caller. Its id. */
  const open = async (flow: string, state: Record<string, unknown>): Promise<string> =>
    (await client.flow(flow).createSession({ state })).id;

  return { client, call, act, open };
}

/** Wait until no request in `stores` is running, then a beat more, so a dispatch accepted just now is counted. */
export async function untilIdle(stores: { request: { list: (q: object) => Promise<Array<{ status: string }>> } }): Promise<void> {
  // An existence check: unordered, stopping at the first running request.
  const busy = async () => (await stores.request.list({ status: "in_progress", orderBy: "none", limit: 1 })).length > 0;
  const count = async () => (await stores.request.list({ orderBy: "none" })).length;
  for (let i = 0; i < 1500; i += 1) {
    if (!(await busy())) {
      const before = await count();
      await sleep(50);
      if (!(await busy()) && (await count()) === before) return;
    }
    await sleep(20);
  }
  throw new Error("a request never finished");
}
