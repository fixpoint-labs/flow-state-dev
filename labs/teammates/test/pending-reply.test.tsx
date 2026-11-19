// @vitest-environment happy-dom
/**
 * A reply that has already landed never shows as pending. A waited send takes
 * its answer as the tool's result, so no received line ever lands for it, and
 * a received line older than the loaded page isn't among the entries: neither
 * may leave a "reads it next" line pinned under every newer message. The log
 * row's status says whether the message landed; the screen trusts it.
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { Client } from "@flow-state-dev/client";
import type { WorkerMessageResourceState } from "@flow-state-dev/workforce/browser";
import { App } from "../src/components/App";
import type { ConversationEntry } from "../src/lib/conversation";
import { pendingFor } from "../src/lib/talk";
import { scriptedServer, ScriptedProvider } from "./scripted-server";

const LEAD = "teammates.chief-of-staff";
const RESEARCHER = "teammates.researcher";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  window.history.replaceState(null, "", "/");
});

/** A row of the message log, as workforce's worker messages view answers it. */
const logEntry = (fields: Partial<WorkerMessageResourceState> & Pick<WorkerMessageResourceState, "id" | "from" | "to" | "text" | "at">): WorkerMessageResourceState => ({
  exchange: fields.id, fromSession: "wks_from", fromFlow: "teammates", toSession: "wks_to", toFlow: "teammates", hop: 1, status: "unconfirmed", ...fields,
});
const ask = logEntry({ id: "msg_question", from: LEAD, to: RESEARCHER, text: "Launch date?", replyRequested: true, at: 1 });
const reply = logEntry({ id: "msg_reply", from: RESEARCHER, to: LEAD, text: "Nov 12.", inReplyTo: "msg_question", exchange: "msg_question", at: 2 });

describe("which messages to a worker are still pending", () => {
  it("leaves out a waited send's answer: it was the tool's result, and no received line will ever land for it", () => {
    expect(pendingFor(LEAD, [ask, { ...reply, status: "delivered" }], [])).toEqual([]);
  });

  it("leaves out a reply whose received line is older than the loaded page", () => {
    const loaded: ConversationEntry[] = [{ kind: "user", id: "u_9", text: "Make section 2 about pricing." }];
    expect(pendingFor(LEAD, [ask, { ...reply, status: "delivered" }], loaded)).toEqual([]);
  });

  it("leaves out a message that will never land", () => {
    expect(pendingFor(LEAD, [{ ...reply, status: "refused" }, { ...reply, id: "msg_late", status: "undeliverable" }], [])).toEqual([]);
  });

  it("still holds a reply that hasn't landed yet", () => {
    expect(pendingFor(LEAD, [ask, reply], []).map((m) => m.id)).toEqual(["msg_reply"]);
  });
});

describe("a waited send's answer, on the screen", () => {
  it("draws no pending line under your newer message, during or after Lead's turn", async () => {
    const lab = scriptedServer({ speed: 0.05 });
    // What Jake saw: researcher's answers to Lead's waited sends, delivered as the sends' results.
    const waited = [1, 2, 3, 4].map((n) => ({ ...reply, id: `msg_waited_${n}`, inReplyTo: `msg_ask_${n}`, at: n, status: "delivered" as const }));
    const client = {
      ...lab.client,
      view: async (ref: { view: string }, input: { worker?: string }, options?: unknown) => {
        const read = await lab.client.view(ref as never, input as never, options as never);
        return ref.view === "workerMessages" && input.worker === LEAD ? { ...read, value: [...waited, ...(read.value as unknown[])] } : read;
      },
    } as unknown as Client;
    render(<ScriptedProvider server={lab} client={client}><App /></ScriptedProvider>);
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
