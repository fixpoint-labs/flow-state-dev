/**
 * The one send path (V6; BR-4, BR-5): what makes a line *delivered*, and what
 * a refusal and a lost request each come back as. Against stub clients, so
 * each answer the Lab can give is staged exactly.
 */
import { describe, expect, it } from "vitest";
import { sendTurn, TurnNotDelivered } from "../src/lib/send";
import type { LabClients } from "../src/lib/connection";

const TARGET = { sessionId: "s_run", flowId: "eng.coder", door: "message" };

/** Clients whose door request ends `status`, and whose session holds `items`. */
function stubClients(options: {
  status: string;
  items?: Array<{ requestId: string; role: string; type: string }>;
  failure?: string;
  sendFails?: boolean;
}): { clients: LabClients; sent: unknown[] } {
  const sent: unknown[] = [];
  const clients = {
    actions: (flowId: string) => ({
      sendAction: async (action: string, input: unknown, opts: unknown) => {
        if (options.sendFails === true) throw Object.assign(new Error("store offline"), { status: 503 });
        sent.push({ flowId, action, input, opts });
        return { request: { id: "req_door" } };
      },
      getRequestStatus: async () => ({ status: options.status }),
    }),
    sessions: {
      getSessionState: async () => ({ items: options.items ?? [], pagination: { hasMore: false } }),
      listSessionRequests: async () =>
        options.failure === undefined ? [] : [{ id: "req_door", result: { error: { message: options.failure } } }],
    },
  } as unknown as LabClients;
  return { clients, sent };
}

describe("sendTurn", () => {
  it("is delivered when the door's request completed and the session holds its user item", async () => {
    const { clients, sent } = stubClients({
      status: "completed",
      items: [{ requestId: "req_door", role: "user", type: "message" }],
    });
    await expect(sendTurn(clients, TARGET, "hello", { pollMs: 1 })).resolves.toEqual({ requestId: "req_door" });
    // Through the target's door, into its session, with the line as `{ message }`.
    expect(sent).toEqual([{ flowId: "eng.coder", action: "message", input: { message: "hello" }, opts: { sessionId: "s_run" } }]);
  });

  it("is not delivered when the request completed but the session doesn't hold the line", async () => {
    const { clients } = stubClients({
      status: "completed",
      items: [{ requestId: "req_other", role: "user", type: "message" }],
    });
    const error = await sendTurn(clients, TARGET, "hello", { pollMs: 1 }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TurnNotDelivered);
    expect((error as TurnNotDelivered).kind).toBe("not-sent");
    expect((error as Error).message).toMatch(/doesn't hold your message/);
  });

  it("is refused, in the door's own words, when the door's request failed", async () => {
    const { clients } = stubClients({ status: "failed", failure: "A finished task takes no message." });
    const error = await sendTurn(clients, TARGET, "hello", { pollMs: 1 }).catch((e: unknown) => e);
    expect((error as TurnNotDelivered).kind).toBe("refused");
    expect((error as Error).message).toBe("A finished task takes no message.");
  });

  it("is not sent when the action never reached the Lab", async () => {
    const { clients } = stubClients({ status: "completed", sendFails: true });
    const error = await sendTurn(clients, TARGET, "hello", { pollMs: 1 }).catch((e: unknown) => e);
    expect((error as TurnNotDelivered).kind).toBe("not-sent");
  });

  it("is not sent when the door's request ended any other way", async () => {
    const { clients } = stubClients({ status: "aborted" });
    const error = await sendTurn(clients, TARGET, "hello", { pollMs: 1 }).catch((e: unknown) => e);
    expect((error as TurnNotDelivered).kind).toBe("not-sent");
    expect((error as Error).message).toMatch(/ended aborted/);
  });
});
