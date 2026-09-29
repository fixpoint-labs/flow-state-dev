/**
 * Runs inside the consumer project the packed-install check builds, and does
 * what a first user does after `npm install`: define a flow, start a server,
 * and call it over HTTP.
 *
 * Everything here resolves from the installed tarballs in `node_modules`; there
 * is no path back into the repository. Exits 0 and prints `serve: ok` only when
 * `/healthz` reports ready and a POSTed action runs to `completed`; anything
 * else exits 1 with the step that failed.
 */
import { defineFlow, handler } from "@flow-state-dev/core";
import { createFlowState, inMemoryStores } from "@flow-state-dev/engine";
import { serve } from "@flow-state-dev/node";
import { z } from "zod";

const fail = (step, detail) => {
  console.error(`serve: FAIL at ${step}: ${detail}`);
  process.exit(1);
};

const flow = defineFlow({
  kind: "packed-install",
  actions: {
    ping: {
      inputSchema: z.object({ text: z.string() }),
      block: handler({
        name: "ping",
        inputSchema: z.object({ text: z.string() }),
        outputSchema: z.object({ echoed: z.string() }),
        // Throwing on anything else turns a lost or mangled input into a
        // `failed` request, so `completed` below proves the input arrived.
        execute: (input) => {
          if (input.text !== "hello") throw new Error(`unexpected input ${input.text}`);
          return { echoed: input.text };
        },
      }),
    },
  },
})();

const flowState = createFlowState({
  flows: { "packed-install": flow },
  stores: { default: { primary: inMemoryStores() } },
});

const handle = await serve(flowState, {
  port: 0,
  host: "127.0.0.1",
  handleSignals: false,
});
const base = `http://127.0.0.1:${handle.port}`;

try {
  let health = 0;
  for (let i = 0; i < 50 && health !== 200; i += 1) {
    health = (await fetch(`${base}/healthz`)).status;
    if (health !== 200) await new Promise((r) => setTimeout(r, 100));
  }
  if (health !== 200) fail("healthz", `status ${health} after 5s`);

  const res = await fetch(`${base}/api/flows/packed-install/actions/ping`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ userId: "packed-install-user", input: { text: "hello" } }),
  });
  const body = await res.text();
  if (!res.ok) fail("action", `status ${res.status}: ${body.slice(0, 300)}`);
  const requestId = JSON.parse(body).request?.id;
  if (!requestId) fail("action", `no request id in ${body.slice(0, 300)}`);

  // The action is accepted and runs in the background; poll until it settles.
  let status = "in_progress";
  for (let i = 0; i < 50 && status !== "completed" && status !== "failed"; i += 1) {
    await new Promise((r) => setTimeout(r, 100));
    const s = await fetch(
      `${base}/api/flows/packed-install/requests/${requestId}/status?userId=packed-install-user`,
    );
    if (!s.ok) fail("status", `status ${s.status}: ${(await s.text()).slice(0, 300)}`);
    status = (await s.json()).status;
  }
  if (status !== "completed") fail("status", `request ended ${status}`);
  console.log("serve: ok");
} finally {
  await handle.close();
}
