/**
 * Process A of the cold-restart goal check: dispatch until the gate suspends,
 * against an ON-DISK store so the suspension outlives this process.
 *
 * Run via `tsx -e` from `apps/kitchen-sink` (by run.mts) so the app's `@/*`
 * aliases and `@flow-state-dev/*` both resolve. Reports the ids the resume
 * process needs on a single `__GOAL__<json>` line.
 *
 * Persistence uses the engine's on-disk filesystem store — it provides the
 * checkpoint/suspension/lease stores and survives a process restart.
 * store-sqlite would work too but is not a kitchen-sink dependency, so it can't
 * be resolved from a file executed with that app as cwd.
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
  const userId = "goal-user";
  const sessionId = "goal_cold_" + Date.now();

  const initial = await runAction({
    flow,
    actionName: "requestApproval",
    input: { request: process.env.KS_GOAL_REQUEST },
    userId,
    sessionId,
    stores,
    runtimeConfig: { durabilityProvider: provider },
  });

  const pending = await provider.listSuspended({ status: "pending" });
  const suspension = pending.find((s: { requestId: string }) => s.requestId === initial.requestId);
  if (!suspension) {
    out({ ok: false, reason: "process A did not suspend", output: String(initial.output ?? "") });
    return;
  }
  out({
    ok: true,
    requestId: initial.requestId,
    sessionId,
    suspensionId: suspension.suspensionId,
  });
}

main()
  .catch((err) =>
    out({
      ok: false,
      reason: "suspend driver threw: " + (err instanceof Error ? (err.stack ?? err.message) : String(err)),
    }),
  )
  .finally(() => {
    if (typeof stores.close === "function") stores.close();
    process.exit(0);
  });
