// @vitest-environment happy-dom
/**
 * The shell against a real Lab, in a DOM (V2, V3's second path, V6; BR-14,
 * BR-28). What the screen draws is compared with what the Lab's routes hold.
 */
import type { Client } from "@flow-state-dev/client";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_ORG_ID } from "@flow-state-dev/core";
import { App } from "../src/App";
import { GAPS } from "../src/gaps";
import { bootTheme } from "../src/lib/theme";
import { connect } from "../src/lib/connection";
import { ASKER_GATED_LINE, ASKER_FLOW, ASKER_REFUSED_LINE, ASKER_SLOW_LINE, heardLine, holdSlowLines, startProjectLine } from "./fixtures/ask-lab/asker.mts";
import { ASK_LAB_USER_ID, openAskLab } from "./fixtures/ask-lab/lab.mts";
import { serveLab, type ServedLab } from "./helpers/serve-lab";
import { deriveWorkerSessionId } from "@flow-state-dev/workforce/browser";

/** The user's conversation with the Shift Coordinator: the session at its derived address, the one the view shows. */
const SHIFT_COORDINATOR_CONVERSATION = await deriveWorkerSessionId({
  userId: ASK_LAB_USER_ID,
  orgId: DEFAULT_ORG_ID,
  flow: ASKER_FLOW,
  criteria: { worker: "ops.shift-coordinator" },
});

/**
 * Run a worker's action as a user would: in a session of the asker flow's one
 * copy, opened naming the worker's worker first.
 */
async function workerAction(
  client: Client,
  workerId: string,
  action: string,
  input: unknown,
  sessionId: string,
) {
  await client
    .flow(ASKER_FLOW)
    .createSession({ sessionId, state: { workerId: workerId } })
    .catch((error: unknown) => {
      if ((error as { status?: number }).status !== 409) throw error;
    });
  return client.flow(ASKER_FLOW).send(action, input, { sessionId });
}

const served: ServedLab[] = [];
// A wide window: the right panel is drawn beside the centre only from 1180px.
beforeEach(() => (window as unknown as { happyDOM: { setViewport(viewport: { width: number; height: number }): void } }).happyDOM.setViewport({ width: 1600, height: 900 }));
// Every request a test's page makes, so the test can let them land before
// its Lab closes: a read the sidebar started can still be in flight after
// unmount, and would otherwise be counted by the next test's spy.
const inFlight = new Set<Promise<unknown>>();
const realFetch = globalThis.fetch;
beforeEach(() => {
  globalThis.fetch = (input, init) => {
    const request = realFetch(input, init);
    const settled = request.catch(() => {}).finally(() => inFlight.delete(settled));
    inFlight.add(settled);
    return request;
  };
});
afterEach(async () => {
  cleanup();
  // Settled for two ticks running: a chained read starts its next request only after the last one lands.
  for (let quiet = 0; quiet < 2; ) {
    await Promise.all(inFlight);
    await new Promise((r) => setTimeout(r, 0));
    quiet = inFlight.size === 0 ? quiet + 1 : 0;
  }
  vi.restoreAllMocks();
  globalThis.fetch = realFetch;
  await Promise.all(served.splice(0).map((lab) => lab.handle.close()));
});

async function openApp(path: string, options: Parameters<typeof openAskLab>[0] = {}, bearerToken?: string) {
  const lab = await serveLab((await openAskLab(options)).flowState);
  served.push(lab);
  // The page is served from the Lab's own origin, as the `shift-manager` command serves it.
  (window as unknown as { happyDOM: { setURL(url: string): void } }).happyDOM.setURL(`${lab.baseUrl}${path}`);
  const connection = { userId: ASK_LAB_USER_ID, ...(bearerToken === undefined ? {} : { bearerToken }) };
  const client = connect(connection);
  render(<App connection={connection} />);
  return { lab, client };
}

