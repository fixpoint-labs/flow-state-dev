// @vitest-environment happy-dom
/**
 * A first run teaches (FIX-2403): a strip over the conversation says what the
 * lab works on and with, the harness chips say which can run, and an empty
 * conversation names who its worker hands work to, from the roster and the
 * declared delegates as read, and offers lines that fill the composer without
 * sending them.
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { Client } from "@flow-state-dev/client";
import { CODER_FLOW } from "@flow-state-dev/harness-manager/browser";
import type { RosterEntry } from "@flow-state-dev/workforce/browser";
import { App } from "../src/components/App";
import { delegatesOf, emptyLine, starterLines } from "../src/lib/first-run";
import { scriptedServer, ScriptedProvider, rosterEntry } from "./scripted-server";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  window.history.replaceState(null, "", "/");
});

const row = (id: string, name: string, extra: Partial<RosterEntry> = {}): RosterEntry => rosterEntry({ id, name, ...extra });
const coder = { flow: CODER_FLOW };
const context = (delegates: Record<string, "all" | string[]>) => ({ folder: "/x", folderProblem: null, model: "m", harness: "cursor", delegates });

describe("the first run's lines", () => {
  it("names the delegates the roster and the declared list give, so two rosters read differently", () => {
    const lead = row("t.lead", "Lead");
    const one = [lead, row("t.scout", "Scout"), row("t.forge", "Forge", coder)];
    const two = [lead, row("t.scribe", "Scribe"), row("t.anvil", "Anvil", coder)];
    const a = emptyLine(lead, delegatesOf(lead, one, context({ "t.lead": "all" })));
    const b = emptyLine(lead, delegatesOf(lead, two, context({ "t.lead": "all" })));
    expect(a).toBe("Lead runs the work with you: it asks Scout and starts coding tasks on Forge. This is your one conversation with it.");
    expect(b).toContain("asks Scribe and starts coding tasks on Anvil");
    expect(starterLines(lead, delegatesOf(lead, two, context({ "t.lead": "all" })))).toContain("Ask Scribe to look into something for me");
  });

  it("names only the listed delegates, and none for a worker that declares none", () => {
    const lead = row("t.lead", "Lead");
    const roster = [lead, row("t.scout", "Scout"), row("t.other", "Other")];
    expect(delegatesOf(lead, roster, context({ "t.lead": ["t.scout"] })).map((w) => w.name)).toEqual(["Scout"]);
    expect(delegatesOf(row("t.scout", "Scout"), roster, context({ "t.lead": "all" }))).toEqual([]);
    expect(emptyLine(row("t.scout", "Scout", { description: "Finds facts." }), [])).toBe("Say hello to Scout. This is your one conversation with it. Finds facts.");
  });
});

describe("the context strip", () => {
  it("shows the folder, model and harness the server read, and the harness chips with their remedy", async () => {
    render(<ScriptedProvider server={scriptedServer({ speed: 0.05 })}><App /></ScriptedProvider>);
    const strip = await screen.findByRole("region", { name: "Working context" });
    // The folder reads by its last two segments; the whole path is in its tooltip.
    await waitFor(() => expect(within(strip).getByTestId("context-folder").textContent).toBe("Working folder work / launch-site"));
    expect(within(strip).getByTestId("context-folder").title).toContain("Working folder: /work/launch-site");
    expect(within(strip).getByTestId("context-model").textContent).toBe("Model gpt-6-luna");
    expect(within(strip).getByTestId("context-harness").textContent).toBe("Default harness Cursor");
    const chips = within(strip).getByRole("group", { name: "Coding harnesses" });
    await waitFor(() => expect(chips.querySelector('[data-harness="codex"]')?.textContent).toContain("Run `codex login`"));
    // A harness that can't run shows Sign in, not its error, until asked: then what to do.
    const codex = chips.querySelector<HTMLElement>('[data-harness="codex"]')!;
    const signIn = within(codex).getByRole("button", { name: "Sign in" });
    const remedy = () => screen.queryByRole("dialog", { name: "Sign in to Codex" });
    expect(remedy()).toBeNull();
    fireEvent.click(signIn);
    expect(remedy()?.textContent).toContain("Run `codex login`");
    expect(signIn.getAttribute("aria-expanded")).toBe("true");
    expect(within(chips).getByRole("button", { name: "Re-check harnesses" })).toBeTruthy();
  });

  // The remedy must never be stuck open: whichever way the person dismisses it, it closes and focus goes back to Sign in.
  it("closes the Sign in remedy with Sign in again, Escape, or a click outside, and gives focus back to Sign in", async () => {
    render(<ScriptedProvider server={scriptedServer({ speed: 0.05 })}><App /></ScriptedProvider>);
    const chips = await screen.findByRole("group", { name: "Coding harnesses" });
    await waitFor(() => expect(chips.querySelector('[data-harness="codex"] button')).not.toBeNull());
    const signIn = within(chips.querySelector<HTMLElement>('[data-harness="codex"]')!).getByRole("button", { name: "Sign in" });
    const remedy = () => screen.queryByRole("dialog", { name: "Sign in to Codex" });
    // Sign in again toggles it shut.
    fireEvent.click(signIn);
    expect(remedy()).not.toBeNull();
    fireEvent.click(signIn);
    await waitFor(() => expect(remedy()).toBeNull());
    expect(signIn.getAttribute("aria-expanded")).toBe("false");
    // Escape closes it and puts focus back on Sign in.
    fireEvent.click(signIn);
    fireEvent.keyDown(remedy()!, { key: "Escape" });
    await waitFor(() => expect(remedy()).toBeNull());
    expect(document.activeElement).toBe(signIn);
    // A click anywhere else closes it.
    fireEvent.click(signIn);
    expect(remedy()).not.toBeNull();
    // The outside-click listener is armed a tick after the popover opens, as a real click would find it.
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    fireEvent.pointerDown(document.body);
    await waitFor(() => expect(remedy()).toBeNull());
  });

  /** A client whose lab-context and readiness reads are changed by `edit`. */
  const editedReads = (lab: ReturnType<typeof scriptedServer>, edit: (view: string, value: unknown) => unknown) =>
    ({
      ...lab.client,
      view: async (ref: { view: string }, input: unknown, options?: unknown) => {
        const read = await lab.client.view(ref as never, input as never, options as never);
        return { ...read, value: edit(ref.view, read.value) };
      },
    }) as unknown as Client;

  it("warns on the default harness when it can't run here, so a coding task isn't sent to one that will fail", async () => {
    const lab = scriptedServer({ speed: 0.05 });
    const client = editedReads(lab, (view, value) =>
      view === "readiness"
        ? (value as { harness: string }[]).map((row) => (row.harness === "cursor" ? { ...row, ready: false, reason: "Cursor has no key", remedy: "Set CURSOR_API_KEY" } : row))
        : value,
    );
    render(<ScriptedProvider server={lab} client={client}><App /></ScriptedProvider>);
    const chip = await screen.findByTestId("context-harness");
    await waitFor(() => expect(chip.dataset.ready).toBe("false"));
    expect(chip.title).toContain("Set CURSOR_API_KEY");
  });

  it("says in the folder's tooltip what each coding worktree runs before and after its run", async () => {
    const lab = scriptedServer({ speed: 0.05 });
    const client = editedReads(lab, (view, value) => (view === "context" ? { ...(value as object), setup: "pnpm install --frozen-lockfile", checks: ["pnpm typecheck", "pnpm test"] } : value));
    render(<ScriptedProvider server={lab} client={client}><App /></ScriptedProvider>);
    const folder = await screen.findByTestId("context-folder");
    await waitFor(() => expect(folder.title).toContain("Worktree setup: pnpm install --frozen-lockfile"));
    expect(folder.title).toContain("Run checks: pnpm typecheck; pnpm test");
  });

  it("warns when a coding run's checkout of the folder would be refused", async () => {
    const lab = scriptedServer({ speed: 0.05 });
    // The lab-context view answers the problem a coding run's checkout of the folder would be refused with.
    const client = {
      ...lab.client,
      view: async (ref: { view: string }, input: unknown, options?: unknown) => {
        const read = await lab.client.view(ref as never, input as never, options as never);
        return ref.view === "context" ? { ...read, value: { ...(read.value as object), folderProblem: "the repository does not ignore .fsdev/ask" } } : read;
      },
    } as unknown as Client;
    render(<ScriptedProvider server={lab} client={client}><App /></ScriptedProvider>);
    expect((await screen.findByTestId("context-folder-problem")).textContent).toContain("does not ignore .fsdev/ask");
  });
});

describe("an empty conversation", () => {
  it("offers starter lines; a click fills the composer and sends nothing", async () => {
    const lab = scriptedServer({ speed: 0.05 });
    render(<ScriptedProvider server={lab}><App /></ScriptedProvider>);
    // A teammate hired now has an empty conversation.
    await screen.findByRole("region", { name: "Working context" });
    const hired = await lab.hire({ name: "scout", role: "Finds facts.", instructions: "Find facts." });
    cleanup();
    render(<ScriptedProvider server={lab}><App /></ScriptedProvider>);
    fireEvent.click(await screen.findByRole("button", { name: new RegExp(`^${hired.id}`) }));
    const lines = await screen.findByRole("list", { name: "Starter lines" });
    fireEvent.click(within(lines).getByRole("button", { name: "What can you help me with?" }));
    await waitFor(() => expect((screen.getByLabelText(`Message ${hired.id}`) as HTMLTextAreaElement).value).toBe("What can you help me with?"));
    // Nothing reached the worker flow's door.
    expect(lab.sends).toHaveLength(0);
  });
});
