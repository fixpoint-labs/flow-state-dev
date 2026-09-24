/**
 * The Inventory tab (ER-Devtool checklist row 5): the organization's
 * registered seats, channels and memberships, read from one session.
 *
 * The transport is a stubbed `fetch` behind the REAL `DevToolProvider`, not a
 * mocked hook, because half of what is under test is the request: a tab that
 * drew the rows correctly from a read it sent without the bearer token would
 * render identically here and 401 in any app with a principal resolver (V3a).
 *
 * Absent, failed and empty are three different things, and each case below
 * asserts the one it grades AND that it does not read as either of the others.
 *
 * **Red states, observed** (each produced by hand once and reverted):
 * - V3a: `createDevToolResourceClient` built with no `fetcher` (a bare
 *   resource client) → `the manifest request carries the token: expected null
 *   to be 'Bearer tok-inventory'`.
 * - V3b: an undeclared collection read as a loaded, empty one → `the channels
 *   section of a seat-only flow: expected 'loaded' to be 'not-installed'`; and
 *   the absent text swapped for the empty text → `expected 'Registered
 *   channelsNo channels regist…' to contain 'Not installed on this flow.'`.
 * - BR-12: the channels heading changed to *Open channels* → `words the tab
 *   must not use: expected [ 'Open' ] to deeply equal []`. The first cut of
 *   this scan read `textContent` and stayed GREEN under that mutation, because
 *   it glues "eng.queue" onto "Open" and the word boundary never fires.
 * - The pagination guard removed (no page bound, no repeated-cursor check) →
 *   `expected 'the read never stopped' to match /same page cursor twice/`,
 *   `… to match /after 1000/`, and in the tab `expected 'Registered
 *   seatsThe seats read failed…' to contain 'same page cursor twice'` — the
 *   stubs' own backstops stop the loop, so the red state cannot hang the suite.
 * - BR-9/BR-10: a failed read returned as an empty one → the 403 and the
 *   later-page cases fail with `expected 'loaded' to be 'failed'`, the 404 case
 *   with `expected 'Registered channels0No channels regis…' to contain '(404)'`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import { DevToolProvider } from "../src/react/context/devtool-context";
import {
  InventoryProvider,
  InventoryTabContent,
  InventoryTabTrigger,
} from "../src/react/components/workspace/inventory-view";
import { Tabs, TabsList, TabsTrigger } from "../src/react/components/ui/tabs";
import { readEveryPage } from "../src/react/lib/inventory";

const SESSION = "eng.queue";
const TOKEN = "tok-inventory";

/** Refs a flow gave the collections. Deliberately not the patterns: the tab must read them off the manifest. */
const REFS = { seats: "orgSeats", channels: "orgChannels", memberships: "orgMembers" };

type ManifestEntry = { ref: string; kind: "collection"; scope: "org"; pattern: string; hasClientData: boolean; client: { state: { read: boolean } } };

function collection(ref: string, pattern: string, read = true): ManifestEntry {
  return { ref, kind: "collection", scope: "org", pattern, hasClientData: read, client: { state: { read } } };
}

const ALL_THREE = [
  collection(REFS.seats, "inventory/seats/*"),
  collection(REFS.channels, "inventory/channels/*"),
  collection(REFS.memberships, "inventory/members/**"),
];

/** A page answer: `items` as the route sends them, and a cursor when more remain. */
type Page = { status?: number; items?: unknown[]; nextCursor?: string; error?: string };

type Server = {
  manifest: ManifestEntry[] | { status: number };
  /** Ref -> pages, in order. A page with a `status` answers with that status. */
  pages: Record<string, Page[]>;
};

type Seen = { url: string; authorization: string | null };
let seen: Seen[] = [];

