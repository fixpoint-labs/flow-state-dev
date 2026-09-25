/**
 * Test helpers: a per-body scripted evaluation model on the testing package's
 * mock, and a way to run turns against one shared store.
 */
import { evaluator, type EvaluationModel } from "@flow-state-dev/core";
import type { StoreRegistry } from "@flow-state-dev/engine";
import {
  mockEvaluationModel,
  testFlow,
  type MockEvaluationAnswer,
  type MockEvaluationCall,
} from "@flow-state-dev/testing";
import { ticketQuestions, type TicketEvaluator, type TicketState } from "../src/facets";

/** What the scripted model does for one body. */
export type BodyScript = {
  answers?: Record<string, MockEvaluationAnswer>;
  error?: Error;
};

export type ScriptedModel = EvaluationModel & { calls: string[] };

/**
 * An evaluation model that answers per body. Each call is delegated to a
 * `mockEvaluationModel` built from the body's script, so answers and reported
 * confidence map exactly as they do on the shipped mock.
 */
export function scriptedModel(byBody: (body: string) => BodyScript): ScriptedModel {
  const calls: string[] = [];
  const model = {
    specificationVersion: "v4",
    provider: "mock.evaluation",
    modelId: "mock-evaluation",
    supportedQuestionTypes: ["choice", "score", "boolean"],
    calls,
    async doEvaluate(call: MockEvaluationCall) {
      const body = String(call.state);
      calls.push(body);
      const script = byBody(body);
      return mockEvaluationModel({ answers: script.answers, error: script.error }).doEvaluate(
        call as never,
      );
    },
  };
  return model as unknown as ScriptedModel;
}

/** The app's evaluator, as `fsdev.config.ts` builds it, on a test model. */
export function triageOn(model: EvaluationModel): TicketEvaluator {
  return evaluator({ name: "ticket-facets", model, questions: ticketQuestions });
}

export const BILLING_OPEN: Record<string, MockEvaluationAnswer> = {
  topic: { type: "choice", choice: "billing", confidence: 0.9 },
  status: { type: "choice", choice: "open" },
};
export const OUTAGE_CLOSED: Record<string, MockEvaluationAnswer> = {
  topic: { type: "choice", choice: "outage", confidence: 0.8 },
  status: { type: "choice", choice: "closed", confidence: 0.7 },
};

export const USER = "u";

/** Run one action as its own turn against a shared store. */
export async function turn(
  flow: Parameters<typeof testFlow>[0]["flow"],
  stores: StoreRegistry,
  action: string,
  input: unknown,
  sessionId = "s1",
) {
  return testFlow({ flow, stores, action, input, userId: USER, sessionId });
}

/** Read a ticket's stored state straight from the store. */
export async function storedTicket(stores: StoreRegistry, key: string): Promise<TicketState | undefined> {
  const row = await stores.resourceState.get("user", USER, `tickets/${key}`);
  return row?.state as TicketState | undefined;
}
