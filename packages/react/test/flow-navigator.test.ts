// @vitest-environment happy-dom
/**
 * `FlowNavigator` behaviour (FIX-1477 V3, V5, V6, and BR-6 – BR-12).
 *
 * Assertions are on the NUMBER OF REQUESTS wherever the rendered rail would
 * look identical either way. A DOM-only test passes against a navigator that
 * pre-fetches every instance's sessions, which is the one performance shape
 * this component can get badly wrong.
 */
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import type { FlowListEntry, SessionSummary } from "@flow-state-dev/client";
import {
  FlowNavigator,
  flowNavigatorPropNames,
} from "../src/components/flow-navigator/FlowNavigator";

const entry = (
  id: string,
  kind: string,
  cardinality: FlowListEntry["cardinality"]
): FlowListEntry => ({ id, kind, cardinality, requireUser: false, actions: [] });

const session = (id: string, flowId?: string): SessionSummary =>
  ({
    id,
    flowKind: "agent",
    userId: "u",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...(flowId === undefined ? {} : { flowId }),
  }) as unknown as SessionSummary;

/**
 * A session store that filters the way `handleListSessions` does: `flowId` is
 * an exact owner and never matches a row with no owner recorded; `flowKind`
 * matches by kind, ownerless rows included.
 */
function fakeServer(flows: FlowListEntry[], rows: { id: string; kind: string; owner?: string }[]) {
  const calls: { flowId?: string; flowKind?: string; userId?: string }[] = [];

  return {
    calls,
    listFlows: vi.fn(async () => flows),
    listSessions: vi.fn(async (options?: { flowId?: string; flowKind?: string; userId?: string }) => {
      calls.push({ ...options });
      return rows
        .filter((row) =>
          options?.flowId !== undefined
            ? row.owner === options.flowId
            : options?.flowKind !== undefined
              ? row.kind === options.flowKind
              : true
        )
        .map((row) => session(row.id, row.owner));
    }),
  };
}

const sections = [
  { label: "Channels", kinds: ["chat"] },
  { label: "Seats", kinds: ["agent"] },
];

const manySeats = [
  entry("chat", "chat", "singleton"),
  ...Array.from({ length: 40 }, (_, i) => entry(`seat-${i}`, "agent", "collection")),
];

function mount(server: ReturnType<typeof fakeServer>, props: Record<string, unknown> = {}) {
  return render(
    createElement(FlowNavigator, {
      sections,
      onSelectSession: () => {},
      client: { listFlows: server.listFlows } as never,
      sessionClient: { listSessions: server.listSessions } as never,
      userId: "u",
      ...props,
    })
  );
}

const kindRow = (kind: string) =>
  document.querySelector<HTMLButtonElement>(`[data-kind="${kind}"]`)!;
const instanceRow = (id: string) =>
  document.querySelector<HTMLButtonElement>(`[data-instance-id="${id}"]`)!;