function serve(server: Server) {
  seen = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      seen.push({ url, authorization: new Headers(init?.headers).get("authorization") });
      const json = (status: number, body: unknown) =>
        new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

      if (url.includes(`/api/flows/sessions/${encodeURIComponent(SESSION)}/manifest`)) {
        if (!Array.isArray(server.manifest)) return json(server.manifest.status, { error: "no" });
        return json(200, { flowKind: "channel", resources: server.manifest });
      }
      const read = /\/api\/flows\/sessions\/[^/]+\/resources\/([^/?]+)\?(.*)$/.exec(url);
      if (read !== null) {
        const ref = decodeURIComponent(read[1]!);
        const cursor = new URLSearchParams(read[2]).get("cursor");
        const pages = server.pages[ref] ?? [];
        // A backstop for a reader with no pagination guard: without it that
        // reader loops on resolved promises and never yields to a timeout.
        const asked = seen.filter((s) => s.url.includes(`/resources/${encodeURIComponent(ref)}?`)).length;
        if (asked > 2_000) return json(500, { error: "the stub stopped answering after 2000 pages" });
        const index = cursor === null ? 0 : Number(cursor.replace("page-", ""));
        const page = pages[index] ?? { items: [] };
        if (page.status !== undefined) return json(page.status, { error: page.error ?? "failed" });
        return json(200, {
          items: (page.items ?? []).map((clientData, i) => ({ topic: `t${index}-${i}`, clientData })),
          ...(page.nextCursor !== undefined ? { nextCursor: page.nextCursor } : {}),
        });
      }
      // Everything else the provider reads on mount (the flow list).
      return json(200, { flows: [] });
    }),
  );
}

afterEach(() => vi.unstubAllGlobals());

/**
 * The workspace's tabs as the panel builds them: the four built-in triggers,
 * then the Inventory trigger and panel, which appear only when they belong.
 */
function renderWorkspace(bearerToken: string | undefined = TOKEN) {
  render(
    <DevToolProvider initialConfig={{ userId: "devuser", bearerToken }} userIdControl="host">
      <InventoryProvider sessionId={SESSION}>
        <Tabs defaultValue="inventory">
          <TabsList>
            <TabsTrigger value="stream">Stream</TabsTrigger>
            <InventoryTabTrigger />
          </TabsList>
          <InventoryTabContent sessionId={SESSION} />
        </Tabs>
      </InventoryProvider>
    </DevToolProvider>,
  );
}

/** The tab's panel once every section has finished reading. */
async function openPanel(): Promise<HTMLElement> {
  await waitFor(() => expect(screen.getByRole("tab", { name: "Inventory" })).toBeInTheDocument());
  await waitFor(() =>
    expect(document.querySelectorAll("[data-inventory-section]").length).toBe(3),
  );
  return document.querySelector<HTMLElement>("[data-inventory-view]")!;
}

function section(name: "seats" | "channels" | "memberships"): HTMLElement {
  return document.querySelector<HTMLElement>(`[data-inventory-section="${name}"]`)!;
}

/** The cells of the row whose first cell reads `id`, keyed by column heading. */
function rowById(sectionName: "seats" | "channels" | "memberships", id: string): Record<string, string> | undefined {
  const table = section(sectionName).querySelector("table");
  if (table === null) return undefined;
  const headers = [...table.querySelectorAll("thead th")].map((th) => (th.textContent ?? "").trim());
  for (const tr of table.querySelectorAll("tbody tr")) {
    const tds = [...tr.querySelectorAll("td")];
    if ((tds[0]?.textContent ?? "").trim() !== id) continue;
    return Object.fromEntries(headers.map((head, i) => [head, (tds[i]?.textContent ?? "").trim()]));
  }
  return undefined;
}

const SEATS = [
  { id: "eng.planner", kind: "planner" },
  { id: "eng.builder", kind: "worker" },
];
const CHANNEL = {
  id: "eng.queue",
  kind: "channel",
  members: ["eng.planner", "eng.builder"],
  openedAt: "2026-09-24T10:00:00.000Z",
};
const MEMBERSHIPS = [
  { seatId: "eng.planner", channelId: "eng.queue" },
  { seatId: "eng.builder", channelId: "eng.queue" },
];

const EMPTY_TEXT = /No (seats|channels|memberships) registered/;
const ABSENT_TEXT = "Not installed on this flow.";

