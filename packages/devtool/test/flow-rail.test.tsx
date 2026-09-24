/**
 * The developer tool as the navigator's SECOND host (FIX-1477 V7).
 *
 * This is the reusability proof, so almost nothing here is mocked. The
 * provider is the real one, the clients are the real factories, and the
 * transport is a stubbed `fetch` that records what actually went over it —
 * because the failure this check exists to catch is a component that quietly
 * builds its own client. That component lists flows perfectly well (the flow
 * list route is exempt from authorization) and then 401s on every session read
 * under it, which is a split a DOM-only assertion sails straight past.
 *
 * The deletion half is asserted on the filesystem AND on the rendered DOM. A
 * file check alone passes against a hand-rolled replacement living under a
 * different name, which is the promotion-that-shipped-twice this issue exists
 * to prevent.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { act, render, screen, waitFor } from "@testing-library/react";
import { DevToolProvider } from "../src/react/context/devtool-context";
import { FlowRail } from "../src/react/components/flows/flow-rail";

const BEARER = "s3cret-token";

type Call = { url: string; authorization: string | null };

let calls: Call[] = [];

/** The flow list every case below is pointed at, unless it says otherwise. */
const FLOWS = [
  { id: "chat", kind: "chat", cardinality: "singleton", requireUser: false, actions: ["send"] },
  {
    id: "engineer-a",
    kind: "engineer",
    cardinality: "collection",
    requireUser: false,
    actions: ["inspect", "halt"],
  },
  {
    id: "engineer-b",
    kind: "engineer",
    cardinality: "collection",
    requireUser: false,
    actions: [],
  },
];

const SESSIONS: Record<string, { id: string; title?: string }[]> = {
  "flowId=engineer-a": [{ id: "sess-a", title: "A's work" }],
  "flowId=engineer-b": [{ id: "sess-b", title: "B's work" }],
  "flowKind=chat": [{ id: "sess-chat", title: "Chat" }],
};

function stubTransport() {
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      calls.push({
        url,
        authorization: new Headers(init?.headers).get("authorization"),
      });

      const body = url.includes("/api/flows/sessions")
        ? {
            sessions: (
              Object.entries(SESSIONS).find(([key]) => url.includes(key))?.[1] ?? []
            ).map((session) => ({
              ...session,
              flowKind: "x",
              userId: "devuser",
              createdAt: "2026-01-01T00:00:00.000Z",
              updatedAt: "2026-01-01T00:00:00.000Z",
            })),
          }
        : { flows: FLOWS };

      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }),
  );
}

