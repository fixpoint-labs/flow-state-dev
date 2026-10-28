// @vitest-environment happy-dom
/**
 * The picker, a harness mode's address, and a harness mode's frame, as drawn
 * (`specs/issues/FIX-1914/PLAN.md` V5, V6; BUSINESS-RULES BR-1, BR-14, BR-19,
 * BR-21 to BR-23).
 *
 * V5 renders the server components on the real gate, with the host set
 * through the environment, so what is asserted is the page and not the
 * availability function. V6 mounts the frame on a stubbed server holding two
 * harness flow kinds, so "lists only its own kind" can fail.
 *
 * Red states produced before these were trusted:
 *   - render the frame whatever the availability: the unavailable-address case fails (a rail is drawn).
 *   - list the mode's section with no `kinds` filter: the only-its-own-kind case fails (the other kind's row shows).
 *   - create the new session on the first listed flow, not the mode's: the New-session case fails.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { FlowListEntry, SessionSummary } from "@flow-state-dev/client";

import PickerPage from "@/app/page";
import { HarnessFrame } from "@/components/harness-frame";
import { HarnessModePage } from "@/components/harness-mode-page";
import { resetModeAvailabilityForTests } from "@/lib/harness-gate";
import { resetHarnessModelChoicesForTests, type ModelChoices } from "@/lib/harness-models";
import { COORDINATOR_FLOWS, SHELL_FLOW, WORKER_FLOWS } from "@/lib/workforce-shell";

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  resetModeAvailabilityForTests();
  resetHarnessModelChoicesForTests();
});

/** The harness flow kinds the spec pins, one per harness mode. */
const HARNESS_KINDS = ["claude-code-session", "codex-session", "cursor-session"];

describe("V5 · the picker at /", () => {
  it("BR-1: four modes, in order; Flow State available; each unavailable one with its reason", async () => {
    vi.stubEnv("VERCEL", "1");
    render(await PickerPage());
    const cards = [...document.querySelectorAll<HTMLElement>("[data-mode-id]")];
    expect(cards.map((card) => card.dataset.modeId)).toEqual(["flow-state", "claude-code", "codex", "cursor"]);
    expect(cards.map((card) => within(card).getByText(/^(Flow State|Claude Code|Codex|Cursor)$/).textContent)).toEqual([
      "Flow State",
      "Claude Code",
      "Codex",
      "Cursor",
    ]);
    const [flowState, ...harnesses] = cards;
    expect(flowState!.dataset.available).toBe("true");
    expect(within(flowState!).getByRole("link").getAttribute("href")).toBe("/flow-state");
    for (const card of harnesses) {
      expect(card.dataset.available).toBe("false");
      expect(within(card).queryByRole("link")).toBeNull();
      expect(within(card).getByTestId("mode-reason").textContent).toMatch(/local machine/);
    }
  });

  it("BR-9: with a repository, Claude Code, Codex and Cursor modes are built and available", async () => {
    vi.stubEnv("VERCEL", "");
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("KITCHEN_SINK_HARNESS_WORKSPACE", "");
    // Test mode runs the scripted Claude Code, Codex and Cursor, so their own checks pass on any host.
    vi.stubEnv("KITCHEN_SINK_TEST_MODE", "1");
    vi.stubEnv("KITCHEN_SINK_REAL_HARNESS", "");
    render(await PickerPage());
    const reasons = [...document.querySelectorAll('[data-available="false"] [data-testid="mode-reason"]')].map(
      (reason) => reason.textContent,
    );
    expect(reasons).toEqual([]);
    expect(document.querySelectorAll('[data-available="true"]')).toHaveLength(4);
  });
});

