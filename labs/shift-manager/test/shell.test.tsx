// @vitest-environment happy-dom
/**
 * The shell against a real Lab, in a DOM (V2, V3's second path, V6; BR-14,
 * BR-28). What the screen draws is compared with what the Lab's routes hold.
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_ORG_ID } from "@flow-state-dev/core";
import { App } from "../src/App";
import { Composer } from "../src/surfaces/Stream";
import type { BoardRow } from "../src/lib/reads";
import { GAPS } from "../src/gaps";
import { bootColorScheme } from "../src/lib/color-scheme";
import { createLabClients } from "../src/lib/connection";
import { ASKER_REFUSED_LINE, heardLine } from "./fixtures/ask-lab/asker.mts";
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

describe("the sidebar's shift switch", () => {
  it("shows the shift the page is in, and a click flips the look both ways", async () => {
    const lab = await serveLab((await openAskLab()).flowState);
    served.push(lab);
    (window as unknown as { happyDOM: { setURL(url: string): void } }).happyDOM.setURL(`${lab.baseUrl}/inbox`);
    // An OS that prefers dark and storage that keeps nothing: the page boots on the night shift.
    const media = { matches: true, addEventListener: () => {}, removeEventListener: () => {} };
    const look = bootColorScheme(undefined, { matchMedia: () => media, localStorage: { getItem: () => null, setItem: () => {} } } as unknown as Window);
    try {
      render(<App clients={createLabClients({ userId: ASK_LAB_USER_ID })} look={look} />);
      const day = await screen.findByTestId("shift-day");
      // The sidebar can commit before its passive effects run, and the switch
      // subscribes to the look in one. Flush them, so the first click can't
      // land before the switch is listening.
      await act(async () => {});
      const night = screen.getByTestId("shift-night");
      expect(within(screen.getByTestId("sidebar-footer")).getByTestId("shift-switch")).toBeTruthy();
      expect([day.textContent, night.textContent]).toEqual(["Day shift", "Night shift"]);
      expect(night.getAttribute("aria-pressed")).toBe("true");
      expect(document.documentElement.classList.contains("dark")).toBe(true);

      act(() => fireEvent.click(day));
      expect(document.documentElement.classList.contains("dark")).toBe(false);
      expect(day.getAttribute("aria-pressed")).toBe("true");
      expect(night.getAttribute("aria-pressed")).toBe("false");

      act(() => fireEvent.click(night));
      expect(document.documentElement.classList.contains("dark")).toBe(true);
      expect(night.getAttribute("aria-pressed")).toBe("true");
    } finally {
      document.documentElement.classList.remove("dark");
    }
  });
});

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

describe("a Lab Shift Manager can't reach", () => {
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

describe("a workstream's Stream holds its members' asks (BR-16)", () => {
  it("draws a pending ask in the feed, marked as waiting on you, and answering it there clears Inbox too", async () => {
    const lab = await serveLab((await openAskLab()).flowState);
    served.push(lab);
    (window as unknown as { happyDOM: { setURL(url: string): void } }).happyDOM.setURL(`${lab.baseUrl}/w/ops.desk/stream`);
    const clients = createLabClients({ baseUrl: lab.baseUrl, userId: ASK_LAB_USER_ID });
    // ops.asker sits in #ops.desk, so its ask belongs in that Stream.
    await clients.actions("ops.asker").sendAction("ask", { what: "ship it" }, { sessionId: "s_ops_asker" });
    render(<App clients={createLabClients({ userId: ASK_LAB_USER_ID })} />);

    const ask = await screen.findByTestId("feed-ask");
    // In the feed itself, not beside it.
    expect(screen.getByTestId("transcript").contains(ask)).toBe(true);
    expect(within(ask).getByText("NEEDS YOU").getAttribute("data-look")).toBe("needs-tag");
    expect(within(ask).getByTestId("ask-card").textContent).toMatch(/ship it/);
    await waitFor(() => expect(screen.getByTestId("nav-inbox-count").textContent).toBe("1"));

    act(() => fireEvent.click(within(ask).getByRole("button", { name: "Approve" })));
    // The ask leaves the feed and Inbox together: there is one list of pending asks.
    await waitFor(() => expect(screen.queryByTestId("feed-ask")).toBeNull(), { timeout: 10_000 });
    await waitFor(() => expect(screen.getByTestId("nav-inbox-count").textContent).toBe("0"));
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
    // The button draws v2's ⏎; its name says the line goes to a worker, not the channel.
    expect(screen.getByTestId("composer-send").getAttribute("aria-label")).toBe("Send");

    fireEvent.change(input, { target: { value: "@nobody please" } });
    expect(screen.getByTestId("composer-status").textContent).toBe(`@nobody ${GAPS.turn.noWorker}`);
    expect((screen.getByTestId("composer-send") as HTMLButtonElement).disabled).toBe(true);

    const state = await clients.sessions.getSessionState("ops.side", { includeItems: true, itemTypes: ["component"] });
    expect(JSON.stringify(state.items ?? [])).not.toContain("please");
  });
});

describe("the composer's @mentions", () => {
  it("a new line started from an @mention is unsent, so it doesn't read delivered", async () => {
    const row = { id: "only-task", title: "the coder's one task" } as BoardRow;
    render(
      <Composer
        send={async () => {}}
        onKept={async () => {}}
        mentions={["coder"]}
        addressing={() => ({ blocked: null, rows: [row], send: async () => {} })}
      />,
    );
    fireEvent.change(screen.getByTestId("composer-input"), { target: { value: "@coder first line" } });
    fireEvent.click(screen.getByTestId("composer-send"));
    await waitFor(() => expect(screen.getByTestId("composer-status").getAttribute("data-state")).toBe("delivered"));
    fireEvent.click(screen.getByTestId("composer-mention"));
    expect((screen.getByTestId("composer-input") as HTMLInputElement).value).toBe("@coder ");
    expect(screen.getByTestId("composer-status").getAttribute("data-state")).toBe("idle");
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

describe("Chief of Staff (FIX-1722)", () => {
  const setURL = (url: string) => (window as unknown as { happyDOM: { setURL(url: string): void } }).happyDOM.setURL(url);

  /** A Lab with `asks` asks pending, opened at `path`. */
  async function openCos(path: string, options: Parameters<typeof openAskLab>[0] = {}, asks = 0) {
    const lab = await serveLab((await openAskLab(options)).flowState);
    served.push(lab);
    const clients = createLabClients({ baseUrl: lab.baseUrl, userId: ASK_LAB_USER_ID });
    for (let i = 0; i < asks; i += 1) {
      await clients.actions("ops.asker").sendAction("ask", { what: `ship part ${i}` }, { sessionId: `s_ops_asker_${i}` });
    }
    setURL(`${lab.baseUrl}${path}`);
    render(<App clients={createLabClients({ userId: ASK_LAB_USER_ID })} />);
    await screen.findByTestId("cos");
    return { lab, clients };
  }

  /** The asks the store still holds pending, read through the Lab's routes. */
  async function pendingInStore(clients: ReturnType<typeof createLabClients>, count: number): Promise<number> {
    let pending = 0;
    for (let i = 0; i < count; i += 1) {
      const state = await clients.sessions.getSessionState(`s_ops_asker_${i}`, { includeItems: true, itemTypes: ["suspension", "suspension_resume"] });
      const items = (state.items ?? []) as Array<{ type: string; suspensionId?: string }>;
      const resumed = new Set(items.filter((it) => it.type === "suspension_resume").map((it) => it.suspensionId));
      pending += items.filter((it) => it.type === "suspension" && !resumed.has(it.suspensionId)).length;
    }
    return pending;
  }

  it("is where Shift Manager lands, at / and at a path it doesn't know, first in the sidebar and current (BR-1, BR-2)", async () => {
    await openCos("/");
    const nav = within(screen.getByTestId("sidebar"));
    const entries = nav.getAllByRole("button").map((b) => b.getAttribute("data-testid")).filter((id) => id?.startsWith("nav-"));
    expect(entries.slice(0, 3)).toEqual(["nav-cos", "nav-inbox", "nav-tasks"]);
    expect(screen.getByTestId("nav-cos").getAttribute("aria-current")).toBe("page");
    expect(screen.getByTestId("nav-inbox").getAttribute("aria-current")).toBeNull();
    expect(screen.queryByTestId("nav-cos-count")).toBeNull();
    expect(screen.getByTestId("centre").getAttribute("data-level")).toBe("cos");
    cleanup();
    setURL(`${served[0]!.baseUrl}/no/such/place`);
    render(<App clients={createLabClients({ userId: ASK_LAB_USER_ID })} />);
    await screen.findByTestId("cos");
  });

  it("Jump to finds it and opens it (BR-2)", async () => {
    await openCos("/");
    act(() => fireEvent.click(screen.getByTestId("nav-tasks")));
    act(() => fireEvent.click(screen.getByTestId("jump-to")));
    act(() => fireEvent.change(screen.getByTestId("jump-input"), { target: { value: "chief" } }));
    const [result, ...rest] = await screen.findAllByTestId("jump-result");
    expect(rest).toEqual([]);
    act(() => fireEvent.click(result!));
    await screen.findByTestId("cos");
    expect(window.location.pathname).toBe("/cos");
  });

  it("summarises what Inbox lists, and an ask answered there leaves the summary and Inbox together (BR-4 to BR-6)", async () => {
    const { clients } = await openCos("/cos", {}, 2);
    await waitFor(() => expect(screen.getByTestId("cos-needs-you").textContent).toBe("2"));
    expect(screen.getByTestId("nav-inbox-count").textContent).toBe("2");
    expect(screen.getAllByTestId("cos-ask")).toHaveLength(2);
    expect(screen.getByTestId("cos-summary").textContent).toMatch(/FROM SHIFT MANAGER/);
    expect(screen.getByTestId("cos-summary-running").textContent).toBe("0 runs going across 0 workstreams.");

    const first = screen.getAllByTestId("cos-ask")[0]!;
    act(() => fireEvent.click(within(first).getByRole("button", { name: "Approve" })));
    await waitFor(() => expect(screen.getAllByTestId("cos-ask")).toHaveLength(1), { timeout: 5_000 });
    expect(screen.getByTestId("cos-needs-you").textContent).toBe("1");
    expect(await pendingInStore(clients, 2)).toBe(1);
    act(() => fireEvent.click(screen.getByTestId("nav-inbox")));
    expect(await screen.findAllByTestId("inbox-item")).toHaveLength(1);
  });

  it("says nothing needs the person when nothing does, with the running counts still there (BR-7)", async () => {
    await openCos("/cos");
    expect((await screen.findByTestId("cos-summary-asks")).textContent).toBe("Nothing needs you.");
    expect(screen.getByTestId("cos-summary-running")).toBeTruthy();
  });

  it("draws each workstream's running rows and its members' asks in the rail, and the workers on call (BR-19)", async () => {
    await openCos("/cos", {}, 1);
    await waitFor(() => expect(screen.getByTestId("cos-needs-you").textContent).toBe("1"));
    const streams = screen.getAllByTestId("cos-stream").map((el) => [
      el.getAttribute("data-channel-id"),
      within(el).getByTestId("cos-stream-running").textContent,
      within(el).getByTestId("cos-stream-needs-you").textContent,
    ]);
    // ops.asker sits in both channels; ops.helper only in the desk.
    expect(streams).toEqual([
      ["ops.desk", "0", "1"],
      ["ops.side", "0", "1"],
    ]);
    // ops.asker's pending ask puts it on call, by the rule Roster uses.
    expect(screen.getAllByTestId("cos-on-call").map((el) => el.getAttribute("data-seat-id"))).toEqual(["ops.asker"]);
  });

  it("names the missing seat in place of the conversation, with the summary still drawn (BR-11)", async () => {
    await openCos("/");
    expect((await screen.findByTestId("cos-none")).textContent).toContain(GAPS.chiefOfStaff.none.title);
    expect(screen.getByTestId("cos-summary")).toBeTruthy();
    expect(screen.queryByTestId("cos-composer")).toBeNull();
  });

  it("opens the conversation with the first line, shows delivered once the session holds it, and draws the seat's stored reply (BR-14 to BR-17)", async () => {
    const { clients } = await openCos("/", { chiefOfStaff: true });
    const conversation = await screen.findByTestId("cos-conversation");
    expect(conversation.getAttribute("data-seat-id")).toBe("ops.chief-of-staff");
    expect(screen.getByTestId("cos-conversation-empty")).toBeTruthy();

    // Hold the door's request open: nothing may read delivered, or draw a reply, while it is.
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    const real = globalThis.fetch;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (i, init) => {
      if (String(i instanceof Request ? i.url : i).includes("/status")) await held;
      return real(i, init);
    });
    const input = screen.getByTestId("cos-composer-input") as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "what is running" } });
    fireEvent.click(screen.getByTestId("cos-composer-send"));
    await screen.findByTestId("cos-working");
    expect(screen.getByTestId("cos-composer-status").getAttribute("data-state")).toBe("sending");
    expect((screen.getByTestId("cos-composer-send") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryAllByTestId("cos-item")).toEqual([]);
    release();
    await waitFor(() => expect(screen.getByTestId("cos-composer-status").getAttribute("data-state")).toBe("delivered"), { timeout: 5_000 });
    vi.restoreAllMocks();

    // The session the door opened is the seat's, and holds the line and the reply drawn.
    const sessionId = screen.getByTestId("cos-conversation").getAttribute("data-session-id")!;
    expect((await clients.sessions.getSession(sessionId)).flowId).toBe("ops.chief-of-staff");
    const state = await clients.sessions.getSessionState(sessionId, { includeItems: true, itemTypes: ["message"] });
    const stored = (state.items ?? []) as Array<{ id: string; role?: string; content?: unknown }>;
    const reply = stored.find((item) => item.role === "assistant");
    expect(JSON.stringify(stored.find((item) => item.role === "user"))).toContain("what is running");
    expect(JSON.stringify(reply)).toContain(heardLine("what is running"));
    await waitFor(() => expect(screen.getAllByTestId("cos-item").some((el) => el.getAttribute("data-item-id") === reply!.id)).toBe(true));

    // Back later: the same conversation.
    cleanup();
    setURL(`${served[0]!.baseUrl}/cos`);
    render(<App clients={createLabClients({ userId: ASK_LAB_USER_ID })} />);
    await waitFor(() => expect(screen.getByTestId("cos-conversation").getAttribute("data-session-id")).toBe(sessionId));
    await waitFor(() => expect(screen.getAllByTestId("cos-item").map((el) => el.getAttribute("data-item-id"))).toContain(reply!.id));
  });

  it("keeps the draft and shows the seat's reason when its door refuses (BR-15)", async () => {
    await openCos("/", { chiefOfStaff: true });
    const input = (await screen.findByTestId("cos-composer-input")) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: ASKER_REFUSED_LINE } });
    fireEvent.click(screen.getByTestId("cos-composer-send"));
    expect((await screen.findByTestId("cos-composer-error", {}, { timeout: 5_000 })).textContent).toBe("This seat won't take that line.");
    expect(input.value).toBe(ASKER_REFUSED_LINE);
  });

  it("keeps a refused first line's conversation, so the next line goes into the same session (BR-15)", async () => {
    const { clients } = await openCos("/", { chiefOfStaff: true });
    const input = (await screen.findByTestId("cos-composer-input")) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: ASKER_REFUSED_LINE } });
    fireEvent.click(screen.getByTestId("cos-composer-send"));
    await screen.findByTestId("cos-composer-error", {}, { timeout: 5_000 });
    // The door took the line before it refused it: the session exists and holds it.
    await waitFor(() => expect(screen.getByTestId("cos-conversation").getAttribute("data-session-id")).not.toBe(""));
    const first = screen.getByTestId("cos-conversation").getAttribute("data-session-id")!;
    await waitFor(() => expect(screen.getAllByTestId("cos-item").some((el) => el.getAttribute("data-role") === "user")).toBe(true));
    fireEvent.change(input, { target: { value: "second line" } });
    fireEvent.click(screen.getByTestId("cos-composer-send"));
    await waitFor(() => expect(screen.getByTestId("cos-composer-status").getAttribute("data-state")).toBe("delivered"), { timeout: 5_000 });
    expect(screen.getByTestId("cos-conversation").getAttribute("data-session-id")).toBe(first);
    const direct = (await clients.sessions.listSessions({ userId: ASK_LAB_USER_ID })).filter((s) => s.flowId === "ops.chief-of-staff" && s.parentSessionId == null);
    expect(direct.map((s) => s.id)).toEqual([first]);
  });

  it("takes no line until the conversation has been read, and Retry keeps it shut until a read succeeds", async () => {
    const lab = await serveLab((await openAskLab({ chiefOfStaff: true })).flowState);
    served.push(lab);
    const clients = createLabClients({ baseUrl: lab.baseUrl, userId: ASK_LAB_USER_ID });
    await clients.actions("ops.chief-of-staff").sendAction("message", { message: "earlier" }, { sessionId: "s_cos_earlier" });
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    let failing = false;
    const real = globalThis.fetch;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (i, init) => {
      const url = String(i instanceof Request ? i.url : i);
      // The conversation's read, not the snapshot's ask read of the same session.
      if (url.includes("/sessions/s_cos_earlier/state") && !url.includes("item_types=suspension")) {
        await held;
        if (failing) return new Response(JSON.stringify({ error: "store offline" }), { status: 503 });
      }
      return real(i, init);
    });
    setURL(`${lab.baseUrl}/cos`);
    render(<App clients={createLabClients({ userId: ASK_LAB_USER_ID })} />);
    const input = (await screen.findByTestId("cos-composer-input")) as HTMLTextAreaElement;
    expect(screen.getByTestId("cos-conversation").getAttribute("data-session-id")).toBe("s_cos_earlier");
    expect(input.disabled).toBe(true);
    failing = true;
    release();
    await screen.findByTestId("cos-conversation-failure");
    expect(input.disabled).toBe(true);
    act(() => fireEvent.click(within(screen.getByTestId("cos-conversation-failure")).getByRole("button", { name: "Retry" })));
    expect(input.disabled).toBe(true);
    failing = false;
    await waitFor(() => expect(input.disabled).toBe(false));
    expect(screen.queryByTestId("cos-conversation-failure")).toBeNull();
  });

  it("draws an answered ask in the conversation as answered, not as waiting on the person", async () => {
    const lab = await serveLab((await openAskLab({ chiefOfStaff: true })).flowState);
    served.push(lab);
    const clients = createLabClients({ baseUrl: lab.baseUrl, userId: ASK_LAB_USER_ID });
    await clients.actions("ops.chief-of-staff").sendAction("ask", { what: "ship it" }, { sessionId: "s_cos_asked" });
    let suspension: { requestId: string; suspensionId: string } | undefined;
    await waitFor(async () => {
      const state = await clients.sessions.getSessionState("s_cos_asked", { includeItems: true, itemTypes: ["suspension"] });
      suspension = (state.items ?? [])[0] as typeof suspension;
      expect(suspension).toBeDefined();
    });
    await clients.recovery.resumeSuspension("ops.chief-of-staff", suspension!.requestId, {
      suspensionId: suspension!.suspensionId,
      action: "approve",
      resumedBy: ASK_LAB_USER_ID,
    });
    await waitFor(async () => {
      const state = await clients.sessions.getSessionState("s_cos_asked", { includeItems: true, itemTypes: ["suspension_resume"] });
      expect(state.items ?? []).toHaveLength(1);
    });
    setURL(`${lab.baseUrl}/cos`);
    render(<App clients={createLabClients({ userId: ASK_LAB_USER_ID })} />);
    const conversation = await screen.findByTestId("cos-conversation");
    await waitFor(() => expect(within(conversation).getAllByTestId("cos-item").some((el) => el.getAttribute("data-item-type") === "suspension")).toBe(true));
    expect(conversation.textContent).not.toMatch(/Waiting on you/);
  });

  it("says what the Lab answered, with Retry, for a workstream whose boards or asks didn't load (BR-8)", async () => {
    const lab = await serveLab((await openAskLab()).flowState);
    served.push(lab);
    // A seat session, so there are asks to read.
    await createLabClients({ baseUrl: lab.baseUrl, userId: ASK_LAB_USER_ID }).actions("ops.asker").sendAction("ask", { what: "ship it" }, { sessionId: "s_ops_asker" });
    const real = globalThis.fetch;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (i, init) => {
      const url = String(i instanceof Request ? i.url : i);
      if (url.includes("/sessions/ops.desk/resources/ops.desk.") || url.includes("item_types=suspension")) {
        return new Response(JSON.stringify({ error: "store offline" }), { status: 503 });
      }
      return real(i, init);
    });
    setURL(`${lab.baseUrl}/cos`);
    render(<App clients={createLabClients({ userId: ASK_LAB_USER_ID })} />);
    const desk = await screen.findByTestId("cos-stream-failure");
    expect(desk.textContent).toMatch(/ops\.desk/);
    expect(desk.textContent).toMatch(/store offline.*503/);
    expect(within(desk).getByRole("button", { name: "Retry" })).toBeTruthy();
    const asks = screen.getByTestId("cos-streams-asks-failure");
    expect(asks.textContent).toMatch(/store offline/);
    expect(within(asks).getByRole("button", { name: "Retry" })).toBeTruthy();
  });

  it("disables the composer for a seat that takes no message (BR-13)", async () => {
    await openCos("/", { chiefOfStaff: true, doors: false });
    const input = (await screen.findByTestId("cos-composer-input")) as HTMLTextAreaElement;
    expect(input.disabled).toBe(true);
    expect(screen.getByTestId("cos-composer-blocked").textContent).toBe(`ops.chief-of-staff ${GAPS.turn.noDoor}`);
  });
});

