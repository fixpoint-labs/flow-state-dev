/**
 * Boot: feed loaded seats into the two registries that exist.
 *
 * - Agents → `createAgentRegistry` (`@flow-state-dev/workforce`)
 * - Flows → `createFlowState({ flows })` (engine builds `FlowRegistry` at
 *   construction — `packages/engine/src/flowstate/createFlowState.ts:324-327`)
 *
 * No third catalog. No `registry.register` after construction — kinds are
 * fixed at boot.
 */
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { Agent, AgentRegistry } from "@flow-state-dev/core";
import type { FlowInstance } from "@flow-state-dev/core/types";
import {
  createFlowState,
  inMemoryStores,
  runAction,
  type FlowState,
  type FlowStateRuntime
} from "@flow-state-dev/engine";
import { createAgentRegistry } from "@flow-state-dev/workforce";
import { loadSeatTree } from "./load";

export const USER_ID = "workforce-poc-d-user";

export const TREE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "tree");

export interface LabHost {
  agents: AgentRegistry;
  state: FlowState;
  runtime: FlowStateRuntime;
  flows: Record<string, FlowInstance>;
  createSession: (flowKind: string, sessionId: string, title?: string) => Promise<{
    id: string;
    flowKind: string;
    title?: string;
  }>;
  call: (
    flowKind: string,
    action: string,
    input: unknown,
    sessionId: string
  ) => Promise<{ output: unknown; error?: { message?: string } }>;
  sessionState: (sessionId: string) => Promise<Record<string, unknown> | undefined>;
  dispose: () => Promise<void>;
}

export function loadCommittedTree() {
  return loadSeatTree(TREE_ROOT);
}

export function flowsByKind(flows: FlowInstance[]): Record<string, FlowInstance> {
  return Object.fromEntries(flows.map((flow) => [flow.kind, flow]));
}

export async function bootLab(input: {
  agents: Agent[];
  flows: FlowInstance[];
}): Promise<LabHost> {
  const agents = createAgentRegistry(input.agents);
  const flows = flowsByKind(input.flows);
  const state = createFlowState({
    flows,
    stores: { default: { primary: inMemoryStores() } }
  });
  const runtime = await state.getRuntime();
  const router = await state.getRouter();

  return {
    agents,
    state,
    runtime,
    flows,
    async createSession(flowKind, sessionId, title) {
      const response = await router.POST(
        new Request(`http://localhost/api/flows/${encodeURIComponent(flowKind)}/sessions`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ userId: USER_ID, sessionId, title })
        }),
        { params: { path: [flowKind, "sessions"] } }
      );
      if (response.status !== 201) {
        throw new Error(
          `create_session ${flowKind}/${sessionId} → ${response.status}: ${await response.text()}`
        );
      }
      const body = (await response.json()) as {
        session: { id: string; flowKind: string; title?: string };
      };
      return body.session;
    },
    async call(flowKind, action, input, sessionId) {
      const flow = flows[flowKind];
      if (flow === undefined) {
        throw new Error(`no flow registered as "${flowKind}"`);
      }
      const result = await runAction({
        flow: flow as never,
        actionName: action as never,
        input: input as never,
        userId: USER_ID,
        sessionId,
        stores: runtime.stores,
        runtimeConfig: { ...runtime.runtimeConfig }
      });
      const outcome = result as {
        output?: unknown;
        error?: { message?: string };
      };
      return { output: outcome.output, error: outcome.error };
    },
    async sessionState(sessionId) {
      const record = await runtime.stores.session.get(sessionId);
      return record?.state as Record<string, unknown> | undefined;
    },
    async dispose() {
      await state.dispose();
    }
  };
}

export async function until(
  predicate: () => boolean | Promise<boolean>,
  label: string
): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`timed out waiting for ${label}`);
}
