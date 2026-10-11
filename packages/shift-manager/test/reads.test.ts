/**
 * S3's shared reads, against a real Lab served on a free port (V2, V3, V7).
 *
 * Every assertion is on what the Lab's own routes return: the ask-lab is an
 * ordinary Lab config whose workers suspend on a stock approval, woken the way a
 * real Lab wakes them, by a person's post to a coordinator, which delivers it
 * to each delegate.
 */
import { DEFAULT_ORG_ID } from "@flow-state-dev/core";
import { PUBLIC_REENTRY_SOURCES } from "@flow-state-dev/engine";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createLabClients } from "../src/lib/connection";
import {
  createLabReader,
  DISPATCHED_RUN_UNANSWERABLE,
  REOPENED_SOURCES,
  readerSessionId,
  UNOWNED_SESSION_UNANSWERABLE,
  type LabSnapshot,
} from "../src/lib/reads";
import { workerStates, type LoadedSnapshot } from "../src/lib/derive";
import { withRoster } from "../src/lib/roster";
import { workforceClientFor } from "../src/lib/workforce";
import { ROSTER_FLOW_KIND } from "@flow-state-dev/workforce/browser";
import { COORDINATOR_KIND } from "@flow-state-dev/workforce";
import { ASK_LAB_COORDINATORS, ASK_LAB_USER_ID, openAskLab } from "./fixtures/ask-lab/lab.mts";
import { ASKER_KIND } from "./fixtures/ask-lab/asker.mts";
import { eventually, serveLab, type ServedLab } from "./helpers/serve-lab";

/**
 * The two session opens a first visit makes: a reading session on the mailbox
 * kind and on the roster flow. The ask-lab serves no mailbox kind, so its own
 * answer to the first is a 404: nothing to open.
 */
const READER_OPENS = ["/api/flows/mailbox/sessions", "/api/flows/workforce-roster/sessions"];

const served: ServedLab[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(served.splice(0).map((lab) => lab.handle.close()));
});

async function lab(options: Parameters<typeof openAskLab>[0] = {}) {
  const opened = await openAskLab(options);
  const s = await serveLab(opened.flowState);
  served.push(s);
  return { ...s, tree: opened.tree };
}

function loaded(snapshot: LabSnapshot): LoadedSnapshot {
  if (snapshot.refused !== undefined) throw new Error(`refused: ${snapshot.refused.message}`);
  if (snapshot.unreachable !== undefined) throw new Error(`unreachable: ${snapshot.unreachable.message}`);
  return snapshot;
}

/** Post a line into the person's conversation with a coordinator, through the coordinator's own door. */
async function post(clients: ReturnType<typeof createLabClients>, coordinatorId: string, message: string) {
  await clients.actions(COORDINATOR_KIND).sendAction("run", { message }, { sessionId: coordinatorId });
}

/** What a delegate is handed, and so what it asks about: the post as its coordinator delivers it. */
const delivered = (coordinatorId: string, message: string) => `${ASK_LAB_USER_ID}, through ${coordinatorId}: ${message}`;

/**
 * A person asks a worker directly, through its public `ask` action, in the
 * worker's own session (`s_<worker id>`, the session the Lab's EM ask lives in),
 * opened naming the worker's worker on the asker flow's one copy.
 */
async function ask(clients: ReturnType<typeof createLabClients>, workerId: string, what: string) {
  const sessionId = `s_${workerId.replace(/\./g, "_")}`;
  await clients.sessions
    .createSession({ flowKind: ASKER_KIND, userId: clients.userId, sessionId, state: { workerId: workerId } })
    .catch((error: unknown) => {
      if ((error as { status?: number }).status !== 409) throw error;
    });
  await clients.actions(ASKER_KIND).sendAction("ask", { what }, { sessionId });
}

/** The person hires a worker of their own on the asker kind, through the roster flow's `hire`. */
async function hire(clients: ReturnType<typeof createLabClients>, id: string) {
  const roster = await clients.sessions.createSession({ flowKind: ROSTER_FLOW_KIND, userId: clients.userId });
  await clients.actions(ROSTER_FLOW_KIND).sendAction("hire", { id, flow: ASKER_KIND }, { sessionId: roster.id });
}

