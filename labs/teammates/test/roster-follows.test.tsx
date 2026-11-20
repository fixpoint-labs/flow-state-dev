// @vitest-environment happy-dom
/**
 * The list follows the roster: a teammate hired or fired somewhere else (another
 * tab, or a worker's turn) shows without a reload, and the page never reads the
 * roster again on its own for a hire or fire made here. Workforce's roster
 * watch is the one source.
 *
 * Red state produced: against the boot read plus a re-read after this tab's
 * own hire and fire, the hire made elsewhere never shows.
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/components/App";
import { scriptedServer, ScriptedProvider } from "./scripted-server";

// Counts the page's roster watches and one-off roster reads, through workforce's own client.
const roster = vi.hoisted(() => ({ watches: 0, reads: 0 }));
vi.mock("@flow-state-dev/workforce/browser", async (original) => {
  const real = await original<typeof import("@flow-state-dev/workforce/browser")>();
  return {
    ...real,
    createWorkforceClient: (source: Parameters<typeof real.createWorkforceClient>[0]) => {
      const client = real.createWorkforceClient(source);
      return {
        ...client,
        watchRoster: (...args: Parameters<typeof client.watchRoster>) => (roster.watches++, client.watchRoster(...args)),
        roster: () => (roster.reads++, client.roster()),
      };
    },
  };
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  window.history.replaceState(null, "", "/");
});

const listed = () =>
  [...screen.getByRole("navigation", { name: "Workers" }).querySelectorAll<HTMLElement>("[data-worker]")].map((row) => row.getAttribute("data-worker"));

describe("the worker list follows the roster", () => {
  it("shows a teammate hired elsewhere, and drops it when it is fired elsewhere", async () => {
    const lab = scriptedServer({ speed: 0.05 });
    render(<ScriptedProvider server={lab}><App /></ScriptedProvider>);
    await screen.findByLabelText("Message Lead");
    expect(listed()).not.toContain("scribe");

    // Another tab's hire: the adapter, not this page, makes it.
    await act(async () => void (await lab.hire({ name: "scribe", role: "Takes notes", instructions: "" })));
    await waitFor(() => expect(listed()).toContain("scribe"));

    await act(async () => void (await lab.fire("scribe")));
    await waitFor(() => expect(listed()).not.toContain("scribe"));
  });

  it("watches the roster once, whatever this tab hires", async () => {
    const lab = scriptedServer({ speed: 0.05 });
    roster.watches = 0;
    roster.reads = 0;
    render(<ScriptedProvider server={lab}><App /></ScriptedProvider>);
    await screen.findByLabelText("Message Lead");
    // This tab's own hire, from its form.
    fireEvent.click(screen.getByRole("button", { name: "Hire a teammate" }));
    const form = screen.getByRole("form", { name: "Hire a teammate" });
    fireEvent.change(within(form).getByLabelText("Teammate name"), { target: { value: "scribe" } });
    fireEvent.change(within(form).getByLabelText("Teammate role"), { target: { value: "Takes notes" } });
    await act(async () => fireEvent.click(within(form).getByRole("button", { name: "Hire" })));
    await waitFor(() => expect(listed()).toContain("scribe"));
    expect(lab.rosterWrites.map((w) => w.action)).toEqual(["hire"]);
    expect(roster).toEqual({ watches: 1, reads: 0 });
  });

  it("keeps following the roster when one teammate's conversation won't open, and opens it when picked", async () => {
    const lab = scriptedServer({ speed: 0.05 });
    let refuse = true;
    // Opening scribe's conversation fails while `refuse` holds, as an unreachable server fails it.
    const flaky = {
      ...lab.client,
      flow: (address: string) => {
        const flow = lab.client.flow(address);
        return {
          ...flow,
          createSession: (options?: Parameters<typeof flow.createSession>[0]) =>
            Object.values(options?.state ?? {}).includes("scribe") && refuse ? Promise.reject(new TypeError("fetch failed")) : flow.createSession(options),
        } as typeof flow;
      },
    } as typeof lab.client;
    render(<ScriptedProvider server={lab} client={flaky}><App /></ScriptedProvider>);
    await screen.findByLabelText("Message Lead");

    // The hire's conversation fails to open: the roster still lands, and so does the next change.
    await act(async () => void (await lab.hire({ name: "scribe", role: "Takes notes", instructions: "" })));
    await waitFor(() => expect(listed()).toContain("scribe"));
    await act(async () => void (await lab.hire({ name: "editor", role: "Edits", instructions: "" })));
    await waitFor(() => expect(listed()).toContain("editor"));
    expect(screen.getByLabelText("Message Lead")).toBeTruthy();

    // Picked once the lab answers again, its conversation opens.
    refuse = false;
    const row = screen.getByRole("navigation", { name: "Workers" }).querySelector<HTMLElement>('[data-worker="scribe"]')!;
    fireEvent.click(row.querySelector("button") ?? row);
    expect(await screen.findByLabelText("Message scribe")).toBeTruthy();
  });

  it("opens a teammate hired here with the cursor in its composer, once its row lands", async () => {
    const lab = scriptedServer({ speed: 0.05 });
    render(<ScriptedProvider server={lab}><App /></ScriptedProvider>);
    await screen.findByLabelText("Message Lead");
    fireEvent.click(screen.getByRole("button", { name: "Hire a teammate" }));
    const form = screen.getByRole("form", { name: "Hire a teammate" });
    fireEvent.change(within(form).getByLabelText("Teammate name"), { target: { value: "scribe" } });
    fireEvent.change(within(form).getByLabelText("Teammate role"), { target: { value: "Takes notes" } });
    await act(async () => fireEvent.click(within(form).getByRole("button", { name: "Hire" })));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText("Message scribe")));
  });
});
