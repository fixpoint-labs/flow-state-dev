// @vitest-environment happy-dom
/**
 * PROJECTS and the project level against a real Lab, in a DOM (V4: BR-22 to
 * BR-31). Every project is created through the project writes' own
 * `createProject`, and every line through a talk session's own `post`; what
 * the screen draws is compared with what the Lab's routes hold.
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App";
import { GAPS } from "../src/gaps";
import { createLabClients, type LabClients } from "../src/lib/connection";
import { projectsOf, talkFor, type LoadedSnapshot } from "../src/lib/derive";
import { toProject, type Project } from "../src/lib/reads";
import { postToRoom, readRoom, readRoomPages, startRoomRefresh, TalkRefused, type RoomLine, type RoomPage } from "../src/lib/talk";
import { ClientHttpError } from "@flow-state-dev/client";
import { ASK_LAB_USER_ID, openAskLab } from "./fixtures/ask-lab/lab.mts";
import { eventually, serveLab, type ServedLab } from "./helpers/serve-lab";

const OTHER = "u_ask_member";
const OUTSIDER = "u_ask_outsider";

const served: ServedLab[] = [];
afterEach(async () => {
  cleanup();
  vi.restoreAllMocks();
  await Promise.all(served.splice(0).map((lab) => lab.handle.close()));
});

/** The ask-lab with two projects: `desk` holds a board-holding and a board-less workstream; `empty` holds none. */
const PROJECTS = [
  { id: "desk", title: "The desk", brief: "Keep the request desk moving.", members: [OTHER], workstreams: ["ops.desk", "ops.side"] },
  { id: "empty", title: "Nothing yet", members: [OTHER] },
];

async function lab(projects: NonNullable<Parameters<typeof openAskLab>[0]>["projects"] = PROJECTS) {
  const opened = await openAskLab({ projects });
  const s = await serveLab(opened.flowState);
  served.push(s);
  return s;
}

/** Give `userId` a session of their own in the Lab, so Shift Manager has an organization to open it under. */
async function holdASession(baseUrl: string, userId: string) {
  const clients = createLabClients({ userId, baseUrl });
  await clients.actions("channel").sendAction("read", {}, {});
  return clients;
}

/** The row as the Lab stores it, read over its collection route through one of the owner's sessions. */
async function storedRow(baseUrl: string, id: string): Promise<Project> {
  const res = await fetch(`${baseUrl}/api/flows/sessions/ops.desk/resources/projects?limit=200`);
  const body = (await res.json()) as { items: Array<{ clientData: Project }> };
  const row = body.items.map((i) => i.clientData).find((p) => p.id === id);
  if (row === undefined) throw new Error(`no project ${id} stored`);
  return row;
}

/**
 * Serve the inventory's channel rows rewritten by `rewrite`, as a Lab whose
 * inventory says that would answer. Everything else goes to the Lab as is.
 * Returns the path of every action request sent, in order.
 */
