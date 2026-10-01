// @vitest-environment happy-dom
/**
 * The shell against a real Lab, in a DOM (V2, V3's second path, V6; BR-14,
 * BR-28). What the screen draws is compared with what the Lab's routes hold.
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_ORG_ID } from "@flow-state-dev/core";
import { App } from "../src/App";
import { GAPS } from "../src/gaps";
import { createLabClients } from "../src/lib/connection";
import { ASKER_REFUSED_LINE } from "./fixtures/ask-lab/asker.mts";
import { ASK_LAB_USER_ID, openAskLab } from "./fixtures/ask-lab/lab.mts";
import { serveLab, type ServedLab } from "./helpers/serve-lab";

const served: ServedLab[] = [];
afterEach(async () => {
  cleanup();
  vi.restoreAllMocks();
  await Promise.all(served.splice(0).map((lab) => lab.handle.close()));
});

async function openApp(path: string, options: Parameters<typeof openAskLab>[0] = {}, bearerToken?: string) {
  const lab = await serveLab((await openAskLab(options)).flowState);
  served.push(lab);
  // The page is served from the Lab's own origin, as the start script serves it.
  (window as unknown as { happyDOM: { setURL(url: string): void } }).happyDOM.setURL(`${lab.baseUrl}${path}`);
  const clients = createLabClients({ userId: ASK_LAB_USER_ID, ...(bearerToken === undefined ? {} : { bearerToken }) });
  render(<App clients={clients} />);
  return { lab, clients };
}

describe("the refusal (V2, BR-3)", () => {
  it("shows only the refusal, draws nothing from the tree, and makes no further read", async () => {
    const seen: string[] = [];
    const real = globalThis.fetch;
    vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      seen.push(new URL(String(input instanceof Request ? input.url : input), window.location.href).pathname);
      return real(input, init);
    });
    await openApp("/w/ops.desk/stream", { bearer: "secret" });
    await screen.findByTestId("refusal");
    expect(screen.getByTestId("refusal-message").textContent).toMatch(/401.*verified organization/);
    expect(screen.queryByTestId("sidebar")).toBeNull();
    expect(document.body.textContent).not.toMatch(/ops\./);
    await new Promise((r) => setTimeout(r, 300));
    expect(seen).toEqual(["/api/flows/sessions"]);
  });

  it("a Lab that names no organization for the person gets the refusal, never an unknown one", async () => {
    await openApp("/inbox", { channels: false });
    await screen.findByTestId("refusal");
    expect(screen.getByTestId("refusal-message").textContent).toMatch(/no organization/);
    expect(screen.queryByTestId("sidebar")).toBeNull();
    expect(document.body.textContent).not.toMatch(/Unknown organization/);
  });
});

describe("a Lab shift-manager can't reach", () => {
  it("shows what the Lab answered with Retry, not the refusal, and Retry opens the Lab once it answers", async () => {
    const real = globalThis.fetch;
    let down = true;
    vi.spyOn(globalThis, "fetch").mockImplementation((input, init) =>
      down ? Promise.resolve(new Response(JSON.stringify({ error: "store offline" }), { status: 503 })) : real(input, init),
    );
    await openApp("/inbox");
    const screenEl = await screen.findByTestId("unreachable");
    expect(screen.getByTestId("unreachable-message").textContent).toMatch(/503.*store offline/);
    expect(screen.queryByTestId("refusal")).toBeNull();
    expect(screen.queryByTestId("sidebar")).toBeNull();
    expect(screenEl.textContent).not.toMatch(/organization/);
    down = false;
    act(() => fireEvent.click(screen.getByTestId("unreachable-retry")));
    await screen.findByTestId("sidebar");
  });
});

describe("a Lab booted without its inventory (V3, BR-4)", () => {
  it("fails TEAMS and PROJECTS by name with Retry, and the rest still renders", async () => {
    await openApp("/inbox", { inventory: false });
    const teams = await screen.findByTestId("teams-failure");
    expect(teams.textContent).toMatch(/without opening its inventory/);
    expect(within(teams).getByRole("button", { name: "Retry" })).toBeTruthy();
    expect(screen.getByTestId("projects-failure").textContent).toMatch(/without opening its inventory/);
    expect(screen.getByTestId("nav-tasks")).toBeTruthy();
    expect(screen.getByTestId("jump-to")).toBeTruthy();
  });

  it("a Lab whose flows declare no inventory still names the organization it binds the person to", async () => {
    await openApp("/inbox", { inventoryDeclared: false });
    expect((await screen.findByTestId("teams-failure")).textContent).toMatch(/without opening its inventory/);
    expect(screen.getByTestId("org-switcher").textContent).toContain(DEFAULT_ORG_ID);
    expect(document.body.textContent).not.toMatch(/Unknown organization/);
  });
});

describe("empty states (BR-14, BR-28)", () => {
  it("a workstream whose channel attaches no board says so on the Board tab and in the panel", async () => {
    await openApp("/w/ops.side/board");
    expect((await screen.findByTestId("board-none")).textContent).toMatch(/attaches no board/);
    expect(screen.getByTestId("panel-tasks-none").textContent).toMatch(/attaches no board/);
  });

  it("Inbox and Tasks with nothing say so in a sentence", async () => {
    await openApp("/inbox");
    expect((await screen.findByTestId("inbox-empty")).textContent).toMatch(/No seat in this Lab is waiting/);
    act(() => fireEvent.click(screen.getByTestId("nav-tasks")));
    expect((await screen.findByTestId("tasks-empty")).textContent).toMatch(/No attached board holds a row/);
  });
});

describe("the composer (V6)", () => {
  it("draws a post only once the channel holds it", async () => {
    const { clients } = await openApp("/w/ops.side/stream");
    const input = (await screen.findByTestId("composer-input")) as HTMLTextAreaElement;
    // Hold the post's request open: nothing may be drawn while it is.
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    const real = globalThis.fetch;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (i, init) => {
      if (String(i instanceof Request ? i.url : i).includes("/status")) await held;
      return real(i, init);
    });
    fireEvent.change(input, { target: { value: "kept line" } });
    fireEvent.click(screen.getByTestId("composer-send"));
    await waitFor(() => expect(screen.getByTestId("composer-status").textContent).toMatch(/Posting/));
    expect(screen.queryByText("kept line", { selector: "[data-testid=transcript-line-body]" })).toBeNull();
    expect(input.value).toBe("kept line");
    release();
    await screen.findByText("kept line", { selector: "[data-testid=transcript-line-body]" });
    // The live stream can draw the kept line before the post's next status poll
    // answers, and only that answer clears the draft: wait for it, don't race it.
    await waitFor(() => expect(input.value).toBe(""));
    // And the channel holds it.
    const state = await clients.sessions.getSessionState("ops.side", { includeItems: true, itemTypes: ["component"] });
    expect(JSON.stringify(state.items)).toContain("kept line");
  });

  it("keeps the draft and says why when the post is refused", async () => {
    await openApp("/w/ops.side/stream");
    const input = (await screen.findByTestId("composer-input")) as HTMLTextAreaElement;
    const real = globalThis.fetch;
    vi.spyOn(globalThis, "fetch").mockImplementation((i, init) =>
      String(i instanceof Request ? i.url : i).includes("/actions/post")
        ? Promise.resolve(new Response(JSON.stringify({ error: "post refused by the channel" }), { status: 422 }))
        : real(i, init),
    );
    fireEvent.change(input, { target: { value: "refused line" } });
    fireEvent.click(screen.getByTestId("composer-send"));
    expect((await screen.findByTestId("composer-error")).textContent).toMatch(/post refused by the channel/);
    expect(input.value).toBe("refused line");
    expect(screen.queryByText("refused line", { selector: "[data-testid=transcript-line-body]" })).toBeNull();
  });

  it("@worker with no task in this workstream disables Send and says so, and posts nothing (BR-19)", async () => {
    const { clients } = await openApp("/w/ops.side/stream");
    const input = await screen.findByTestId("composer-input");
    fireEvent.change(input, { target: { value: "@asker please look" } });
    await waitFor(() => expect(screen.getByTestId("composer-status").textContent).toBe(`ops.asker ${GAPS.turn.noTask}`));
    expect((screen.getByTestId("composer-send") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId("composer-send").textContent).toBe("Send");

    fireEvent.change(input, { target: { value: "@nobody please" } });
    expect(screen.getByTestId("composer-status").textContent).toBe(`@nobody ${GAPS.turn.noWorker}`);
    expect((screen.getByTestId("composer-send") as HTMLButtonElement).disabled).toBe(true);

    const state = await clients.sessions.getSessionState("ops.side", { includeItems: true, itemTypes: ["component"] });
    expect(JSON.stringify(state.items ?? [])).not.toContain("please");
  });
});

describe("Inbox's reply (V6; BR-4, BR-5, BR-21, BR-22)", () => {
  /** An ask in the asker's session, then Inbox open on it. */
  async function openOnAsk(options: Parameters<typeof openAskLab>[0] = {}) {
    const lab = await serveLab((await openAskLab(options)).flowState);
    served.push(lab);
    const clients = createLabClients({ baseUrl: lab.baseUrl, userId: ASK_LAB_USER_ID });
    await clients.actions("ops.asker").sendAction("ask", { what: "ship it" }, { sessionId: "s_ops_asker" });
    (window as unknown as { happyDOM: { setURL(url: string): void } }).happyDOM.setURL(`${lab.baseUrl}/inbox`);
    render(<App clients={createLabClients({ userId: ASK_LAB_USER_ID })} />);
    const item = await screen.findByTestId("inbox-item");
    act(() => fireEvent.click(item));
    await screen.findByTestId("inbox-reply");
    return { clients };
  }

  /** The user lines a session holds. */
  async function userLines(clients: ReturnType<typeof createLabClients>, sessionId: string): Promise<string> {
    const state = await clients.sessions.getSessionState(sessionId, { includeItems: true, itemTypes: ["message"] });
    return JSON.stringify((state.items ?? []).filter((item) => (item as { role?: string }).role === "user"));
  }

  it("shows delivered only once the seat's session holds the line, through its door", async () => {
    const { clients } = await openOnAsk();
    const input = screen.getByTestId("inbox-reply-input") as HTMLTextAreaElement;
    expect(input.disabled).toBe(false);
    // Hold the door's request open: nothing may read delivered while it is.
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    const real = globalThis.fetch;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (i, init) => {
      if (String(i instanceof Request ? i.url : i).includes("/status")) await held;
      return real(i, init);
    });
    fireEvent.change(input, { target: { value: "a reply line" } });
    fireEvent.click(screen.getByTestId("inbox-reply-send"));
    await waitFor(() => expect(screen.getByTestId("inbox-reply-status").getAttribute("data-state")).toBe("sending"));
    expect(input.value).toBe("a reply line");
    release();
    await waitFor(() => expect(screen.getByTestId("inbox-reply-status").getAttribute("data-state")).toBe("delivered"));
    expect(input.value).toBe("");
    expect(await userLines(clients, "s_ops_asker")).toContain("a reply line");
    // The ask is untouched: a reply isn't an answer.
    expect(screen.getByTestId("inbox-detail").textContent).toMatch(/Approve/);
  });

  it("keeps the draft and shows the seat's own reason when its door refuses", async () => {
    await openOnAsk();
    const input = screen.getByTestId("inbox-reply-input") as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: ASKER_REFUSED_LINE } });
    fireEvent.click(screen.getByTestId("inbox-reply-send"));
    expect((await screen.findByTestId("inbox-reply-error", {}, { timeout: 5_000 })).textContent).toBe("This seat won't take that line.");
    expect(screen.getByTestId("inbox-reply-status").getAttribute("data-state")).toBe("refused");
    expect(input.value).toBe(ASKER_REFUSED_LINE);
    expect(screen.queryByTestId("inbox-reply-retry")).toBeNull();
  });

  it("says not sent, with Retry, when the line never reached the Lab", async () => {
    const { clients } = await openOnAsk();
    const input = screen.getByTestId("inbox-reply-input") as HTMLTextAreaElement;
    const real = globalThis.fetch;
    let down = true;
    vi.spyOn(globalThis, "fetch").mockImplementation((i, init) =>
      down && String(i instanceof Request ? i.url : i).includes("/actions/message")
        ? Promise.resolve(new Response(JSON.stringify({ error: "store offline" }), { status: 503 }))
        : real(i, init),
    );
    fireEvent.change(input, { target: { value: "try again" } });
    fireEvent.click(screen.getByTestId("inbox-reply-send"));
    expect((await screen.findByTestId("inbox-reply-error")).textContent).toMatch(/^Not sent: .*store offline/);
    expect(input.value).toBe("try again");
    down = false;
    act(() => fireEvent.click(screen.getByTestId("inbox-reply-retry")));
    await waitFor(() => expect(screen.getByTestId("inbox-reply-status").getAttribute("data-state")).toBe("delivered"));
    expect(await userLines(clients, "s_ops_asker")).toContain("try again");
  });

  it("keeps the draft and offers no Retry when it can't confirm the line arrived", async () => {
    const { clients } = await openOnAsk();
    const input = screen.getByTestId("inbox-reply-input") as HTMLTextAreaElement;
    const real = globalThis.fetch;
    // The door takes the line, then reading the session back fails.
    vi.spyOn(globalThis, "fetch").mockImplementation((i, init) =>
      String(i instanceof Request ? i.url : i).includes("item_types=message")
        ? Promise.resolve(new Response(JSON.stringify({ error: "store offline" }), { status: 503 }))
        : real(i, init),
    );
    fireEvent.change(input, { target: { value: "did it land" } });
    fireEvent.click(screen.getByTestId("inbox-reply-send"));
    expect((await screen.findByTestId("inbox-reply-error", {}, { timeout: 5_000 })).textContent).toMatch(/Check the worker's session/);
    expect(screen.getByTestId("inbox-reply-status").getAttribute("data-state")).toBe("unconfirmed");
    expect(input.value).toBe("did it land");
    // A resend here would put the line in the session twice.
    expect(screen.queryByTestId("inbox-reply-retry")).toBeNull();
    vi.restoreAllMocks();
    expect(await userLines(clients, "s_ops_asker")).toContain("did it land");
  });

  it("is disabled for a seat whose kind has no door, and Approve still answers (BR-22)", async () => {
    await openOnAsk({ doors: false });
    expect((screen.getByTestId("inbox-reply-input") as HTMLTextAreaElement).disabled).toBe(true);
    expect(screen.getByTestId("inbox-reply-blocked").textContent).toBe(`ops.asker ${GAPS.turn.replyNoDoor}`);
    const approve = within(screen.getByTestId("inbox-detail")).getByRole("button", { name: "Approve" });
    expect((approve as HTMLButtonElement).disabled).toBe(false);
  });
});

