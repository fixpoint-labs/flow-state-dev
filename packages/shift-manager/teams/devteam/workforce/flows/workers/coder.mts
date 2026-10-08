/**
 * The `coder` worker kind — one file under `workforce/flows/workers/`,
 * basename = the kind id every working `WORKER.md` names in its `flow:` line.
 *
 * This is the seat a filed row wakes. It declares one task entry, and the block
 * behind it is `harnessManager`: the row it is handed becomes a supervised
 * coding run with its own checkout, and the verdict is read before the row
 * settles.
 *
 * **The harness is a slot**, passed in. That is D2, and it is what lets the
 * model-free contract gate and the model-backed honesty check drive the same
 * tree, the same hire and the same wiring while differing by one expression.
 * Hard-code a harness here and the gate becomes impossible, not inconvenient.
 *
 * The board belongs to the feature mailbox: its `MAILBOX.md` names it, and the
 * host hands this kind the mailbox's ledger. The manager runs each row as a
 * coding run whose checkout and branch are derived from that ledger's id. The
 * task entry takes its rows from that ledger through {@link ledgerDoor}, with
 * no board of its own: the EM's board drains it and hands each row here, in a
 * session naming the coder worker it was handed to.
 *
 * Every coder worker runs on this kind's one copy. A session names its worker
 * (`installation.session()`), and the phase reads that worker's own settings
 * through the installation, never `ctx.flow.config`.
 */

import { defineFlow } from "@flow-state-dev/core";
import type { DeclaredResources } from "@flow-state-dev/core";
import { harnessManager, type PhaseSpec, type WorkspaceConfig } from "@flow-state-dev/harness-manager";
import type { HarnessBlock, HarnessCallbackContext } from "@flow-state-dev/core/types";
import { projectWorkspaceCapability, type WorkerInstallation } from "@flow-state-dev/workforce";
import type { WorkspaceHost } from "@flow-state-dev/workspace";
import { ledgerDoor, RESUME_ENTRY, WORK_ENTRY, type FeatureLedger } from "../../../board.mts";
import {
  defineReadOwnFacts,
  INSPECT_ENTRY,
  seatOf,
  seatSettingsSchema,
} from "../../../seat-config.mts";

/** The kind id the working `WORKER.md` names. **Pinned** — the basename must match. */
export const CODER_KIND = "coder";

export interface CoderWorkerFlowOptions {
  /** The installation whose workers run on this kind. */
  installation: WorkerInstallation;
  /**
   * **The slot.** How this kind is pointed at a coding harness.
   *
   * One expression, handed the three feeds the harness contract declares. The
   * gate puts a scripted stub here; the honesty check puts a real coding agent
   * here. Nothing else differs between the two.
   */
  harness: (feeds: {
    cwd: (ctx: HarnessCallbackContext) => string | Promise<string>;
    resume: (ctx: HarnessCallbackContext) => string | null | Promise<string | null>;
    onSession: (sessionId: string, ctx: HarnessCallbackContext) => void | Promise<void>;
  }) => HarnessBlock;
  /**
   * Where each run works: a fixed repository (`{ root, sourceRepo, baseRef }`),
   * or a workspace host whose source is `projectWorkspace` on this kind's
   * board, so a run works in its project's repository or on its project's
   * files.
   */
  workspace: WorkspaceConfig | WorkspaceHost;
  /** The one phase: how the prompt is built, and what counts as done. */
  phase: PhaseSpec;
  /** Wall-clock budget for one harness run. */
  runTimeoutMs: number;
  /** The file-declared documents, as `resourcesFromDocs` built them. */
  resources: DeclaredResources;
  /**
   * The ledger the manager runs rows off — the feature mailbox's. Its id is
   * what every run's checkout folder and branch are derived from.
   */
  ledger: FeatureLedger;
  /**
   * The flow the coordinator whose board hands this seat its rows runs on.
   * The message door re-runs that board there, in the session that claimed
   * the row, after a stop. Absent, the kind declares no message door: nothing
   * would re-run its board.
   */
  coordinatorFlow?: string;
}

/**
 * Build the working kind.
 *
 * @param options The installation, the harness slot, the workspace, the phase, the documents and the ledger.
 * @returns The flow factory `hireWorkforce` registers one copy of, which every coder worker runs on.
 */
export function defineCoderWorkerFlow(options: CoderWorkerFlowOptions) {
  const { collection } = options.ledger;
  const { installation } = options;
  const readOwnFacts = defineReadOwnFacts(seatOf(installation, CODER_KIND));

  const manager = harnessManager({
    boardCollectionId: options.ledger.id,
    boardCollection: collection,
    tenant: undefined,
    phase: options.phase,
    workspace: options.workspace,
    runTimeoutMs: options.runTimeoutMs,
    harness: options.harness,
    // The collections a project's run source reads, on the blocks that ask it.
    ...("provision" in options.workspace ? { uses: [projectWorkspaceCapability] } : {}),
  } as never);

  return defineFlow({
    kind: CODER_KIND,
    // Registered once, at its kind, which is what the coordinator's
    // dispatcher names in `flowKind`; the worker is named by the row's session.
    cardinality: "collection",
    configSchema: seatSettingsSchema(),
    session: installation.session(),
    // Installed at flow level. Org-scoped, and organization identity is
    // unconditional, so the org registry is always built for a request that
    // reaches the reading blocks.
    resources: { ...options.resources, ...installation.resources },
    actions: {
      [INSPECT_ENTRY]: {
        block: readOwnFacts,
        description: "Read what this seat can see of its own configuration. Writes nothing.",
      },
      // The seat's door: a person's message into one of its running coding
      // runs, which stops and continues the same coding session with it.
      ...(options.coordinatorFlow === undefined
        ? {}
        : { message: manager.messageDoor({ drain: RESUME_ENTRY, flowKind: options.coordinatorFlow }) }),
    },
    // Reachable only through the door's claim gate, by a hand-off that named
    // this flow and carried this ledger's id.
    task: { actions: { [WORK_ENTRY]: { block: manager, from: ledgerDoor(options.ledger) } } },
  } as never);
}