function rewriteChannelRows(
  baseUrl: string,
  rewrite: (rows: Array<{ clientData: Record<string, unknown> }>) => Array<{ clientData: Record<string, unknown> }>,
): { actions: string[] } {
  const real = globalThis.fetch;
  const actions: string[] = [];
  let channelsRef: Promise<string> | undefined;
  const refOf = () =>
    (channelsRef ??= real(`${baseUrl}/api/flows/sessions/ops.desk/manifest`)
      .then((r) => r.json())
      .then((m: { resources: Array<{ kind: string; pattern: string; ref: string }> }) => {
        const found = m.resources.find((r) => r.kind === "collection" && r.pattern === "inventory/channels/*");
        if (found === undefined) throw new Error("the ask-lab's channel kind declares no channel inventory");
        return found.ref;
      }));
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    if (/\/actions\//.test(url)) actions.push(url.replace(/^https?:\/\/[^/]+/, "").split("?")[0]!);
    if (new RegExp(`/resources/${encodeURIComponent(await refOf())}(\\?|$)`).test(url)) {
      const body = (await (await real(input, init)).json()) as { items: Array<{ clientData: Record<string, unknown> }> };
      return new Response(JSON.stringify({ ...body, items: rewrite(body.items) }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return real(input, init);
  });
  return { actions };
}

function openApp(baseUrl: string, path: string, userId = ASK_LAB_USER_ID): LabClients {
  (window as unknown as { happyDOM: { setURL(url: string): void } }).happyDOM.setURL(`${baseUrl}${path}`);
  const clients = createLabClients({ userId });
  render(<App clients={clients} />);
  return clients;
}

describe("PROJECTS (BR-22, D3)", () => {
  it("lists each project with exactly the workstreams its row names, then No project with the rest", async () => {
    const { baseUrl } = await lab([
      { id: "desk", title: "The desk", members: [OTHER], workstreams: ["ops.desk"] },
      { id: "empty", title: "Nothing yet", members: [OTHER] },
    ]);
    openApp(baseUrl, "/inbox");
    await screen.findByTestId("nav-project-desk");
    const groups = screen.getAllByTestId("project-group").map((g) => ({
      id: g.getAttribute("data-project-id"),
      streams: within(g)
        .queryAllByTestId(/^nav-workstream-/)
        .map((el) => el.getAttribute("data-testid")!.slice("nav-workstream-".length)),
    }));
    expect(groups).toEqual([
      { id: "desk", streams: ["ops.desk"] },
      { id: "empty", streams: [] },
      { id: "unassigned", streams: ["ops.side"] },
    ]);
    expect(screen.getByTestId("nav-project-desk").textContent).toContain("The desk");
  });

  it("draws no No project when every workstream is in a project, and every workstream when there are no projects", async () => {
    const { baseUrl } = await lab();
    openApp(baseUrl, "/inbox");
    await screen.findByTestId("nav-project-desk");
    expect(screen.queryByTestId("nav-project-unassigned")).toBeNull();
    cleanup();

    const bare = await lab([]);
    openApp(bare.baseUrl, "/inbox");
    await screen.findByTestId("nav-project-unassigned");
    expect(screen.getAllByTestId("project-group")).toHaveLength(1);
    expect(screen.getByTestId("nav-workstream-ops.desk")).toBeTruthy();
    expect(screen.getByTestId("nav-workstream-ops.side")).toBeTruthy();
  });

  it("a Lab whose inventory lists seats and projects but no workstreams still shows its projects", async () => {
    const { baseUrl } = await lab();
    rewriteChannelRows(baseUrl, () => []);
    openApp(baseUrl, "/inbox");
    await screen.findByTestId("nav-project-desk", undefined, { timeout: 10_000 });
    expect(screen.getAllByTestId("project-group").map((g) => g.getAttribute("data-project-id"))).toEqual(["desk", "empty"]);
  });

  it("a failed projects read shows its failed-read state with Retry, and Retry reads it again (BR-30)", async () => {
    const { baseUrl } = await lab();
    const real = globalThis.fetch;
    let down = true;
    vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      const url = String(input instanceof Request ? input.url : input);
      if (down && /\/resources\/projects(\?|$)/.test(url)) {
        return Promise.resolve(new Response(JSON.stringify({ error: "projects offline" }), { status: 503 }));
      }
      return real(input, init);
    });
    openApp(baseUrl, "/inbox");
    const failed = await screen.findByTestId("projects-failure");
    expect(failed.textContent).toMatch(/Projects did not load.*projects offline/);
    expect(screen.getByTestId("teams")).toBeTruthy();
    down = false;
    act(() => fireEvent.click(within(failed).getByRole("button", { name: "Retry" })));
    await screen.findByTestId("nav-project-desk");
  });
});

