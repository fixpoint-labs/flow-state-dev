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
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement, useEffect } from "react";
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

const session = (id: string, flowId?: string, title?: string): SessionSummary =>
  ({
    id,
    flowKind: "agent",
    userId: "u",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...(flowId === undefined ? {} : { flowId }),
    ...(title === undefined ? {} : { title }),
  }) as unknown as SessionSummary;

/**
 * A session store that filters the way `handleListSessions` does: `flowId` is
 * an exact owner and never matches a row with no owner recorded; `flowKind`
 * matches by kind, ownerless rows included.
 */
function fakeServer(
  flows: FlowListEntry[],
  rows: { id: string; kind: string; owner?: string; title?: string }[]
) {
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
        .map((row) => session(row.id, row.owner, row.title));
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
  // Where the three levels' labels land is measured on the rendered page, in
  // the kitchen-sink end-to-end suite: this DOM has no layout, and comparing
  // padding values passes on a rail whose labels land in the wrong column.
  it("stays inside exactly one scroll container", async () => {
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
        // The leaf toolbar is filled too, and with a BUTTON. It draws on the
        // leaf's own row, beside the activation button rather than inside it,
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

    // Includes `leafToolbar`'s host, which draws on the leaf's row beside its
    // button rather than in it — this is the assertion that keeps it that way.
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

describe("FlowNavigator · an open leaf's toolbar sits on the leaf's own row (BR-1 – BR-3, BR-7)", () => {
  const flows = [entry("chat", "chat", "singleton"), entry("seat-a", "agent", "collection")];

  /** Counts its own mounts and unmounts, the way a host's toolbar effects would. */
  const lifecycle = { mounted: 0, unmounted: 0 };
  function Toolbar(props: { address: string }) {
    useEffect(() => {
      lifecycle.mounted += 1;
      return () => {
        lifecycle.unmounted += 1;
      };
    }, []);
    return createElement("button", { type: "button", "data-toolbar": props.address }, "New session");
  }

  const withToolbar = (server: ReturnType<typeof fakeServer>) =>
    mount(server, {
      slots: {
        rowTrailing: (r: { type: string }) =>
          r.type === "instance"
            ? createElement("button", { type: "button", "data-copy": "" }, "Copy")
            : null,
        leafToolbar: (leaf: { address: string }) => createElement(Toolbar, { address: leaf.address }),
      },
    });

  beforeEach(() => {
    lifecycle.mounted = 0;
    lifecycle.unmounted = 0;
  });

  it("draws it in the instance row's frame, after the row's own trailing content, never in the button", async () => {
    const server = fakeServer(flows, [{ id: "s1", kind: "agent", owner: "seat-a" }]);
    withToolbar(server);

    await waitFor(() => expect(kindRow("agent")).toBeTruthy());
    await click(kindRow("agent"));
    // Closed: the row's own copy is drawn, the leaf's actions are not.
    expect(instanceRow("seat-a").parentElement!.querySelector("[data-copy]")).toBeTruthy();
    expect(document.querySelector("[data-toolbar]")).toBeNull();

    await click(instanceRow("seat-a"));
    const toolbar = await waitFor(() => {
      const found = document.querySelector<HTMLElement>('[data-toolbar="seat-a"]');
      expect(found).toBeTruthy();
      return found!;
    });
    const frame = instanceRow("seat-a").parentElement!;
    expect(frame.contains(toolbar)).toBe(true);
    expect(instanceRow("seat-a").contains(toolbar)).toBe(false);
    // Nothing of the toolbar's is left under the row as a line of its own.
    expect(document.querySelector('[data-leaf="seat-a"]')!.contains(toolbar)).toBe(false);

    // Tab order follows the DOM: the row, its own copy, then the leaf's actions.
    const copy = frame.querySelector("[data-copy]")!;
    const follows = (a: Node, b: Node) =>
      (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
    expect(follows(instanceRow("seat-a"), copy)).toBe(true);
    expect(follows(copy, toolbar)).toBe(true);
  });

  it("draws a singleton's toolbar on its kind row, which is its leaf", async () => {
    const server = fakeServer(flows, [{ id: "c1", kind: "chat" }]);
    withToolbar(server);

    await waitFor(() => expect(kindRow("chat")).toBeTruthy());
    await click(kindRow("chat"));
    const toolbar = await waitFor(() => {
      const found = document.querySelector<HTMLElement>('[data-toolbar="chat"]');
      expect(found).toBeTruthy();
      return found!;
    });
    expect(kindRow("chat").parentElement!.contains(toolbar)).toBe(true);
    expect(kindRow("chat").contains(toolbar)).toBe(false);
  });

  it("mounts it when the leaf opens and unmounts it when the leaf closes", async () => {
    const server = fakeServer(flows, []);
    withToolbar(server);

    await waitFor(() => expect(kindRow("agent")).toBeTruthy());
    await click(kindRow("agent"));
    expect(lifecycle).toEqual({ mounted: 0, unmounted: 0 });

    await click(instanceRow("seat-a"));
    await waitFor(() => expect(lifecycle).toEqual({ mounted: 1, unmounted: 0 }));

    await click(instanceRow("seat-a"));
    expect(lifecycle).toEqual({ mounted: 1, unmounted: 1 });
    expect(document.querySelector("[data-toolbar]")).toBeNull();
  });

  it("keeps the row's button, and its focus, across a toggle, with one read per open", async () => {
    const server = fakeServer(flows, []);
    withToolbar(server);

    await waitFor(() => expect(kindRow("agent")).toBeTruthy());
    await click(kindRow("agent"));
    const button = instanceRow("seat-a");
    button.focus();

    await click(button);
    await waitFor(() => expect(document.querySelector('[data-toolbar="seat-a"]')).toBeTruthy());
    expect(instanceRow("seat-a")).toBe(button);
    expect(document.activeElement).toBe(button);
    expect(server.listSessions).toHaveBeenCalledTimes(1);

    await click(button);
    expect(instanceRow("seat-a")).toBe(button);
    expect(document.activeElement).toBe(button);
    expect(server.listSessions).toHaveBeenCalledTimes(1);
  });
});

describe("FlowNavigator · session labels (BR-16 – BR-19)", () => {
  const sessionRow = (id: string) =>
    document.querySelector<HTMLElement>(`[data-session-id="${id}"]`)!;

  it("shows a title, a short engine id, or the id whole, with the full id as the tooltip", async () => {
    const server = fakeServer(
      [entry("chat", "chat", "singleton")],
      [
        { id: "sess_1790206121611_42636c63df102", kind: "chat", title: "Refund for order 4417" },
        { id: "sess_1790206133090_9f1e07ab55c3", kind: "chat" },
        { id: "support.noticeboard", kind: "chat" },
        { id: "sess_1790206140712_0c4d2e91aa7f", kind: "chat", title: "" },
      ]
    );
    const picked: string[] = [];
    mount(server, { onSelectSession: (id: string) => picked.push(id) });

    await waitFor(() => expect(kindRow("chat")).toBeTruthy());
    await click(kindRow("chat"));
    await waitFor(() => expect(sessionRow("support.noticeboard")).toBeTruthy());

    expect(sessionRow("sess_1790206121611_42636c63df102").textContent).toBe("Refund for order 4417");
    // The prefix says what it is; the tail is what tells two apart.
    expect(sessionRow("sess_1790206133090_9f1e07ab55c3").textContent).toBe("sess_…ab55c3");
    // Not engine-shaped, so nothing to shorten: a channel reads as its name.
    expect(sessionRow("support.noticeboard").textContent).toBe("support.noticeboard");
    // An empty title is no title.
    expect(sessionRow("sess_1790206140712_0c4d2e91aa7f").textContent).toBe("sess_…91aa7f");

    for (const id of [
      "sess_1790206121611_42636c63df102",
      "sess_1790206133090_9f1e07ab55c3",
      "support.noticeboard",
      "sess_1790206140712_0c4d2e91aa7f",
    ]) {
      expect(sessionRow(id).title).toBe(id);
    }
    // What the row reports when picked is the id, not the label.
    await click(sessionRow("sess_1790206133090_9f1e07ab55c3"));
    expect(picked).toEqual(["sess_1790206133090_9f1e07ab55c3"]);
  });
});

describe("FlowNavigator · tree lines (BR-26 – BR-28)", () => {
  const guidesUnder = (rowButton: HTMLElement) => {
    const list = rowButton.closest("li")!.querySelector(":scope > ul");
    return list === null
      ? []
      : (Array.from(list.children).filter(
          (c) => c.getAttribute("aria-hidden") === "true"
        ) as HTMLElement[]);
  };

  it("hangs one decorative line under each open parent and none under a closed one", async () => {
    const server = fakeServer(
      [
        entry("chat", "chat", "singleton"),
        entry("seat-a", "agent", "collection"),
        entry("seat-b", "agent", "collection"),
      ],
      [{ id: "s1", kind: "agent", owner: "seat-a" }]
    );
    mount(server);

    await waitFor(() => expect(kindRow("agent")).toBeTruthy());
    await click(kindRow("agent"));
    await click(instanceRow("seat-a"));
    await click(kindRow("chat"));
    // An open leaf holding only a note still gets its line.
    await waitFor(() => expect(screen.queryByText("No sessions yet")).toBeTruthy());

    for (const parent of [kindRow("agent"), instanceRow("seat-a"), kindRow("chat")]) {
      const guides = guidesUnder(parent);
      expect(guides).toHaveLength(1);
      // Out of flow and inert, so drawing it moves no row and takes no click.
      expect(guides[0]!.style.position).toBe("absolute");
      expect(guides[0]!.style.pointerEvents).toBe("none");
      expect(guides[0]!.style.borderLeftStyle).toBe("dashed");
    }
    expect(guidesUnder(instanceRow("seat-b"))).toHaveLength(0);
  });
});

describe("FlowNavigator · row actions show on hover or focus (BR-29 – BR-34)", () => {
  const flows = [entry("chat", "chat", "singleton"), entry("seat-a", "agent", "collection")];
  // The area holding the row's actions: the parent of what the host put there.
  const trailingOf = (rowButton: HTMLElement) =>
    rowButton.parentElement!.querySelector<HTMLElement>("[data-affordance]")!.parentElement!;
  const opacity = (rowButton: HTMLElement) => trailingOf(rowButton).style.opacity;

  const withAffordances = (
    server: ReturnType<typeof fakeServer>,
    props: Record<string, unknown> = {}
  ) => {
    const rowTrailing = vi.fn((r: { type: string }) =>
      createElement("button", { type: "button", "data-affordance": r.type }, "Copy")
    );
    mount(server, { slots: { rowTrailing }, ...props });
    return rowTrailing;
  };

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("hides a row's actions until the pointer is over it, re-rendering no other row", async () => {
    const server = fakeServer(flows, []);
    const rowTrailing = withAffordances(server);

    await waitFor(() => expect(kindRow("agent")).toBeTruthy());
    await click(kindRow("agent"));
    await click(instanceRow("seat-a"));
    // Open is not enough: an open leaf's row stays quiet until pointed at.
    expect(opacity(instanceRow("seat-a"))).toBe("0");
    expect(opacity(kindRow("agent"))).toBe("0");

    const calls = rowTrailing.mock.calls.length;
    const frame = instanceRow("seat-a").parentElement!;
    await act(async () => {
      fireEvent.mouseEnter(frame);
    });
    expect(opacity(instanceRow("seat-a"))).toBe("1");
    expect(opacity(kindRow("agent"))).toBe("0");
    // Only the pointed-at row re-rendered: no slot was asked for anything again.
    expect(rowTrailing.mock.calls.length).toBe(calls);

    await act(async () => {
      fireEvent.mouseLeave(frame);
    });
    expect(opacity(instanceRow("seat-a"))).toBe("0");
  });

  it("shows them while focus is anywhere in the row, and hides them without removing them", async () => {
    const server = fakeServer(flows, []);
    withAffordances(server);

    await waitFor(() => expect(kindRow("agent")).toBeTruthy());
    const affordance = kindRow("agent").parentElement!.querySelector<HTMLButtonElement>(
      "[data-affordance]"
    )!;
    // Hidden, and still in the tab order.
    expect(opacity(kindRow("agent"))).toBe("0");
    expect(trailingOf(kindRow("agent")).style.display).not.toBe("none");
    expect(trailingOf(kindRow("agent")).style.visibility).not.toBe("hidden");
    expect(affordance.tabIndex).toBe(0);

    await act(async () => {
      affordance.focus();
    });
    expect(opacity(kindRow("agent"))).toBe("1");

    await act(async () => {
      kindRow("chat").focus();
    });
    expect(opacity(kindRow("agent"))).toBe("0");
  });

  it("keeps a selected row's actions shown", async () => {
    const server = fakeServer(flows, [
      { id: "c1", kind: "chat" },
      { id: "c2", kind: "chat" },
    ]);
    withAffordances(server, { selectedSessionId: "c1" });

    await waitFor(() => expect(kindRow("chat")).toBeTruthy());
    await click(kindRow("chat"));
    const sessionRow = (id: string) =>
      document.querySelector<HTMLElement>(`[data-session-id="${id}"]`)!;
    await waitFor(() => expect(sessionRow("c1")).toBeTruthy());
    expect(opacity(sessionRow("c1"))).toBe("1");
    expect(opacity(sessionRow("c2"))).toBe("0");
  });

  it("always shows them on a screen with no hover pointer", async () => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query === "(hover: none)",
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    const server = fakeServer(flows, []);
    withAffordances(server);

    await waitFor(() => expect(kindRow("agent")).toBeTruthy());
    expect(opacity(kindRow("agent"))).toBe("1");
    expect(opacity(kindRow("chat"))).toBe("1");
  });
});
