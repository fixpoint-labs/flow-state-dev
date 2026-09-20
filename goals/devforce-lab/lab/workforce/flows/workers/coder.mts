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
 * ## The board declaration below is an interim tax, not a convention
 *
 * This kind declares the feature board a second time — same `boardId`, same
 * ledger id, its own same-flow dispatcher — and drains it never. It is here
 * because the framework requires it, in two places:
 *
 * - `defineFlow` refuses a flow that declares a task entry with no board
 *   reachable from the flow that hands off to it (the orphan-task-entry guard);
 * - the claim gate refuses a dispatch whose `boardId` differs from the one the
 *   recipient's own board was built with.
 *
 * So a recipient cannot declare only the remotely addressed entry. That was
 * settled by a run before this spec was drafted, and the framework's own
 * `packages/orchestration/test/task-board/hand-off-cross-flow.test.ts`
 * documents the same constraint in its header.
 *
 * **Do not read it as how DevForce declares boards.** The Architect split that
 * question in two: board *authoring* is a channel-attached `TaskCollection`
 * (FIX-1385), and this cross-flow claim-gate cost is a separate L1 constraint
 * carved onto FIX-1408. A kind that needs a task entry may pay this tax today,
 * labelled interim. A Lab that taught it as the rule would grandfather an
 * asymmetry nobody chose.
 */

import { defineFlow } from "@flow-state-dev/core";
import type { DeclaredResources } from "@flow-state-dev/core";
import { harnessManager, type PhaseSpec, type WorkspaceConfig } from "@flow-state-dev/harness-manager";
import type { HarnessBlock, HarnessCallbackContext } from "@flow-state-dev/core/types";
import {
  featureLedger,
  LEDGER_ID,
  recipientBoard,
  WORK_ENTRY,
} from "../../../board.mts";
import {
  INSPECT_ENTRY,
  readOwnFacts,
  seatSettingsSchema,
} from "../../../seat-config.mts";

/** The kind id the working `WORKER.md` names. **Pinned** — the basename must match. */
export const CODER_KIND = "coder";

/**
 * The action that exists so the claim gate has a board to verify against.
 * Drained by nobody — see this module's header.
 */
export const DRAIN_ENTRY = "drain";

export interface CoderWorkerFlowOptions {
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
  /** Where checkouts are cut, from what, and off which ref. */
  workspace: WorkspaceConfig;
  /** The one phase: how the prompt is built, and what counts as done. */
  phase: PhaseSpec;
  /** Wall-clock budget for one harness run. */
  runTimeoutMs: number;
  /** The file-declared documents, as `resourcesFromDocs` built them. */
  resources: DeclaredResources;
}

/**
 * Build the working kind.
 *
 * @param options The harness slot, the workspace, the phase and the documents.
 * @returns The flow factory `hireWorkforce` mints one copy of per coder record.
 */
export function defineCoderWorkerFlow(options: CoderWorkerFlowOptions) {
  const collection = featureLedger();

  const manager = harnessManager({
    boardCollectionId: LEDGER_ID,
    boardCollection: collection,
    tenant: undefined,
    phase: options.phase,
    workspace: options.workspace,
    runTimeoutMs: options.runTimeoutMs,
    harness: options.harness,
  } as never);

  // ---- the interim tax, and the whole of it ------------------------------
  // Same board, declared again so the entry below is gated. See the header.
  const board = recipientBoard(collection);

  return defineFlow({
    kind: CODER_KIND,
    // One copy per worker record, each addressed by its own id — which is what
    // the coordinator's dispatcher names in `flowKind`.
    cardinality: "collection",
    configSchema: seatSettingsSchema(),
    // Installed at flow level, which is why the reading blocks must require an
    // org: `defineFlow` collects `requiresOrg` from blocks, never from here.
    resources: options.resources,
    actions: {
      [DRAIN_ENTRY]: { block: board.drain, description: "Interim: exists to gate the task entry." },
      [INSPECT_ENTRY]: {
        block: readOwnFacts,
        description: "Read what this seat can see of its own configuration. Writes nothing.",
      },
    },
    // Reachable only through the board's claim gate, by a hand-off that named
    // this instance.
    task: { actions: { [WORK_ENTRY]: { block: manager } } },
  } as never);
}