describe("a project's tabs (BR-25 to BR-29)", () => {
  it("Brief is the row's brief; Board draws a lane per board-holding workstream; Workstreams lists the row's", async () => {
    const { baseUrl } = await lab();
    openApp(baseUrl, "/p/desk/brief");
    expect((await screen.findByTestId("project-brief")).textContent).toBe((await storedRow(baseUrl, "desk")).brief);
    expect(screen.getByTestId("project-title").textContent).toBe("The desk");

    act(() => fireEvent.click(screen.getByRole("tab", { name: /board/i })));
    const lanes = (await screen.findAllByTestId("project-lane")).map((l) => l.getAttribute("data-channel-id"));
    expect(lanes).toEqual(["ops.desk"]);

    act(() => fireEvent.click(screen.getByRole("tab", { name: /workstreams/i })));
    const listed = (await screen.findAllByTestId("project-workstream")).map((l) => l.getAttribute("data-channel-id"));
    expect(listed).toEqual((await storedRow(baseUrl, "desk")).workstreams);
  });

  it("a project with no workstreams and no brief names each empty tab", async () => {
    const { baseUrl } = await lab();
    openApp(baseUrl, "/p/empty/board");
    await screen.findByTestId("project-board-none");
    act(() => fireEvent.click(screen.getByRole("tab", { name: /workstreams/i })));
    await screen.findByTestId("project-workstreams-none");
    act(() => fireEvent.click(screen.getByRole("tab", { name: /brief/i })));
    await screen.findByTestId("project-brief-none");
  });

  it("No project: Board and Workstreams list its workstreams; Stream and Brief say it has no room or brief (BR-28)", async () => {
    const { baseUrl } = await lab([{ id: "desk", title: "The desk", members: [OTHER], workstreams: ["ops.desk"] }]);
    openApp(baseUrl, "/p/unassigned/workstreams");
    const listed = (await screen.findAllByTestId("project-workstream")).map((l) => l.getAttribute("data-channel-id"));
    expect(listed).toEqual(["ops.side"]);
    act(() => fireEvent.click(screen.getByRole("tab", { name: /board/i })));
    await screen.findByTestId("project-board-none");
    act(() => fireEvent.click(screen.getByRole("tab", { name: /^stream$/i })));
    await screen.findByTestId("project-stream-none");
    act(() => fireEvent.click(screen.getByRole("tab", { name: /brief/i })));
    await screen.findByTestId("project-brief-none");
  });

  it("a route naming no project the Lab holds says so, and links on (BR-29)", async () => {
    const { baseUrl } = await lab();
    openApp(baseUrl, "/p/no-such/stream");
    expect((await screen.findByTestId("project-missing")).textContent).toMatch(/no project "no-such"/);
    act(() => fireEvent.click(screen.getByTestId("project-missing-link")));
    await screen.findByTestId("project-workstreams-none");
    expect(window.location.pathname).toBe("/p/unassigned/workstreams");
  });
});