/** The refs a session's flow declares the inventory's worker and mailbox collections under, as its manifest lists them. */
async function inventoryRefs(baseUrl: string, sessionId: string): Promise<string[]> {
  const manifest = (await (await fetch(`${baseUrl}/api/flows/sessions/${sessionId}/manifest`)).json()) as {
    resources: Array<{ kind: string; pattern?: string; ref: string }>;
  };
  const refs = ["inventory/workers/*", "inventory/mailboxes/*"].map(
    (pattern) => manifest.resources.find((r) => r.kind === "collection" && r.pattern === pattern)?.ref,
  );
  if (refs.some((ref) => ref === undefined)) throw new Error(`session ${sessionId}'s flow declares no inventory`);
  return refs as string[];
}

/** Count requests by method and path, through the real `fetch`. */
function countRequests() {
  const real = globalThis.fetch;
  const seen: string[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    seen.push(`${init?.method ?? "GET"} ${url.pathname}`);
    return real(input, init);
  });
  return seen;
}

describe("the refusal (V2, BR-3)", () => {
  it("stops at the first read when the Lab refuses it for want of a verified organization", async () => {
    const { baseUrl } = await lab({ bearer: "ask-lab-secret" });
    const seen = countRequests();
    const snapshot = await createLabReader(createLabClients({ baseUrl, userId: ASK_LAB_USER_ID })).read();
    expect(snapshot.refused?.httpStatus).toBe(401);
    expect(snapshot.refused?.message).toMatch(/verified organization/);
    // The refusal is the only answer: no further read was made.
    expect(seen).toEqual(["GET /api/flows/sessions"]);
  });

  it("reads the Lab when the bearer is presented", async () => {
    const { baseUrl } = await lab({ bearer: "ask-lab-secret" });
    const snapshot = loaded(
      await createLabReader(createLabClients({ baseUrl, userId: ASK_LAB_USER_ID, bearerToken: "ask-lab-secret" })).read(),
    );
    expect(snapshot.orgId).toBe("org_ask_lab");
    expect(snapshot.inventory.ok).toBe(true);
  });

  it("refuses a Lab that names no organization for the person, and reads nothing from the tree", async () => {
    // The Lab opens nothing at boot and serves no reader kind to open one on,
    // so the person holds no session and nothing the Lab serves says which
    // organization they are in.
    const { baseUrl } = await lab({ conversations: false });
    const seen: string[] = [];
    const real = globalThis.fetch;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      seen.push(`${init?.method ?? "GET"} ${url.pathname}`);
      if (READER_OPENS.includes(url.pathname)) return new Response(JSON.stringify({ error: "no flow" }), { status: 404 });
      return real(input, init);
    });
    const snapshot = await createLabReader(createLabClients({ baseUrl, userId: ASK_LAB_USER_ID })).read();
    expect(snapshot.refused?.message).toMatch(/no organization/);
    expect(snapshot.refused?.message).toContain(ASK_LAB_USER_ID);
    expect(seen.slice(0, 1)).toEqual(["GET /api/flows/sessions"]);
    expect(seen.slice(1, 3).sort()).toEqual(READER_OPENS.map((path) => `POST ${path}`));
    expect(seen.slice(3).every((s) => s === "GET /api/flows/sessions")).toBe(true);
  });

  // FIX-1752: projects are org-wide, so a person the Lab verifies reaches them on a first
  // visit. Their reading sessions are opened first, and the Lab stamps them with their organization.
  it("reads the organization off a reading session it opens for a person who holds none", async () => {
    // The Lab opens nothing at boot; its verified principal puts the person in `org_first_visit`.
    const { baseUrl } = await lab({ conversations: false, bearer: "ask-lab-secret", orgId: "org_first_visit" });
    const clients = createLabClients({ baseUrl, userId: ASK_LAB_USER_ID, bearerToken: "ask-lab-secret" });
    expect(await clients.sessions.listSessions({ userId: ASK_LAB_USER_ID })).toEqual([]);
    const snapshot = loaded(await createLabReader(clients).read());
    expect(snapshot.orgId).toBe("org_first_visit");
    // The Lab serves no mailbox kind, so the roster flow's is the one reading session opened.
    expect(snapshot.sessions.map((s) => s.flowKind)).toEqual(["workforce-roster"]);
  });

  // Two reads of a first visit can overlap: StrictMode replays the boot, or the person opens
  // two tabs. Either way the person ends up with one reading session on each kind, never two.
  it("opens one reading session per kind for overlapping first-visit reads, on one page and across two", async () => {
    const { baseUrl } = await lab({ conversations: false });
    const page = createLabClients({ baseUrl, userId: ASK_LAB_USER_ID });
    const [a, b] = await Promise.all([createLabReader(page).read(), createLabReader(page).read()]);
    // Two tabs: two clients, so nothing in the page is shared between them.
    const tab = () => createLabClients({ baseUrl, userId: "u_two_tabs" });
    const [c, d] = await Promise.all([createLabReader(tab()).read(), createLabReader(tab()).read()]);
    for (const snapshot of [a, b, c, d]) expect(loaded(snapshot).orgId).toBe(DEFAULT_ORG_ID);
    expect((await page.sessions.listSessions({ userId: ASK_LAB_USER_ID })).map((s) => s.flowKind)).toEqual(["workforce-roster"]);
    expect((await tab().sessions.listSessions({ userId: "u_two_tabs" })).map((s) => s.flowKind)).toEqual(["workforce-roster"]);
  });

  // Session ids aren't scoped by organization. A person whose reading id is already held in
  // another of their organizations must still reach this one, not be locked out of it.
  it("opens the reading session under a fresh id when its one id is held where this organization can't list it", async () => {
    const { baseUrl } = await lab({ conversations: false });
    const real = globalThis.fetch;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input instanceof Request ? input.url : input);
      // The other organization's session under the same id: a conflict, which this listing never shows.
      if (
        new RegExp(`/api/flows/${ROSTER_FLOW_KIND}/sessions$`).test(url) &&
        String(init?.body ?? "").includes(readerSessionId(ASK_LAB_USER_ID, ROSTER_FLOW_KIND))
      ) {
        return new Response(JSON.stringify({ error: "Session already exists" }), { status: 409 });
      }
      return real(input, init);
    });
    const clients = createLabClients({ baseUrl, userId: ASK_LAB_USER_ID });
    const snapshot = loaded(await createLabReader(clients).read());
    expect(snapshot.orgId).toBe(DEFAULT_ORG_ID);
    const readers = (await clients.sessions.listSessions({ userId: ASK_LAB_USER_ID })).filter((s) => s.flowKind === ROSTER_FLOW_KIND);
    expect(readers).toHaveLength(1);
    expect(readers[0]!.id).not.toBe(readerSessionId(ASK_LAB_USER_ID, ROSTER_FLOW_KIND));
  });

  it("a person with no session whose reading sessions are refused gets the Lab's refusal, and nothing else is read", async () => {
    const { baseUrl } = await lab({ conversations: false });
    const seen: string[] = [];
    const real = globalThis.fetch;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      seen.push(`${init?.method ?? "GET"} ${url.pathname}`);
      if (READER_OPENS.includes(url.pathname)) return new Response(JSON.stringify({ error: "not in this Lab" }), { status: 403 });
      return real(input, init);
    });
    const snapshot = await createLabReader(createLabClients({ baseUrl, userId: ASK_LAB_USER_ID })).read();
    expect(snapshot.refused).toMatchObject({ httpStatus: 403, message: "not in this Lab" });
    expect(seen.slice(0, 1)).toEqual(["GET /api/flows/sessions"]);
    expect(seen.slice(1, 3).sort()).toEqual(READER_OPENS.map((path) => `POST ${path}`));
    expect(seen.slice(3).every((s) => s === "GET /api/flows/sessions")).toBe(true);
  });

  it("refuses when the person's session carries no organization", async () => {
    const { baseUrl } = await lab();
    const real = globalThis.fetch;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const response = await real(input, init);
      if (!/\/api\/flows\/sessions\/[^/]+$/.test(new URL(String(input instanceof Request ? input.url : input)).pathname)) {
        return response;
      }
      const body = (await response.json()) as { session?: Record<string, unknown> } & Record<string, unknown>;
      const strip = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([k]) => k !== "orgId"));
      const stripped = body.session === undefined ? strip(body) : { ...body, session: strip(body.session) };
      return new Response(JSON.stringify(stripped), { status: 200, headers: { "content-type": "application/json" } });
    });
    const snapshot = await createLabReader(createLabClients({ baseUrl, userId: ASK_LAB_USER_ID })).read();
    expect(snapshot.unreachable).toBeUndefined();
    expect(snapshot.refused?.message).toMatch(/no organization/);
  });

  it("a first read that fails for another reason is unreachable, not a refusal, and nothing else is read", async () => {
    const { baseUrl } = await lab();
    const seen: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      seen.push(new URL(String(input instanceof Request ? input.url : input)).pathname);
      return Promise.resolve(new Response(JSON.stringify({ error: "store offline" }), { status: 503 }));
    });
    const snapshot = await createLabReader(createLabClients({ baseUrl, userId: ASK_LAB_USER_ID })).read();
    expect(snapshot.refused).toBeUndefined();
    expect(snapshot.unreachable).toMatchObject({ httpStatus: 503, message: "store offline" });
    expect(seen).toEqual(["/api/flows/sessions"]);
  });

  it("a network failure on the first read is unreachable, not a refusal", async () => {
    const { baseUrl } = await lab();
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("fetch failed"));
    const snapshot = await createLabReader(createLabClients({ baseUrl, userId: ASK_LAB_USER_ID })).read();
    expect(snapshot.refused).toBeUndefined();
    expect(snapshot.unreachable?.message).toMatch(/fetch failed/);
  });
});