function mount(props: Record<string, unknown> = {}, userId = "devuser") {
  return render(
    <DevToolProvider initialConfig={{ userId, bearerToken: BEARER }} userIdControl="host">
      <FlowRail {...props} />
    </DevToolProvider>,
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

const sessionCalls = () => calls.filter((call) => call.url.includes("/api/flows/sessions"));

beforeEach(() => {
  stubTransport();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the developer tool renders the SHIPPED navigator", () => {
  it("has no navigator folder of its own left", () => {
    const components = resolve(process.cwd(), "src/react/components");
    // The sibling that MUST be there. Without it a wrong working directory
    // would make the real assertion below pass by looking at nothing, which is
    // the way a file check quietly stops being one.
    expect(existsSync(resolve(components, "flows"))).toBe(true);
    expect(existsSync(resolve(components, "navigator"))).toBe(false);
  });

  it("draws the package's rail, grouped by kind rather than flat over instances", async () => {
    mount();

    // The component's own marker — this is the shipped rail, not a look-alike.
    await waitFor(() =>
      expect(document.querySelector("[data-fsd-flow-navigator]")).toBeTruthy(),
    );

    // Two copies of one kind are ONE row with the copies under it. The tool's
    // own list drew them as two top-level rows, so this assertion is exactly
    // what a hand-rolled replacement would fail.
    expect(
      Array.from(document.querySelectorAll("[data-kind]")).map((el) =>
        el.getAttribute("data-kind"),
      ),
    ).toEqual(["chat", "engineer"]);
    expect(document.querySelectorAll("[data-instance-id]")).toHaveLength(0);

    await click(kindRow("engineer"));
    expect(
      Array.from(document.querySelectorAll("[data-instance-id]")).map((el) =>
        el.getAttribute("data-instance-id"),
      ),
    ).toEqual(["engineer-a", "engineer-b"]);
  });

  it("lists every kind the inspected server has, without being told their names", async () => {
    // The tool is pointed at an arbitrary server. `chat` and `engineer` are
    // this fixture's words, not the tool's — nothing in its source names
    // either, so a rail that only drew kinds it had been given would be empty.
    mount();
    await waitFor(() => expect(kindRow("engineer")).toBeTruthy());
    expect(kindRow("chat")).toBeTruthy();
  });

  it("reads the flow list a bounded number of times, however many rows it draws", async () => {
    // TWO, and the second one is the point: the navigator reads the flow list
    // for the rail, and this tool separately keeps its own copy because the
    // panel outside the rail needs it — for the action bar, and to empty the
    // workspace when the copy it was on leaves the catalog. The component does
    // not publish its inventory, deliberately, so a host needing flow data
    // anywhere else reads it again.
    //
    // What matters is that the number is bounded by the HOST and not by the
    // rows: this fixture draws two kinds and two copies, and a read that had
    // crept down to the row level would read four or more.
    mount();
    await waitFor(() => expect(kindRow("engineer")).toBeTruthy());
    await click(kindRow("engineer"));
    await click(instanceRow("engineer-a"));
    await click(instanceRow("engineer-b"));

    expect(calls.filter((call) => call.url.endsWith("/api/flows"))).toHaveLength(2);
  });

  it("asks the server nothing when a kind holding two copies is opened", async () => {
    mount();
    await waitFor(() => expect(kindRow("engineer")).toBeTruthy());
    expect(sessionCalls()).toHaveLength(0);

    await click(kindRow("engineer"));

    expect(document.querySelectorAll("[data-instance-id]")).toHaveLength(2);
    expect(sessionCalls()).toHaveLength(0);
  });
});

describe("the tool's own transport survives the move (BR-29)", () => {
  it("sends the bearer token on the LEAF read, not only on the flow list", async () => {
    mount();
    await waitFor(() => expect(kindRow("engineer")).toBeTruthy());

    // The flow list is the half that passes either way — its route is exempt,
    // so a component holding its own unauthenticated client still fills the
    // rail. Asserted anyway, so the case below cannot be read as "nothing
    // loaded".
    const flowList = calls.filter((call) => call.url.endsWith("/api/flows"));
    expect(flowList).not.toHaveLength(0);
    expect(flowList.every((call) => call.authorization === `Bearer ${BEARER}`)).toBe(true);

    await click(kindRow("engineer"));
    await click(instanceRow("engineer-a"));
    await waitFor(() => expect(sessionCalls()).not.toHaveLength(0));

    // This is the half that fails when a component builds its own client.
    expect(sessionCalls().every((call) => call.authorization === `Bearer ${BEARER}`)).toBe(
      true,
    );
  });

  it("re-lists through the rebuilt client when the operator identity changes", async () => {
    // Sessions are per user as well as per copy, so the rows on screen belong
    // to whoever was signed in when they were read. A Settings change rebuilds
    // every client, and the rail must not sit there showing the previous
    // operator's list.
    const { rerender } = render(
      <DevToolProvider
        initialConfig={{ userId: "devuser", bearerToken: BEARER }}
        userIdControl="host"
      >
        <FlowRail />
      </DevToolProvider>,
    );
    await waitFor(() => expect(kindRow("chat")).toBeTruthy());
    await click(kindRow("chat"));
    await waitFor(() => expect(sessionCalls()).not.toHaveLength(0));
    expect(sessionCalls().every((call) => call.url.includes("userId=devuser"))).toBe(true);

    await act(async () => {
      rerender(
        <DevToolProvider
          initialConfig={{ userId: "someone-else", bearerToken: BEARER }}
          userIdControl="host"
        >
          <FlowRail />
        </DevToolProvider>,
      );
    });

    await waitFor(() =>
      expect(
        sessionCalls().some((call) => call.url.includes("userId=someone-else")),
      ).toBe(true),
    );
  });

  it("settles instead of re-reading forever, because the tool's clients are stable", async () => {
    // The navigator fences its reads on the client it read through. A host
    // handing it a fresh object every render reads as a rebuilt client every
    // render, and the rail spins rather than failing — a hang, not an error.
    // The tool holds its clients in provider state, and this is what says so.
    //
    // A LEAF IS OPEN for this, and that is the whole point: with the rail
    // collapsed the only read in flight is the flow list, so a test that
    // stopped here would be blind to an unstable SESSION client — which is the
    // half a host is most likely to get wrong, because it is the one passed
    // down into a slot-bearing subtree. Opening a leaf puts both fences in
    // play.
    mount();
    await waitFor(() => expect(kindRow("chat")).toBeTruthy());
    await click(kindRow("chat"));
    await waitFor(() => expect(sessionCalls()).toHaveLength(1));

    const settled = calls.length;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 120));
    });
    expect(calls.length).toBe(settled);
    expect(sessionCalls()).toHaveLength(1);
  });
});

