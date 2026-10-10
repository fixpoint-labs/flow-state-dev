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

/** A host's router, driven as `userId` (sent in `x-user`). */
export function httpActions(router: any, userId: string) {
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
   * @throws When the router refuses the action, or the request ended failed.
   */
  const act = async (flow: string, sessionId: string, action: string, input: unknown): Promise<any> => {
    const sent = await call("POST", [flow, sessionId, "actions", action], { userId, input });
    if (sent.status !== 202) throw new Error(`${action} was refused (${sent.status}): ${sent.text}`);
    const requestId = JSON.parse(sent.text).request.id as string;
    for (let i = 0; i < 1000; i += 1) {
      const status = JSON.parse((await call("GET", [flow, "requests", requestId, "status"])).text).status;
      if (status !== "in_progress") break;
      await sleep(10);
    }
    const listed = await call("GET", ["sessions", sessionId, "requests"], undefined, "?include_result_output=true&limit=100");
    const found = (JSON.parse(listed.text).requests ?? []).find((r: { id: string }) => r.id === requestId);
    if (found?.result?.error !== undefined) throw new Error(`${action} failed: ${JSON.stringify(found.result.error)}`);
    return found?.result?.output;
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
  for (let i = 0; i < 1500; i += 1) {
    const all = await stores.request.list({});
    if (!all.some((r) => r.status === "in_progress")) {
      await sleep(50);
      const again = await stores.request.list({});
      if (!again.some((r) => r.status === "in_progress") && again.length === all.length) return;
    }
    await sleep(20);
  }
  throw new Error("a request never finished");
}