describe("the picker, for an available mode that carries a note", () => {
  it("says so on the mode's card, so an unconfined run is never a surprise", async () => {
    const note = "Cursor is running against a preview build on this host.";
    // The answer the gate memoizes for this server start, as the Cursor check gives it under the opt-out.
    (globalThis as Record<symbol, unknown>)[Symbol.for("kitchen-sink.harness-gate")] = Promise.resolve({
      "flow-state": { available: true },
      "claude-code": { available: true },
      codex: { available: false, reason: "Not built yet." },
      cursor: { available: true, note },
    });
    render(await PickerPage());
    const cursor = document.querySelector<HTMLElement>('[data-mode-id="cursor"]')!;
    expect(cursor.dataset.available).toBe("true");
    expect(within(cursor).getByTestId("mode-note").textContent).toBe(note);
    const claudeCode = document.querySelector<HTMLElement>('[data-mode-id="claude-code"]')!;
    expect(within(claudeCode).queryByTestId("mode-note")).toBeNull();
  });

  it("says so on the mode's own page too, so a bookmark or direct link never skips the warning", async () => {
    const note = "Cursor is running against a preview build on this host.";
    (globalThis as Record<symbol, unknown>)[Symbol.for("kitchen-sink.harness-gate")] = Promise.resolve({
      "flow-state": { available: true },
      "claude-code": { available: true },
      codex: { available: false, reason: "Not built yet." },
      cursor: { available: true, note },
    });
    // The lists as this server start read them, so the page asks no harness.
    (globalThis as Record<symbol, unknown>)[Symbol.for("kitchen-sink.harness-models")] = new Map([
      ["cursor", TWO_MODELS],
      ["claude-code", TWO_MODELS],
    ]);
    render(await HarnessModePage({ id: "cursor" }));
    expect(within(screen.getByTestId("rail")).getByTestId("mode-note").textContent).toBe(note);
    cleanup();
    render(await HarnessModePage({ id: "claude-code" }));
    expect(screen.queryByTestId("mode-note")).toBeNull();
  });
});

describe("V5 · BR-14 · an unavailable mode by its address", () => {
  it("shows the picker's reason and the way back, and draws no rail, no navigator, no composer", async () => {
    vi.stubEnv("VERCEL", "1");
    render(await HarnessModePage({ id: "codex" }));
    expect(screen.getByTestId("mode-reason").textContent).toMatch(/local machine/);
    expect(screen.getByRole("link", { name: "Back to the modes" }).getAttribute("href")).toBe("/");
    expect(screen.queryByTestId("rail")).toBeNull();
    expect(document.querySelector("nav[data-fsd-flow-navigator]")).toBeNull();
    expect(screen.queryByTestId("new-session")).toBeNull();
    expect(screen.queryByTestId("message-input")).toBeNull();
  });
});

const entry = (kind: string): FlowListEntry => ({ id: kind, kind, cardinality: "singleton", requireUser: false, actions: [] });

/** A server holding two harness flow kinds and the sessions on each, newest first. */
function fakeServer(rows: Array<{ id: string; kind: string; title: string }>) {
  const created: Array<{ flowKind: string; userId: string; state?: Record<string, unknown> }> = [];
  return {
    created,
    listFlows: vi.fn(async () => [entry("codex-session"), entry("claude-code-session")]),
    sessionSource: {
      listSessions: vi.fn(async (options?: { flowKind?: string; flowId?: string }) =>
        rows
          .filter((row) => row.kind === (options?.flowId ?? options?.flowKind))
          .map((row) => ({ id: row.id, flowKind: row.kind, title: row.title }) as unknown as SessionSummary),
      ),
      createSession: vi.fn(async (options: { flowKind: string; userId: string; state?: Record<string, unknown> }) => {
        // What the frame's `client.flow(kind).createSession` would post.
        created.push({ flowKind: options.flowKind, userId: options.userId, state: options.state });
        const row = { id: `new-${created.length}`, kind: options.flowKind, title: "fresh" };
        rows.unshift(row);
        return { id: row.id, flowKind: row.kind } as never;
      }),
    },
  };
}

/** A mode's models: two, the first preselected. */
const TWO_MODELS: ModelChoices = {
  models: [
    { id: "model-a", label: "Model A" },
    { id: "model-b", label: "Model B" },
  ],
  defaultId: "model-a",
  reason: null,
  fallbackId: null,
};

