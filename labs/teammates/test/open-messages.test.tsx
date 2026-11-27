// @vitest-environment happy-dom
/**
 * The screen's worker messages read answers only what is open (a message on
 * its way, or one asked to be answered and not answered yet), as workforce's
 * view does: once Lead's message to researcher is answered, nothing of that
 * exchange is open, Lead's line goes back to idle, and no pending line stays.
 * The scripted server answers through the same rule as the view (`isOpenMessage`), so a
 * screen drawn on it can't lean on closed messages the server never sends.
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { workerMessagesViewRef } from "@flow-state-dev/workforce/browser";
import { App } from "../src/components/App";
import { scriptedServer, ScriptedProvider } from "./scripted-server";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  window.history.replaceState(null, "", "/");
});

const LEAD = "teammates.chief-of-staff";

describe("the open messages the screen reads", () => {
  it("drop an exchange once it is answered, so Lead reads idle with nothing pending", async () => {
    const lab = scriptedServer({ speed: 0.05 });
    render(<ScriptedProvider server={lab}><App /></ScriptedProvider>);
    const box = await screen.findByLabelText("Message Lead");
    await act(async () => {
      fireEvent.change(box, { target: { value: "Ask researcher for our launch date, and help me outline the post." } });
      fireEvent.keyDown(box, { key: "Enter" });
    });
    const conversation = () => screen.getByRole("main", { name: "Conversation" });
    const leadStatus = () => screen.getByRole("navigation", { name: "Workers" }).querySelector('[data-worker="Lead"] [data-status]')?.textContent;
    await within(conversation()).findByRole("button", { name: /^Messaged researcher: / });
    // Answered and read: Lead is idle.
    await waitFor(() => expect(leadStatus()).toMatch(/^Idle/), { timeout: 3000 });
    const open = (await lab.client.view(workerMessagesViewRef(), { worker: LEAD })).value;
    expect(open.map((m) => m.id)).toEqual([]);
    expect(conversation().querySelectorAll("[data-pending]")).toHaveLength(0);
  });
});