describe("Jump to from the keyboard", () => {
  it("arrow keys move the highlight through the results, and Enter goes to the highlighted one", async () => {
    await openApp("/inbox");
    const jump = await screen.findByTestId("jump-to");
    act(() => fireEvent.click(jump));
    const input = screen.getByTestId("jump-input");
    const results = await screen.findAllByTestId("jump-result");
    expect(results.length).toBeGreaterThan(2);
    const active = () => screen.getAllByTestId("jump-result").findIndex((r) => r.getAttribute("aria-selected") === "true");
    expect(active()).toBe(0);

    act(() => fireEvent.keyDown(input, { key: "ArrowDown" }));
    act(() => fireEvent.keyDown(input, { key: "ArrowDown" }));
    expect(active()).toBe(2);
    act(() => fireEvent.keyDown(input, { key: "ArrowUp" }));
    expect(active()).toBe(1);
    // The ends hold: Up from the first stays on the first, Down from the last stays on the last.
    act(() => fireEvent.keyDown(input, { key: "ArrowUp" }));
    act(() => fireEvent.keyDown(input, { key: "ArrowUp" }));
    expect(active()).toBe(0);
    for (let i = 0; i < results.length + 2; i++) act(() => fireEvent.keyDown(input, { key: "ArrowDown" }));
    expect(active()).toBe(results.length - 1);

    // Typing starts the highlight over on the first match.
    act(() => fireEvent.change(input, { target: { value: "o" } }));
    expect(active()).toBe(0);
    act(() => fireEvent.change(input, { target: { value: "" } }));

    // Enter opens the highlighted result, not the first one: the ask Lab's
    // first three results are Chief of Staff, then its workstreams, ops.desk
    // then ops.side.
    act(() => fireEvent.keyDown(input, { key: "ArrowDown" }));
    act(() => fireEvent.keyDown(input, { key: "ArrowDown" }));
    expect(screen.getAllByTestId("jump-result")[2]!.textContent).toMatch(/^ops\.side/);
    act(() => fireEvent.keyDown(input, { key: "Enter" }));
    expect(screen.queryByTestId("jump-dialog")).toBeNull();
    expect(window.location.pathname).toBe("/w/ops.side/stream");
  });

  it("the pointer highlights the result it is over", async () => {
    await openApp("/inbox");
    const jump = await screen.findByTestId("jump-to");
    act(() => fireEvent.click(jump));
    const results = await screen.findAllByTestId("jump-result");
    act(() => fireEvent.mouseMove(results[2]!));
    expect(results.map((r) => r.getAttribute("aria-selected"))).toEqual(results.map((_, i) => String(i === 2)));
  });
});