describe("the sidebar's mark", () => {
  it("is the one theme control: it shows the theme the page is in, and each click moves to the next", async () => {
    const lab = await serveLab((await openAskLab()).flowState);
    served.push(lab);
    (window as unknown as { happyDOM: { setURL(url: string): void } }).happyDOM.setURL(`${lab.baseUrl}/inbox`);
    // Storage that keeps nothing and a clock at 21:00: the page opens on Night.
    const look = bootTheme(undefined, { localStorage: { getItem: () => null, setItem: () => {} } } as unknown as Window, document.documentElement, () => new Date(2026, 9, 6, 21, 0));
    try {
      render(<App connection={{ userId: ASK_LAB_USER_ID }} look={look} />);
      const mark = await screen.findByTestId("theme-mark");
      // The sidebar can commit before its passive effects run, and the mark
      // subscribes to the look in one. Flush them, so the first click can't
      // land before the mark is listening.
      await act(async () => {});
      expect(screen.queryByTestId("shift-switch")).toBeNull();
      expect(document.documentElement.dataset.theme).toBe("night");
      expect(document.documentElement.classList.contains("dark")).toBe(true);
      expect(mark.getAttribute("title")).toBe("Theme: Night. Click for Day.");
      expect(screen.getByTestId("sidebar-theme-name").textContent).toMatch(/Night shift$/);

      act(() => fireEvent.click(mark));
      expect(document.documentElement.dataset.theme).toBe("day");
      expect(document.documentElement.classList.contains("dark")).toBe(false);
      expect(screen.getByTestId("sidebar-theme-name").textContent).toMatch(/Day shift$/);

      act(() => fireEvent.click(mark));
      expect(document.documentElement.dataset.theme).toBe("evening");
      expect(document.documentElement.classList.contains("dark")).toBe(false);
      expect(mark.getAttribute("data-theme")).toBe("evening");
      expect(screen.getByTestId("sidebar-theme-name").textContent).toMatch(/Evening shift$/);
    } finally {
      look.stop();
      document.documentElement.classList.remove("dark", "theme-fade");
      delete document.documentElement.dataset.theme;
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

  it("a Lab that names no organization for the user gets the refusal, never an unknown one", async () => {
    // A Lab that holds no session of theirs and serves no roster flow to open one on.
    const real = globalThis.fetch;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) =>
      /\/api\/flows\/workforce-roster\/sessions$/.test(String(input instanceof Request ? input.url : input))
        ? new Response(JSON.stringify({ error: "no flow" }), { status: 404 })
        : real(input, init),
    );
    await openApp("/inbox", { conversations: false });
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
  it("fails TEAMS by name with Retry, and the rest, PROJECTS included, still renders", async () => {
    await openApp("/inbox", { inventory: false });
    const teams = await screen.findByTestId("teams-failure");
    expect(teams.textContent).toMatch(/without opening its inventory/);
    expect(within(teams).getByRole("button", { name: "Retry" })).toBeTruthy();
    // Projects are read on their own: an unread inventory leaves PROJECTS whole.
    expect(screen.queryByTestId("projects-failure")).toBeNull();
    expect(screen.getByTestId("nav-tasks")).toBeTruthy();
    expect(screen.getByTestId("jump-tip").textContent).toMatch(/⌘K/);
    expect(screen.queryByTestId("jump-to")).toBeNull();
  });

  it("a Lab whose flows declare no inventory shows no organization selector", async () => {
    await openApp("/inbox", { inventoryDeclared: false });
    expect((await screen.findByTestId("teams-failure")).textContent).toMatch(/without opening its inventory/);
    expect(screen.queryByTestId("org-switcher")).toBeNull();
    expect(document.body.textContent).not.toMatch(/Unknown organization/);
  });
});

describe("empty states (BR-14, BR-28)", () => {
  it("Inbox and Tasks with nothing say so in a sentence", async () => {
    await openApp("/inbox");
    // v2's sentence, with what is still going: nothing runs in this Lab.
    expect((await screen.findByTestId("inbox-empty")).textContent).toBe("Nothing needs you. 0 sessions are still running.");
    act(() => fireEvent.click(screen.getByTestId("nav-tasks")));
    expect((await screen.findByTestId("tasks-empty")).textContent).toMatch(/No attached board holds a row/);
  });
});

describe("Inbox's reply (V6; BR-4, BR-5, BR-21, BR-22)", () => {
  /** An ask in the asker's session, then Inbox open on it. */
  async function openOnAsk(options: Parameters<typeof openAskLab>[0] = {}, beforeRender?: () => void) {
    const lab = await serveLab((await openAskLab(options)).flowState);
    served.push(lab);
    const client = connect({ baseUrl: lab.baseUrl, userId: ASK_LAB_USER_ID });
    await workerAction(client, "ops.asker", "ask", { what: "ship it" }, "s_ops_asker");
    (window as unknown as { happyDOM: { setURL(url: string): void } }).happyDOM.setURL(`${lab.baseUrl}/inbox`);
    beforeRender?.();
    render(<App connection={{ userId: ASK_LAB_USER_ID }} />);
    const item = await screen.findByTestId("inbox-item");
    act(() => fireEvent.click(item));
    await screen.findByTestId("inbox-reply");
    return { client };
  }

  /** The user lines a session holds. */
  async function userLines(client: Client, sessionId: string): Promise<string> {
    const state = await client.sessions.state(sessionId, { includeItems: true, itemTypes: ["message"] });
    return JSON.stringify((state.items ?? []).filter((item) => (item as { role?: string }).role === "user"));
  }

  it("shows delivered only once the worker's session holds the line, through its door", async () => {
    const { client } = await openOnAsk();
    // The asker asks before doing anything, so its session holds no tool call before the ask.
    expect((await screen.findByTestId("inbox-from-session-none")).textContent).toBe("No tool call before this ask.");
    expect(screen.queryAllByTestId("inbox-reply-line")).toHaveLength(0);
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
    expect(await userLines(client, "s_ops_asker")).toContain("a reply line");
    // Read back from the session, the line is drawn under the ask as the user's reply.
    await waitFor(() => expect(screen.getAllByTestId("inbox-reply-line-text").map((el) => el.textContent)).toEqual(["a reply line"]));
    expect(screen.getByTestId("inbox-reply-line-label").textContent).toMatch(/^You · \d\d:\d\d · sent into s_ops_asker$/);
    // The ask is untouched: a reply isn't an answer.
    expect(screen.getByTestId("inbox-detail").textContent).toMatch(/Approve/);
  });

  // FIX-1773: the same for a worker that isn't the coordinator.
  it("clears a reply into the conversation under the ask as soon as the worker's session holds it, before the worker answers", async () => {
    const { client } = await openOnAsk();
    const input = screen.getByTestId("inbox-reply-input") as HTMLInputElement;
    expect(input.getAttribute("aria-label")).toBe("Reply to ops.asker");
    const release = holdSlowLines();
    try {
      fireEvent.change(input, { target: { value: ASKER_SLOW_LINE } });
      fireEvent.click(screen.getByTestId("inbox-reply-send"));
      await waitFor(() => expect(input.value).toBe(""), { timeout: 5_000 });
      await waitFor(() => expect(screen.getAllByTestId("inbox-reply-line-text").map((el) => el.textContent)).toEqual([ASKER_SLOW_LINE]), { timeout: 5_000 });
      expect(screen.getByTestId("inbox-reply-status").getAttribute("data-state")).toBe("held");
      // The worker hasn't answered: its session holds no reply yet.
      const state = await client.sessions.state("s_ops_asker", { includeItems: true, itemTypes: ["message"] });
      expect(JSON.stringify(state.items ?? [])).not.toContain(heardLine(ASKER_SLOW_LINE));
    } finally {
      release();
    }
    await waitFor(() => expect(screen.getByTestId("inbox-reply-status").getAttribute("data-state")).toBe("delivered"), { timeout: 5_000 });
  });

  it("says so when the ask's session holds more than one read returns, rather than dropping later replies unseen", async () => {
    // Every page of the session read says more remain, so the read stops at its cap.
    await openOnAsk({}, () => {
      const real = globalThis.fetch;
      vi.spyOn(globalThis, "fetch").mockImplementation(async (i, init) => {
        const url = String(i instanceof Request ? i.url : i);
        const response = await real(i, init);
        // Only the whole-session read Inbox's detail makes; the asks read filters by item type.
        if (!url.includes("/sessions/s_ops_asker/state") || url.includes("item_types")) return response;
        const body = (await response.json()) as { pagination?: Record<string, unknown> };
        return Response.json({ ...body, pagination: { ...body.pagination, hasMore: true, nextOffset: 200 } });
      });
    });
    expect((await screen.findByTestId("inbox-session-truncated")).textContent).toMatch(/^More than shown/);
  });

  it("draws no truncation note when the session's read is whole", async () => {
    await openOnAsk();
    await screen.findByTestId("inbox-from-session-none");
    expect(screen.queryByTestId("inbox-session-truncated")).toBeNull();
  });

  it("keeps the draft and shows the worker's own reason when its door refuses", async () => {
    await openOnAsk();
    const input = screen.getByTestId("inbox-reply-input") as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: ASKER_REFUSED_LINE } });
    fireEvent.click(screen.getByTestId("inbox-reply-send"));
    expect((await screen.findByTestId("inbox-reply-error", {}, { timeout: 5_000 })).textContent).toBe("This worker won't take that line.");
    expect(screen.getByTestId("inbox-reply-status").getAttribute("data-state")).toBe("refused");
    expect(input.value).toBe(ASKER_REFUSED_LINE);
    expect(screen.queryByTestId("inbox-reply-retry")).toBeNull();
  });

  it("says not sent, with Retry, when the line never reached the Lab", async () => {
    const { client } = await openOnAsk();
    const input = screen.getByTestId("inbox-reply-input") as HTMLTextAreaElement;
    const real = globalThis.fetch;
    let down = true;
    vi.spyOn(globalThis, "fetch").mockImplementation((i, init) =>
      down && String(i instanceof Request ? i.url : i).includes("/actions/respond")
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
    expect(await userLines(client, "s_ops_asker")).toContain("try again");
  });

  it("keeps the draft and offers no Retry when it can't confirm the line arrived", async () => {
    const { client } = await openOnAsk();
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
    expect(await userLines(client, "s_ops_asker")).toContain("did it land");
  });

  it("is disabled for a worker whose worker flow has no door, and Approve still answers (BR-22)", async () => {
    await openOnAsk({ doors: false });
    expect((screen.getByTestId("inbox-reply-input") as HTMLTextAreaElement).disabled).toBe(true);
    expect(screen.getByTestId("inbox-reply-blocked").textContent).toBe(`ops.asker ${GAPS.turn.replyNoDoor}`);
    const approve = within(screen.getByTestId("inbox-detail")).getByRole("button", { name: "Approve" });
    expect((approve as HTMLButtonElement).disabled).toBe(false);
  });
});

describe("a titled ask in Inbox", () => {
  it("is headed by its short title, with its message drawn as markdown body text under it", async () => {
    const lab = await serveLab((await openAskLab()).flowState);
    served.push(lab);
    (window as unknown as { happyDOM: { setURL(url: string): void } }).happyDOM.setURL(`${lab.baseUrl}/inbox`);
    const client = connect({ baseUrl: lab.baseUrl, userId: ASK_LAB_USER_ID });
    const detail = "Seen 2 times. File it?\n\n**Questions**\n\n- Should `runAction` retry?\n- Which team owns it?";
    await workerAction(client, "ops.asker", "ask", { what: "ship it", detail }, "s_ops_asker");
    render(<App connection={{ userId: ASK_LAB_USER_ID }} />);

    const item = await screen.findByTestId("inbox-item");
    expect(within(item).getByTestId("inbox-item-question").textContent).toBe("Approve: ship it");
    act(() => fireEvent.click(item));

    expect((await screen.findByTestId("inbox-detail-title")).textContent).toBe("Approve: ship it");
    const body = screen.getByTestId("inbox-detail-body");
    expect([...body.querySelectorAll("li")].map((li) => li.textContent)).toEqual(["Should runAction retry?", "Which team owns it?"]);
    expect(body.querySelector("code")?.textContent).toBe("runAction");
    expect(body.textContent).not.toContain("**");
    // The card under it still answers the ask.
    expect(within(screen.getByTestId("inbox-detail")).getByRole("button", { name: "Approve" })).toBeTruthy();
  });

  it("an ask with no title is headed by its message, with no body under it", async () => {
    const lab = await serveLab((await openAskLab()).flowState);
    served.push(lab);
    (window as unknown as { happyDOM: { setURL(url: string): void } }).happyDOM.setURL(`${lab.baseUrl}/inbox`);
    const client = connect({ baseUrl: lab.baseUrl, userId: ASK_LAB_USER_ID });
    await workerAction(client, "ops.asker", "ask", { what: "ship it" }, "s_ops_asker");
    render(<App connection={{ userId: ASK_LAB_USER_ID }} />);
    const item = await screen.findByTestId("inbox-item");
    act(() => fireEvent.click(item));
    expect((await screen.findByTestId("inbox-detail-title")).textContent).toBe("Approve: ship it");
    expect(screen.queryByTestId("inbox-detail-body")).toBeNull();
  });
});

describe("Jump to a declared document (BR-10)", () => {
  it("finds the Lab's document by name and opens it read-only, with the file's body", async () => {
    const lab = await serveLab((await openAskLab()).flowState);
    served.push(lab);
    const client = connect({ baseUrl: lab.baseUrl, userId: ASK_LAB_USER_ID });
    // A worker session, before the page boots, makes a flow that serves the document listable.
    await workerAction(client, "ops.asker", "ask", { what: "ship it" }, "s_ops_asker");
    (window as unknown as { happyDOM: { setURL(url: string): void } }).happyDOM.setURL(`${lab.baseUrl}/inbox`);
    render(<App connection={{ userId: ASK_LAB_USER_ID }} />);

    await screen.findByTestId("jump-tip");
    act(() => void fireEvent.keyDown(document.body, { key: "k", metaKey: true }));
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

describe("Shift Coordinator (FIX-1722)", () => {
  const setURL = (url: string) => (window as unknown as { happyDOM: { setURL(url: string): void } }).happyDOM.setURL(url);

  /** A Lab with `asks` asks pending, opened at `path`. */
  async function openShiftCoordinator(path: string, options: Parameters<typeof openAskLab>[0] = {}, asks = 0) {
    const lab = await serveLab((await openAskLab(options)).flowState);
    served.push(lab);
    const client = connect({ baseUrl: lab.baseUrl, userId: ASK_LAB_USER_ID });
    for (let i = 0; i < asks; i += 1) {
      await workerAction(client, "ops.asker", "ask", { what: `ship part ${i}` }, `s_ops_asker_${i}`);
    }
    setURL(`${lab.baseUrl}${path}`);
    render(<App connection={{ userId: ASK_LAB_USER_ID }} />);
    await screen.findByTestId("shift-coordinator");
    return { lab, client };
  }

  /** The asks the store still holds pending, read through the Lab's routes. */
  async function pendingInStore(client: Client, count: number): Promise<number> {
    let pending = 0;
    for (let i = 0; i < count; i += 1) {
      const state = await client.sessions.state(`s_ops_asker_${i}`, { includeItems: true, itemTypes: ["suspension", "suspension_resume"] });
      const items = (state.items ?? []) as Array<{ type: string; suspensionId?: string }>;
      const resumed = new Set(items.filter((it) => it.type === "suspension_resume").map((it) => it.suspensionId));
      pending += items.filter((it) => it.type === "suspension" && !resumed.has(it.suspensionId)).length;
    }
    return pending;
  }

  it("is where Shift Manager lands, at / and at a path it doesn't know, first in the sidebar and current (BR-1, BR-2)", async () => {
    await openShiftCoordinator("/");
    const nav = within(screen.getByTestId("sidebar"));
    const entries = nav.getAllByRole("button").map((b) => b.getAttribute("data-testid")).filter((id) => id?.startsWith("nav-"));
    expect(entries.slice(0, 3)).toEqual(["nav-shift-coordinator", "nav-inbox", "nav-tasks"]);
    expect(screen.getByTestId("nav-shift-coordinator").getAttribute("aria-current")).toBe("page");
    expect(screen.getByTestId("nav-inbox").getAttribute("aria-current")).toBeNull();
    expect(screen.queryByTestId("nav-shift-coordinator-count")).toBeNull();
    expect(screen.getByTestId("centre").getAttribute("data-level")).toBe("shift-coordinator");
    // Shift Manager names the view Shift Coordinator; the worker keeps its id (FIX-1747).
    // The entry's label and the screen's title carry the name; v2's square beside each carries initials.
    expect(screen.getByTestId("nav-shift-coordinator").querySelector("[data-look=nav-label]")!.textContent).toBe("Shift Coordinator");
    expect(within(screen.getByTestId("shift-coordinator-header")).getByText("Shift Coordinator")).toBeTruthy();
    expect(screen.getByTestId("sidebar").textContent).not.toMatch(/Shift Coordinator/i);
    expect(screen.getByTestId("shift-coordinator").textContent).not.toMatch(/Shift Coordinator/i);
    cleanup();
    setURL(`${served[0]!.baseUrl}/no/such/place`);
    render(<App connection={{ userId: ASK_LAB_USER_ID }} />);
    await screen.findByTestId("shift-coordinator");
  });

  it("Jump to finds it and opens it (BR-2)", async () => {
    await openShiftCoordinator("/");
    act(() => fireEvent.click(screen.getByTestId("nav-tasks")));
    act(() => void fireEvent.keyDown(document.body, { key: "k", metaKey: true }));
    act(() => fireEvent.change(screen.getByTestId("jump-input"), { target: { value: "coordinator" } }));
    const [result, ...rest] = await screen.findAllByTestId("jump-result");
    expect(rest).toEqual([]);
    expect(result!.textContent).toMatch(/^Shift Coordinator/);
    act(() => fireEvent.click(result!));
    await screen.findByTestId("shift-coordinator");
    expect(window.location.pathname).toBe("/shift-coordinator");
  });

  it("summarises what Inbox lists, and an ask answered there leaves the summary and Inbox together (BR-4 to BR-6)", async () => {
    const { client } = await openShiftCoordinator("/shift-coordinator", {}, 2);
    await waitFor(() => expect(screen.getByTestId("shift-coordinator-needs-you").textContent).toBe("2"));
    expect(screen.getByTestId("nav-inbox-count").textContent).toBe("2");
    expect(screen.getAllByTestId("shift-coordinator-ask")).toHaveLength(2);
    expect(screen.getByTestId("shift-coordinator-summary").textContent).toMatch(/FROM SHIFT MANAGER/);
    expect(screen.getByTestId("shift-coordinator-summary-running").textContent).toBe("0 runs going across 0 workstreams.");

    const first = screen.getAllByTestId("shift-coordinator-ask")[0]!;
    act(() => fireEvent.click(within(first).getByRole("button", { name: "Approve" })));
    await waitFor(() => expect(screen.getAllByTestId("shift-coordinator-ask")).toHaveLength(1), { timeout: 5_000 });
    expect(screen.getByTestId("shift-coordinator-needs-you").textContent).toBe("1");
    expect(await pendingInStore(client, 2)).toBe(1);
    act(() => fireEvent.click(screen.getByTestId("nav-inbox")));
    expect(await screen.findAllByTestId("inbox-item")).toHaveLength(1);
  });

  it("says nothing needs the user when nothing does, with the running counts still there (BR-7)", async () => {
    await openShiftCoordinator("/shift-coordinator");
    expect((await screen.findByTestId("shift-coordinator-summary-asks")).textContent).toBe("Nothing needs you.");
    expect(screen.getByTestId("shift-coordinator-summary-running")).toBeTruthy();
  });

  it("draws no on-call list in the rail, even with a worker waiting on the user", async () => {
    await openShiftCoordinator("/shift-coordinator", {}, 1);
    await waitFor(() => expect(screen.getByTestId("shift-coordinator-needs-you").textContent).toBe("1"));
    expect(screen.queryAllByTestId("shift-coordinator-on-call")).toHaveLength(0);
    expect(screen.getByTestId("shift-coordinator-panel").textContent).not.toMatch(/on call/i);
  });

  it("names the missing worker in place of the conversation, with the summary still drawn (BR-11)", async () => {
    await openShiftCoordinator("/");
    const none = (await screen.findByTestId("shift-coordinator-none")).textContent ?? "";
    expect(none).toContain(GAPS.shiftCoordinator.none.title);
    // Org workers have shipped: the copy names where to declare the worker today, and promises nothing.
    expect(none).toContain("org/workers/shift-coordinator/");
    expect(none).not.toMatch(/once .* ship|FIX-\d+/);
    expect(screen.getByTestId("shift-coordinator-summary")).toBeTruthy();
    expect(screen.queryByTestId("shift-coordinator-composer")).toBeNull();
  });

  it("opens the conversation with the first line, shows delivered once the session holds it, and draws the worker's stored reply (BR-14 to BR-17)", async () => {
    const { client } = await openShiftCoordinator("/", { shiftCoordinator: true });
    const conversation = await screen.findByTestId("shift-coordinator-conversation");
    expect(conversation.getAttribute("data-worker-id")).toBe("ops.shift-coordinator");
    expect(conversation.textContent).not.toMatch(/Shift Coordinator/i);
    expect(await screen.findByTestId("shift-coordinator-conversation-empty")).toBeTruthy();

    // Hold the door's request open: nothing may read delivered, or draw a reply, while it is.
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    const real = globalThis.fetch;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (i, init) => {
      if (String(i instanceof Request ? i.url : i).includes("/status")) await held;
      return real(i, init);
    });
    const input = screen.getByTestId("shift-coordinator-composer-input") as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "what is running" } });
    fireEvent.click(screen.getByTestId("shift-coordinator-composer-send"));
    await screen.findByTestId("shift-coordinator-working");
    expect(screen.getByTestId("shift-coordinator-composer-status").getAttribute("data-state")).toBe("sending");
    expect((screen.getByTestId("shift-coordinator-composer-send") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryAllByTestId("shift-coordinator-item")).toEqual([]);
    release();
    await waitFor(() => expect(screen.getByTestId("shift-coordinator-composer-status").getAttribute("data-state")).toBe("delivered"), { timeout: 5_000 });
    vi.restoreAllMocks();

    // The session the door opened is the worker's, and holds the line and the reply drawn.
    const sessionId = screen.getByTestId("shift-coordinator-conversation").getAttribute("data-session-id")!;
    const opened = await client.sessions.get(sessionId);
    expect(opened.flowId).toBe(ASKER_FLOW);
    expect(opened.state?.workerId).toBe("ops.shift-coordinator");
    const state = await client.sessions.state(sessionId, { includeItems: true, itemTypes: ["message"] });
    const stored = (state.items ?? []) as Array<{ id: string; role?: string; content?: unknown }>;
    const reply = stored.find((item) => item.role === "assistant");
    expect(JSON.stringify(stored.find((item) => item.role === "user"))).toContain("what is running");
    expect(JSON.stringify(reply)).toContain(heardLine("what is running"));
    await waitFor(() => expect(screen.getAllByTestId("shift-coordinator-item").some((el) => el.getAttribute("data-item-id") === reply!.id)).toBe(true));

    // Back later: the same conversation.
    cleanup();
    setURL(`${served[0]!.baseUrl}/shift-coordinator`);
    render(<App connection={{ userId: ASK_LAB_USER_ID }} />);
    await waitFor(() => expect(screen.getByTestId("shift-coordinator-conversation").getAttribute("data-session-id")).toBe(sessionId));
    await waitFor(() => expect(screen.getAllByTestId("shift-coordinator-item").map((el) => el.getAttribute("data-item-id"))).toContain(reply!.id));
  });

  // FIX-1773: the user follows the conversation, not the composer. A line the session holds
  // is the conversation's, so it leaves the draft and is drawn while the reply is still coming.
  it("names the coordinator on Send, clears a held line into the conversation at once, and shows it working until the reply", async () => {
    await openShiftCoordinator("/", { shiftCoordinator: true });
    const input = (await screen.findByTestId("shift-coordinator-composer-input")) as HTMLInputElement;
    // The worker's id stays shift-coordinator; what the user sees is its name.
    expect(input.getAttribute("aria-label")).toBe("Message Shift Coordinator");
    expect(input.placeholder).toBe("Message Shift Coordinator…");
    const release = holdSlowLines();
    try {
      fireEvent.change(input, { target: { value: ASKER_SLOW_LINE } });
      fireEvent.click(screen.getByTestId("shift-coordinator-composer-send"));
      // The reply is held: the line still leaves the draft and is drawn, read back from the session.
      await waitFor(() => expect(input.value).toBe(""), { timeout: 5_000 });
      await waitFor(() => expect(screen.getAllByTestId("shift-coordinator-item").map((el) => el.getAttribute("data-role"))).toEqual(["user"]), { timeout: 5_000 });
      expect(screen.getByTestId("shift-coordinator-composer-status").getAttribute("data-state")).toBe("held");
      expect(screen.getByTestId("shift-coordinator-working").textContent).toBe("Shift Coordinator is working on it…");
      expect((screen.getByTestId("shift-coordinator-composer-send") as HTMLButtonElement).disabled).toBe(true);
    } finally {
      release();
    }
    await waitFor(() => expect(screen.getByTestId("shift-coordinator-composer-status").getAttribute("data-state")).toBe("delivered"), { timeout: 5_000 });
    await waitFor(() => expect(screen.getAllByTestId("shift-coordinator-item").map((el) => el.getAttribute("data-role"))).toEqual(["user", "assistant"]));
    expect(screen.queryByTestId("shift-coordinator-working")).toBeNull();
  });

  // A finished turn raised no ask, but it may have changed the organization: a project it
  // created is listed without a reload.
  it("lists a project the Shift Coordinator's turn created, without a reload", async () => {
    await openShiftCoordinator("/", { shiftCoordinator: true, workersStartProjects: true });
    // The composer is drawn from the read snapshot, whose PROJECTS hold no project yet.
    const input = (await screen.findByTestId("shift-coordinator-composer-input")) as HTMLTextAreaElement;
    expect(screen.queryByTestId("projects-failure")).toBeNull();
    expect(screen.queryAllByTestId("project-group")).toEqual([]);
    fireEvent.change(input, { target: { value: startProjectLine("launch") } });
    fireEvent.click(screen.getByTestId("shift-coordinator-composer-send"));
    await waitFor(() => expect(screen.getByTestId("shift-coordinator-composer-status").getAttribute("data-state")).toBe("delivered"), { timeout: 5_000 });
    expect((await screen.findByTestId("nav-project-launch", undefined, { timeout: 5_000 })).textContent).toContain("Project launch");
  });

  it("keeps the draft and shows the worker's reason when its door refuses (BR-15)", async () => {
    await openShiftCoordinator("/", { shiftCoordinator: true });
    const input = (await screen.findByTestId("shift-coordinator-composer-input")) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: ASKER_REFUSED_LINE } });
    fireEvent.click(screen.getByTestId("shift-coordinator-composer-send"));
    expect((await screen.findByTestId("shift-coordinator-composer-error", {}, { timeout: 5_000 })).textContent).toBe("This worker won't take that line.");
    expect(input.value).toBe(ASKER_REFUSED_LINE);
  });

  // A gated change (fire, retire) stops the worker's turn on the user's approval. The line
  // is delivered and the ask waits in Inbox: Retry would send it, and raise the ask, twice.
  it("reads a line whose turn stopped on an approval as delivered, pointing at Inbox, with no Retry", async () => {
    const { client } = await openShiftCoordinator("/", { shiftCoordinator: true });
    expect((await screen.findByTestId("shift-coordinator-summary-asks")).textContent).toBe("Nothing needs you.");
    const input = (await screen.findByTestId("shift-coordinator-composer-input")) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: ASKER_GATED_LINE } });
    fireEvent.click(screen.getByTestId("shift-coordinator-composer-send"));
    const status = screen.getByTestId("shift-coordinator-composer-status");
    await waitFor(() => expect(status.getAttribute("data-state")).toBe("delivered"), { timeout: 5_000 });
    expect(status.textContent).toMatch(/Delivered\..*Inbox/);
    expect(screen.queryByTestId("shift-coordinator-composer-retry")).toBeNull();
    expect(screen.queryByTestId("shift-coordinator-composer-error")).toBeNull();
    expect(input.value).toBe("");
    // The Lab is read again, so the ask the composer points at is listed: here, and in Inbox.
    await waitFor(() => expect(screen.getByTestId("shift-coordinator-summary-asks").textContent).not.toBe("Nothing needs you."), { timeout: 5_000 });
    // The session holds the line once, with the one ask it raised.
    const sessionId = screen.getByTestId("shift-coordinator-conversation").getAttribute("data-session-id")!;
    const state = await client.sessions.state(sessionId, { includeItems: true, itemTypes: ["message", "suspension"] });
    const items = (state.items ?? []) as Array<{ type: string; role?: string }>;
    expect(items.filter((item) => item.type === "message" && item.role === "user")).toHaveLength(1);
    expect(items.filter((item) => item.type === "suspension")).toHaveLength(1);
  });

  // Which stop it was only picks the words: a stop the send couldn't classify still reads the
  // Lab again, so a real ask is never kept out of Inbox.
  it("lists the ask a gated line raised even when the send couldn't read what it stopped on", async () => {
    await openShiftCoordinator("/", { shiftCoordinator: true });
    expect((await screen.findByTestId("shift-coordinator-summary-asks")).textContent).toBe("Nothing needs you.");
    const real = globalThis.fetch;
    let failing = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (i, init) => {
      const url = String(i instanceof Request ? i.url : i);
      // The send's own read of the turn's suspended request fails, so it can't tell what the
      // turn stopped on; the refresh after it reads normally.
      if (failing > 0 && /\/sessions\/wks_[^/]+\/requests/.test(url) && url.includes("include_items=true")) {
        failing -= 1;
        return new Response(JSON.stringify({ error: "store offline" }), { status: 503 });
      }
      return real(i, init);
    });
    const input = (await screen.findByTestId("shift-coordinator-composer-input")) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: ASKER_GATED_LINE } });
    failing = 1;
    fireEvent.click(screen.getByTestId("shift-coordinator-composer-send"));
    const status = screen.getByTestId("shift-coordinator-composer-status");
    await waitFor(() => expect(status.getAttribute("data-state")).toBe("delivered"), { timeout: 5_000 });
    expect(status.textContent).toMatch(/Delivered\..*waiting/);
    expect(screen.queryByTestId("shift-coordinator-composer-retry")).toBeNull();
    await waitFor(() => expect(screen.getByTestId("shift-coordinator-summary-asks").textContent).not.toBe("Nothing needs you."), { timeout: 5_000 });
  });

  // The send read nothing pending (resumed meanwhile, say) and the turn then stopped on a new
  // ask: the words say plain delivered, but a turn seen suspended still reads the Lab again.
  it("lists the ask a gated line raised even when the send read nothing pending", async () => {
    await openShiftCoordinator("/", { shiftCoordinator: true });
    expect((await screen.findByTestId("shift-coordinator-summary-asks")).textContent).toBe("Nothing needs you.");
    const real = globalThis.fetch;
    let emptying = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (i, init) => {
      const url = String(i instanceof Request ? i.url : i);
      // The send's read of the turn's suspended request finds it no longer suspended.
      if (emptying > 0 && /\/sessions\/wks_[^/]+\/requests/.test(url) && url.includes("include_items=true")) {
        emptying -= 1;
        return new Response(JSON.stringify({ requests: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return real(i, init);
    });
    const input = (await screen.findByTestId("shift-coordinator-composer-input")) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: ASKER_GATED_LINE } });
    emptying = 1;
    fireEvent.click(screen.getByTestId("shift-coordinator-composer-send"));
    const status = screen.getByTestId("shift-coordinator-composer-status");
    await waitFor(() => expect(status.getAttribute("data-state")).toBe("delivered"), { timeout: 5_000 });
    expect(status.textContent).toBe("Delivered.");
    await waitFor(() => expect(screen.getByTestId("shift-coordinator-summary-asks").textContent).not.toBe("Nothing needs you."), { timeout: 5_000 });
  });

  it("keeps a refused first line's conversation, so the next line goes into the same session (BR-15)", async () => {
    const { client } = await openShiftCoordinator("/", { shiftCoordinator: true });
    const input = (await screen.findByTestId("shift-coordinator-composer-input")) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: ASKER_REFUSED_LINE } });
    fireEvent.click(screen.getByTestId("shift-coordinator-composer-send"));
    await screen.findByTestId("shift-coordinator-composer-error", {}, { timeout: 5_000 });
    // The door took the line before it refused it: the session exists and holds it.
    await waitFor(() => expect(screen.getByTestId("shift-coordinator-conversation").getAttribute("data-session-id")).not.toBe(""));
    const first = screen.getByTestId("shift-coordinator-conversation").getAttribute("data-session-id")!;
    await waitFor(() => expect(screen.getAllByTestId("shift-coordinator-item").some((el) => el.getAttribute("data-role") === "user")).toBe(true));
    fireEvent.change(input, { target: { value: "second line" } });
    fireEvent.click(screen.getByTestId("shift-coordinator-composer-send"));
    await waitFor(() => expect(screen.getByTestId("shift-coordinator-composer-status").getAttribute("data-state")).toBe("delivered"), { timeout: 5_000 });
    expect(screen.getByTestId("shift-coordinator-conversation").getAttribute("data-session-id")).toBe(first);
    const direct = (await client.sessions.list({ userId: ASK_LAB_USER_ID })).filter((s) => (s as { state?: { workerId?: string } }).state?.workerId === "ops.shift-coordinator" && s.parentSessionId == null);
    expect(direct.map((s) => s.id)).toEqual([first]);
  });

  it("takes no line until the conversation has been read, and Retry keeps it shut until a read succeeds", async () => {
    const lab = await serveLab((await openAskLab({ shiftCoordinator: true })).flowState);
    served.push(lab);
    const client = connect({ baseUrl: lab.baseUrl, userId: ASK_LAB_USER_ID });
    await workerAction(client, "ops.shift-coordinator", "respond", { message: "earlier" }, SHIFT_COORDINATOR_CONVERSATION);
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    let failing = false;
    const real = globalThis.fetch;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (i, init) => {
      const url = String(i instanceof Request ? i.url : i);
      // The conversation's read, not the snapshot's ask read of the same session.
      if (url.includes(`/sessions/${SHIFT_COORDINATOR_CONVERSATION}/state`) && !url.includes("item_types=suspension")) {
        await held;
        if (failing) return new Response(JSON.stringify({ error: "store offline" }), { status: 503 });
      }
      return real(i, init);
    });
    setURL(`${lab.baseUrl}/shift-coordinator`);
    render(<App connection={{ userId: ASK_LAB_USER_ID }} />);
    const input = (await screen.findByTestId("shift-coordinator-composer-input")) as HTMLTextAreaElement;
    // The address is worked out before the read starts; the composer stays shut throughout.
    expect(input.disabled).toBe(true);
    await waitFor(() => expect(screen.getByTestId("shift-coordinator-conversation").getAttribute("data-session-id")).toBe(SHIFT_COORDINATOR_CONVERSATION));
    expect(input.disabled).toBe(true);
    failing = true;
    release();
    await screen.findByTestId("shift-coordinator-conversation-failure");
    expect(input.disabled).toBe(true);
    act(() => fireEvent.click(within(screen.getByTestId("shift-coordinator-conversation-failure")).getByRole("button", { name: "Retry" })));
    expect(input.disabled).toBe(true);
    failing = false;
    await waitFor(() => expect(input.disabled).toBe(false));
    expect(screen.queryByTestId("shift-coordinator-conversation-failure")).toBeNull();
  });

  it("draws an answered ask in the conversation as answered, not as waiting on the user", async () => {
    const lab = await serveLab((await openAskLab({ shiftCoordinator: true })).flowState);
    served.push(lab);
    const client = connect({ baseUrl: lab.baseUrl, userId: ASK_LAB_USER_ID });
    setURL(lab.baseUrl);
    await workerAction(client, "ops.shift-coordinator", "ask", { what: "ship it" }, SHIFT_COORDINATOR_CONVERSATION);
    let suspension: { requestId: string; suspensionId: string } | undefined;
    await waitFor(async () => {
      const state = await client.sessions.state(SHIFT_COORDINATOR_CONVERSATION, { includeItems: true, itemTypes: ["suspension"] });
      suspension = (state.items ?? [])[0] as typeof suspension;
      expect(suspension).toBeDefined();
    });
    await client.flow(ASKER_FLOW).request(suspension!.requestId).resume({
      suspensionId: suspension!.suspensionId,
      action: "approve",
      resumedBy: ASK_LAB_USER_ID,
    });
    await waitFor(async () => {
      const state = await client.sessions.state(SHIFT_COORDINATOR_CONVERSATION, { includeItems: true, itemTypes: ["suspension_resume"] });
      expect(state.items ?? []).toHaveLength(1);
    });
    setURL(`${lab.baseUrl}/shift-coordinator`);
    render(<App connection={{ userId: ASK_LAB_USER_ID }} />);
    const conversation = await screen.findByTestId("shift-coordinator-conversation");
    await waitFor(() => expect(within(conversation).getAllByTestId("shift-coordinator-item").some((el) => el.getAttribute("data-item-type") === "suspension")).toBe(true));
    expect(conversation.textContent).not.toMatch(/Waiting on you/);
  });

  it("redraws the conversation once its ask is answered on the page, without a line sent (FIX-1901)", async () => {
    const lab = await serveLab((await openAskLab({ shiftCoordinator: true })).flowState);
    served.push(lab);
    const client = connect({ baseUrl: lab.baseUrl, userId: ASK_LAB_USER_ID });
    setURL(lab.baseUrl);
    await workerAction(client, "ops.shift-coordinator", "ask", { what: "ship it" }, SHIFT_COORDINATOR_CONVERSATION);
    setURL(`${lab.baseUrl}/shift-coordinator`);
    render(<App connection={{ userId: ASK_LAB_USER_ID }} />);
    const conversation = await screen.findByTestId("shift-coordinator-conversation");
    await waitFor(() => expect(conversation.textContent).toMatch(/Waiting on you/));
    const ask = (await screen.findAllByTestId("shift-coordinator-ask"))[0]!;
    act(() => fireEvent.click(within(ask).getByRole("button", { name: "Approve" })));
    await waitFor(() => expect(screen.getByTestId("shift-coordinator-conversation").textContent).not.toMatch(/Waiting on you/), { timeout: 5_000 });
    expect(within(screen.getByTestId("shift-coordinator-conversation")).getAllByTestId("shift-coordinator-item").some((el) => el.getAttribute("data-item-type") === "suspension")).toBe(true);
  });

  it("says what the Lab answered, with Retry, for asks or a conversation's board that didn't load (BR-8)", async () => {
    const lab = await serveLab((await openAskLab()).flowState);
    served.push(lab);
    // A worker session, so there are asks to read.
    await workerAction(connect({ baseUrl: lab.baseUrl, userId: ASK_LAB_USER_ID }), "ops.asker", "ask", { what: "ship it" }, "s_ops_asker");
    const real = globalThis.fetch;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (i, init) => {
      const url = String(i instanceof Request ? i.url : i);
      if (/\/resources\/tasks(\?|$)/.test(url) || url.includes("item_types=suspension")) {
        return new Response(JSON.stringify({ error: "store offline" }), { status: 503 });
      }
      return real(i, init);
    });
    setURL(`${lab.baseUrl}/shift-coordinator`);
    render(<App connection={{ userId: ASK_LAB_USER_ID }} />);
    const asks = await screen.findByTestId("shift-coordinator-summary-asks-failure");
    expect(asks.textContent).toMatch(/store offline/);
    expect(within(asks).getByRole("button", { name: "Retry" })).toBeTruthy();
    // The user's conversation boards are read once, through one of their
    // sessions whose flow keeps them (a coordinator's, or a delegate's that
    // takes posts, as the asker does): Tasks names it, with what the Lab answered.
    act(() => fireEvent.click(screen.getByTestId("nav-tasks")));
    const board = await screen.findByTestId("section-failure");
    expect(board.textContent).toMatch(/The boards of (ops\.(desk|side)|s_ops_asker) did not load/);
    expect(board.textContent).toMatch(/store offline.*503/);
    expect(within(board).getByRole("button", { name: "Retry" })).toBeTruthy();
  });

  it("disables the composer for a worker that takes no message (BR-13)", async () => {
    await openShiftCoordinator("/", { shiftCoordinator: true, doors: false });
    const input = (await screen.findByTestId("shift-coordinator-composer-input")) as HTMLTextAreaElement;
    expect(input.disabled).toBe(true);
    expect(screen.getByTestId("shift-coordinator-composer-blocked").textContent).toBe(`Shift Coordinator ${GAPS.turn.noDoor}`);
  });
});

