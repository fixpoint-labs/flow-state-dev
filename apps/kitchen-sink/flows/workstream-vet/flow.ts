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
    start: { block: startAction },
    // `decide` is approval sugar over `resolve` — kept to show the shape.
    decide: { block: decideAction },
    resolve: { block: resolveAction },
    advance: { block: advanceLoop },
    status: { block: snapshot },
    startUnchecked: { block: startUncheckedAction },
  },
  resources: {
    wsvetTasks: workstreamTasksCollection,
    wsvetWorkspace: workspaceResource,
  },
});

export default workstreamVetFlow({ id: "default" });
