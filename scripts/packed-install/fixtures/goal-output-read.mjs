/**
 * Runs inside the consumer project for `onepath.output-read`: the installed
 * client reads what an action answered with one call, by the request's id,
 * however long the session is.
 *
 * Two cases, on a real server (`@flow-state-dev/node` over
 * `@flow-state-dev/engine`), as `serve.mjs` does:
 *
 *   1. `compute` returns a value computed from its input. Its request is then
 *      buried under 101 newer requests in the same session, one more than a
 *      page of 100, and `request(firstId).result()` must resolve
 *      `{ status: "completed", output }` with exactly that value.
 *   2. `refuse` throws a `FlowError` with its own code, and `result()` must
 *      resolve (not reject) `status: "failed"` with that `error.code`.
 *
 * The requests are sent and settled over plain HTTP, the routes every version
 * has, so only the read under test goes through the installed client. That
 * read runs through a recording `fetcher`: a call to a session's request list
 * is a FAIL, because the cell is a read by request id, never by listing.
 *
 * A client whose request handle has no `result()` fails the assertion; it does
 * not crash it. Prints `output-read: ok`, or `output-read: FAIL at cases: …`
 * followed by one indented line per failed case.
 */
import { createClient } from "@flow-state-dev/client";
import { defineFlow, FlowError, handler } from "@flow-state-dev/core";
import { createFlowState, inMemoryStores } from "@flow-state-dev/engine";
import { serve } from "@flow-state-dev/node";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";

const KIND = "goal-output-read";
const USER = "goal-user";
const REFUSAL_CODE = "goal_refused";
/** Newer requests sent after the first: one more than a list page of 100. */
const NEWER = 101;

const flow = defineFlow({
  kind: KIND,
  actions: {
    compute: {
      inputSchema: z.object({ n: z.number() }),
      block: handler({
        name: "compute",
        inputSchema: z.object({ n: z.number() }),
        outputSchema: z.object({ n: z.number(), square: z.number(), tag: z.string() }),
        execute: (input) => ({ n: input.n, square: input.n * input.n, tag: `sq-${input.n}` }),
      }),
    },
    refuse: {
      inputSchema: z.object({}),
      block: handler({
        name: "refuse",
        inputSchema: z.object({}),
        outputSchema: z.object({ ok: z.boolean() }),
        execute: () => {
          throw new FlowError("refused on purpose", { code: REFUSAL_CODE });
        },
      }),
    },
  },
})();

const flowState = createFlowState({
  flows: [flow],
  stores: { default: { primary: inMemoryStores() } },
});
const handle = await serve(flowState, { port: 0, host: "127.0.0.1", handleSignals: false });
const base = `http://127.0.0.1:${handle.port}`;

/** Setup over HTTP: a broken setup is the harness's `error`, not a FAIL. */
async function post(action, input, sessionId) {
  const res = await fetch(`${base}/api/flows/${KIND}/actions/${action}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ userId: USER, input, ...(sessionId ? { sessionId } : {}) }),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`POST ${action}: ${res.status} ${body.slice(0, 300)}`);
  const parsed = JSON.parse(body);
  if (!parsed.request?.id) throw new Error(`POST ${action}: no request id in ${body.slice(0, 300)}`);
  return parsed.request.id;
}

async function createSession() {
  const res = await fetch(`${base}/api/flows/${KIND}/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ userId: USER }),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`create session: ${res.status} ${body.slice(0, 300)}`);
  const id = JSON.parse(body).session?.id;
  if (!id) throw new Error(`create session: no session id in ${body.slice(0, 300)}`);
  return id;
}

async function settled(id) {
  for (let i = 0; i < 200; i += 1) {
    const res = await fetch(`${base}/api/flows/${KIND}/requests/${id}/status?userId=${USER}`);
    if (!res.ok) throw new Error(`status ${id}: ${res.status} ${(await res.text()).slice(0, 300)}`);
    const { status } = await res.json();
    if (status !== "in_progress") return status;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`request ${id} did not settle in 5s`);
}

/** The read under test: the installed client, by request id, with every URL it fetched. */
async function readResult(id) {
  const urls = [];
  const client = createClient({
    baseUrl: base,
    userId: USER,
    fetcher: (input, init) => {
      urls.push(String(input?.url ?? input));
      return fetch(input, init);
    },
  });
  const request = client.flow(KIND).request(id);
  if (typeof request?.result !== "function") return { missing: true, urls };
  try {
    return { value: await request.result({ timeoutMs: 30_000 }), urls };
  } catch (err) {
    return { threw: String(err?.message ?? err).slice(0, 200), urls };
  }
}

const listed = (urls) => urls.filter((u) => /\/sessions\/[^/?]+\/requests(\?|$)/.test(u));

try {
  let health = 0;
  for (let i = 0; i < 50 && health !== 200; i += 1) {
    health = (await fetch(`${base}/healthz`)).status;
    if (health !== 200) await new Promise((r) => setTimeout(r, 100));
  }
  if (health !== 200) throw new Error(`healthz ${health} after 5s`);

  const sessionId = await createSession();
  const first = await post("compute", { n: 7 }, sessionId);
  if ((await settled(first)) !== "completed") throw new Error("the first compute did not complete");
  for (let i = 0; i < NEWER; i += 1) {
    const newer = await post("compute", { n: 1000 + i }, sessionId);
    await settled(newer);
  }
  const refused = await post("refuse", {}, sessionId);
  if ((await settled(refused)) !== "failed") throw new Error("the refusing action did not fail");

  const failures = [];
  const expected = { n: 7, square: 49, tag: "sq-7" };

  const a = await readResult(first);
  if (a.missing) failures.push(`completed: the installed client's request handle has no result()`);
  else if (a.threw) failures.push(`completed: result() rejected: ${a.threw}`);
  else if (a.value?.status !== "completed" || !isDeepStrictEqual(a.value?.output, expected))
    failures.push(
      `completed: under ${NEWER} newer requests, result() gave ${JSON.stringify({ status: a.value?.status, output: a.value?.output }).slice(0, 200)}, not the computed ${JSON.stringify(expected)}`,
    );
  if (listed(a.urls).length > 0) failures.push(`completed: result() listed the session's requests (${listed(a.urls)[0]})`);

  const b = await readResult(refused);
  if (b.missing) failures.push(`failed: the installed client's request handle has no result()`);
  else if (b.threw) failures.push(`failed: result() rejected on a failed request instead of resolving: ${b.threw}`);
  else if (b.value?.status !== "failed" || b.value?.error?.code !== REFUSAL_CODE)
    failures.push(
      `failed: result() gave ${JSON.stringify({ status: b.value?.status, error: b.value?.error }).slice(0, 200)}, not failed with code ${REFUSAL_CODE}`,
    );
  if (listed(b.urls).length > 0) failures.push(`failed: result() listed the session's requests (${listed(b.urls)[0]})`);

  if (failures.length === 0) console.log("output-read: ok");
  else {
    console.log(`output-read: FAIL at cases: ${failures.length} case check(s) failed`);
    for (const f of failures) console.log(`  ${f}`);
  }
} finally {
  await handle.close();
}
process.exit(0);