describe("the tool's three affordances, as slots", () => {
  it("copies a copy's id from beside the row, without opening it", async () => {
    const writeText = vi.fn();
    vi.stubGlobal("navigator", { ...globalThis.navigator, clipboard: { writeText } });
    mount();

    await waitFor(() => expect(kindRow("engineer")).toBeTruthy());
    await click(kindRow("engineer"));

    const copy = screen.getByLabelText("Copy instance ID engineer-a");
    await click(copy);

    expect(writeText).toHaveBeenCalledWith("engineer-a");
    // Pressing copy must not also expand the row — the defect this slot had.
    expect(instanceRow("engineer-a").getAttribute("aria-expanded")).toBe("false");
    expect(sessionCalls()).toHaveLength(0);
  });

  it("nests no interactive element inside another, with the tool's real affordances filled in", async () => {
    // Every slot this host actually uses is populated here, which is what
    // separates this from the package's own version of the assertion: that one
    // fills `rowTrailing` with a stub and never mounts a leaf toolbar at all.
    mount();
    await waitFor(() => expect(kindRow("engineer")).toBeTruthy());
    await click(kindRow("engineer"));
    await click(instanceRow("engineer-a"));
    await waitFor(() => expect(screen.queryByTitle("New session")).toBeTruthy());

    const nested = Array.from(document.querySelectorAll("button, a[href]")).filter(
      (el) => el.parentElement?.closest("button, a[href]") != null,
    );
    expect(nested.map((el) => el.textContent)).toEqual([]);
  });

  it("re-reads one leaf's sessions on ⟳, and brings the open session with it", async () => {
    const onRefreshActiveSession = vi.fn();
    mount({ onRefreshActiveSession });

    await waitFor(() => expect(kindRow("chat")).toBeTruthy());
    await click(kindRow("chat"));
    await waitFor(() => expect(sessionCalls()).toHaveLength(1));

    await click(screen.getByTitle("Refresh sessions"));

    await waitFor(() => expect(sessionCalls()).toHaveLength(2));
    expect(onRefreshActiveSession).toHaveBeenCalledTimes(1);
  });

  it("starts a session on the copy the row names, and lists it", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: unknown, init?: RequestInit) => {
        const url = String(input);
        calls.push({
          url,
          authorization: new Headers(init?.headers).get("authorization"),
        });
        if (init?.method === "POST") {
          return new Response(JSON.stringify({ session: { id: "brand-new" } }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        const body = url.includes("/api/flows/sessions")
          ? { sessions: [] }
          : { flows: FLOWS };
        return new Response(JSON.stringify(body), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }),
    );

    mount();
    await waitFor(() => expect(kindRow("engineer")).toBeTruthy());
    await click(kindRow("engineer"));
    await click(instanceRow("engineer-b"));
    await waitFor(() => expect(screen.queryByTitle("New session")).toBeTruthy());

    await click(screen.getByTitle("New session"));

    // Addressed to engineer-b, the copy whose row it was pressed on — not to
    // `engineer`, which names both copies.
    const created = await waitFor(() => {
      const call = calls.find((c) => c.url.includes("engineer-b") && !c.url.includes("flowId"));
      expect(call).toBeTruthy();
      return call!;
    });
    expect(created.authorization).toBe(`Bearer ${BEARER}`);
  });

  it("says a failed start on the row it was pressed on, adding no line under it", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: unknown, init?: RequestInit) => {
        const url = String(input);
        if (init?.method === "POST") {
          return new Response(JSON.stringify({ error: "Seat is not accepting sessions" }), {
            status: 500,
            headers: { "content-type": "application/json" },
          });
        }
        const body = url.includes("/api/flows/sessions") ? { sessions: [] } : { flows: FLOWS };
        return new Response(JSON.stringify(body), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }),
    );

    mount();
    await waitFor(() => expect(kindRow("engineer")).toBeTruthy());
    await click(kindRow("engineer"));
    await click(instanceRow("engineer-b"));
    await waitFor(() => expect(screen.queryByTitle("New session")).toBeTruthy());

    await click(screen.getByTitle("New session"));

    const alert = await waitFor(() => {
      const found = document.querySelector<HTMLElement>('[role="alert"]');
      expect(found).toBeTruthy();
      return found!;
    });
    // On the row it was pressed on, announced, and not a line of its own.
    expect(instanceRow("engineer-b").parentElement!.contains(alert)).toBe(true);
    expect(alert.textContent).toContain("Request failed (500)");
    expect(document.querySelector('[data-leaf="engineer-b"]')!.contains(alert)).toBe(false);
  });
});

