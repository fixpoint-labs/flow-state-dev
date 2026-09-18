/**
 * The path this lab exists to prove: a flow classifies a ticket with Jev,
 * then code routes. No generator, no free text.
 */
import { describe, expect, it } from "vitest";
import { testFlow } from "@flow-state-dev/testing";
import { createTicketTriageFlow, FLOW_KIND } from "../src/flow";
import { TICKET_QUESTIONS } from "../src/questions";
import {
  BILLING_RESULT,
  LOW_CONFIDENCE_RESULT,
  scriptedClient,
} from "./scripted-client";

const USER = "lab-user";

describe("ticket-triage flow", () => {
  it("declares triage and evaluate on one flow kind", () => {
    const { client } = scriptedClient(BILLING_RESULT);
    const flow = createTicketTriageFlow({ client });
    expect(flow.kind).toBe(FLOW_KIND);
    expect(Object.keys(flow.actions).sort()).toEqual(["evaluate", "triage"]);
  });

  it("routes an urgent billing ticket to escalate (confidence-gated combo)", async () => {
    const { client, calls } = scriptedClient(BILLING_RESULT);
    const result = await testFlow({
      flow: createTicketTriageFlow({ client }),
      action: "triage",
      userId: USER,
      input: {
        subject: "Duplicate charge",
        message: "My card was charged twice. Help ASAP.",
      },
    });

    expect(result.status).toBe("completed");
    expect(result.output).toMatchObject({
      destination: "escalate",
      model: BILLING_RESULT.model,
    });
    expect(calls[0]?.request.questions).toEqual(TICKET_QUESTIONS);
    expect(calls[0]?.request.state).toEqual({
      subject: "Duplicate charge",
      message: "My card was charged twice. Help ASAP.",
    });
  });

  it("routes a calm billing ticket to billing when urgency is low", async () => {
    const calm = {
      ...BILLING_RESULT,
      answers: {
        ...BILLING_RESULT.answers,
        is_urgent: { type: "noul" as const, noul: 0.1 },
      },
    };
    const { client } = scriptedClient(calm);
    const result = await testFlow({
      flow: createTicketTriageFlow({ client }),
      action: "triage",
      userId: USER,
      input: {
        subject: "Invoice copy",
        message: "Please send last month's invoice when you can.",
      },
    });

    expect(result.status).toBe("completed");
    expect(result.output).toMatchObject({
      destination: "billing",
    });
  });

  it("escalates when department confidence is below the floor", async () => {
    const { client } = scriptedClient(LOW_CONFIDENCE_RESULT);
    const result = await testFlow({
      flow: createTicketTriageFlow({ client }),
      action: "triage",
      userId: USER,
      input: {
        subject: "Question",
        message: "Not sure who this is for.",
      },
    });

    expect(result.status).toBe("completed");
    expect(result.output).toMatchObject({ destination: "escalate" });
  });

  it("evaluate returns the answers map for caller-supplied questions", async () => {
    const { client, calls } = scriptedClient(BILLING_RESULT);
    const questions = {
      urgent: { type: "noul" as const, instructions: "Urgent?" },
    };
    const result = await testFlow({
      flow: createTicketTriageFlow({ client }),
      action: "evaluate",
      userId: USER,
      input: { state: "Help ASAP", questions },
    });

    expect(result.status).toBe("completed");
    expect(result.output).toEqual(BILLING_RESULT);
    expect(calls[0]?.request).toMatchObject({
      state: "Help ASAP",
      questions,
    });
  });
});
