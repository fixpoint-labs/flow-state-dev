/**
 * The one send path (V6; BR-4, BR-5): what makes a line *delivered*, and what
 * a refusal, a lost request and an answer it can't confirm each come back as.
 * Against stub clients, so each answer the Lab can give is staged exactly.
 */
import { describe, expect, it } from "vitest";
import { ClientHttpError } from "@flow-state-dev/client";
import { sendTurn, TurnNotDelivered } from "../src/lib/send";
import type { LabClients } from "../src/lib/connection";

const TARGET = { sessionId: "s_run", flowId: "eng.coder", door: "message" };

type Item = { requestId: string; role?: string; type: string; reason?: string };

/** Clients whose door request ends `status`, and whose session holds `items`, paged by offset and limit. */
function stubClients(options: {
  status: string;
  items?: Item[];
  failure?: string;
  sendFails?: boolean;
  /** The session read rejects with this, as the client would. */
  stateFails?: unknown;
  /** The session read answers this instead of a page. */
  stateAnswers?: unknown;
}): { clients: LabClients; sent: unknown[] } {
  const sent: unknown[] = [];
  const items = options.items ?? [];
  const clients = {
    actions: (flowId: string) => ({
      sendAction: async (action: string, input: unknown, opts: unknown) => {
        if (options.sendFails === true) throw new ClientHttpError("Request failed (503)", { status: 503, body: { error: "store offline" } });
        sent.push({ flowId, action, input, opts });
        return { request: { id: "req_door" } };
      },
      getRequestStatus: async () => ({ status: options.status }),
    }),
    sessions: {
      getSessionState: async (_id: string, read: { offset?: number; limit?: number; itemTypes?: string[] } = {}) => {
        if (options.stateFails !== undefined) throw options.stateFails;
        if (options.stateAnswers !== undefined) return options.stateAnswers;
        const typed = items.filter((item) => read.itemTypes === undefined || read.itemTypes.includes(item.type));
        const offset = read.offset ?? 0;
        const limit = read.limit ?? 50;
        const page = typed.slice(offset, offset + limit);
        return {
          items: page,
          pagination: { offset, limit, total: typed.length, hasMore: offset + page.length < typed.length, nextOffset: offset + page.length },
        };
      },
      listSessionRequests: async () =>
        options.failure === undefined ? [] : [{ id: "req_door", result: { error: { message: options.failure } } }],
    },
  } as unknown as LabClients;
  return { clients, sent };
}

const kindOf = async (promise: Promise<unknown>) => {
  const error = await promise.catch((e: unknown) => e);
  expect(error).toBeInstanceOf(TurnNotDelivered);
  return error as TurnNotDelivered;
};

