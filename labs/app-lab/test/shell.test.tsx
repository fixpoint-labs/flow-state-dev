// @vitest-environment happy-dom
/**
 * The shell against a real Lab, in a DOM (V2, V3's second path, V6; BR-14,
 * BR-28). What the screen draws is compared with what the Lab's routes hold.
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App";
import { createLabClients } from "../src/lib/connection";
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
    expect(input.value).toBe("");
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

  it("disables addressing a worker until its session write ships, and says so", async () => {
    await openApp("/w/ops.side/stream");
    const input = await screen.findByTestId("composer-input");
    fireEvent.change(input, { target: { value: "@someone please" } });
    expect((screen.getByTestId("composer-send") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId("composer-status").textContent).toMatch(/FIX-1664/);
  });
});
