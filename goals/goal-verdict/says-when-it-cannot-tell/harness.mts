/**
 * Real-path driver for `goal-verdict › it says when it cannot tell`. Copied into
 * `apps/kitchen-sink` and run there by run.mts (via `runHarness`), so the app's
 * `@/*` aliases and `@flow-state-dev/*` both resolve.
 *
 * Not typechecked by `goals/tsconfig.json` — its imports resolve against
 * apps/kitchen-sink, not against goals/. See goals/README.md → "Harnesses".
 */
import { runAction } from "@flow-state-dev/engine";
import { DEFAULT_ORG_ID } from "@flow-state-dev/core";
import { flowstate } from "./lib/flowstate";

const out = (r: unknown) => console.log("__GOAL__" + JSON.stringify(r));

async function main(): Promise<void> {
  const runtime = await flowstate.getRuntime();
  const flow = runtime.registry.get("chat-agent");
  if (!flow) return out({ ok: false, reason: 'flow "chat-agent" not found' });

  const run = await runAction({
    orgId: DEFAULT_ORG_ID,
    flow,
    actionName: "requestApproval",
    input: { request: process.env.KS_GOAL_REQUEST },
    userId: "goal-user",
    sessionId: "goal_" + Date.now(),
    stores: runtime.stores,
    runtimeConfig: runtime.runtimeConfig,
  });
  const record = await runtime.stores.request.get(run.requestId);
  out({ ok: true, status: record?.status ?? "unknown", items: record?.items ?? [] });
}

main()
  .catch((err) => out({ ok: false, reason: "driver threw: " + (err instanceof Error ? (err.stack ?? err.message) : String(err)) }))
  .finally(async () => {
    if (typeof flowstate.dispose === "function") await flowstate.dispose().catch(() => {});
    process.exit(0);
  });
