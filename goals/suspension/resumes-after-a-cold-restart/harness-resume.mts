/**
 * Process B of the cold-restart goal check: a FRESH runtime over the SAME
 * on-disk store directory — the cold restart itself. Loads the prior runtime's
 * suspension (asserting it survived as `pending`), approves it, and resumes the
 * same request to completion.
 *
 * Copied into `apps/kitchen-sink` and run there as a real ESM file by run.mts
 * (via `runHarness`) so the app's `@/*`
 * aliases and `@flow-state-dev/*` both resolve. Reports observations on a
 * single `__GOAL__<json>` line; run.mts owns the grading.
 *
 * Not typechecked by `goals/tsconfig.json`. See goals/README.md → "Harnesses".
 */
import {
  createFilesystemStores,
  createCheckpointDurabilityProvider,
  runAction,
} from "@flow-state-dev/engine";
import flow from "./flows/chat-agent/flow";

const out = (r: unknown) => console.log("__GOAL__" + JSON.stringify(r));
const stores = createFilesystemStores({
  rootDir: process.env.KS_GOAL_DIR,
  developmentOnly: true,
});

async function main(): Promise<void> {
  const provider = createCheckpointDurabilityProvider({
    checkpoints: stores.checkpoints,
    suspensions: stores.suspensions,
    leases: stores.leases,
  });
  const requestId = process.env.KS_GOAL_REQUEST_ID!;
  const sessionId = process.env.KS_GOAL_SESSION_ID;
  const suspensionId = process.env.KS_GOAL_SUSPENSION_ID!;
  const note = process.env.KS_GOAL_NOTE;

  // Cross-restart persistence proof: the prior runtime's suspension must still
  // be loadable here, and still pending (nobody resolved it before the restart).
  const reloaded = await provider.loadSuspension(requestId, suspensionId);
  const foundPending = reloaded != null && reloaded.status === "pending";
  if (reloaded) {
    await provider.suspend({
      ...reloaded,
      status: "approved",
      resolvedAt: Date.now(),
      resumeData: { note },
    });
  }

  const resumed = await runAction({
    flow,
    actionName: "requestApproval",
    input: { request: process.env.KS_GOAL_REQUEST },
    userId: "goal-user",
    sessionId,
    stores,
    runtimeConfig: { durabilityProvider: provider },
    metadata: {
      resumeOf: requestId,
      resumeContext: { suspensionId, action: "approve", data: { note } },
    },
  });

  const rec = await stores.request.get(resumed.requestId);
  out({
    ok: true,
    foundPending,
    output: resumed.output ?? null,
    status: rec?.status ?? "unknown",
    error: resumed.error ?? null,
  });
}

main()
  .catch((err) =>
    out({
      ok: false,
      reason: "resume driver threw: " + (err instanceof Error ? (err.stack ?? err.message) : String(err)),
    }),
  )
  .finally(() => {
    if (typeof stores.close === "function") stores.close();
    process.exit(0);
  });
