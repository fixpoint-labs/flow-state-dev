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

type Item = { requestId: string; role?: string; type: string; reason?: string; suspensionId?: string };

/** Clients whose door request ends `status`, and whose session holds `items`, paged by offset and limit. */
function stubClients(options: {
  status: string;
  /** Statuses for the polls after the first, in order; the last repeats. Default: `status` throughout. */
  later?: string[];
  items?: Item[];
  failure?: string;
  sendFails?: boolean;
  /** The session read rejects with this, as the client would. */
  stateFails?: unknown;
  /** The session read answers this instead of a page. */
  stateAnswers?: unknown;
  /** Only the read of suspension items rejects; the line's read-back still answers. */
  suspensionsFail?: boolean;
  /** What the session holds for every read of suspension items after the first. */
  itemsLater?: Item[];
}): { clients: LabClients; sent: unknown[] } {
  const sent: unknown[] = [];
  const items = options.items ?? [];
  let polls = 0;
  let suspensionReads = 0;
  const clients = {
    actions: (flowId: string) => ({
      sendAction: async (action: string, input: unknown, opts: unknown) => {
        if (options.sendFails === true) throw new ClientHttpError("Request failed (503)", { status: 503, body: { error: "store offline" } });
        sent.push({ flowId, action, input, opts });
        return { request: { id: "req_door" } };
      },
      getRequestStatus: async () => {
        const later = options.later ?? [];
        const status = polls === 0 || later.length === 0 ? options.status : later[Math.min(polls - 1, later.length - 1)];
        polls += 1;
        return { status };
      },
    }),
    sessions: {
      getSessionState: async (_id: string, read: { offset?: number; limit?: number; itemTypes?: string[] } = {}) => {
        if (options.stateFails !== undefined) throw options.stateFails;
        if (options.stateAnswers !== undefined) return options.stateAnswers;
        if (options.suspensionsFail === true && read.itemTypes?.includes("suspension") === true) {
          throw new ClientHttpError("Request failed (503)", { status: 503, body: null });
        }
        const suspensions = read.itemTypes?.includes("suspension") === true;
        const held = suspensions && suspensionReads > 0 && options.itemsLater !== undefined ? options.itemsLater : items;
        if (suspensions) suspensionReads += 1;
        const typed = held.filter((item) => read.itemTypes === undefined || read.itemTypes.includes(item.type));
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
    await expect(sendTurn(clients, TARGET, "hello", { pollMs: 1 })).resolves.toEqual({ requestId: "req_door", suspended: false, stopped: null });
    // Through the target's door, into its session, with the line as `{ message }`.
    expect(sent).toEqual([{ flowId: "eng.coder", action: "message", input: { message: "hello" }, opts: { sessionId: "s_run" } }]);
  });

  it("finds the line at the end of a long session, where a new line is", async () => {
    const older = Array.from({ length: 5_000 }, (_, i) => ({ requestId: `req_${i}`, role: "user", type: "message" }));
    const { clients } = stubClients({ status: "completed", items: [...older, { requestId: "req_door", role: "user", type: "message" }] });
    await expect(sendTurn(clients, TARGET, "hello", { pollMs: 1 })).resolves.toEqual({ requestId: "req_door", suspended: false, stopped: null });
  });

  // A turn that stops on a person's approval (a chief of staff's fire or retire) holds the
  // line already: it is delivered, and resending it would raise the ask twice.
  it("is delivered, stopped on an ask, when the door's request suspended on a person's approval and the session holds its user item", async () => {
    const { clients } = stubClients({
      status: "suspended",
      items: [
        { requestId: "req_door", role: "user", type: "message" },
        { requestId: "req_door", type: "suspension", reason: "human_approval", suspensionId: "susp_fire" },
      ],
    });
    await expect(sendTurn(clients, TARGET, "fire eng.coder", { pollMs: 1 })).resolves.toEqual({ requestId: "req_door", suspended: true, stopped: "ask" });
  });

  // Inbox lists only a person's asks, so a suspension on anything else must not point there.
  it("is delivered, stopped on a wait and not an ask, when the request suspended on something Inbox doesn't list", async () => {
    const { clients } = stubClients({
      status: "suspended",
      items: [
        { requestId: "req_door", role: "user", type: "message" },
        { requestId: "req_other", type: "suspension", reason: "human_approval", suspensionId: "susp_other" },
        { requestId: "req_door", type: "suspension", reason: "external_event", suspensionId: "susp_deploy" },
      ],
    });
    await expect(sendTurn(clients, TARGET, "wait for the deploy", { pollMs: 1 })).resolves.toEqual({ requestId: "req_door", suspended: true, stopped: "wait" });
  });

  // An ask someone already answered is not in Inbox any more: only the still-pending stop counts.
  it("is stopped on a wait when the request's ask was answered and it then stopped on something else", async () => {
    const { clients } = stubClients({
      status: "suspended",
      items: [
        { requestId: "req_door", role: "user", type: "message" },
        { requestId: "req_door", type: "suspension", reason: "human_approval", suspensionId: "susp_fire" },
        { requestId: "req_door", type: "suspension_resume", suspensionId: "susp_fire" },
        { requestId: "req_door", type: "suspension", reason: "external_event", suspensionId: "susp_deploy" },
      ],
    });
    await expect(sendTurn(clients, TARGET, "fire eng.coder", { pollMs: 1 })).resolves.toEqual({ requestId: "req_door", suspended: true, stopped: "wait" });
  });

  // Every state a suspended poll can be followed by, and what the composer is told for each.
  describe("what a suspended turn is still stopped on, once the session is read", () => {
    const line = { requestId: "req_door", role: "user", type: "message" };
    const ask = (id: string, reason = "human_approval") => ({ requestId: "req_door", type: "suspension", reason, suspensionId: id });
    const resume = (id: string) => ({ requestId: "req_door", type: "suspension_resume", suspensionId: id });
    const cases: Array<[string, Item[], "ask" | "wait" | null]> = [
      ["answered between the poll and the read, nothing pending: plain delivered", [line, ask("s1"), resume("s1")], null],
      ["a wait answered, then a person's ask pending: in Inbox", [line, ask("s1", "external_event"), resume("s1"), ask("s2")], "ask"],
      ["a person's input pending: in Inbox", [line, ask("s1", "human_input")], "ask"],
      ["another request's ask pending, this one's answered: not this line's", [line, ask("s1"), resume("s1"), { ...ask("s9"), requestId: "req_other" }], null],
    ];
    for (const [what, items, stopped] of cases) {
      it(what, async () => {
        const { clients } = stubClients({ status: "suspended", items });
        await expect(sendTurn(clients, TARGET, "fire eng.coder", { pollMs: 1 })).resolves.toEqual({ requestId: "req_door", suspended: true, stopped });
      });
    }

    // A resume marks the request running before it writes its resume item: the ask still
    // reads as pending, but the turn is no longer stopped on it.
    it("resumed after the read but before its resume item lands: the recheck says running, so plain delivered", async () => {
      const { clients } = stubClients({ status: "suspended", later: ["in_progress"], items: [line, ask("s1")] });
      await expect(sendTurn(clients, TARGET, "fire eng.coder", { pollMs: 1 })).resolves.toEqual({ requestId: "req_door", suspended: true, stopped: null });
    });

    // Inbox pages every suspension item; so does this, or an older pending ask is missed.
    it("a pending ask older than a page of later suspension events: still in Inbox", async () => {
      const others = Array.from({ length: 250 }, (_, i) => [
        { requestId: `req_${i}`, type: "suspension", reason: "human_approval", suspensionId: `o${i}` },
        { requestId: `req_${i}`, type: "suspension_resume", suspensionId: `o${i}` },
      ]).flat();
      const { clients } = stubClients({ status: "suspended", items: [line, ask("s1"), ...others] });
      await expect(sendTurn(clients, TARGET, "fire eng.coder", { pollMs: 1 })).resolves.toEqual({ requestId: "req_door", suspended: true, stopped: "ask" });
    });

    // suspended → resumed → suspended again on another reason, all under one request id: the
    // stop reported is the one pending now, not the one first read.
    it("re-suspended on a different reason between the read and the recheck: the newer stop is reported", async () => {
      const { clients } = stubClients({
        status: "suspended",
        items: [line, ask("s1")],
        itemsLater: [line, ask("s1"), resume("s1"), ask("s2", "external_event")],
      });
      await expect(sendTurn(clients, TARGET, "fire eng.coder", { pollMs: 1 })).resolves.toEqual({ requestId: "req_door", suspended: true, stopped: "wait" });
    });

    it("re-suspended on a person's ask after a wait was read: the ask is reported", async () => {
      const { clients } = stubClients({
        status: "suspended",
        items: [line, ask("s1", "external_event")],
        itemsLater: [line, ask("s1", "external_event"), resume("s1"), ask("s2")],
      });
      await expect(sendTurn(clients, TARGET, "fire eng.coder", { pollMs: 1 })).resolves.toEqual({ requestId: "req_door", suspended: true, stopped: "ask" });
    });

    // Whatever the words say, a turn the poll saw suspended tells the caller to read the Lab again.
    it("nothing pending at the first read, then re-suspended on an ask: still reported suspended", async () => {
      const { clients } = stubClients({ status: "suspended", items: [line, ask("s1"), resume("s1")], itemsLater: [line, ask("s1"), resume("s1"), ask("s2")] });
      const sent = await sendTurn(clients, TARGET, "fire eng.coder", { pollMs: 1 });
      expect(sent.suspended).toBe(true);
    });

    it("a failed read of the suspensions, resumed meanwhile: the recheck says running, so plain delivered", async () => {
      const { clients } = stubClients({ status: "suspended", later: ["completed"], items: [line, ask("s1")], suspensionsFail: true });
      await expect(sendTurn(clients, TARGET, "fire eng.coder", { pollMs: 1 })).resolves.toEqual({ requestId: "req_door", suspended: true, stopped: null });
    });

    it("a failed read of the suspensions is still delivered, as a wait that points nowhere", async () => {
      const { clients } = stubClients({ status: "suspended", items: [line, ask("s1")], suspensionsFail: true });
      await expect(sendTurn(clients, TARGET, "fire eng.coder", { pollMs: 1 })).resolves.toEqual({ requestId: "req_door", suspended: true, stopped: "wait" });
    });
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