describe("V3 · the Inventory tab on a channel's session", () => {
  beforeEach(() =>
    serve({
      manifest: ALL_THREE,
      pages: { [REFS.seats]: [{ items: SEATS }], [REFS.channels]: [{ items: [CHANNEL] }], [REFS.memberships]: [{ items: MEMBERSHIPS }] },
    }),
  );

  it("appears, and shows every seat with its kind and channels, and the channel with its members (BR-7, BR-8)", async () => {
    renderWorkspace();
    const panel = await openPanel();

    for (const seat of SEATS) {
      const row = rowById("seats", seat.id);
      expect(row, `seat ${seat.id} has a row`).toBeDefined();
      expect(row!.Kind).toBe(seat.kind);
      expect(row!.Channels).toBe("eng.queue");
    }
    const channel = rowById("channels", "eng.queue");
    expect(channel, "the channel has a row").toBeDefined();
    expect(channel!.Kind).toBe("channel");
    expect(channel!.Members).toBe("eng.planner, eng.builder");
    expect(channel!.Registered).toBe(CHANNEL.openedAt);
    expect(rowById("memberships", "eng.builder")?.Channel).toBe("eng.queue");

    // Nothing is inside an expander.
    expect(panel.querySelectorAll("details").length).toBe(0);
    expect(panel.textContent).not.toMatch(EMPTY_TEXT);
    expect(panel.textContent).not.toContain(ABSENT_TEXT);
  });

  it("says registered, and never open, live, online or active (BR-12)", async () => {
    renderWorkspace();
    const panel = await openPanel();
    // Text node by text node, joined with spaces. `textContent` glues the end
    // of one element onto the start of the next ("eng.queueOpen"), so a word
    // boundary check over it misses a heading that begins with the word.
    const walker = document.createTreeWalker(panel, NodeFilter.SHOW_TEXT);
    const nodes: string[] = [];
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) nodes.push(node.textContent ?? "");
    const words = nodes.join(" ");
    // The positive half first: a scan that finds nothing at all would pass the
    // negative half on an empty panel.
    expect(words).toMatch(/\bregistered\b/i);
    expect(words.match(/\b(open|live|online|active)\b/gi) ?? [], "words the tab must not use").toEqual([]);
  });

  it("names no organization and offers no picker (BR-16)", async () => {
    serve({
      manifest: ALL_THREE,
      pages: {
        // A key outside the named fields, carrying an org id, as a server that
        // over-shared might send it. The view renders named fields only.
        [REFS.seats]: [{ items: [{ ...SEATS[0], orgId: "org_secret_acme" }] }],
        [REFS.channels]: [{ items: [CHANNEL] }],
        [REFS.memberships]: [{ items: MEMBERSHIPS }],
      },
    });
    renderWorkspace();
    const panel = await openPanel();
    expect(rowById("seats", "eng.planner"), "the seat row rendered").toBeDefined();
    expect(panel.textContent).not.toContain("org_secret_acme");
    expect(panel.textContent).not.toMatch(/organization id/i);
    expect(within(panel).queryAllByRole("combobox")).toEqual([]);
    expect(panel.querySelectorAll("select").length).toBe(0);
  });

  it("shows each collection's own answer when a channel's members and the membership rows disagree (BR-13)", async () => {
    serve({
      manifest: ALL_THREE,
      pages: {
        [REFS.seats]: [{ items: SEATS }],
        [REFS.channels]: [{ items: [CHANNEL] }],
        // Only the planner has a membership row; the channel row names both.
        [REFS.memberships]: [{ items: [MEMBERSHIPS[0]] }],
      },
    });
    renderWorkspace();
    await openPanel();
    expect(rowById("channels", "eng.queue")!.Members).toBe("eng.planner, eng.builder");
    expect(rowById("seats", "eng.builder")!.Channels).toBe("none");
    expect(rowById("seats", "eng.planner")!.Channels).toBe("eng.queue");
  });

  it("reads a channel row that predates members and openedAt as none and unknown (BR-14)", async () => {
    serve({
      manifest: ALL_THREE,
      pages: {
        [REFS.seats]: [{ items: SEATS }],
        [REFS.channels]: [{ items: [{ id: "eng.legacy", kind: "channel" }] }],
        [REFS.memberships]: [{ items: [] }],
      },
    });
    renderWorkspace();
    await openPanel();
    const legacy = rowById("channels", "eng.legacy");
    expect(legacy, "the legacy row rendered").toBeDefined();
    expect(legacy!.Members).toBe("none");
    expect(legacy!.Registered).toBe("unknown");
  });
});

