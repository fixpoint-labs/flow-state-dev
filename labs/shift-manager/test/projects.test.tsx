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
import type { Project } from "../src/lib/reads";
import { postToRoom, readRoom, TalkRefused, untilAnswered, type RoomLine } from "../src/lib/talk";
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

    // The other member posts; it shows here on the next read (focus), not before.
    await postToRoom(other, "channel", otherSession, "a reply from the other member");
    expect(document.body.textContent).not.toContain("a reply from the other member");
    act(() => void window.dispatchEvent(new Event("focus")));
    await waitFor(() => expect(document.body.textContent).toContain("a reply from the other member"));
    void clients;
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
  });

  it("after a post, waits for each seat's answer however long it takes, not for a quiet spell", async () => {
    // A slow seat: nothing new for three reads after the post, then its answer.
    let reads = 0;
    const held: RoomLine[] = [{ projectId: "p", seq: 1, userId: ASK_LAB_USER_ID, author: null, body: "the post" }];
    const read = async () => {
      reads += 1;
      if (reads === 4) held.push({ projectId: "p", seq: 2, userId: ASK_LAB_USER_ID, author: "ops.slow", body: "done, at last" });
      return held;
    };
    expect(await untilAnswered(read, 1, ["ops.slow"], { pollMs: 5, timeoutMs: 5_000 })).toBe(true);
    expect(reads).toBe(4);
    // A seat that never answers ends at the bound, not before.
    const begun = Date.now();
    expect(await untilAnswered(async () => held, 2, ["ops.never"], { pollMs: 5, timeoutMs: 200 })).toBe(false);
    expect(Date.now() - begun).toBeGreaterThanOrEqual(200);
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
      projects: { ok: true, value: { rows, talkKind: "channel" } },
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
