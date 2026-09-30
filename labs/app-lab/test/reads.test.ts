/**
 * S3's shared reads, against a real Lab served on a free port (V2, V3, V7).
 *
 * Every assertion is on what the Lab's own routes return: the ask-lab is an
 * ordinary Lab config whose seats suspend on a stock approval, woken the way a
 * real Lab wakes them, by a channel post through the framework's member wake.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createLabClients } from "../src/lib/connection";
import {
  createLabReader,
  DISPATCHED_RUN_UNANSWERABLE,
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
  return snapshot;
}

/** Post a line to a channel through its own `post` action. */
async function post(clients: ReturnType<typeof createLabClients>, channelId: string, body: string) {
  await clients.actions("channel").sendAction("post", { body }, { sessionId: channelId });
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
    // Each attached board is read once, through its channel's session.
    const boardReads = seen.filter((line) => /\/resources\/[^/]+\.[^/]+\.[^/]+$/.test(line));
    const attached = tree.channels.filter((c) => Array.isArray(c.declared.boards)).length;
    expect(boardReads).toHaveLength(attached);
    expect(Object.keys(snapshot.boards).sort()).toEqual(tree.channels.map((c) => c.id).sort());
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
    expect(snapshot.sessions.ok).toBe(true);
  });
});

describe("asks through the channel-notify path (V7)", () => {
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
    const desk = tree.channels.find((c) => c.id === "ops.desk")!;
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
    // A seat on two channels shows its ask on both Streams.
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

  it("a channel-woken ask is marked unanswerable, and the Lab does refuse to reopen it", async () => {
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

  it("an ask in a seat that is no channel's member is in Inbox and on no Stream", async () => {
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
    // The desk's board belongs to the channel's flow, not the seat's.
    await expect(reader.resume({ ...pending!, flowId: "channel" }, { action: "approve" })).rejects.toMatchObject({
      status: 404,
    });
    await expect(reader.resume({ ...pending!, flowId: null }, { action: "approve" })).rejects.toThrow(
      UNOWNED_SESSION_UNANSWERABLE,
    );
    await reader.resume(pending!, { action: "approve" });
    expect(loaded(await reader.read()).asks).toEqual({ ok: true, value: [] });
  });
});
