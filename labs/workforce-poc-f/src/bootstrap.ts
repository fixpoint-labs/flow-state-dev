/**
 * Host-side bootstrap: open rooms through today's `create_session` route.
 *
 * Atlas cut: no `seed-session` on `defineFlow`. `openTeamInbox` looks up
 * the intake seat, then this caller opens that DM.
 */
import type { FlowInstance } from "@flow-state-dev/core/types";
import {
  createFlowState,
  inMemoryStores,
  runAction,
  type FlowState,
  type FlowStateRuntime,
} from "@flow-state-dev/engine";
import { intakeFlow } from "./intake";
import { memberFlow } from "./member";
import { openTeamInbox, type Seat } from "./roster";

export const USER_ID = "workforce-poc-f-user";

export interface LabHost {
  state: FlowState;
  runtime: FlowStateRuntime;
  createSession: (
    flowKind: string,
    sessionId: string,
    title?: string,
  ) => Promise<{ id: string; flowKind: string; title?: string }>;
  openInbox: (
    rosterId: string,
  ) => Promise<{ id: string; flowKind: string; title?: string; seat: Seat }>;
  call: (
    flowKind: string,
    action: string,
    input: unknown,
    sessionId: string,
  ) => Promise<{ output: unknown; error?: { message?: string } }>;
  sessionState: (sessionId: string) => Promise<Record<string, unknown> | undefined>;
  dispose: () => Promise<void>;
}

export async function bootLab(): Promise<LabHost> {
  const flows: Record<string, FlowInstance> = {
    [intakeFlow.kind]: intakeFlow,
    [memberFlow.kind]: memberFlow,
  };
  const state = createFlowState({
    flows,
    stores: { default: { primary: inMemoryStores() } },
  });
  const runtime = await state.getRuntime();
  const router = await state.getRouter();

  return {
    state,
    runtime,
    async createSession(flowKind, sessionId, title) {
      const response = await router.POST(
        new Request(
          `http://localhost/api/flows/${encodeURIComponent(flowKind)}/sessions`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ userId: USER_ID, sessionId, title }),
          },
        ),
        { params: { path: [flowKind, "sessions"] } },
      );
      if (response.status !== 201) {
        throw new Error(
          `create_session ${flowKind}/${sessionId} → ${response.status}: ${await response.text()}`,
        );
      }
      const body = (await response.json()) as {
        session: { id: string; flowKind: string; title?: string };
      };
      return body.session;
    },
    async openInbox(rosterId) {
      const seat = openTeamInbox(rosterId);
      const session = await this.createSession(
        seat.flowKind,
        seat.sessionId,
        seat.sessionId,
      );
      return { ...session, seat };
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
        runtimeConfig: { ...runtime.runtimeConfig },
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
    },
  };
}