describe("Jump to a declared document (BR-10)", () => {
  it("finds the Lab's document by name and opens it read-only, with the file's body", async () => {
    const lab = await serveLab((await openAskLab()).flowState);
    served.push(lab);
    const clients = createLabClients({ baseUrl: lab.baseUrl, userId: ASK_LAB_USER_ID });
    // A seat session, before the page boots, makes a flow that serves the document listable.
    await clients.actions("ops.asker").sendAction("ask", { what: "ship it" }, { sessionId: "s_ops_asker" });
    (window as unknown as { happyDOM: { setURL(url: string): void } }).happyDOM.setURL(`${lab.baseUrl}/inbox`);
    render(<App clients={createLabClients({ userId: ASK_LAB_USER_ID })} />);

    const jump = await screen.findByTestId("jump-to");
    act(() => fireEvent.click(jump));
    act(() => fireEvent.change(screen.getByTestId("jump-input"), { target: { value: "runbook" } }));
    const [result, ...rest] = await screen.findAllByTestId("jump-result");
    expect(rest).toEqual([]);
    expect(result!.textContent).toMatch(/runbook.*read-only/);
    act(() => fireEvent.click(result!));

    const view = await screen.findByTestId("resource");
    expect((await within(view).findByTestId("resource-content")).textContent).toContain("RUNBOOK-DOC-7F3A1");
    // Read-only: the page offers nothing to type into or save with.
    expect(view.querySelector("textarea, input, [contenteditable=true]")).toBeNull();
    expect(within(view).queryAllByRole("button")).toEqual([]);
  });
});