describe("sendTurn", () => {
  it("is delivered when the door's request completed and the session holds its user item", async () => {
    const { clients, sent } = stubClients({
      status: "completed",
      items: [{ requestId: "req_door", role: "user", type: "message" }],
    });
    await expect(sendTurn(clients, TARGET, "hello", { pollMs: 1 })).resolves.toEqual({ requestId: "req_door", stopped: null });
    // Through the target's door, into its session, with the line as `{ message }`.
    expect(sent).toEqual([{ flowId: "eng.coder", action: "message", input: { message: "hello" }, opts: { sessionId: "s_run" } }]);
  });

  it("finds the line at the end of a long session, where a new line is", async () => {
    const older = Array.from({ length: 5_000 }, (_, i) => ({ requestId: `req_${i}`, role: "user", type: "message" }));
    const { clients } = stubClients({ status: "completed", items: [...older, { requestId: "req_door", role: "user", type: "message" }] });
    await expect(sendTurn(clients, TARGET, "hello", { pollMs: 1 })).resolves.toEqual({ requestId: "req_door", stopped: null });
  });

  // A turn that stops on a person's approval (a chief of staff's fire or retire) holds the
  // line already: it is delivered, and resending it would raise the ask twice.
  it("is delivered, stopped on an ask, when the door's request suspended on a person's approval and the session holds its user item", async () => {
    const { clients } = stubClients({
      status: "suspended",
      items: [
        { requestId: "req_door", role: "user", type: "message" },
        { requestId: "req_door", type: "suspension", reason: "human_approval" },
      ],
    });
    await expect(sendTurn(clients, TARGET, "fire eng.coder", { pollMs: 1 })).resolves.toEqual({ requestId: "req_door", stopped: "ask" });
  });

  // Inbox lists only a person's asks, so a suspension on anything else must not point there.
  it("is delivered, stopped on a wait and not an ask, when the request suspended on something Inbox doesn't list", async () => {
    const { clients } = stubClients({
      status: "suspended",
      items: [
        { requestId: "req_door", role: "user", type: "message" },
        { requestId: "req_other", type: "suspension", reason: "human_approval" },
        { requestId: "req_door", type: "suspension", reason: "external_event" },
      ],
    });
    await expect(sendTurn(clients, TARGET, "wait for the deploy", { pollMs: 1 })).resolves.toEqual({ requestId: "req_door", stopped: "wait" });
  });

  it("is unconfirmed, not not-sent, when the request suspended but the session doesn't show the line", async () => {
    const { clients } = stubClients({ status: "suspended", items: [] });
    const error = await kindOf(sendTurn(clients, TARGET, "fire eng.coder", { pollMs: 1 }));
    expect(error.kind).toBe("unconfirmed");
  });

  it("is refused, in the door's own words, when the door's request failed", async () => {
    const { clients } = stubClients({ status: "failed", failure: "A finished task takes no message." });
    const error = await kindOf(sendTurn(clients, TARGET, "hello", { pollMs: 1 }));
    expect(error.kind).toBe("refused");
    expect(error.message).toBe("A finished task takes no message.");
  });

  it("is not sent when the action never reached the Lab", async () => {
    const { clients } = stubClients({ status: "completed", sendFails: true });
    const error = await kindOf(sendTurn(clients, TARGET, "hello", { pollMs: 1 }));
    expect(error.kind).toBe("not-sent");
    expect(error.message).toMatch(/store offline/);
  });

  it("is not sent when the door's request ended any other way", async () => {
    const { clients } = stubClients({ status: "aborted" });
    const error = await kindOf(sendTurn(clients, TARGET, "hello", { pollMs: 1 }));
    expect(error.kind).toBe("not-sent");
    expect(error.message).toMatch(/ended aborted/);
  });

  // A line that may have arrived must not be offered for a resend, or Retry sends it twice.
  describe("unconfirmed: the line may have arrived, so nothing offers to send it again", () => {
    it("when the request completed but the session doesn't hold the line", async () => {
      const { clients } = stubClients({ status: "completed", items: [{ requestId: "req_other", role: "user", type: "message" }] });
      const error = await kindOf(sendTurn(clients, TARGET, "hello", { pollMs: 1 }));
      expect(error.kind).toBe("unconfirmed");
      expect(error.message).toMatch(/doesn't hold your message/);
    });

    it("when the worker doesn't answer in time", async () => {
      const { clients } = stubClients({ status: "in_progress" });
      const error = await kindOf(sendTurn(clients, TARGET, "hello", { pollMs: 1, timeoutMs: 5 }));
      expect(error.kind).toBe("unconfirmed");
      expect(error.message).toMatch(/may still arrive/);
    });

    it("when reading the session fails after the line was sent", async () => {
      const { clients } = stubClients({ status: "completed", stateFails: new ClientHttpError("Request failed (503)", { status: 503, body: null }) });
      const error = await kindOf(sendTurn(clients, TARGET, "hello", { pollMs: 1 }));
      expect(error.kind).toBe("unconfirmed");
    });
  });

  it("lets a fault in its own reading through, rather than calling it not sent", async () => {
    const { clients } = stubClients({ status: "completed", stateAnswers: { items: "not a list", pagination: { total: 1 } } });
    const error = await sendTurn(clients, TARGET, "hello", { pollMs: 1 }).catch((e: unknown) => e);
    expect(error).not.toBeInstanceOf(TurnNotDelivered);
    expect(error).toBeInstanceOf(TypeError);
  });
});
