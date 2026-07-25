/**
 * Real-path driver for the suspend → approve → resume goal check. Copied into
 * `apps/kitchen-sink` and run there as a real ESM file by run.mts (via
 * `runHarness`) so the kitchen-sink `@/*` aliases AND `@flow-state-dev/*`
 * resolve — only a file executed with that
 * app as cwd resolves both, and `goals/` is not that app.
 *
 * Performs the real dispatch → approve → resume round trip against the app's
 * own runtime (its real durability provider and stores), in ONE process so the
 * in-memory dev store carries the suspension between the phases. Only DRIVES
 * and reports raw observations on a single `__GOAL__<json>` line; run.mts owns
 * the grading. Inputs arrive via env so this file hardcodes nothing.
 *
 * Not typechecked by `goals/tsconfig.json` — its imports resolve against
 * apps/kitchen-sink, not against goals/. See goals/README.md → "Harnesses".
 */
import { runAction } from "@flow-state-dev/engine";
import { flowstate } from "./lib/flowstate";

const request = process.env.KS_GOAL_REQUEST;
const note = process.env.KS_GOAL_NOTE;
const out = (r: unknown) => console.log("__GOAL__" + JSON.stringify(r));

async function main(): Promise<void> {
  const runtime = await flowstate.getRuntime();
  const flow = runtime.registry.get("chat-agent");
  const provider = runtime.runtimeConfig?.durabilityProvider;
  const stores = runtime.stores;
  if (!flow) return out({ ok: false, reason: 'flow "chat-agent" not found' });
  if (!provider) return out({ ok: false, reason: "no durabilityProvider on runtime" });

  const userId = "goal-user";
  const sessionId = "goal_" + Date.now();

  // 1. dispatch → suspends
  const initial = await runAction({
    flow,
    actionName: "requestApproval",
    input: { request },
    userId,
    sessionId,
    stores,
    runtimeConfig: runtime.runtimeConfig,
  });

  const pending = await provider.listSuspended({ status: "pending" });
  const suspension = pending.find((s: { requestId: string }) => s.requestId === initial.requestId);
  if (!suspension) {
    return out({
      ok: false,
      reason: "first run did not suspend",
      output: String(initial.output ?? ""),
    });
  }

  // 2. approve → persist the operator decision (what the resume endpoint does)
  await provider.suspend({
    ...suspension,
    status: "approved",
    resolvedAt: Date.now(),
    resumeData: { note },
  });

  // 3. resume the same request → runs past the gate, completes
  const resumed = await runAction({
    flow,
    actionName: "requestApproval",
    input: { request },
    userId,
    sessionId,
    stores,
    runtimeConfig: runtime.runtimeConfig,
    metadata: {
      resumeOf: initial.requestId,
      resumeContext: {
        suspensionId: suspension.suspensionId,
        action: "approve",
        data: { note },
      },
    },
  });

  const rec = await stores.request.get(resumed.requestId);
  out({
    ok: true,
    suspended: true,
    output: resumed.output ?? null,
    status: rec?.status ?? "unknown",
    error: resumed.error ?? null,
  });
}

main()
  .catch((err) =>
    out({
      ok: false,
      reason: "driver threw: " + (err instanceof Error ? (err.stack ?? err.message) : String(err)),
    }),
  )
  .finally(async () => {
    if (typeof flowstate.dispose === "function") await flowstate.dispose().catch(() => {});
    process.exit(0);
  });