describe("a project's Stream is its room (BR-23, BR-24)", () => {
  it("a member reads the room through their own talk session, posts into it, and another member's line shows on the next read", async () => {
    const { baseUrl } = await lab();
    const row = await storedRow(baseUrl, "desk");
    const own = row.sessions.find((s) => s.userId === ASK_LAB_USER_ID)!.sessionId;
    const clients = openApp(baseUrl, "/p/desk/stream");
    const stream = await screen.findByTestId("stream");
    expect(stream.getAttribute("data-talk-session")).toBe(own);

    fireEvent.change(screen.getByTestId("composer-input"), { target: { value: "first line in the room" } });
    act(() => fireEvent.click(screen.getByTestId("composer-send")));
    await waitFor(() => expect(screen.getAllByTestId("transcript-line-body").map((b) => b.textContent)).toContain("first line in the room"));
    // The line is in the room: the other member reads it through their own session.
    const other = await holdASession(baseUrl, OTHER);
    const otherSession = await joinAs(other, "desk");
    expect((await readRoom(other, "channel", otherSession, 0)).lines.map((l) => [l.userId, l.body])).toEqual([
      [ASK_LAB_USER_ID, "first line in the room"],
    ]);

    // The other member posts; the open room's refresh loop reads it in, with nothing done on this side.
    await postToRoom(other, "channel", otherSession, "a reply from the other member");
    await waitFor(() => expect(document.body.textContent).toContain("a reply from the other member"), { timeout: 10_000 });
    void clients;
  });

  it("the room's refresh loop stops when the room unmounts: no read after", async () => {
    const { baseUrl } = await lab();
    const reads: number[] = [];
    const real = globalThis.fetch;
    vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      const url = String(input instanceof Request ? input.url : input);
      if (/\/actions\/read$/.test(url)) reads.push(Date.now());
      return real(input, init);
    });
    openApp(baseUrl, "/p/desk/stream");
    await screen.findByTestId("stream", undefined, { timeout: 10_000 });
    fireEvent.change(screen.getByTestId("composer-input"), { target: { value: "posted before leaving" } });
    act(() => fireEvent.click(screen.getByTestId("composer-send")));
    await waitFor(() => expect(screen.getAllByTestId("transcript-line-body").map((b) => b.textContent)).toContain("posted before leaving"));
    // The loop is running: it reads again without being asked.
    const before = reads.length;
    await waitFor(() => expect(reads.length).toBeGreaterThan(before), { timeout: 5_000 });
    cleanup();
    const left = Date.now();
    await new Promise((r) => setTimeout(r, 3_000));
    // A read already sent when the view went may still land; none is sent after.
    expect(reads.filter((at) => at > left + 50)).toEqual([]);
  });

  it("a read the Lab can't answer shows beside the lines with Retry, and a post whose read-back fails keeps its draft", async () => {
    const { baseUrl } = await lab();
    const own = (await storedRow(baseUrl, "desk")).sessions.find((s) => s.userId === ASK_LAB_USER_ID)!.sessionId;
    await postToRoom(createLabClients({ userId: ASK_LAB_USER_ID, baseUrl }), "channel", own, "a line already here");
    const real = globalThis.fetch;
    let down = false;
    vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      const url = String(input instanceof Request ? input.url : input);
      if (down && /\/actions\/read$/.test(url)) {
        return Promise.resolve(new Response(JSON.stringify({ error: "room offline" }), { status: 503 }));
      }
      return real(input, init);
    });
    openApp(baseUrl, "/p/desk/stream");
    await waitFor(() => expect(document.body.textContent).toContain("a line already here"));

    down = true;
    fireEvent.change(screen.getByTestId("composer-input"), { target: { value: "posted while reads are down" } });
    act(() => fireEvent.click(screen.getByTestId("composer-send")));
    // The post went through; reading it back did not. The draft stays, and says so.
    const error = await screen.findByTestId("composer-error", undefined, { timeout: 10_000 });
    expect(error.textContent).toMatch(/posted, but reading it back failed/);
    expect((screen.getByTestId("composer-input") as HTMLTextAreaElement).value).toBe("posted while reads are down");
    // A 5xx is the Lab out of reach, not a refusal: Retry, beside the lines already drawn.
    const failure = screen.getByTestId("room-failure");
    expect(screen.queryByTestId("room-refused")).toBeNull();
    expect(screen.getAllByTestId("transcript-line-body").map((b) => b.textContent)).toContain("a line already here");

    down = false;
    act(() => fireEvent.click(within(failure).getByRole("button", { name: "Retry" })));
    await waitFor(() => expect(screen.getAllByTestId("transcript-line-body").map((b) => b.textContent)).toContain("posted while reads are down"));
    await waitFor(() => expect(screen.queryByTestId("room-failure")).toBeNull());
  });

  it("a room on a workstream of a custom kind is still opened, read and posted on the built-in channel kind", async () => {
    const { baseUrl } = await lab();
    // The inventory says every workstream runs on an app's own kind. Rooms are
    // always the built-in channel kind's, whatever kind carried the projects read.
    const { actions } = rewriteChannelRows(baseUrl, (rows) => rows.map((r) => ({ ...r, clientData: { ...r.clientData, kind: "desk-kind" } })));
    openApp(baseUrl, "/p/desk/stream");
    await screen.findByTestId("stream", undefined, { timeout: 10_000 });
    fireEvent.change(screen.getByTestId("composer-input"), { target: { value: "posted beside a custom kind" } });
    act(() => fireEvent.click(screen.getByTestId("composer-send")));
    await waitFor(() => expect(screen.getAllByTestId("transcript-line-body").map((b) => b.textContent)).toContain("posted beside a custom kind"), { timeout: 10_000 });
    expect(actions.length).toBeGreaterThan(0);
    expect(actions.filter((path) => !path.startsWith("/api/flows/channel/"))).toEqual([]);
  });

  it("only the Lab's own answer is a refusal: a 4xx or a failed request is TalkRefused, a 5xx is thrown as it came", async () => {
    const fake = (send: () => Promise<unknown>, status = "completed", error?: string) =>
      ({
        actions: () => ({
          sendAction: send,
          getRequestStatus: async () => ({ status }),
        }),
        sessions: {
          listSessionRequests: async () => [{ id: "r1", result: error === undefined ? { output: { seq: 1 } } : { error: { message: error } } }],
        },
      }) as unknown as LabClients;
    const started = async () => ({ request: { id: "r1" } });

    await expect(postToRoom(fake(() => Promise.reject(new ClientHttpError("not-a-member", { status: 403, body: { error: "not-a-member" } }))), "channel", "s", "x")).rejects.toBeInstanceOf(TalkRefused);
    await expect(postToRoom(fake(started, "failed", "not-a-member: you are not in this room"), "channel", "s", "x")).rejects.toThrow(TalkRefused);
    const unreachable = postToRoom(fake(() => Promise.reject(new ClientHttpError("upstream", { status: 503, body: null }))), "channel", "s", "x");
    await expect(unreachable).rejects.toBeInstanceOf(ClientHttpError);
    await expect(postToRoom(fake(() => Promise.reject(new TypeError("fetch failed"))), "channel", "s", "x")).rejects.not.toBeInstanceOf(TalkRefused);
    // A request that ended without the Lab's answer is something to retry, not a refusal.
    for (const ended of ["aborted", "interrupted", "incomplete"]) {
      const cut = postToRoom(fake(started, ended), "channel", "s", "x");
      await expect(cut).rejects.toThrow(new RegExp(ended));
      await expect(postToRoom(fake(started, ended), "channel", "s", "x")).rejects.not.toBeInstanceOf(TalkRefused);
    }
  });

  it("a page holding only tombstones moves the cursor on, and the lines after it are read", async () => {
    const line = (seq: number, body: string): RoomLine => ({ projectId: "p", seq, userId: ASK_LAB_USER_ID, author: null, body });
    // What `readRoom` hands back: tombstones already dropped, so the first page is empty but its cursor moved.
    const pages = new Map<number, RoomPage>([
      [0, { lines: [], nextCursor: 50, charter: "", seats: [] }],
      [50, { lines: [line(51, "after the gap"), line(52, "and one more")], nextCursor: 52, charter: "", seats: [] }],
      [52, { lines: [], nextCursor: 52, charter: "", seats: [] }],
    ]);
    const seen: string[] = [];
    const cursor = await readRoomPages(async (after) => pages.get(after)!, 0, (p) => seen.push(...p.lines.map((l) => l.body)));
    expect(seen).toEqual(["after the gap", "and one more"]);
    expect(cursor).toBe(52);
  });

  describe("the room's one refresh loop", () => {
    /** A room the loop reads by cursor, with how many reads ran at once at most. */
    function fakeRoom() {
      const room: RoomLine[] = [];
      const shown: RoomLine[] = [];
      let inFlight = 0;
      const stats = { reads: 0, maxInFlight: 0 };
      const read = async () => {
        stats.reads += 1;
        inFlight += 1;
        stats.maxInFlight = Math.max(stats.maxInFlight, inFlight);
        await new Promise((r) => setTimeout(r, 5));
        const fresh = room.slice(shown.length);
        shown.push(...fresh);
        inFlight -= 1;
        return fresh.length;
      };
      const add = (author: string | null, body: string) =>
        room.push({ projectId: "p", seq: room.length + 1, userId: ASK_LAB_USER_ID, author, body });
      return { room, shown, stats, read, add };
    }
    const until = async (check: () => boolean, ms = 3_000) => {
      const end = Date.now() + ms;
      while (!check()) {
        if (Date.now() > end) throw new Error("timed out");
        await new Promise((r) => setTimeout(r, 5));
      }
    };

    it("two posts at once both show their answers, whichever seat answers first", async () => {
      const r = fakeRoom();
      const loop = startRoomRefresh(r.read, { minMs: 10, maxMs: 80, visible: () => true });
      // Two posts close together; each wakes the loop. The answers land later, out of order.
      r.add(null, "first post");
      loop.wake();
      r.add(null, "second post");
      loop.wake();
      setTimeout(() => r.add("ops.slow", "answer to the first"), 150);
      setTimeout(() => r.add("ops.quick", "answer to the second"), 60);
      await until(() => r.shown.length === 4);
      expect(r.shown.map((l) => l.body)).toEqual(["first post", "second post", "answer to the second", "answer to the first"]);
      loop.stop();
    });

    it("runs one read at a time however many posts wake it, and backs off while quiet", async () => {
      const r = fakeRoom();
      const loop = startRoomRefresh(r.read, { minMs: 10, maxMs: 80, visible: () => true });
      // Posts keep arriving, each waking the loop, many of them while a read is in flight.
      let i = 0;
      await new Promise<void>((resolve) => {
        const posting = setInterval(() => {
          r.add(null, `post ${i}`);
          loop.wake();
          i += 1;
          if (i === 25) {
            clearInterval(posting);
            resolve();
          }
        }, 2);
      });
      await until(() => r.shown.length === 25);
      expect(r.stats.maxInFlight).toBe(1);
      // Quiet now: over 600 ms a loop that backs off to 80 ms reads at most ~10 times, not every 10 ms.
      const quietFrom = r.stats.reads;
      await new Promise((resolve) => setTimeout(resolve, 600));
      expect(r.stats.reads - quietFrom).toBeLessThanOrEqual(12);
      expect(r.stats.reads - quietFrom).toBeGreaterThan(0);
      loop.stop();
    });

    it("reads nothing once stopped, and nothing while the view is hidden", async () => {
      const r = fakeRoom();
      const loop = startRoomRefresh(r.read, { minMs: 10, maxMs: 40, visible: () => true });
      await until(() => r.stats.reads > 0);
      loop.stop();
      const at = r.stats.reads;
      loop.wake();
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(r.stats.reads).toBe(at);

      const hidden = fakeRoom();
      const away = startRoomRefresh(hidden.read, { minMs: 10, maxMs: 40, visible: () => false });
      away.wake();
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(hidden.stats.reads).toBe(0);
      away.stop();
    });
  });

  it("a member with no talk session gets Join, and joining binds one that the row then lists", async () => {
    const { baseUrl } = await lab();
    await holdASession(baseUrl, OTHER);
    openApp(baseUrl, "/p/desk/stream", OTHER);
    const join = await screen.findByTestId("project-join");
    act(() => fireEvent.click(join));
    const stream = await screen.findByTestId("stream", undefined, { timeout: 10_000 });
    const listed = (await storedRow(baseUrl, "desk")).sessions.filter((s) => s.userId === OTHER);
    expect(listed).toHaveLength(1);
    expect(stream.getAttribute("data-talk-session")).toBe(listed[0]!.sessionId);
  });

  it("someone who is not a member sees the project and is told the room is for its members, and the room is never read", async () => {
    const { baseUrl } = await lab();
    await holdASession(baseUrl, OUTSIDER);
    const actions: string[] = [];
    const real = globalThis.fetch;
    vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      const url = String(input instanceof Request ? input.url : input);
      if (/\/actions\//.test(url)) actions.push(url);
      return real(input, init);
    });
    openApp(baseUrl, "/p/desk/stream", OUTSIDER);
    await screen.findByTestId("project-stream-members-only");
    expect(screen.getByTestId("nav-project-desk")).toBeTruthy();
    expect(screen.queryByTestId("composer")).toBeNull();
    await new Promise((r) => setTimeout(r, 300));
    expect(actions).toEqual([]);
    // And the Lab refuses the outsider's own talk session, whatever its state says.
    const outsider = createLabClients({ userId: OUTSIDER, baseUrl });
    await expect(joinAs(outsider, "desk")).rejects.toThrow(/not-a-member|members/);
  });

  it("the owner of a project whose mint failed is bound on open, once (BR-8a)", async () => {
    const { baseUrl } = await lab([{ id: "orphan", title: "Orphaned", members: [OTHER], unbound: true }]);
    expect((await storedRow(baseUrl, "orphan")).sessions).toEqual([]);
    openApp(baseUrl, "/p/orphan/stream");
    const stream = await screen.findByTestId("stream", undefined, { timeout: 10_000 });
    const sessions = (await storedRow(baseUrl, "orphan")).sessions;
    expect(sessions).toEqual([{ sessionId: stream.getAttribute("data-talk-session"), userId: ASK_LAB_USER_ID }]);
  });
});