describe("one read per resource (V3, BR-11)", () => {
  it("lists once, reads each manifest kind once, and the person's conversation boards once per refresh", async () => {
    const { baseUrl } = await lab();
    const reader = createLabReader(createLabClients({ baseUrl, userId: ASK_LAB_USER_ID }));
    // The first read opens the person's roster session, so its kind's manifest is first read on the second.
    await reader.read();
    await reader.read();
    const seen = countRequests();
    const snapshot = loaded(await reader.read());

    // One listing, and one more after each reading session the refresh tried
    // to open: the Lab serves no mailbox kind, so it answers each try 404.
    const opens = seen.filter((line) => line === "POST /api/flows/mailbox/sessions");
    expect(opens).toHaveLength(1);
    expect(seen.filter((line) => line === "GET /api/flows/sessions")).toHaveLength(1 + opens.length);
    // Manifests are cached by flow kind across refreshes.
    expect(seen.filter((line) => line.endsWith("/manifest"))).toEqual([]);
    // Both of the person's coordinator conversations keep a board, in one
    // ledger: it is read once, through one of them. Nothing filed on either.
    const boardReads = seen.filter((line) => line.endsWith("/resources/tasks"));
    expect(boardReads).toHaveLength(1);
    expect(ASK_LAB_COORDINATORS.map((id) => `GET /api/flows/sessions/${id}/resources/tasks`)).toContain(boardReads[0]);
    expect(snapshot.boards).toEqual({});
  });

  it("a failed conversation-board read is one failed section, and the rest of the snapshot is whole", async () => {
    const { baseUrl } = await lab();
    const real = globalThis.fetch;
    vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      const url = String(input instanceof Request ? input.url : input);
      if (/\/resources\/tasks(\?|$)/.test(url)) {
        return Promise.resolve(new Response(JSON.stringify({ error: "board unavailable" }), { status: 500 }));
      }
      return real(input, init);
    });
    const snapshot = loaded(await createLabReader(createLabClients({ baseUrl, userId: ASK_LAB_USER_ID })).read());
    // Under the conversation it was read through.
    const failed = Object.entries(snapshot.boards);
    expect(failed).toHaveLength(1);
    expect(ASK_LAB_COORDINATORS).toContain(failed[0]![0]);
    expect(failed[0]![1]).toMatchObject({ ok: false, failure: { message: "board unavailable" } });
    expect(snapshot.inventory.ok).toBe(true);
    expect(snapshot.asks.ok).toBe(true);
  });

  it("finds the inventory through the inventory writer's session, the one session of the person's whose flow declares it", async () => {
    const { baseUrl } = await lab();
    const seen = countRequests();
    const snapshot = loaded(await createLabReader(createLabClients({ baseUrl, userId: ASK_LAB_USER_ID })).read());
    if (!snapshot.inventory.ok) throw new Error(snapshot.inventory.failure.message);
    expect(snapshot.inventory.value.workers.map((worker) => worker.id).sort()).toEqual(
      ["ops.asker", "ops.desk", "ops.helper", "ops.loner", "ops.side"],
    );
    // No workstream: nothing registers a mailbox.
    expect(snapshot.inventory.value.workstreams).toEqual([]);
    const refs = await inventoryRefs(baseUrl, "inventory-binder");
    expect(seen.filter((line) => refs.some((ref) => line.endsWith(`/resources/${ref}`)))).toEqual(
      refs.map((ref) => `GET /api/flows/sessions/inventory-binder/resources/${ref}`),
    );
  });

  it("finds the inventory through a worker's session for a person who holds only that one", async () => {
    const { baseUrl } = await lab();
    const other = createLabClients({ baseUrl, userId: "u_other" });
    await other.sessions.createSession({ flowKind: ASKER_KIND, userId: "u_other", sessionId: "s_other_asker", state: { workerId: "ops.asker" } });
    const seen = countRequests();
    const snapshot = loaded(await createLabReader(other).read());
    if (!snapshot.inventory.ok) throw new Error(snapshot.inventory.failure.message);
    expect(snapshot.inventory.value.workers.map((worker) => worker.id)).toContain("ops.asker");
    const refs = await inventoryRefs(baseUrl, "s_other_asker");
    expect(seen.filter((line) => refs.some((ref) => line.endsWith(`/resources/${ref}`)))).toEqual(
      refs.map((ref) => `GET /api/flows/sessions/s_other_asker/resources/${ref}`),
    );
  });

  it("a Lab booted without its inventory fails TEAMS and PROJECTS by name, and nothing else", async () => {
    const { baseUrl } = await lab({ inventory: false });
    const snapshot = loaded(await createLabReader(createLabClients({ baseUrl, userId: ASK_LAB_USER_ID })).read());
    expect(snapshot.inventory).toMatchObject({ ok: false });
    if (snapshot.inventory.ok) return;
    expect(snapshot.inventory.failure.message).toMatch(/without opening its inventory/);
    expect(snapshot.sessions.length).toBeGreaterThan(0);
    expect(snapshot.orgId).toBe(DEFAULT_ORG_ID);
  });

  it("a Lab whose flows declare no inventory still reads the organization off the person's sessions", async () => {
    const { baseUrl } = await lab({ inventoryDeclared: false });
    const snapshot = loaded(await createLabReader(createLabClients({ baseUrl, userId: ASK_LAB_USER_ID })).read());
    if (snapshot.inventory.ok) throw new Error("the inventory loaded");
    expect(snapshot.inventory.failure.message).toMatch(/No inventory to read/);
    // A page built before a key rename lands here too; the message says so.
    expect(snapshot.inventory.failure.message).toMatch(/older build than the Lab/);
    expect(snapshot.orgId).toBe(DEFAULT_ORG_ID);
  });
});