const click = async (element: HTMLElement) => {
  await act(async () => {
    element.click();
  });
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe("FlowNavigator · what a click costs the server", () => {
  it("reads the flow list ONCE for two sections", async () => {
    const server = fakeServer(manySeats, []);
    mount(server);

    await waitFor(() => expect(kindRow("agent")).toBeTruthy());
    expect(server.listFlows).toHaveBeenCalledTimes(1);
  });

  it("makes ZERO session-list requests when a collection kind holding 40 instances opens", async () => {
    const server = fakeServer(manySeats, []);
    mount(server);

    await waitFor(() => expect(kindRow("agent")).toBeTruthy());
    await click(kindRow("agent"));

    // All forty rows are drawn.
    expect(document.querySelectorAll("[data-instance-id]")).toHaveLength(40);
    // And nothing was asked of the server. Move the fetch up to the kind row
    // and this counter reads 40.
    expect(server.listSessions).toHaveBeenCalledTimes(0);
  });

  it("makes exactly one request when one instance opens", async () => {
    const server = fakeServer(manySeats, []);
    mount(server);

    await waitFor(() => expect(kindRow("agent")).toBeTruthy());
    await click(kindRow("agent"));
    await click(instanceRow("seat-7"));

    await waitFor(() => expect(server.listSessions).toHaveBeenCalledTimes(1));
    expect(server.calls[0]).toEqual({ flowId: "seat-7", userId: "u" });
  });

  it("treats a singleton kind row as the leaf — one request, no instance level", async () => {
    const server = fakeServer(manySeats, []);
    mount(server);

    await waitFor(() => expect(kindRow("chat")).toBeTruthy());
    await click(kindRow("chat"));

    await waitFor(() => expect(server.listSessions).toHaveBeenCalledTimes(1));
    expect(server.calls[0]).toEqual({ flowKind: "chat", userId: "u" });
    expect(document.querySelectorAll('[data-leaf="chat"]')).toHaveLength(1);
  });

  it("does not re-read a leaf on every toggle", async () => {
    const server = fakeServer(manySeats, []);
    mount(server);

    await waitFor(() => expect(kindRow("chat")).toBeTruthy());
    await click(kindRow("chat"));
    await waitFor(() => expect(server.listSessions).toHaveBeenCalledTimes(1));

    await click(kindRow("chat")); // closed — reads nothing
    expect(server.listSessions).toHaveBeenCalledTimes(1);

    await click(kindRow("chat")); // opened again — at most one further read
    await waitFor(() => expect(server.listSessions).toHaveBeenCalledTimes(2));
    expect(server.listSessions).toHaveBeenCalledTimes(2);
  });
});

describe("FlowNavigator · an ownerless session row (BR-12)", () => {
  const flows = [entry("chat", "chat", "singleton"), entry("seat-a", "agent", "collection")];

  it("lists it under a singleton kind, whose address IS its kind", async () => {
    const server = fakeServer(flows, [{ id: "orphan", kind: "chat" }]);
    mount(server);

    await waitFor(() => expect(kindRow("chat")).toBeTruthy());
    await click(kindRow("chat"));

    expect(await screen.findByText("orphan")).toBeTruthy();
  });

  it("never attributes it to an instance of a collection kind", async () => {
    const server = fakeServer(flows, [{ id: "orphan", kind: "agent" }]);
    mount(server);

    await waitFor(() => expect(kindRow("agent")).toBeTruthy());
    await click(kindRow("agent"));
    await click(instanceRow("seat-a"));

    // Not misfiled under a copy that does not own it. The promise is "never
    // misfiled", not "always reachable".
    await waitFor(() => expect(server.listSessions).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("No sessions yet")).toBeTruthy();
    expect(screen.queryByText("orphan")).toBeNull();
  });
});

describe("FlowNavigator · sections", () => {
  it("says so when a section names a kind the server does not have, leaving the other alone", async () => {
    const server = fakeServer([entry("chat", "chat", "singleton")], []);
    mount(server);

    await waitFor(() => expect(kindRow("chat")).toBeTruthy());
    expect(document.querySelector('[data-empty-section="Seats"]')).toBeTruthy();
    // Not an error, and Channels still drew its kind.
    expect(document.querySelectorAll('[role="alert"]')).toHaveLength(0);
  });

  it("does not answer 'nothing registered' before the flow list has answered", async () => {
    let release: (flows: FlowListEntry[]) => void = () => {};
    const server = fakeServer([], []);
    server.listFlows.mockImplementationOnce(
      () => new Promise<FlowListEntry[]>((resolve) => (release = resolve))
    );
    mount(server);

    // In flight: "No seats on this server" is a claim about the server, and we
    // do not have one yet.
    await waitFor(() => expect(screen.queryAllByText("Loading flows…")).toHaveLength(2));
    expect(document.querySelector("[data-empty-section]")).toBeNull();

    await act(async () => {
      release([entry("chat", "chat", "singleton")]);
      await Promise.resolve();
    });

    await waitFor(() => expect(kindRow("chat")).toBeTruthy());
    expect(document.querySelector('[data-empty-section="Seats"]')).toBeTruthy();
  });

  it("surfaces a failed flow-list read with a retry, and retries on demand", async () => {
    const server = fakeServer([], []);
    server.listFlows.mockRejectedValueOnce(new Error("offline"));
    mount(server);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("offline");

    server.listFlows.mockResolvedValue([entry("chat", "chat", "singleton")]);
    await click(screen.getByText("Retry"));
    await waitFor(() => expect(kindRow("chat")).toBeTruthy());
  });

  it("does not answer 'nothing registered' from a read that failed", async () => {
    const server = fakeServer([], []);
    server.listFlows.mockRejectedValue(new Error("offline"));
    mount(server);

    await screen.findByRole("alert");

    // The failure is reported once, above, with its retry. Repeating it per
    // section as "No seats on this server" states the registry is empty on the
    // strength of a request that never came back.
    expect(document.querySelectorAll("[data-empty-section]")).toHaveLength(0);
    expect(screen.queryByText(/on this server/)).toBeNull();
  });
});

describe("FlowNavigator · the published props are an allow-list (V5, BR-3, BR-24)", () => {
  it("publishes exactly these props and no others", () => {
    // Written as the whole set, not as a denylist of three names, so a fourth
    // spelling of "tell it how deep to go" fails too. The type test beside the
    // component proves this list and `keyof FlowNavigatorProps` are equal, so
    // the list cannot drift from the type it stands for.
    expect([...flowNavigatorPropNames]).toEqual([
      "client",
      "includeDispatchRuns",
      "onSelectSession",
      "sections",
      "selectedSessionId",
      "sessionClient",
      "slots",
      "userId",
    ]);
  });

  it("names nothing a host could use to override depth or scope by organization", () => {
    for (const forbidden of ["depth", "levels", "orgId", "organizationId", "maxDepth"]) {
      expect(flowNavigatorPropNames).not.toContain(forbidden);
    }
  });
});

describe("FlowNavigator · the rail at 256px, fully expanded (V6, BR-27)", () => {
  it("indents three levels inside exactly one scroll container", async () => {
    const server = fakeServer(
      [entry("chat", "chat", "singleton"), entry("seat-a", "agent", "collection")],
      [{ id: "s1", kind: "agent", owner: "seat-a" }]
    );
    const { container } = mount(server);

    await waitFor(() => expect(kindRow("agent")).toBeTruthy());
    // Expand everything — a collapsed rail proves nothing here.
    await click(kindRow("chat"));
    await click(kindRow("agent"));
    await click(instanceRow("seat-a"));
    await waitFor(() => expect(screen.queryByText("s1")).toBeTruthy());

    const scrollers = Array.from(container.querySelectorAll<HTMLElement>("*")).filter(
      (el) => el.style.overflowY === "auto" || el.style.overflowY === "scroll"
    );
    // Mount the component twice instead of once and this reads 2.
    expect(scrollers).toHaveLength(1);

    const indents = new Set(
      [
        kindRow("agent"),
        instanceRow("seat-a"),
        document.querySelector<HTMLElement>('[data-session-id="s1"]')!,
      ].map((el) => el.style.paddingLeft)
    );
    expect(indents.size).toBe(3);
  });
});

describe("FlowNavigator · slots (BR-17)", () => {
  it("fills host affordances without publishing a class name", async () => {
    const server = fakeServer(
      [entry("seat-a", "agent", "collection")],
      [{ id: "s1", kind: "agent", owner: "seat-a" }]
    );
    mount(server, {
      slots: {
        rowTrailing: (row: { type: string }) =>
          createElement("span", { "data-slot": row.type }, "·"),
        leafToolbar: (leaf: { address: string }) =>
          createElement("button", { type: "button", "data-toolbar": leaf.address }, "Refresh"),
        sectionHeader: () => createElement("span", { "data-section-slot": "" }, "+"),
      },
    });

    await waitFor(() => expect(kindRow("agent")).toBeTruthy());
    await click(kindRow("agent"));
    await click(instanceRow("seat-a"));

    await waitFor(() =>
      expect(document.querySelector('[data-toolbar="seat-a"]')).toBeTruthy()
    );
    expect(document.querySelectorAll('[data-slot="kind"]')).toHaveLength(1);
    expect(document.querySelectorAll('[data-slot="instance"]')).toHaveLength(1);
    expect(document.querySelectorAll('[data-slot="session"]')).toHaveLength(1);
    expect(document.querySelectorAll("[data-section-slot]")).toHaveLength(2);

    // Nothing in the rendered tree carries a class the host could target.
    const classed = Array.from(document.querySelectorAll("[class]")).filter(
      (el) => el.getAttribute("class")!.trim().length > 0
    );
    expect(classed).toHaveLength(0);
  });
});

describe("FlowNavigator · a host affordance is beside the row, not inside it", () => {
  // `rowTrailing` exists so a host can hang its own affordances off a row —
  // copy this id, start a session — and those are buttons and links. Rendered
  // as a CHILD of the row's activation button, two things break at once: the
  // markup nests one interactive element inside another, which keyboard and
  // assistive-technology traversal cannot represent, and the host's click has
  // nowhere to go but up into the row handler.
  const flows = [
    entry("chat", "chat", "singleton"),
    entry("seat-a", "agent", "collection"),
  ];

  const withAffordance = (server: ReturnType<typeof fakeServer>) =>
    mount(server, {
      slots: {
        rowTrailing: (r: { type: string }) =>
          createElement(
            "button",
            { type: "button", "data-affordance": r.type, onClick: () => {} },
            "Copy"
          ),
        // The leaf toolbar is filled too, and with a BUTTON. Its host renders
        // it inside an `li` rather than inside the row's activation button,
        // and the rail-wide assertion below is what keeps it there — which it
        // cannot do for a slot no case ever mounts.
        leafToolbar: () =>
          createElement("button", { type: "button", onClick: () => {} }, "New session"),
      },
    });

  // Scoped to ONE row's own frame. Two sections mean two `data-affordance`
  // elements of the same type, and a document-wide lookup silently compares
  // the agent row against the chat row's affordance — a pair that is unnested
  // even on the broken code, so the assertion passes for the wrong reason.
  const trailingOf = (rowButton: HTMLElement) =>
    rowButton.parentElement!.querySelector<HTMLButtonElement>("[data-affordance]")!;

  it("keeps it out of the kind row's button, and its click off the row handler", async () => {
    const server = fakeServer(flows, []);
    withAffordance(server);

    await waitFor(() => expect(kindRow("agent")).toBeTruthy());
    const trailing = trailingOf(kindRow("agent"));
    expect(trailing.getAttribute("data-affordance")).toBe("kind");
    expect(kindRow("agent").contains(trailing)).toBe(false);

    await click(trailing);
    // Pressing "copy" must not also expand the kind.
    expect(kindRow("agent").getAttribute("aria-expanded")).toBe("false");
    expect(document.querySelectorAll("[data-instance-id]")).toHaveLength(0);
  });

  it("keeps it out of the instance row's button, and its click off the row handler", async () => {
    const server = fakeServer(flows, [{ id: "s1", kind: "agent", owner: "seat-a" }]);
    withAffordance(server);

    await waitFor(() => expect(kindRow("agent")).toBeTruthy());
    await click(kindRow("agent"));

    const trailing = trailingOf(instanceRow("seat-a"));
    expect(trailing.getAttribute("data-affordance")).toBe("instance");
    expect(instanceRow("seat-a").contains(trailing)).toBe(false);

    await click(trailing);
    expect(instanceRow("seat-a").getAttribute("aria-expanded")).toBe("false");
    // The row never opened, so no leaf read was made.
    expect(server.listSessions).toHaveBeenCalledTimes(0);
  });

  it("keeps it out of the session row's button, and its click off the selection handler", async () => {
    const picked: string[] = [];
    const server = fakeServer(flows, [{ id: "s1", kind: "chat" }]);
    mount(server, {
      onSelectSession: (id: string) => picked.push(id),
      slots: {
        rowTrailing: (r: { type: string }) =>
          createElement(
            "button",
            { type: "button", "data-affordance": r.type, onClick: () => {} },
            "Copy"
          ),
      },
    });

    await waitFor(() => expect(kindRow("chat")).toBeTruthy());
    await click(kindRow("chat"));

    const sessionRow = await waitFor(() =>
      document.querySelector<HTMLButtonElement>('[data-session-id="s1"]')!
    );
    const trailing = trailingOf(sessionRow);
    expect(trailing.getAttribute("data-affordance")).toBe("session");
    expect(sessionRow.contains(trailing)).toBe(false);

    await click(trailing);
    expect(picked).toEqual([]);
  });

  it("renders no interactive element inside another, anywhere in the rail", async () => {
    const server = fakeServer(flows, [{ id: "s1", kind: "agent", owner: "seat-a" }]);
    withAffordance(server);

    await waitFor(() => expect(kindRow("agent")).toBeTruthy());
    await click(kindRow("agent"));
    await click(instanceRow("seat-a"));
    await waitFor(() => expect(screen.queryByText("s1")).toBeTruthy());

    // Includes `leafToolbar`'s host, which renders inside an `li` rather than
    // a button — this is the assertion that keeps it that way.
    const nested = Array.from(
      document.querySelectorAll("button, a[href]")
    ).filter((el) => el.parentElement?.closest("button, a[href]") != null);
    expect(nested).toEqual([]);
  });
});

describe("FlowNavigator · selection", () => {
  it("reports the session AND the leaf it was listed under", async () => {
    const picked: unknown[] = [];
    const server = fakeServer(
      [entry("seat-a", "agent", "collection")],
      [{ id: "s1", kind: "agent", owner: "seat-a" }]
    );
    mount(server, { onSelectSession: (id: string, leaf: unknown) => picked.push([id, leaf]) });

    await waitFor(() => expect(kindRow("agent")).toBeTruthy());
    await click(kindRow("agent"));
    await click(instanceRow("seat-a"));
    await click(await screen.findByText("s1"));

    expect(picked).toEqual([
      ["s1", { kind: "agent", address: "seat-a", cardinality: "collection" }],
    ]);
  });
});
