/**
 * A message the log marks delivered is not pending, including when the loaded
 * page holds other entries and not that message. One it has not marked still is.
 */
import { describe, expect, it, vi } from "vitest";
import type { Client } from "@flow-state-dev/client";
import { createLabAdapter, type ConversationEntry, type TalkRow } from "../src/adapter";
import { pendingFor } from "../src/lib/talk";

const LEAD = "teammates.chief-of-staff";
const RESEARCHER = "teammates.researcher";

vi.mock("@flow-state-dev/workforce/browser", async (original) => ({
  ...(await original<typeof import("@flow-state-dev/workforce/browser")>()),
  createWorkforceClient: () => ({
    roster: async () => [{ id: LEAD, flow: "teammates", standard: true, description: null, name: "Chief of Staff" }],
    ensureWorkerSession: async () => ({ id: "wks_1", flowKind: "teammates" }),
  }),
}));

const reply: TalkRow = { id: "msg_reply", from: RESEARCHER, to: LEAD, text: "Nov 12.", inReplyTo: "msg_ask", at: 2 };

describe("which messages to a worker are still pending", () => {
  it("leaves out one the log says landed, on an empty page and on a page that does not hold its line, and holds one still on its way", () => {
    const landed = { ...reply, id: "msg_landed", delivered: true };
    const loaded: ConversationEntry[] = [{ kind: "user", id: "u_9", text: "Make section 2 about pricing." }];
    expect(pendingFor(LEAD, [reply, landed], []).map((m) => m.id)).toEqual(["msg_reply"]);
    expect(pendingFor(LEAD, [reply, landed], loaded).map((m) => m.id)).toEqual(["msg_reply"]);
  });
});

describe("the message log the screen reads", () => {
  it("marks a message the log says was delivered", async () => {
    const row = (id: string, status: string) => ({
      clientData: { ...reply, id, exchange: "msg_ask", fromSession: "wks_r", fromFlow: "teammates", toSession: "wks_1", toFlow: "teammates", hop: 1, status },
    });
    const client = {
      resources: { listCollectionItems: async () => ({ items: [row("msg_landed", "delivered"), row("msg_on_its_way", "unconfirmed")] }) },
    } as unknown as Client;
    let rows: TalkRow[] | undefined;
    const stop = createLabAdapter(client).watchTalk(LEAD, (next) => (rows = next));
    for (let i = 0; rows === undefined && i < 100; i++) await new Promise((r) => setTimeout(r, 20));
    stop();
    expect(rows!.map((m) => [m.id, m.delivered === true])).toEqual([
      ["msg_landed", true],
      ["msg_on_its_way", false],
    ]);
  });
});
