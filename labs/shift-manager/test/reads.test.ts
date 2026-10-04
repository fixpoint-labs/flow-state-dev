/**
 * S3's shared reads, against a real Lab served on a free port (V2, V3, V7).
 *
 * Every assertion is on what the Lab's own routes return: the ask-lab is an
 * ordinary Lab config whose seats suspend on a stock approval, woken the way a
 * real Lab wakes them, by a mailbox post through the framework's member wake.
 */
import { DEFAULT_ORG_ID } from "@flow-state-dev/core";
import { PUBLIC_REENTRY_SOURCES } from "@flow-state-dev/engine";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createLabClients } from "../src/lib/connection";
import {
  createLabReader,
  DISPATCHED_RUN_UNANSWERABLE,
  REOPENED_SOURCES,
  roomSessionId,
  UNOWNED_SESSION_UNANSWERABLE,
  type LabSnapshot,
} from "../src/lib/reads";
import { asksFor, workstreamsOf, type LoadedSnapshot } from "../src/lib/derive";
import { ASK_LAB_USER_ID, openAskLab } from "./fixtures/ask-lab/lab.mts";
import { eventually, serveLab, type ServedLab } from "./helpers/serve-lab";

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

/** Post a line to a mailbox through its own `post` action. */
async function post(clients: ReturnType<typeof createLabClients>, mailboxId: string, body: string) {
  await clients.actions("mailbox").sendAction("post", { body }, { sessionId: mailboxId });
}

/**
 * A person asks a seat directly, through its public `ask` action, in the
 * seat's own session (`s_<seat id>`, the session the Lab's EM ask lives in).
 */