describe("V3 · reading every page, and failing out loud (BR-9, BR-10, BR-11)", () => {
  it("reads past the first page, so the organization is shown whole (BR-9)", async () => {
    serve({
      manifest: ALL_THREE,
      pages: {
        [REFS.seats]: [{ items: [SEATS[0]], nextCursor: "page-1" }, { items: [SEATS[1]] }],
        [REFS.channels]: [{ items: [CHANNEL] }],
        [REFS.memberships]: [{ items: MEMBERSHIPS }],
      },
    });
    renderWorkspace();
    await openPanel();
    expect(rowById("seats", "eng.planner"), "page 1's seat").toBeDefined();
    expect(rowById("seats", "eng.builder"), "page 2's seat").toBeDefined();
    expect(seen.filter((s) => s.url.includes(`/resources/${REFS.seats}?`)).map((s) => s.url.includes("cursor=page-1"))).toEqual([false, true]);
  });

  it("says how far it got when a later page fails, and shows no partial list (BR-9)", async () => {
    serve({
      manifest: ALL_THREE,
      pages: {
        [REFS.seats]: [{ items: [SEATS[0]], nextCursor: "page-1" }, { status: 500, error: "store unavailable" }],
        [REFS.channels]: [{ items: [CHANNEL] }],
        [REFS.memberships]: [{ items: MEMBERSHIPS }],
      },
    });
    renderWorkspace();
    await openPanel();
    const seats = section("seats");
    expect(seats.dataset.inventoryStatus).toBe("failed");
    expect(seats.textContent).toContain("(500): store unavailable");
    expect(seats.textContent).toContain("1 page (1 rows) were read before it failed");
    expect(seats.querySelector("table"), "no partial table").toBeNull();
    expect(seats.textContent).not.toMatch(EMPTY_TEXT);
  });

  it("names a refused read with its status and never shows an empty organization (BR-10, 403)", async () => {
    serve({
      manifest: ALL_THREE,
      pages: {
        [REFS.seats]: [{ status: 403, error: `State read not permitted for "${REFS.seats}"` }],
        [REFS.channels]: [{ items: [] }],
        [REFS.memberships]: [{ items: [] }],
      },
    });
    renderWorkspace();
    const panel = await openPanel();
    const seats = section("seats");
    expect(seats.dataset.inventoryStatus).toBe("failed");
    expect(seats.textContent, "a refused read names its status").toContain("403");
    expect(seats.textContent).toContain("refused");
    expect(seats.textContent).toContain("State read not permitted");
    expect(seats.textContent).not.toMatch(EMPTY_TEXT);
    // The organization-wide "nothing registered" line would be a lie here:
    // one collection could not be read at all.
    expect(panel.textContent).not.toContain("Nothing is registered");
  });

  it("names an unknown collection (BR-10, 404)", async () => {
    serve({
      manifest: ALL_THREE,
      pages: {
        [REFS.seats]: [{ items: SEATS }],
        [REFS.channels]: [{ status: 404, error: `Unknown resource "${REFS.channels}"` }],
        [REFS.memberships]: [{ items: MEMBERSHIPS }],
      },
    });
    renderWorkspace();
    await openPanel();
    const channels = section("channels");
    expect(channels.textContent).toContain("(404)");
    expect(channels.textContent).toContain("not found");
    expect(channels.textContent).not.toMatch(EMPTY_TEXT);
  });

  it("states an empty organization, and says how rows get there (BR-11)", async () => {
    serve({
      manifest: ALL_THREE,
      pages: { [REFS.seats]: [{ items: [] }], [REFS.channels]: [{ items: [] }], [REFS.memberships]: [{ items: [] }] },
    });
    renderWorkspace();
    const panel = await openPanel();
    expect(panel.textContent).toContain("Nothing is registered in this organization yet");
    expect(panel.textContent).toContain("openInventory");
    for (const name of ["seats", "channels", "memberships"] as const) {
      expect(section(name).dataset.inventoryStatus).toBe("loaded");
      expect(section(name).textContent).toMatch(EMPTY_TEXT);
    }
  });
});

describe("V3 · a cursor that never ends is a failed read, not a hang (BR-9, BR-24)", () => {
  // A bounded timeout on each case, so the red state (no guard) fails here
  // instead of hanging the suite.
  it("ends as failed when the server returns the same cursor twice", { timeout: 5_000 }, async () => {
    let calls = 0;
    const read = await readEveryPage(
      {
        listCollectionItems: async () => {
          calls += 1;
          if (calls > 5_000) throw new Error("the read never stopped");
          return { items: [{ topic: `t${calls}`, clientData: { id: `s${calls}` } }], nextCursor: "stuck" };
        },
      },
      SESSION,
      REFS.seats,
    );
    expect(read.status, JSON.stringify(read)).toBe("failed");
    expect(read.status === "failed" && read.message).toMatch(/same page cursor twice/);
    expect(calls, "pages asked for").toBe(2);
  });

  it("ends as failed after the page bound when every cursor is new", { timeout: 5_000 }, async () => {
    let calls = 0;
    const read = await readEveryPage(
      {
        listCollectionItems: async () => {
          calls += 1;
          if (calls > 5_000) throw new Error("the read never stopped");
          return { items: [], nextCursor: `c${calls}` };
        },
      },
      SESSION,
      REFS.seats,
    );
    expect(read.status, JSON.stringify(read).slice(0, 200)).toBe("failed");
    expect(read.status === "failed" && read.message).toMatch(/after 1000/);
    expect(calls, "pages asked for").toBe(1000);
  });

  it("shows the stuck read in the tab as a failure, never loading or empty", { timeout: 5_000 }, async () => {
    serve({
      manifest: ALL_THREE,
      pages: {
        // Page 0 points at page 0 again: the same cursor, forever.
        [REFS.seats]: [{ items: [SEATS[0]], nextCursor: "page-0" }],
        [REFS.channels]: [{ items: [CHANNEL] }],
        [REFS.memberships]: [{ items: MEMBERSHIPS }],
      },
    });
    renderWorkspace();
    await openPanel();
    const seats = section("seats");
    expect(seats.dataset.inventoryStatus).toBe("failed");
    expect(seats.textContent).toContain("same page cursor twice");
    expect(seats.textContent).not.toMatch(EMPTY_TEXT);
    expect(seats.querySelector("table")).toBeNull();
  });
});

