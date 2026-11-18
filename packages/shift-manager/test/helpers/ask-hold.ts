/**
 * A coding run's review as the inbox view lists it (an Inbox hold, its
 * detail the pending-asks projection and its worker), and a fake Lab client
 * whose session feed holds the stop with its data and whose answer route
 * records each answer. For the ask card's tests.
 */
import type { InboxHold } from "@flow-state-dev/orchestration/inbox";
import type { InboxAsk } from "../../src/lib/inbox";

/** harness-manager's `harnessReviewAnswerSchema`, as the engine stores it. */
const VERDICT_SCHEMA = {
  anyOf: [
    { type: "object", properties: { verdict: { type: "string", const: "accepted" } }, required: ["verdict"], additionalProperties: false },
    {
      type: "object",
      properties: { verdict: { type: "string", const: "revise" }, words: { type: "string", pattern: "\\S" } },
      required: ["verdict", "words"],
      additionalProperties: false,
    },
  ],
};

/** A coder's review stop, as the view lists it; `marked: false` is the same stop not marked as a review. */
export function reviewHold(marked = true): InboxHold<InboxAsk> {
  const variant = marked ? "review" : "input";
  return {
    id: "susp-1",
    source: { kind: "suspension", flowId: "devforce-coder", sessionId: "sess-run", requestId: "req-1", suspensionId: "susp-1" },
    ask: { kind: variant, prompt: "Review the run's changes" },
    openedAt: 0,
    answerable: true,
    unanswerable: null,
    detail: {
      suspensionId: "susp-1",
      requestId: "req-1",
      flowKind: "devforce-coder",
      flowId: "devforce-coder",
      sessionId: "sess-run",
      workerId: "eng.coder",
      kind: variant,
      shape: "form",
      message: "Review the run's changes",
      allow: ["submit"],
      resumeSchema: VERDICT_SCHEMA,
      createdAt: 0,
    } as unknown as InboxAsk,
  };
}

/** A Lab client whose `sess-run` feed holds the stop with `data`, recording each answer sent. */
export function fakeLabClient(data: unknown) {
  const answers: unknown[] = [];
  const client = {
    sessions: {
      state: async () => ({
        items: [
          { id: "s1", type: "suspension", status: "completed", requestId: "req-1", itemIndex: 1, provenance: {}, suspensionId: "susp-1", reason: "user_input", kind: "review", message: "Review the run's changes", data },
        ],
      }),
    },
    flow: () => ({ request: () => ({ answer: async (body: unknown) => void answers.push(body) }) }),
  };
  return { client, answers };
}