async function ask(clients: ReturnType<typeof createLabClients>, seatId: string, what: string) {
  await clients.actions(seatId).sendAction("ask", { what }, { sessionId: `s_${seatId.replace(/\./g, "_")}` });
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
    // The Lab opens nothing at boot and serves no room kind to open one on, so
    // the person holds no session and nothing the Lab serves says which
    // organization they are in.
    const { baseUrl } = await lab({ mailboxes: false });
    const seen: string[] = [];
    const real = globalThis.fetch;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      seen.push(`${init?.method ?? "GET"} ${url.pathname}`);
      if (url.pathname === "/api/flows/mailbox/sessions") return new Response(JSON.stringify({ error: "no flow" }), { status: 404 });
      return real(input, init);
    });
    const snapshot = await createLabReader(createLabClients({ baseUrl, userId: ASK_LAB_USER_ID })).read();
    expect(snapshot.refused?.message).toMatch(/no organization/);
    expect(snapshot.refused?.message).toContain(ASK_LAB_USER_ID);
    expect(seen).toEqual(["GET /api/flows/sessions", "POST /api/flows/mailbox/sessions"]);
  });

  // FIX-1752: projects are org-wide, so a person the Lab verifies reaches them on a first
  // visit. Their room session is opened first, and the Lab stamps it with their organization.
  it("reads the organization off a room session it opens for a person who holds none", async () => {
    // The Lab opens nothing at boot; its verified principal puts the person in `org_first_visit`.
    const { baseUrl } = await lab({ mailboxes: false, bearer: "ask-lab-secret", orgId: "org_first_visit" });
    const clients = createLabClients({ baseUrl, userId: ASK_LAB_USER_ID, bearerToken: "ask-lab-secret" });
    expect(await clients.sessions.listSessions({ userId: ASK_LAB_USER_ID })).toEqual([]);
    const snapshot = loaded(await createLabReader(clients).read());
    expect(snapshot.orgId).toBe("org_first_visit");
    expect(snapshot.sessions.map((s) => s.flowKind)).toEqual(["mailbox"]);
  });

  // Two reads of a first visit can overlap: StrictMode replays the boot, or the person opens
  // two tabs. Either way the person ends up with one room session, never two.
  it("opens one room session for overlapping first-visit reads, on one page and across two", async () => {
    const { baseUrl } = await lab({ mailboxes: false });
    const page = createLabClients({ baseUrl, userId: ASK_LAB_USER_ID });
    const [a, b] = await Promise.all([createLabReader(page).read(), createLabReader(page).read()]);
    // Two tabs: two clients, so nothing in the page is shared between them.
    const tab = () => createLabClients({ baseUrl, userId: "u_two_tabs" });
    const [c, d] = await Promise.all([createLabReader(tab()).read(), createLabReader(tab()).read()]);
    for (const snapshot of [a, b, c, d]) expect(loaded(snapshot).orgId).toBe(DEFAULT_ORG_ID);
    expect((await page.sessions.listSessions({ userId: ASK_LAB_USER_ID })).map((s) => s.flowKind)).toEqual(["mailbox"]);
    expect((await tab().sessions.listSessions({ userId: "u_two_tabs" })).map((s) => s.flowKind)).toEqual(["mailbox"]);
  });

  // Session ids aren't scoped by organization. A person whose room id is already held in
  // another of their organizations must still reach this one, not be locked out of it.
  it("opens the room session under a fresh id when its one id is held where this organization can't list it", async () => {
    const { baseUrl } = await lab({ mailboxes: false });
    const real = globalThis.fetch;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input instanceof Request ? input.url : input);
      // The other organization's session under the same id: a conflict, which this listing never shows.
      if (/\/api\/flows\/mailbox\/sessions$/.test(url) && String(init?.body ?? "").includes(roomSessionId(ASK_LAB_USER_ID))) {
        return new Response(JSON.stringify({ error: "Session already exists" }), { status: 409 });
      }
      return real(input, init);
    });
    const clients = createLabClients({ baseUrl, userId: ASK_LAB_USER_ID });
    const snapshot = loaded(await createLabReader(clients).read());
    expect(snapshot.orgId).toBe(DEFAULT_ORG_ID);
    const rooms = (await clients.sessions.listSessions({ userId: ASK_LAB_USER_ID })).filter((s) => s.flowKind === "mailbox");
    expect(rooms).toHaveLength(1);
    expect(rooms[0]!.id).not.toBe(roomSessionId(ASK_LAB_USER_ID));
  });

  it("a person with no session whose room session is refused gets the Lab's refusal, and nothing else is read", async () => {
    const { baseUrl } = await lab({ mailboxes: false });
    const seen: string[] = [];
    const real = globalThis.fetch;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      seen.push(`${init?.method ?? "GET"} ${url.pathname}`);
      if (url.pathname === "/api/flows/mailbox/sessions") return new Response(JSON.stringify({ error: "not in this Lab" }), { status: 403 });
      return real(input, init);
    });
    const snapshot = await createLabReader(createLabClients({ baseUrl, userId: ASK_LAB_USER_ID })).read();
    expect(snapshot.refused).toMatchObject({ httpStatus: 403, message: "not in this Lab" });
    expect(seen).toEqual(["GET /api/flows/sessions", "POST /api/flows/mailbox/sessions"]);
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
  it("lists once, reads each manifest kind once, and each board once per refresh", async () => {
    const { baseUrl, tree } = await lab();
    const reader = createLabReader(createLabClients({ baseUrl, userId: ASK_LAB_USER_ID }));
    await reader.read();
    const seen = countRequests();
    const snapshot = loaded(await reader.read());
    const count = (prefix: string) => seen.filter((line) => line.startsWith(prefix)).length;

    expect(count("GET /api/flows/sessions")).toBeGreaterThan(0);
    expect(seen.filter((line) => line === "GET /api/flows/sessions")).toHaveLength(1);
    // Manifests are cached by flow kind across refreshes.
    expect(seen.filter((line) => line.endsWith("/manifest"))).toEqual([]);
    // Each attached board is read once, through its mailbox's session.
    const boardReads = seen.filter((line) => /\/resources\/[^/]+\.[^/]+\.[^/]+$/.test(line));
    const attached = tree.mailboxes.filter((c) => Array.isArray(c.declared.boards)).length;
    expect(boardReads).toHaveLength(attached);
    expect(Object.keys(snapshot.boards).sort()).toEqual(tree.mailboxes.map((c) => c.id).sort());
  });

  it("a failed board read degrades only that workstream's boards", async () => {
    const { baseUrl } = await lab();
    const real = globalThis.fetch;
    vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes("/resources/ops.desk.work")) {
        return Promise.resolve(new Response(JSON.stringify({ error: "board unavailable" }), { status: 500 }));
      }
      return real(input, init);
    });
    const snapshot = loaded(await createLabReader(createLabClients({ baseUrl, userId: ASK_LAB_USER_ID })).read());
    expect(snapshot.boards["ops.desk"]).toMatchObject({ ok: false, failure: { message: "board unavailable" } });
    expect(snapshot.boards["ops.side"]).toMatchObject({ ok: true });
    expect(snapshot.inventory.ok).toBe(true);
    expect(snapshot.asks.ok).toBe(true);
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