/** The frame's client over a fake server: its flow list, its listing, and a flow's create as the app's user. */
function clientOf(server: ReturnType<typeof fakeServer>) {
  return {
    userId: "devuser",
    flows: server.listFlows,
    sessions: { list: server.sessionSource.listSessions },
    flow: (flowKind: string) => ({
      createSession: (options: { state?: Record<string, unknown> } = {}) =>
        server.sessionSource.createSession({ flowKind, userId: "devuser", ...options }),
    }),
  } as never;
}

function mount(server: ReturnType<typeof fakeServer>, models: ModelChoices = TWO_MODELS) {
  return render(
    <HarnessFrame
      label="Codex"
      flowKind="codex-session"
      models={models}
      client={clientOf(server)}
      stream={(sessionId) => <p data-testid="opened">{sessionId}</p>}
    />,
  );
}

describe("V6 · a harness mode's frame", () => {
  it("BR-21: the mode's name and the way back head the rail, which lists only its own kind's sessions", async () => {
    const server = fakeServer([
      { id: "c1", kind: "codex-session", title: "codex one" },
      { id: "k1", kind: "claude-code-session", title: "claude one" },
    ]);
    mount(server);
    const rail = screen.getByTestId("rail");
    expect(within(rail).getByTestId("mode-name").textContent).toBe("Codex");
    expect(within(rail).getByRole("link", { name: "Back to the modes" }).getAttribute("href")).toBe("/");
    // The sessions are there as the rail opens: a mode has one flow, so there
    // is no kind row to open first.
    await waitFor(() => expect(within(rail).getByText("codex one")).toBeTruthy());
    expect(rail.querySelector("[data-kind]")).toBeNull();
    expect(within(rail).getByTestId("session-list").querySelector("[aria-expanded]")).toBeNull();
    expect(within(rail).queryByText("claude one")).toBeNull();
  });

  it("BR-22: New session creates a session on the mode's flow and opens it in the stream; the other kind is untouched", async () => {
    const server = fakeServer([{ id: "k1", kind: "claude-code-session", title: "claude one" }]);
    mount(server);
    fireEvent.click(screen.getByTestId("new-session"));
    await waitFor(() => expect(screen.getByTestId("opened").textContent).toBe("new-1"));
    expect(server.created).toEqual([{ flowKind: "codex-session", userId: "devuser", state: { model: "model-a" } }]);
    await waitFor(() => expect(within(screen.getByTestId("rail")).getByText("fresh")).toBeTruthy());
    expect(within(screen.getByTestId("rail")).queryByText("claude one")).toBeNull();
  });

  it("New session is born with the picked model, the mode's default preselected", async () => {
    const server = fakeServer([]);
    mount(server);
    const picker = screen.getByTestId("model-picker") as HTMLSelectElement;
    expect(picker.value).toBe("model-a");
    expect(picker.selectedOptions[0]!.textContent).toBe("Model A (default)");
    fireEvent.change(picker, { target: { value: "model-b" } });
    fireEvent.click(screen.getByTestId("new-session"));
    await waitFor(() => expect(server.created).toHaveLength(1));
    expect(server.created[0]!.state).toEqual({ model: "model-b" });
  });

  it("with no model to offer, New session is off and the reason shows; a short list shows its reason too", async () => {
    const server = fakeServer([]);
    mount(server, { models: [], defaultId: null, reason: "The list can't be read.", fallbackId: null });
    expect(screen.queryByTestId("model-picker")).toBeNull();
    expect(screen.getByTestId("model-list-reason").textContent).toBe("The list can't be read.");
    expect((screen.getByTestId("new-session") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByTestId("new-session"));
    expect(server.created).toHaveLength(0);

    cleanup();
    mount(fakeServer([]), { ...TWO_MODELS, models: [TWO_MODELS.models[0]!], reason: "Only the default." });
    expect(screen.getByTestId("model-list-reason").textContent).toBe("Only the default.");
    expect((screen.getByTestId("new-session") as HTMLButtonElement).disabled).toBe(false);
  });

  it("BR-23: with no sessions, the rail says so and offers New session", async () => {
    const server = fakeServer([]);
    mount(server);
    await waitFor(() => expect(within(screen.getByTestId("rail")).getByText("No sessions yet")).toBeTruthy());
    expect(screen.getByTestId("new-session").textContent).toContain("New session");
  });
});

describe("a harness mode's session list", () => {
  it("says a failed read failed, and Retry reads again", async () => {
    const server = fakeServer([{ id: "c1", kind: "codex-session", title: "codex one" }]);
    server.sessionSource.listSessions.mockRejectedValueOnce(new Error("the server is down"));
    mount(server);
    const rail = screen.getByTestId("rail");
    await waitFor(() => expect(within(rail).getByRole("status").textContent).toMatch(/the server is down/));
    expect(within(rail).queryByText("No sessions yet")).toBeNull();
    fireEvent.click(within(rail).getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(within(rail).getByText("codex one")).toBeTruthy());
  });
});

describe("FIX-1915 BR-6 · a reload comes back to the open session", () => {
  afterEach(() => window.history.replaceState(null, "", "/"));

  /** A reload, as the frame sees one: everything drawn goes, the address stays. */
  function reload(server: ReturnType<typeof fakeServer>) {
    cleanup();
    mount(server);
  }

  it("reopens a session started with New session", async () => {
    const server = fakeServer([{ id: "c1", kind: "codex-session", title: "codex one" }]);
    mount(server);
    fireEvent.click(screen.getByTestId("new-session"));
    await waitFor(() => expect(screen.getByTestId("opened").textContent).toBe("new-1"));

    reload(server);

    await waitFor(() => expect(screen.getByTestId("stream").dataset.sessionId).toBe("new-1"));
    expect(screen.getByTestId("opened").textContent).toBe("new-1");
  });

  it("reopens a session picked in the rail", async () => {
    const server = fakeServer([
      { id: "c1", kind: "codex-session", title: "codex one" },
      { id: "c2", kind: "codex-session", title: "codex two" },
    ]);
    mount(server);
    fireEvent.click(await waitFor(() => within(screen.getByTestId("rail")).getByText("codex two")));
    await waitFor(() => expect(screen.getByTestId("opened").textContent).toBe("c2"));

    reload(server);

    await waitFor(() => expect(screen.getByTestId("opened").textContent).toBe("c2"));
  });

  it("opens nothing for an address naming a session that isn't this mode's", async () => {
    const server = fakeServer([
      { id: "c1", kind: "codex-session", title: "codex one" },
      { id: "k1", kind: "claude-code-session", title: "claude one" },
    ]);
    window.history.replaceState(null, "", "/codex?session=k1");
    mount(server);
    await listingsSettled(server);
    expect(screen.getByTestId("stream").dataset.sessionId).toBeUndefined();
    expect(screen.getByText(/Pick a session/)).toBeTruthy();
  });

  it("says so when the session the address names can't be looked up", async () => {
    const server = fakeServer([{ id: "c1", kind: "codex-session", title: "codex one" }]);
    server.sessionSource.listSessions.mockRejectedValueOnce(new Error("the server is down"));
    window.history.replaceState(null, "", "/codex?session=c1");
    mount(server);
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/c1 can't be reopened: the server is down/));
    expect(screen.getByTestId("stream").dataset.sessionId).toBeUndefined();
  });
});

/** Every listing the frame asked for has answered, and what it set from them has drawn. */
async function listingsSettled(server: ReturnType<typeof fakeServer>) {
  await waitFor(() => expect(server.sessionSource.listSessions).toHaveBeenCalled());
  await act(async () => {
    await Promise.allSettled(server.sessionSource.listSessions.mock.results.map((result) => result.value));
  });
}

describe("V6 · BR-19 · Flow State's rail", () => {
  it("lists no harness mode's sessions", () => {
    const listed = [...COORDINATOR_FLOWS, ...WORKER_FLOWS, SHELL_FLOW];
    expect(listed.filter((kind) => HARNESS_KINDS.includes(kind))).toEqual([]);
  });
});
