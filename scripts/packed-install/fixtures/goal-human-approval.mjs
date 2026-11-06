/**
 * Runs inside the consumer project for `shims.human-approval-throws`: a handler
 * on the installed tarballs calls `ctx.suspend({ reason: "human_approval" })`,
 * the 0.2 spelling, and the call must refuse it, naming `user_approval`. A
 * suspension (a `SuspensionError`, or any error carrying `suspensionId`) is a
 * FAIL, even one naming `user_approval`: that is the old spelling mapped.
 *
 * The flow runs on a real server (`@flow-state-dev/node` over
 * `@flow-state-dev/engine`), as `serve.mjs` does. The handler records what the
 * call did (returned, or threw with which error) before the request settles,
 * so the verdict reads the call itself, not the request's status.
 *
 * Prints `human-approval: ok`, or `human-approval: FAIL at <step>: …`.
 */
import { defineFlow, handler } from "@flow-state-dev/core";
import { createFlowState, inMemoryStores } from "@flow-state-dev/engine";
import { serve } from "@flow-state-dev/node";
import { z } from "zod";

const verdict = (line) => {
  console.log(line);
  process.exit(0);
};

let seen = null;
const flow = defineFlow({
  kind: "goal-human-approval",
  actions: {
    ask: {
      inputSchema: z.object({}),
      block: handler({
        name: "ask",
        inputSchema: z.object({}),
        outputSchema: z.object({ ok: z.boolean() }),
        execute: async (_input, ctx) => {
          try {
            await ctx.suspend({ reason: "human_approval" });
            seen = { kind: "returned" };
          } catch (err) {
            seen = {
              kind: "threw",
              name: err?.name ?? typeof err,
              message: String(err?.message ?? err),
              suspended: err?.name === "SuspensionError" || err?.suspensionId != null,
            };
            throw err;
          }
          return { ok: true };
        },
      }),
    },
  },
})();

// `durable: true` holds stops in memory. Without it, every `ctx.suspend` throws
// for want of durable execution before the reason is read, and this would fail
// for the wrong reason on any version.
const flowState = createFlowState({
  flows: { "goal-human-approval": flow },
  stores: { default: { primary: inMemoryStores() } },
  durable: true,
});
const handle = await serve(flowState, { port: 0, host: "127.0.0.1", handleSignals: false });
const base = `http://127.0.0.1:${handle.port}`;
try {
  let health = 0;
  for (let i = 0; i < 50 && health !== 200; i += 1) {
    health = (await fetch(`${base}/healthz`)).status;
    if (health !== 200) await new Promise((r) => setTimeout(r, 100));
  }
  if (health !== 200) throw new Error(`healthz ${health} after 5s`);
  const res = await fetch(`${base}/api/flows/goal-human-approval/actions/ask`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ userId: "goal-user", input: {} }),
  });
  if (!res.ok) throw new Error(`action ${res.status}: ${(await res.text()).slice(0, 300)}`);
  for (let i = 0; i < 100 && !seen; i += 1) await new Promise((r) => setTimeout(r, 50));
  if (!seen) verdict("human-approval: FAIL at call: the handler never reported what ctx.suspend did");
  if (seen.kind === "returned") verdict("human-approval: FAIL at call: ctx.suspend returned for human_approval");
  // A durable `ctx.suspend` always throws: the throw is the suspension. One that
  // names user_approval is the old spelling silently mapped, not refused.
  if (seen.suspended)
    verdict(`human-approval: FAIL at call: ctx.suspend suspended on human_approval instead of refusing it: ${seen.message.slice(0, 200)}`);
  if (!/user_approval/.test(seen.message))
    verdict(`human-approval: FAIL at call: threw ${seen.name} without naming user_approval: ${seen.message.slice(0, 200)}`);
  verdict("human-approval: ok");
} finally {
  await handle.close();
}