describe("asks through the mailbox-notify path (V7)", () => {
  it("a post wakes the members, and each member's ask is in Inbox and the Streams it belongs to", async () => {
    const { baseUrl, tree } = await lab();
    const clients = createLabClients({ baseUrl, userId: ASK_LAB_USER_ID });
    const reader = createLabReader(clients);
    await post(clients, "ops.desk", "ship it");

    const snapshot = await eventually(async () => {
      const s = loaded(await reader.read());
      return s.asks.ok && s.asks.value.length >= 2 ? s : undefined;
    }, "both desk members to ask");
    if (!snapshot.asks.ok || !snapshot.inventory.ok) throw new Error("asks or inventory did not load");
    const asks = snapshot.asks.value;
    const desk = tree.mailboxes.find((c) => c.id === "ops.desk")!;
    // Every member of the desk asked, from a dispatch run the post started.
    expect(asks.map((a) => a.seatId).sort()).toEqual([...(desk.declared.members as string[])].sort());
    for (const ask of asks) {
      expect(ask.parentSessionId).toBe("ops.desk");
      expect(ask.flowId).toBe(ask.seatId);
      expect(ask.item.message).toBe("Approve: ship it");
    }

    const [deskStream, sideStream] = ["ops.desk", "ops.side"].map(
      (id) => snapshot.inventory.ok && snapshot.inventory.value.workstreams.find((w) => w.id === id)!,
    ) as [NonNullable<ReturnType<typeof Object>>, NonNullable<ReturnType<typeof Object>>];
    // The desk's Stream: exactly the asks whose seat is one of its members.
    expect(asksFor(deskStream as never, asks)).toHaveLength(2);
    // A seat on two mailboxes shows its ask on both Streams.
    const onSide = asksFor(sideStream as never, asks);
    expect(onSide.map((a) => a.seatId)).toEqual(["ops.asker"]);
    expect(workstreamsOf(asks[0]!, snapshot.inventory.value.workstreams).map((w) => w.id)).toEqual(["ops.desk"]);
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

  it("a mailbox-woken ask is marked unanswerable, and the Lab does refuse to reopen it", async () => {
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

  it("an ask in a seat that is no mailbox's member is in Inbox and on no Stream", async () => {
    const { baseUrl } = await lab();
    const clients = createLabClients({ baseUrl, userId: ASK_LAB_USER_ID });
    await ask(clients, "ops.loner", "alone");
    const snapshot = await eventually(async () => {
      const s = loaded(await createLabReader(clients).read());
      return s.asks.ok && s.asks.value.length === 1 ? s : undefined;
    }, "the loner's ask");
    if (!snapshot.asks.ok || !snapshot.inventory.ok) throw new Error("not loaded");
    expect(snapshot.asks.value[0]!.seatId).toBe("ops.loner");
    for (const w of snapshot.inventory.value.workstreams) expect(asksFor(w, snapshot.asks.value)).toEqual([]);
  });

  it("Approve and Deny resolve through the resume, and the ask leaves Inbox and every Stream together", async () => {
    const { baseUrl } = await lab();
    const clients = createLabClients({ baseUrl, userId: ASK_LAB_USER_ID });
    const reader = createLabReader(clients);
    // Asks in member seats' own sessions, started by a person.
    await ask(clients, "ops.asker", "deploy");
    await ask(clients, "ops.helper", "rollback");
    const before = await eventually(async () => {
      const s = loaded(await reader.read());
      return s.asks.ok && s.asks.value.length === 2 && s.inventory.ok ? s : undefined;
    }, "two asks");
    if (!before.asks.ok || !before.inventory.ok) throw new Error("not loaded");
    const desk = before.inventory.value.workstreams.find((w) => w.id === "ops.desk")!;
    const side = before.inventory.value.workstreams.find((w) => w.id === "ops.side")!;
    expect(asksFor(desk, before.asks.value)).toHaveLength(2);
    expect(asksFor(side, before.asks.value).map((a) => a.seatId)).toEqual(["ops.asker"]);
    for (const a of before.asks.value) expect(a.unanswerable).toBeNull();

    const byWhat = (what: string) => before.asks.ok && before.asks.value.find((a) => a.item.message === `Approve: ${what}`)!;
    await reader.resume(byWhat("deploy") as never, { action: "approve" });
    const mid = loaded(await reader.read());
    if (!mid.asks.ok) throw new Error("not loaded");
    // Gone from Inbox and from both Streams at once: all three draw the one session.
    expect(mid.asks.value.map((a) => a.item.message)).toEqual(["Approve: rollback"]);
    expect(asksFor(side, mid.asks.value)).toEqual([]);
    expect(asksFor(desk, mid.asks.value)).toHaveLength(1);

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
    // The desk's board belongs to the mailbox's flow, not the seat's.
    await expect(reader.resume({ ...pending!, flowId: "mailbox" }, { action: "approve" })).rejects.toMatchObject({
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
  it("lists a document a seat's flow serves, and its content is the file's, read through that seat's session", async () => {
    const { baseUrl } = await lab();
    const clients = createLabClients({ baseUrl, userId: ASK_LAB_USER_ID });
    const reader = createLabReader(clients);
    // No seat session yet: no listed flow serves the document, so none is found.
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
