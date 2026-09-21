// @vitest-environment happy-dom
/**
 * What the SECOND host needed and the first did not (FIX-1477 PR-B).
 *
 * The reference app knows its kinds: it filters on `channel` and `agent`,
 * which are values in its own source. A generic inspector does not — the
 * developer tool is pointed at whatever server is running, and the kinds are
 * app-defined strings it can only learn by asking. Both gaps below were found
 * by building that second host, and neither is reachable from the first.
 *
 * Kept separate from `flow-navigator.test.ts` so the provenance of these two
 * cases stays legible: they are the reusability proof's own findings.
 */
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import { createElement } from "react";
import type { FlowListEntry, SessionSummary } from "@flow-state-dev/client";
import { FlowNavigator } from "../src/components/flow-navigator/FlowNavigator";

const entry = (
  id: string,
  kind: string,
  cardinality: FlowListEntry["cardinality"],
  actions: string[] = []
): FlowListEntry => ({ id, kind, cardinality, requireUser: false, actions });

const listSessions = vi.fn(async () => [] as SessionSummary[]);

function mount(flows: FlowListEntry[], props: Record<string, unknown>) {
  const listFlows = vi.fn(async () => flows);
  render(
    createElement(FlowNavigator, {
      onSelectSession: () => {},
      client: { listFlows } as never,
      sessionClient: { listSessions } as never,
      userId: "u",
      ...props,
    } as never)
  );
  return { listFlows };
}

const kindRow = (kind: string) =>
  document.querySelector<HTMLButtonElement>(`[data-kind="${kind}"]`)!;

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe("FlowNavigator · a host that cannot name its kinds", () => {
  const mixed = [
    entry("chat", "chat", "singleton"),
    entry("seat-a", "agent", "collection"),
    entry("seat-b", "agent", "collection"),
    entry("ops", "ops-console", "singleton"),
  ];

  it("lists every kind the server has when a section names none", async () => {
    const { listFlows } = mount(mixed, { sections: [{ label: "Flows" }] });

    // One row per KIND, not per instance: the two agent seats are one row.
    await waitFor(() => expect(kindRow("agent")).toBeTruthy());
    expect(
      Array.from(document.querySelectorAll("[data-kind]")).map((el) =>
        el.getAttribute("data-kind")
      )
    ).toEqual(["chat", "agent", "ops-console"]);

    // Still ONE read. The workaround for a missing wildcard is for the host to
    // read the flow list itself to learn the kind names it must then pass back
    // in, which is the one-read-per-host rule lost to a workaround rather than
    // to a bug.
    expect(listFlows).toHaveBeenCalledTimes(1);
  });

  it("keeps a named section filtering, so the wildcard is opt-in", async () => {
    mount(mixed, { sections: [{ label: "Channels", kinds: ["chat"] }] });

    await waitFor(() => expect(kindRow("chat")).toBeTruthy());
    expect(document.querySelectorAll("[data-kind]")).toHaveLength(1);
  });

  it("treats an EMPTY kind list as a filter matching nothing, not as a wildcard", async () => {
    // The distinction the devtool's transient state turns on: `kinds: []` is a
    // host that has named its filter and it excludes everything, while an
    // absent `kinds` is a host that never had one. Collapsing the two makes a
    // host deriving its kind list flash the whole server's contents on the
    // frame before its own list arrives.
    mount(mixed, { sections: [{ label: "Nothing", kinds: [] }] });

    await waitFor(() =>
      expect(document.querySelector("[data-empty-section]")).toBeTruthy()
    );
    expect(document.querySelectorAll("[data-kind]")).toHaveLength(0);
  });
});
