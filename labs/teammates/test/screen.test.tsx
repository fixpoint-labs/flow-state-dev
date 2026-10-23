// @vitest-environment happy-dom
/**
 * The screen, on fixtures. These prove the UI only: a list of workers rather
 * than sessions, worker talk drawn in both conversations and the Talk panel
 * (D1), a reply that waits for your turn and shows as pending (D2), and a
 * divider that never calls a window boundary a summary. The goal check proves
 * the package at wiring.
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { App } from "../src/App";
import { createFixtureLab } from "../src/fixtures";

// The script runs at a twentieth of real time.
const fast = (options = {}) => createFixtureLab({ speed: 0.05, ...options });

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

const workers = () => screen.getByRole("navigation", { name: "Workers" });
const conversation = () => screen.getByRole("main", { name: "Conversation" });
const talk = () => screen.getByRole("complementary", { name: "Talk" });
const workerRow = (name: string) => workers().querySelector<HTMLElement>(`[data-worker="${name}"]`)!;
const entries = (kind: string) => [...conversation().querySelectorAll(`[data-entry="${kind}"]`)];

async function tell(worker: string, text: string) {
  const box = await screen.findByLabelText(`Message ${worker}`);
  await act(async () => {
    fireEvent.change(box, { target: { value: text } });
    fireEvent.keyDown(box, { key: "Enter" });
  });
}

describe("the teammates screen", () => {
  it("lists workers, not sessions, and opens on lead's one conversation", async () => {
    render(<App adapter={fast()} />);
    await waitFor(() => expect(within(workers()).getAllByRole("listitem")).toHaveLength(3));
    expect(workerRow("lead").getAttribute("aria-current")).toBe("true");
    expect(within(conversation()).getByRole("heading", { name: "lead" })).toBeTruthy();
    // Grok Bot's sidebar has no session list and no new chat.
    expect(screen.queryByRole("button", { name: /new (chat|session)/i })).toBeNull();
  });

  it("marks where lead's word-for-word turns begin, and calls it out of view, not summarized", async () => {
    render(<App adapter={fast()} />);
    const divider = await screen.findByRole("separator");
    expect(divider.getAttribute("aria-label")).toBe("Earlier turns out of view");
    // 52 turns seeded, 50 in the window: turns 1 and 2 sit before the divider, turn 3 right after it.
    const after = divider.nextElementSibling as HTMLElement;
    expect(after.dataset.inWindow).toBe("true");
    expect(after.textContent).toMatch(/List the launch channels/);
    expect(within(conversation()).getByText(/blog first, never social first/).closest("[data-in-window]")?.getAttribute("data-in-window")).toBe("false");
  });

  it("labels the divider summarized only when the earlier turns were summarized", async () => {
    render(<App adapter={fast({ summary: true })} />);
    const divider = await screen.findByRole("separator");
    expect(divider.getAttribute("aria-label")).toBe("Earlier turns summarized");
  });

  it("draws lead's message to researcher in both conversations and in lead's Talk panel", async () => {
    render(<App adapter={fast()} />);
    await tell("lead", "Ask researcher for our launch date, and help me outline the post.");

    // Step 2: a one-line card in lead's conversation that opens to its full text.
    const card = await within(conversation()).findByRole("button", { name: "To researcher: What's our launch date?" });
    expect(card.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(card);
    expect(card.getAttribute("aria-expanded")).toBe("true");
    await waitFor(() => expect(within(talk()).getByRole("region", { name: "with researcher" })).toBeTruthy());

    // While lead waits, its row says so.
    await waitFor(() => expect(workerRow("lead").querySelector("[data-status]")?.textContent).toBe("waiting on researcher"));

    // researcher sees the message as a line from lead.
    fireEvent.click(workerRow("researcher"));
    expect(await within(conversation()).findByRole("region", { name: "From lead" })).toBeTruthy();
  });

  it("holds researcher's reply as pending while lead answers you, and lands it after that answer", async () => {
    render(<App adapter={fast()} />);
    await tell("lead", "Ask researcher for our launch date, and help me outline the post.");
    await within(conversation()).findByRole("button", { name: /To researcher/ });

    // Step 3: a second line before researcher answers. lead takes it, and the reply arrives mid-turn.
    await tell("lead", "Make section 2 about pricing.");
    await waitFor(() => expect(conversation().querySelector("[data-pending]")?.textContent).toBe("← researcher replied · lead reads it after this turn"), {
      interval: 5,
      timeout: 2000,
    });
    expect(within(conversation()).getByRole("status").textContent).toMatch(/lead is answering/);
    expect(entries("received")).toHaveLength(2); // only writer's two older replies so far

    // The reply lands as its own line after lead's answer to you, and lead's next line uses it.
    const reply = await within(conversation()).findByRole("region", { name: "From researcher" }, { timeout: 2000 });
    expect(conversation().querySelector("[data-pending]")).toBeNull();
    const answer = within(conversation()).getByText(/Noted: "Make section 2 about pricing\."/);
    expect(answer.compareDocumentPosition(reply) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(await within(conversation()).findByText(/researcher answered: "Nov 12, per the plan doc\."/, {}, { timeout: 2000 })).toBeTruthy();
  });

  it("counts what researcher did while you watched lead as unread, and clears it when you open researcher", async () => {
    render(<App adapter={fast()} />);
    await tell("lead", "Ask researcher for our launch date, and help me outline the post.");
    await waitFor(() => expect(within(workerRow("researcher")).getByLabelText(/unread/).textContent).toBe("3"), { timeout: 2000 });
    fireEvent.click(workerRow("researcher"));
    await waitFor(() => expect(within(workerRow("researcher")).queryByLabelText(/unread/)).toBeNull());
  });

  it("closes the Talk panel and opens it again from the conversation", async () => {
    render(<App adapter={fast()} />);
    await screen.findByRole("region", { name: "with writer" });
    fireEvent.click(within(talk()).getByRole("button", { name: "Close talk" }));
    expect(screen.queryByRole("complementary", { name: "Talk" })).toBeNull();
    fireEvent.click(within(conversation()).getByRole("button", { name: "Talk" }));
    expect(within(talk()).getByRole("region", { name: "with writer" })).toBeTruthy();
  });
});