// A workstream's Stream used to draw the asks of its mailbox's members, and
// these tests read each ask onto the Streams it belonged to. The ask-lab has
// no mailbox, so it has no workstream to draw them on: those assertions are
// retired (BR-24). Each ask is still in Inbox, read here; a coordinator
// conversation draws the asks raised in it (shell.test.tsx, Chief of Staff);
// and a project workstream's Stream is its owner's project coordinator
// session (project-workstreams.test.tsx).
describe("asks through a coordinator's delivery (V7)", () => {
  it("a post reaches each delegate, and each delegate's ask is in Inbox", async () => {
    const { baseUrl, tree } = await lab();
    const clients = createLabClients({ baseUrl, userId: ASK_LAB_USER_ID });
    const reader = createLabReader(clients);
    await post(clients, "ops.desk", "ship it");

    const snapshot = await eventually(async () => {
      const s = loaded(await reader.read());
      return s.asks.ok && s.asks.value.length >= 2 ? s : undefined;
    }, "both of the desk's delegates to ask");
    if (!snapshot.asks.ok || !snapshot.inventory.ok) throw new Error("asks or inventory did not load");
    const asks = snapshot.asks.value;
    const desk = tree.workers.find((w) => w.id === "ops.desk")!;
    // Every delegate of the desk asked, from a dispatch run the post started.
    expect(asks.map((a) => a.workerId).sort()).toEqual([...(desk.declared.delegates as string[])].sort());
    for (const ask of asks) {
      expect(ask.parentSessionId).toBe("ops.desk");
      expect(ask.flowId).toBe(ASKER_KIND);
      expect(ask.item.message).toBe(`Approve: ${delivered("ops.desk", "ship it")}`);
    }
  });

  it("without dispatch runs in the listing, the ask is missing (the negative)", async () => {
    const { baseUrl } = await lab();
    const clients = createLabClients({ baseUrl, userId: ASK_LAB_USER_ID });
    await post(clients, "ops.desk", "ship it");
    const reader = createLabReader(clients);
    await eventually(async () => {
      const s = loaded(await reader.read());
      return s.asks.ok && s.asks.value.length >= 2 ? s : undefined;
    }, "the asks, with dispatch runs listed");

    // The same reader with the listing on its default: the asks are gone.
    const listSessions = clients.sessions.listSessions;
    const narrowed = {
      ...clients,
      sessions: { ...clients.sessions, listSessions: (o?: object) => listSessions({ ...o, include: undefined }) },
    };
    const snapshot = loaded(await createLabReader(narrowed).read());
    expect(snapshot.asks).toEqual({ ok: true, value: [] });
  });

  it("a delivered post's ask is marked unanswerable, and the Lab does refuse to reopen it", async () => {
    const { baseUrl } = await lab();
    const clients = createLabClients({ baseUrl, userId: ASK_LAB_USER_ID });
    const reader = createLabReader(clients);
    await post(clients, "ops.desk", "ship it");
    const asks = await eventually(async () => {
      const s = loaded(await reader.read());
      return s.asks.ok && s.asks.value.length === 2 ? s.asks.value : undefined;
    }, "the asks");
    for (const ask of asks) {
      expect(ask.unanswerable).toBe(DISPATCHED_RUN_UNANSWERABLE);
      // The flag is the Lab's rule, not a guess: the resume is refused.
      await expect(reader.resume(ask, { action: "approve" })).rejects.toMatchObject({ status: 404 });
    }
  });

  it("offers an answer only on the sources the engine reopens: its own allow-list, pinned here", () => {
    // Shift Manager can't import the engine in a browser, so it keeps a copy. A
    // source added to or removed from the engine's list turns this red.
    expect([...REOPENED_SOURCES].sort()).toEqual([...PUBLIC_REENTRY_SOURCES].sort());
  });

  it("a person's ask whose request records no source is unanswerable, not offered (fail-closed)", async () => {
    const { baseUrl } = await lab();
    const clients = createLabClients({ baseUrl, userId: ASK_LAB_USER_ID });
    await ask(clients, "ops.loner", "no source");
    const listRequests = clients.sessions.listSessionRequests;
    const sourceless = {
      ...clients,
      sessions: {
        ...clients.sessions,
        listSessionRequests: async (...args: Parameters<typeof listRequests>) =>
          (await listRequests(...args)).map(({ source: _source, ...request }) => request as typeof request & { source?: string }),
      },
    };
    const asks = await eventually(async () => {
      const s = loaded(await createLabReader(sourceless as typeof clients).read());
      return s.asks.ok && s.asks.value.length === 1 ? s.asks.value : undefined;
    }, "the loner's ask");
    expect(asks[0]!.unanswerable).toBe(DISPATCHED_RUN_UNANSWERABLE);
    // The same ask, with its source as recorded, is answerable.
    const recorded = await eventually(async () => {
      const s = loaded(await createLabReader(clients).read());
      return s.asks.ok && s.asks.value.length === 1 ? s.asks.value : undefined;
    }, "the loner's ask, as recorded");
    expect(recorded[0]!.unanswerable).toBeNull();
  });

  it("an ask in a worker that is no coordinator's delegate is in Inbox", async () => {
    const { baseUrl } = await lab();
    const clients = createLabClients({ baseUrl, userId: ASK_LAB_USER_ID });
    await ask(clients, "ops.loner", "alone");
    const snapshot = await eventually(async () => {
      const s = loaded(await createLabReader(clients).read());
      return s.asks.ok && s.asks.value.length === 1 ? s : undefined;
    }, "the loner's ask");
    if (!snapshot.asks.ok || !snapshot.inventory.ok) throw new Error("not loaded");
    expect(snapshot.asks.value[0]!.workerId).toBe("ops.loner");
  });

  it("an ask from the person's own worker is in Inbox, and that worker reads as on call", async () => {
    const { baseUrl } = await lab();
    const clients = createLabClients({ baseUrl, userId: ASK_LAB_USER_ID });
    // A worker of the person's own: on their roster, never in the inventory.
    await hire(clients, "ops.mine");
    await ask(clients, "ops.mine", "ship it");
    const snapshot = await eventually(async () => {
      const s = loaded(await createLabReader(clients).read());
      return s.asks.ok && s.asks.value.length === 1 ? s : undefined;
    }, "the own worker's ask");
    if (!snapshot.asks.ok || !snapshot.inventory.ok) throw new Error("not loaded");
    expect(snapshot.inventory.value.workers.map((s) => s.id)).not.toContain("ops.mine");
    expect(snapshot.asks.value.map((a) => [a.workerId, a.item.message])).toEqual([["ops.mine", "Approve: ship it"]]);

    // Roster and TEAMS join the roster the same way, so the worker is on call there.
    const entries = await workforceClientFor(clients).roster();
    const states = workerStates(withRoster(snapshot, { entries }).snapshot);
    expect(states.workers.get("ops.mine")?.status).toBe("on call");
  });

  it("a roster that fails to load fails Inbox's asks by name, not by dropping the person's own workers", async () => {
    const { baseUrl } = await lab();
    const clients = createLabClients({ baseUrl, userId: ASK_LAB_USER_ID });
    await ask(clients, "ops.asker", "deploy");
    const real = globalThis.fetch;
    vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.endsWith("/resources/workforceWorkers")) {
        return Promise.resolve(new Response(JSON.stringify({ error: "roster unavailable" }), { status: 500 }));
      }
      return real(input, init);
    });
    const snapshot = loaded(await createLabReader(clients).read());
    expect(snapshot.asks).toMatchObject({ ok: false, failure: { message: expect.stringMatching(/your roster did not load\. roster unavailable$/) } });
    expect(snapshot.inventory.ok).toBe(true);
  });

  it("a 404 from the roster's own reads fails Inbox's asks; only a Lab with no roster flow has no own workers", async () => {
    const { baseUrl } = await lab();
    const clients = createLabClients({ baseUrl, userId: ASK_LAB_USER_ID });
    await ask(clients, "ops.asker", "deploy");
    // A person who holds only a worker's session, through which the inventory is read.
    const noRoster = createLabClients({ baseUrl, userId: "u_no_roster" });
    await noRoster.sessions.createSession({ flowKind: ASKER_KIND, userId: "u_no_roster", state: { workerId: "ops.asker" } });
    const real = globalThis.fetch;
    const spy = vi.spyOn(globalThis, "fetch");
    spy.mockImplementation((input, init) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.endsWith("/resources/workforceWorkers")) {
        return Promise.resolve(new Response(JSON.stringify({ error: "no such collection" }), { status: 404 }));
      }
      return real(input, init);
    });
    expect(loaded(await createLabReader(clients).read()).asks).toMatchObject({ ok: false });

    // The Lab refuses the roster flow itself, as one that doesn't serve it does.
    spy.mockImplementation((input, init) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes(`/${ROSTER_FLOW_KIND}/sessions`)) {
        return Promise.resolve(new Response(JSON.stringify({ error: `Unknown flow "${ROSTER_FLOW_KIND}"` }), { status: 404 }));
      }
      return real(input, init);
    });
    const snapshot = loaded(await createLabReader(noRoster).read());
    expect(snapshot.asks).toEqual({ ok: true, value: [] });
  });

  it("a session on another flow that names the person's own worker is not that worker's", async () => {
    const { baseUrl } = await lab();
    const clients = createLabClients({ baseUrl, userId: ASK_LAB_USER_ID });
    await hire(clients, "ops.mine");
    await ask(clients, "ops.mine", "ship it");
    // The control: on the flow its roster names, the ask is the worker's.
    await eventually(async () => {
      const s = loaded(await createLabReader(clients).read());
      return s.asks.ok && s.asks.value.length === 1 ? s : undefined;
    }, "the own worker's ask");
    // The roster now says the worker runs elsewhere, so the asker session only names it.
    const real = globalThis.fetch;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input instanceof Request ? input.url : input);
      const response = await real(input, init);
      if (!url.endsWith("/resources/workforceWorkers")) return response;
      const body = (await response.json()) as { items: Array<{ clientData?: Record<string, unknown> }> };
      for (const item of body.items) item.clientData = { ...item.clientData, flow: "elsewhere" };
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    });
    const snapshot = loaded(await createLabReader(clients).read());
    expect(snapshot.asks).toEqual({ ok: true, value: [] });
  });

  it("another person's own worker's ask is in their Inbox, never in this person's", async () => {
    const { baseUrl } = await lab();
    const mine = createLabClients({ baseUrl, userId: ASK_LAB_USER_ID });
    const theirs = createLabClients({ baseUrl, userId: "u_other" });
    await hire(theirs, "ops.theirs");
    await ask(theirs, "ops.theirs", "their thing");
    await ask(mine, "ops.asker", "deploy");
    // The control: the ask is there to be read, by the person whose worker it is.
    const theirAsks = await eventually(async () => {
      const s = loaded(await createLabReader(theirs).read());
      return s.asks.ok && s.asks.value.length === 1 ? s.asks.value : undefined;
    }, "their own worker's ask");
    expect(theirAsks.map((a) => a.workerId)).toEqual(["ops.theirs"]);
    const snapshot = loaded(await createLabReader(mine).read());
    if (!snapshot.asks.ok) throw new Error("not loaded");
    expect(snapshot.asks.value.map((a) => a.workerId)).toEqual(["ops.asker"]);
  });

  it("Approve and Deny resolve through the resume, and the ask leaves Inbox", async () => {
    const { baseUrl } = await lab();
    const clients = createLabClients({ baseUrl, userId: ASK_LAB_USER_ID });
    const reader = createLabReader(clients);
    // Asks in the delegates' own sessions, started by a person.
    await ask(clients, "ops.asker", "deploy");
    await ask(clients, "ops.helper", "rollback");
    const before = await eventually(async () => {
      const s = loaded(await reader.read());
      return s.asks.ok && s.asks.value.length === 2 && s.inventory.ok ? s : undefined;
    }, "two asks");
    if (!before.asks.ok || !before.inventory.ok) throw new Error("not loaded");
    for (const a of before.asks.value) expect(a.unanswerable).toBeNull();

    const byWhat = (what: string) => before.asks.ok && before.asks.value.find((a) => a.item.message === `Approve: ${what}`)!;
    await reader.resume(byWhat("deploy") as never, { action: "approve" });
    const mid = loaded(await reader.read());
    if (!mid.asks.ok) throw new Error("not loaded");
    expect(mid.asks.value.map((a) => a.item.message)).toEqual(["Approve: rollback"]);

    await reader.resume(byWhat("rollback") as never, { action: "reject" });
    const after = loaded(await reader.read());
    expect(after.asks).toEqual({ ok: true, value: [] });
  });

  it("resumes through the session's owning flow; through the board's flow it fails; an unowned session is not offered", async () => {
    const { baseUrl } = await lab();
    const clients = createLabClients({ baseUrl, userId: ASK_LAB_USER_ID });
    const reader = createLabReader(clients);
    await ask(clients, "ops.asker", "deploy");
    const [pending] = await eventually(async () => {
      const s = loaded(await reader.read());
      return s.asks.ok && s.asks.value.length === 1 ? s.asks.value : undefined;
    }, "the ask");
    // The desk's board belongs to the coordinator's flow, not the worker's.
    await expect(reader.resume({ ...pending!, flowId: COORDINATOR_KIND }, { action: "approve" })).rejects.toMatchObject({
      status: 404,
    });
    await expect(reader.resume({ ...pending!, flowId: null }, { action: "approve" })).rejects.toThrow(
      UNOWNED_SESSION_UNANSWERABLE,
    );
    await reader.resume(pending!, { action: "approve" });
    expect(loaded(await reader.read()).asks).toEqual({ ok: true, value: [] });
  });
});