describe("Jump to from the keyboard", () => {
  it("arrow keys move the highlight through the results, and Enter goes to the highlighted one", async () => {
    await openApp("/inbox");
    await screen.findByTestId("jump-tip");
    act(() => void fireEvent.keyDown(document.body, { key: "k", metaKey: true }));
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
    // first three results are Shift Coordinator, then its workers, ops.asker
    // then ops.desk, each of which opens Roster.
    act(() => fireEvent.keyDown(input, { key: "ArrowDown" }));
    act(() => fireEvent.keyDown(input, { key: "ArrowDown" }));
    expect(screen.getAllByTestId("jump-result")[2]!.textContent).toMatch(/^ops\.desk/);
    act(() => fireEvent.keyDown(input, { key: "Enter" }));
    expect(screen.queryByTestId("jump-dialog")).toBeNull();
    expect(window.location.pathname).toBe("/roster");
  });

  it("the pointer highlights the result it is over", async () => {
    await openApp("/inbox");
    await screen.findByTestId("jump-tip");
    act(() => void fireEvent.keyDown(document.body, { key: "k", metaKey: true }));
    const results = await screen.findAllByTestId("jump-result");
    act(() => fireEvent.mouseMove(results[2]!));
    expect(results.map((r) => r.getAttribute("aria-selected"))).toEqual(results.map((_, i) => String(i === 2)));
  });
});
