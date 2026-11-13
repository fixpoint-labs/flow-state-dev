// @vitest-environment happy-dom
/**
 * A reply that has already landed never shows as pending. A waited send takes
 * its answer as the tool's result, so no received line ever lands for it, and
 * a received line older than the loaded page isn't among the entries: neither
 * may leave a "reads it next" line pinned under every newer message. The log
 * row says whether the message landed; the screen trusts it.
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Client } from "@flow-state-dev/client";
import { App } from "../src/App";
import { createLabAdapter, type ConversationEntry, type LabTalk } from "../src/adapter";
import { pendingFor } from "../src/lib/talk";
import { createFixtureLab } from "./fake-lab";
import { liveOver } from "./live-over";

const LEAD = "teammates.chief-of-staff";
const RESEARCHER = "teammates.researcher";

vi.mock("@flow-state-dev/workforce/browser", async (original) => ({
  ...(await original<typeof import("@flow-state-dev/workforce/browser")>()),
  createWorkforceClient: () => ({
    roster: async () => [{ id: LEAD, flow: "teammates", standard: true, description: null, name: "Lead" }],
    ensureWorkerSession: async () => ({ id: "wks_1", flowKind: "teammates" }),
  }),
}));

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  window.history.replaceState(null, "", "/");
});

const ask: LabTalk = { id: "msg_question", from: LEAD, to: RESEARCHER, text: "Launch date?", replyRequested: true, at: 1 };
const reply: LabTalk = { id: "msg_reply", from: RESEARCHER, to: LEAD, text: "Nov 12.", inReplyTo: "msg_question", at: 2 };

describe("which messages to a worker are still pending", () => {
  it("leaves out a waited send's answer: it was the tool's result, and no received line will ever land for it", () => {
    expect(pendingFor(LEAD, [ask, { ...reply, delivered: true }], [])).toEqual([]);
  });

  it("leaves out a reply whose received line is older than the loaded page", () => {
    const loaded: ConversationEntry[] = [{ kind: "user", id: "u_9", text: "Make section 2 about pricing." }];
    expect(pendingFor(LEAD, [ask, { ...reply, delivered: true }], loaded)).toEqual([]);
  });

  it("still holds a reply that hasn't landed yet", () => {
    expect(pendingFor(LEAD, [ask, reply], []).map((m) => m.id)).toEqual(["msg_reply"]);
  });
});

describe("the message log the screen reads", () => {
  it("marks a message the log says was delivered", async () => {
    const row = (id: string, status: string) => ({
      clientData: { ...reply, id, exchange: "msg_question", fromSession: "wks_r", fromFlow: "teammates", toSession: "wks_1", toFlow: "teammates", hop: 1, status },
    });
    const client = {
      resources: { listCollectionResources: async () => ({ items: [row("msg_landed", "delivered"), row("msg_on_its_way", "unconfirmed")] }) },
      subscribe: () => ({ close: () => {} }),
      get live() {
        return liveOver(this as never);
      },
    } as unknown as Client;
    let rows: LabTalk[] | undefined;
    const stop = createLabAdapter(client).watchTalk(LEAD, (next) => (rows = next));
    await waitFor(() => expect(rows).toBeDefined());
    stop();
    expect(rows!.map((m) => [m.id, m.delivered === true])).toEqual([
      ["msg_landed", true],
      ["msg_on_its_way", false],
    ]);
  });
});

describe("a waited send's answer, on the screen", () => {
  it("draws no pending line under your newer message, during or after Lead's turn", async () => {
    const lab = createFixtureLab({ speed: 0.05 });
    // What Jake saw: researcher's answers to Lead's waited sends, delivered as the sends' results.
    const waited = [1, 2, 3, 4].map((n): LabTalk => ({ ...reply, id: `msg_waited_${n}`, inReplyTo: `msg_ask_${n}`, at: n, delivered: true }));
    const adapter = { ...lab, watchTalk: (worker: string, onChange: (rows: LabTalk[]) => void) => lab.watchTalk(worker, (rows) => onChange(worker === LEAD ? [...waited, ...rows] : rows)) };
    render(<App adapter={adapter} />);
    const conversation = () => screen.getByRole("main", { name: "Conversation" });
    const box = await screen.findByLabelText("Message Lead");
    await act(async () => {
      fireEvent.change(box, { target: { value: "Yes my name is Jake." } });
      fireEvent.keyDown(box, { key: "Enter" });
    });
    await within(conversation()).findByText("Yes my name is Jake.");
    expect(conversation().querySelectorAll("[data-pending^='msg_waited_']")).toHaveLength(0);
    await waitFor(() => expect(within(conversation()).queryByText(/Lead is answering/)).toBeNull(), { timeout: 2000 });
    expect(conversation().querySelectorAll("[data-pending^='msg_waited_']")).toHaveLength(0);
  });
});
