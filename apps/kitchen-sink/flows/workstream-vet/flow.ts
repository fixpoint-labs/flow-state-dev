/**
 * workstream-vet — flow definition (defineFlow only).
 *
 * Throwaway tracer bullet for the workstream vet
 * (docs/internal/workstream-vet-tracer-bullet.md): does "workstream" earn
 * centerpiece status, or is it planAndExecute dressed up? The two clauses
 * under test — goal-completion judgment that changes the outcome, and a
 * human checkpoint as pure board semantics across requests — live in
 * `loop.ts`; the session-lived board in `board.ts`.
 *
 * Proof script (see the spec): three `fsdev run` invocations against one
 * session — `start` → `decide reject` → `decide approve` — plus the
 * zero-model `status` read-back and the `startUnchecked` control.
 */
import { defineFlow } from "@flow-state-dev/core";
import {
  advanceLoop,
  decideAction,
  resolveAction,
  snapshot,
  startAction,
  startUncheckedAction,
} from "./loop";
import { workspaceResource, workstreamTasksCollection } from "./resources";

const workstreamVetFlow = defineFlow({
  kind: "workstream-vet",
  requireUser: true,
  actions: {
    // Mutating actions reject per-session concurrent dispatch: two racing
    // `start`s on a fresh session could both see an empty board and seed
    // duplicate chains (full multi-writer seed atomicity is the deferred
    // board-concurrency substrate work; this is the action-level guard).
    start: { block: startAction, concurrency: "reject" },
    // `decide` is approval sugar over `resolve` — kept to show the shape.
    decide: { block: decideAction, concurrency: "reject" },
    resolve: { block: resolveAction, concurrency: "reject" },
    advance: { block: advanceLoop, concurrency: "reject" },
    status: { block: snapshot },
    startUnchecked: { block: startUncheckedAction, concurrency: "reject" },
  },
  resources: {
    wsvetTasks: workstreamTasksCollection,
    wsvetWorkspace: workspaceResource,
  },
});

export default workstreamVetFlow({ id: "default" });
