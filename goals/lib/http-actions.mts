/**
 * Act on an in-process host the way a person's app does: over its HTTP
 * router, as a verified caller, reading an action's answer back from the
 * session's ended request.
 *
 *   const http = httpActions(await state.getRouter(), userId);
 *   const out = await http.act("lead", sessionId, "addTask_tasks", { goal, assignee });
 *   await untilIdle(runtime.stores);
 *
 * The host's `resolvePrincipal` must read the caller from the `x-user` header.
 */

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** One call through the router, and what it answered. */
export type RouterAnswer = { status: number; text: string };

/** The part of a host's router a goal drives: its GET and POST handlers. */
export type GoalRouter = Record<"GET" | "POST", (request: Request, context: { params: { path: string[] } }) => Promise<Response>>;

/** A host's router, driven as `userId` (sent in `x-user`). */
export function httpActions(router: GoalRouter, userId: string) {
  const call = async (method: "GET" | "POST", path: string[], body?: unknown, query = ""): Promise<RouterAnswer> => {
    const response = await router[method](
      new Request(`http://goal/api/flows/${path.join("/")}${query}`, {
        method,
        headers: { "content-type": "application/json", "x-user": userId },
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
      }),
      { params: { path } }
    );
    return { status: response.status, text: await response.text() };
  };

  /**
   * Run `action` on `sessionId` of `flow` and return its answer, read back from
   * the session's ended request as an app reads it.
   *
   * @throws When the router refuses the action, the request never ends, is not
   *   in the session's requests, or ended failed or without an answer.
   */
  // `any`, not `unknown`: each goal reads its own action's output shape.
  const act = async (flow: string, sessionId: string, action: string, input: unknown): Promise<any> => {
    const sent = await call("POST", [flow, sessionId, "actions", action], { userId, input });
    if (sent.status !== 202) throw new Error(`${action} was refused (${sent.status}): ${sent.text}`);
    const requestId = JSON.parse(sent.text).request.id as string;
    let status = "in_progress";
    for (let i = 0; i < 1000 && status === "in_progress"; i += 1) {
      status = JSON.parse((await call("GET", [flow, "requests", requestId, "status"])).text).status;
      if (status === "in_progress") await sleep(10);
    }
    if (status === "in_progress") throw new Error(`${action} never ended (request ${requestId})`);
    const listed = await call("GET", ["sessions", sessionId, "requests"], undefined, "?include_result_output=true&limit=100");
    const found = (JSON.parse(listed.text).requests ?? []).find((r: { id: string }) => r.id === requestId);
    if (found === undefined) throw new Error(`${action}'s request ${requestId} is not among session ${sessionId}'s requests`);
    if (found.result?.error !== undefined) throw new Error(`${action} failed: ${JSON.stringify(found.result.error)}`);
    if (found.result === undefined || !("output" in found.result)) throw new Error(`${action} ended ${status} without an answer`);
    return found.result.output;
  };

  /** Open a session of `flow` with `state`, as `userId`. Its id. */
  const open = async (flow: string, state: Record<string, unknown>): Promise<string> => {
    const created = await call("POST", [flow, "sessions"], { userId, state });
    if (created.status >= 300) throw new Error(`opening a ${flow} session answered ${created.status}: ${created.text}`);
    return JSON.parse(created.text).session.id as string;
  };

  return { call, act, open };
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
