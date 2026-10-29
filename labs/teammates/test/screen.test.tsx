// @vitest-environment happy-dom
/**
 * The screen, on a test double (`fake-lab.ts`). These prove the UI only: a list of workers rather
 * than sessions, worker talk drawn in both conversations and the Talk panel
 * (D1), a reply that waits for your turn and shows as pending (D2), and a
 * divider that never calls a window boundary a summary, and a coding job that
 * runs as a background task, not a teammate (D4, amended by FIX-2332), in the
 * working folder, with no project anywhere (D3, amended by FIX-2335). The
 * goal check proves the package at wiring.
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { App } from "../src/App";
import { createFixtureLab } from "./fake-lab";

// The script runs at a twentieth of real time.
const fast = (options = {}) => createFixtureLab({ speed: 0.05, ...options });

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

const workers = () => screen.getByRole("navigation", { name: "Workers" });
const conversation = () => screen.getByRole("main", { name: "Conversation" });
const talk = () => screen.getByRole("complementary", { name: "Talk" });
const teammates = () => within(workers()).getAllByRole("list")[0];
const background = () => within(workers()).getByRole("list", { name: "Background" });
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
  it("lists teammates, not sessions, and opens on lead's one conversation", async () => {
    render(<App adapter={fast()} />);
    await waitFor(() => expect(within(teammates()).getAllByRole("listitem")).toHaveLength(3));
    // Coding is a background task, not a teammate: the worker coding tasks run on is not listed.
    expect(workers().querySelector('[data-worker="coder"]')).toBeNull();
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

  it("starts a coding task at once, with no project anywhere on the screen, and lands its result as the coding task's", async () => {
    render(<App adapter={fast()} />);
    await tell("lead", "Fix the typo in the README's first line.");

    // Step 5: the task runs in the working folder straight away: nothing asks where.
    const card = await within(conversation()).findByRole("button", { name: "Coding task: Fix the typo in the README's first line" });
    const tile = card.closest<HTMLElement>("[data-entry=task]")!;
    expect(tile.querySelector("[data-task-status]")?.textContent).toBe("running");
    // The lab has no projects: no select, no prompt, no card, and no word for one anywhere.
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.queryByRole("group")).toBeNull();
    expect(document.body.textContent).not.toMatch(/project/i);

    // The result lands as the coding task's, never a teammate's, and lead's next line uses it.
    expect(await within(conversation()).findByRole("region", { name: "From the coding task" }, { timeout: 2000 })).toBeTruthy();
    expect(within(conversation()).queryByRole("region", { name: "From coder" })).toBeNull();
    expect(tile.querySelector("[data-task-status]")?.textContent).toBe("done");
    expect(await within(conversation()).findByText(/The coding task is done: "Fixed the typo in README.md, line 1\."/, {}, { timeout: 2000 })).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/project/i);
  });

  it("shows a coding task as a background item that opens to its run, read only, with no composer", async () => {
    render(<App adapter={fast()} />);
    await tell("lead", "Fix the typo in the README's first line.");
    await within(conversation()).findByRole("button", { name: /Coding task/ });

    const item = await within(background()).findByRole("button", { name: "Coding task: Fix the typo in the README's first line" });
    fireEvent.click(item);
    const runs = await screen.findByRole("main", { name: "Coding tasks" });
    expect(item.getAttribute("aria-current")).toBe("true");
    expect(within(runs).queryByRole("textbox")).toBeNull();
    const run = await within(runs).findByRole("list", { name: "Run of Fix the typo in the README's first line" });
    await waitFor(() => expect(run.textContent).toMatch(/Edited line 1/), { timeout: 2000 });
  });

  it("doesn't carry a draft to another worker: switching workers starts an empty box", async () => {
    render(<App adapter={fast()} />);
    const leadBox = (await screen.findByLabelText("Message lead")) as HTMLTextAreaElement;
    fireEvent.change(leadBox, { target: { value: "For lead only" } });
    fireEvent.click(workerRow("researcher"));
    const researcherBox = (await screen.findByLabelText("Message researcher")) as HTMLTextAreaElement;
    expect(researcherBox.value).toBe("");
  });

  it("doesn't send when Enter ends an input method's composition", async () => {
    render(<App adapter={fast()} />);
    const box = await screen.findByLabelText("Message lead");
    fireEvent.change(box, { target: { value: "日本語" } });
    fireEvent.keyDown(box, { key: "Enter", isComposing: true });
    // Safari: the committing Enter arrives after compositionend, marked only by keyCode 229.
    fireEvent.keyDown(box, { key: "Enter", keyCode: 229 });
    expect((box as HTMLTextAreaElement).value).toBe("日本語");
    expect(entries("user").some((e) => e.textContent?.includes("日本語"))).toBe(false);
    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() => expect(entries("user").some((e) => e.textContent?.includes("日本語"))).toBe(true));
  });

  it("shows what a worker waits for your yes on, and Approve answers it so its turn carries on", async () => {
    render(<App adapter={fast()} />);
    await waitFor(() => expect(workerRow("writer")).toBeTruthy());
    fireEvent.click(workerRow("writer"));
    await tell("writer", "Publish the draft.");
    const card = await within(conversation()).findByRole("region", { name: "writer asks" });
    expect(card.textContent).toContain("Publish the draft to the team page?");
    expect(card.textContent).toContain("waiting for you");
    await act(async () => fireEvent.click(within(card).getByRole("button", { name: "Approve" })));
    await waitFor(() => expect(card.textContent).toContain("approved"));
    expect(within(card).queryByRole("button", { name: "Approve" })).toBeNull();
    expect(await within(conversation()).findByText("Published.", {}, { timeout: 2000 })).toBeTruthy();
  });

  it("hires a teammate you can talk to, changes its instructions, and fires it; the files' workers can't be", async () => {
    render(<App adapter={fast()} />);
    await screen.findByLabelText("Message lead");
    // A worker from the files has no instructions or fire control.
    expect(within(conversation()).queryByRole("button", { name: "Fire" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Hire a teammate" }));
    const form = screen.getByRole("form", { name: "Hire a teammate" });
    fireEvent.change(within(form).getByLabelText("Teammate name"), { target: { value: "Tester" } });
    fireEvent.change(within(form).getByLabelText("Teammate role"), { target: { value: "Runs the tests." } });
    await act(async () => fireEvent.click(within(form).getByRole("button", { name: "Hire" })));
    await waitFor(() => expect(within(teammates()).getAllByRole("listitem")).toHaveLength(4));
    expect(await screen.findByLabelText("Message tester")).toBeTruthy();

    fireEvent.click(within(conversation()).getByRole("button", { name: "Instructions" }));
    const edit = screen.getByRole("form", { name: "Instructions for tester" });
    fireEvent.change(within(edit).getByLabelText("New instructions for tester"), { target: { value: "Answer in one sentence." } });
    await act(async () => fireEvent.click(within(edit).getByRole("button", { name: "Save instructions" })));
    await waitFor(() => expect(screen.queryByRole("form", { name: "Instructions for tester" })).toBeNull());

    window.confirm = () => true;
    await act(async () => fireEvent.click(within(conversation()).getByRole("button", { name: "Fire" })));
    await waitFor(() => expect(within(teammates()).getAllByRole("listitem")).toHaveLength(3));
    expect(workerRow("tester")).toBeNull();
  });
});