describe("declared documents (BR-10)", () => {
  it("lists a document a worker's flow serves, and its content is the file's, read through that worker's session", async () => {
    const { baseUrl } = await lab();
    const clients = createLabClients({ baseUrl, userId: ASK_LAB_USER_ID });
    const reader = createLabReader(clients);
    // No worker session yet: no listed flow serves the document, so none is found.
    const before = loaded(await reader.read());
    expect(before.resources).toEqual({ ok: true, value: [] });

    await ask(clients, "ops.asker", "ship it");
    const snapshot = await eventually(async () => {
      const s = loaded(await reader.read());
      return s.resources.ok && s.resources.value.length > 0 ? s : undefined;
    }, "the runbook to be listed");
    if (!snapshot.resources.ok) throw new Error("resources did not load");
    expect(snapshot.resources.value).toHaveLength(1);
    const [runbook] = snapshot.resources.value;
    expect(runbook!.ref).toMatch(/runbook/);
    const read = await clients.resources.getResourceContent(runbook!.sessionId, runbook!.ref);
    expect(String(read.content)).toContain("RUNBOOK-DOC-7F3A1");
  });

  it("a failed manifest read fails the Resources group by name, and the listing still draws", async () => {
    const { baseUrl } = await lab();
    const clients = createLabClients({ baseUrl, userId: ASK_LAB_USER_ID });
    await ask(clients, "ops.asker", "ship it");
    const real = globalThis.fetch;
    vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.endsWith("/sessions/s_ops_asker/manifest")) {
        return Promise.resolve(new Response(JSON.stringify({ error: "manifest unavailable" }), { status: 500 }));
      }
      return real(input, init);
    });
    const snapshot = loaded(await createLabReader(clients).read());
    expect(snapshot.resources).toMatchObject({ ok: false, failure: { message: "manifest unavailable" } });
    expect(snapshot.sessions.length).toBeGreaterThan(0);
  });
});