describe("V3 · where the tab appears (BR-7)", () => {
  it("does not appear on a session whose flow declares none of the three", async () => {
    serve({
      manifest: [collection("board", "tasks/eng.queue/*")],
      pages: {},
    });
    renderWorkspace();
    // The manifest was read, so absence is an answer rather than a race.
    await waitFor(() => expect(seen.some((s) => s.url.includes("/manifest"))).toBe(true));
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByRole("tab", { name: "Inventory" })).toBeNull();
    expect(screen.getByRole("tab", { name: "Stream" })).toBeInTheDocument();
  });
});

describe("V3a · every request carries the bearer token (BR-25)", () => {
  it("sends Authorization on the manifest and on page 1 and page 2 of a paginated read", async () => {
    serve({
      manifest: ALL_THREE,
      pages: {
        [REFS.seats]: [{ items: [SEATS[0]], nextCursor: "page-1" }, { items: [SEATS[1]] }],
        [REFS.channels]: [{ items: [CHANNEL] }],
        [REFS.memberships]: [{ items: MEMBERSHIPS }],
      },
    });
    renderWorkspace(TOKEN);
    await openPanel();
    expect(rowById("seats", "eng.builder"), "page 2 was read").toBeDefined();

    const manifest = seen.filter((s) => s.url.includes("/manifest"));
    const seatPages = seen.filter((s) => s.url.includes(`/resources/${REFS.seats}?`));
    // The positive record: the requests under test were made at all.
    expect(manifest.length, "manifest requests").toBeGreaterThan(0);
    expect(seatPages.length, "seat page requests").toBe(2);
    for (const request of manifest) {
      expect(request.authorization, "the manifest request carries the token").toBe(`Bearer ${TOKEN}`);
    }
    expect(seatPages[0]!.authorization, "page 1 carries the token").toBe(`Bearer ${TOKEN}`);
    expect(seatPages[1]!.authorization, "page 2 carries the token").toBe(`Bearer ${TOKEN}`);
    for (const request of seen.filter((s) => s.url.includes("/resources/"))) {
      expect(request.authorization, `${request.url} carries the token`).toBe(`Bearer ${TOKEN}`);
    }
  });
});

describe("V3b · a seat-only flow, the shape the hire tools install (BR-7, BR-8, BR-24)", () => {
  it("shows the tab, renders the seats, and reads the other two as not installed — never as empty", async () => {
    serve({
      manifest: [collection("seatInventory", "inventory/seats/*")],
      pages: { seatInventory: [{ items: SEATS }] },
    });
    renderWorkspace();
    await openPanel();

    expect(rowById("seats", "eng.planner")?.Kind).toBe("planner");
    expect(rowById("seats", "eng.builder")?.Kind).toBe("worker");

    for (const name of ["channels", "memberships"] as const) {
      expect(section(name).dataset.inventoryStatus, `the ${name} section of a seat-only flow`).toBe("not-installed");
      expect(section(name).textContent).toContain(ABSENT_TEXT);
      expect(section(name).textContent).not.toMatch(EMPTY_TEXT);
      expect(section(name).querySelector("table")).toBeNull();
    }
    // The two texts a reader tells apart are actually different.
    expect(ABSENT_TEXT).not.toMatch(EMPTY_TEXT);
    // Nothing was asked of a collection the flow does not declare.
    expect(seen.filter((s) => s.url.includes("/resources/")).map((s) => s.url)).toEqual([
      expect.stringContaining("/resources/seatInventory?"),
    ]);
  });
});