/** Join `projectId`'s room as this client, through the Lab's own `join`. */
async function joinAs(clients: LabClients, projectId: string): Promise<string> {
  const { joinRoom } = await import("../src/lib/talk");
  return joinRoom(clients, "channel", projectId);
}

describe("grouping is the snapshot's (V4)", () => {
  const snapshot = (rows: Project[]): LoadedSnapshot =>
    ({
      readAt: 0,
      sessions: [],
      orgId: "org",
      inventory: {
        ok: true,
        value: {
          seats: [],
          workstreams: [
            { id: "eng.a", kind: "channel", members: [] },
            { id: "ops.b", kind: "channel", members: [] },
            { id: "ops.c", kind: "channel", members: [] },
          ],
        },
      },
      projects: { ok: true, value: { rows } },
      boards: {},
      asks: { ok: true, value: [] },
      resources: { ok: true, value: [] },
    }) as LoadedSnapshot;
  const project = (over: Partial<Project>): Project => ({
    id: "p",
    title: "P",
    brief: null,
    status: "active",
    ownerUserId: "alice",
    members: ["alice"],
    workstreams: [],
    sessions: [],
    ...over,
  });

  it("a row's brief: an empty one stays an empty string; absent or not a string is no brief", () => {
    const row = { id: "p", title: "P", ownerUserId: ASK_LAB_USER_ID };
    expect(toProject({ ...row, brief: "" })?.brief).toBe("");
    expect(toProject({ ...row, brief: "Ship it." })?.brief).toBe("Ship it.");
    expect(toProject(row)?.brief).toBeNull();
    expect(toProject({ ...row, brief: 7 })?.brief).toBeNull();
  });

  it("projectsOf groups a cross-team project, keeps a gone id as gone, and makes no read", () => {
    const spy = vi.spyOn(globalThis, "fetch");
    const view = projectsOf(snapshot([project({ id: "s", workstreams: ["eng.a", "ops.b", "ops.gone"] })]));
    expect(spy).not.toHaveBeenCalled();
    if (!view.ok) throw new Error("expected a view");
    expect(view.value.projects[0]!.workstreams.map((w) => [w.id, w.workstream?.id ?? null])).toEqual([
      ["eng.a", "eng.a"],
      ["ops.b", "ops.b"],
      ["ops.gone", null],
    ]);
    expect(view.value.noProject.map((w) => w.id)).toEqual(["ops.c"]);
  });

  it("talkFor reads only the row: member, repair, join, outsider", () => {
    const row = project({ members: ["alice", "bob"], sessions: [{ sessionId: "s_bob", userId: "bob" }] });
    expect(talkFor(row, "bob")).toEqual({ kind: "member", sessionId: "s_bob" });
    expect(talkFor(row, "alice")).toEqual({ kind: "repair" });
    expect(talkFor(project({ members: ["alice", "carol"] }), "carol")).toEqual({ kind: "join" });
    expect(talkFor(row, "mallory")).toEqual({ kind: "outsider" });
  });
});

describe("the gap registry (BR-31)", () => {
  it("names no project gap, and no copy anywhere says projects arrive with FIX-1650", async () => {
    expect(Object.keys(GAPS).filter((key) => key.startsWith("project"))).toEqual([]);
    expect(JSON.stringify(GAPS)).not.toMatch(/FIX-1650/);
    const src = join(__dirname, "..", "src");
    for (const file of ["gaps.ts", "surfaces/Project.tsx", "surfaces/Sidebar.tsx"]) {
      expect(readFileSync(join(src, file), "utf8"), file).not.toMatch(/arrives with FIX-1650/);
    }
    const { baseUrl } = await lab();
    openApp(baseUrl, "/p/desk/stream");
    await screen.findByTestId("stream");
    for (const tab of ["board", "workstreams", "brief"]) {
      act(() => fireEvent.click(screen.getByRole("tab", { name: new RegExp(tab, "i") })));
      await eventually(async () => (screen.queryByRole("tabpanel")?.getAttribute("data-tabpanel") === tab ? true : undefined), tab);
      expect(document.body.textContent).not.toMatch(/FIX-1650/);
    }
  });
});