describe("the async fence around starting a session", () => {
  it("does not move the workspace to the created session once the operator has opened a different copy while the create was in flight", async () => {
    let resolvePost!: (response: Response) => void;
    const postPending = new Promise<Response>((resolve) => {
      resolvePost = resolve;
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: unknown, init?: RequestInit) => {
        const url = String(input);
        calls.push({
          url,
          authorization: new Headers(init?.headers).get("authorization"),
        });
        if (init?.method === "POST") {
          return postPending;
        }
        const body = url.includes("/api/flows/sessions")
          ? {
              sessions: (
                Object.entries(SESSIONS).find(([key]) => url.includes(key))?.[1] ?? []
              ).map((session) => ({
                ...session,
                flowKind: "x",
                userId: "devuser",
                createdAt: "2026-01-01T00:00:00.000Z",
                updatedAt: "2026-01-01T00:00:00.000Z",
              })),
            }
          : { flows: FLOWS };
        return new Response(JSON.stringify(body), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }),
    );

    mount();
    await waitFor(() => expect(kindRow("engineer")).toBeTruthy());
    await click(kindRow("engineer"));
    await click(instanceRow("engineer-b"));
    await waitFor(() => expect(screen.queryByTitle("New session")).toBeTruthy());

    // Start a session on engineer-b. The POST hangs, unresolved.
    await click(screen.getByTitle("New session"));
    await waitFor(() =>
      expect(
        calls.some((c) => c.url.includes("engineer-b") && !c.url.includes("flowId")),
      ).toBe(true),
    );

    // While it's in flight, the operator opens a DIFFERENT copy's existing
    // session — the workspace moves to engineer-a/sess-a.
    await click(instanceRow("engineer-a"));
    await click(await screen.findByText("A's work"));
    await waitFor(() =>
      expect(Object.keys(localStorage).some((key) => key.includes("engineer-a"))).toBe(
        true,
      ),
    );

    // Now the stale create resolves.
    await act(async () => {
      resolvePost(
        new Response(JSON.stringify({ session: { id: "brand-new" } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    // The stale resolution must not yank the workspace back to engineer-b
    // under the session it just created — the operator is on engineer-a now.
    // The hint's KEY carries the instance id; its VALUE is the session id
    // (see `config.ts`), so engineer-b's hint (if any) must not have become
    // "brand-new".
    const engineerBKey = Object.keys(localStorage).find((key) => key.includes("engineer-b"));
    const engineerBHint = engineerBKey ? localStorage.getItem(engineerBKey) : null;
    expect(engineerBHint).not.toBe("brand-new");

    // engineer-a's hint — the workspace the operator actually moved to —
    // must still be the one they picked, not overwritten by the late create.
    const engineerAKey = Object.keys(localStorage).find((key) => key.includes("engineer-a"));
    expect(engineerAKey ? localStorage.getItem(engineerAKey) : null).toBe("sess-a");

    // And no stale error banner from a create that no longer belongs here.
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("what the rail reports to the rest of the tool", () => {
  it("moves the workspace to the exact copy a picked session was listed under", async () => {
    mount();
    await waitFor(() => expect(kindRow("engineer")).toBeTruthy());
    await click(kindRow("engineer"));
    await click(instanceRow("engineer-b"));

    await click(await screen.findByText("B's work"));

    // The session hint is written under the copy it was opened on. A kind
    // there would offer one copy's session to its peer on the next visit.
    await waitFor(() =>
      expect(
        Object.keys(localStorage).some(
          (key) => key.includes("engineer-b") && !key.includes("engineer-a"),
        ),
      ).toBe(true),
    );
  });

  it("re-lists an open leaf when the panel signals a metadata change", async () => {
    // A title arrives over SSE after the first turn, and the rail has to pick
    // it up. The navigator publishes no handle for this, so the signal rides
    // the leaf toolbar; if that wiring breaks, titles go stale silently.
    //
    // ONE config object across both renders. The provider treats a fresh one
    // as a host swapping identity and rebuilds its clients, which re-reads the
    // leaf on its own — a third call that would let this pass without the
    // signal ever arriving.
    const config = { userId: "devuser", bearerToken: BEARER };
    const { rerender } = render(
      <DevToolProvider initialConfig={config} userIdControl="host">
        <FlowRail sessionRefreshKey={0} />
      </DevToolProvider>,
    );
    await waitFor(() => expect(kindRow("chat")).toBeTruthy());
    await click(kindRow("chat"));
    await waitFor(() => expect(sessionCalls()).toHaveLength(1));

    await act(async () => {
      rerender(
        <DevToolProvider initialConfig={config} userIdControl="host">
          <FlowRail sessionRefreshKey={1} />
        </DevToolProvider>,
      );
    });

    await waitFor(() => expect(sessionCalls()).toHaveLength(2));
    // And exactly one further read, not a re-read per render afterwards.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 40));
    });
    expect(sessionCalls()).toHaveLength(2);
  });
});
