// @vitest-environment happy-dom
/**
 * PROJECTS and the project level against a real Lab, in a DOM (V4: BR-22 to
 * BR-28). Every project is created through the project writes' own
 * `createProject`; what the screen draws is compared with what the Lab's
 * routes hold. A project's coordinator and its workstreams are proved on the
 * DevTeam Lab (`project-workstreams.test.tsx`), which installs them.
 */
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App";
import { GAPS } from "../src/gaps";
import { createLabClients, type LabClients } from "../src/lib/connection";
import { projectsOf, type LoadedSnapshot } from "../src/lib/derive";
import { createLabReader, PROJECT_READER_KIND, readerSessionId, toProject, type Project } from "../src/lib/reads";
import { ASKER_KIND } from "./fixtures/ask-lab/asker.mts";
import { ASK_LAB_USER_ID, openAskLab } from "./fixtures/ask-lab/lab.mts";
import { eventually, serveLab, type ServedLab } from "./helpers/serve-lab";

const OTHER = "u_ask_member";

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


/** The row as the Lab stores it, read over its collection route through the owner's roster session, which the app opened. */
async function storedRow(baseUrl: string, id: string): Promise<Project> {
  const res = await fetch(`${baseUrl}/api/flows/sessions/${readerSessionId(ASK_LAB_USER_ID, PROJECT_READER_KIND)}/resources/projects?limit=200`);
  const body = (await res.json()) as { items: Array<{ clientData: Project }> };
  const row = body.items.map((i) => i.clientData).find((p) => p.id === id);
  if (row === undefined) throw new Error(`no project ${id} stored`);
  return row;
}

/**
 * Serve the inventory's mailbox rows rewritten by `rewrite`, as a Lab whose
 * inventory says that would answer. Everything else goes to the Lab as is.
 * Returns the path of every action request sent, in order.
 */
function rewriteMailboxRows(
  baseUrl: string,
  rewrite: (rows: Array<{ clientData: Record<string, unknown> }>) => Array<{ clientData: Record<string, unknown> }>,
): { actions: string[] } {
  const real = globalThis.fetch;
  const actions: string[] = [];
  let mailboxesRef: Promise<string> | undefined;
  const refOf = () =>
    (mailboxesRef ??= real(`${baseUrl}/api/flows/sessions/ops.desk/manifest`)
      .then((r) => r.json())
      .then((m: { resources: Array<{ kind: string; pattern: string; ref: string }> }) => {
        const found = m.resources.find((r) => r.kind === "collection" && r.pattern === "inventory/mailboxes/*");
        if (found === undefined) throw new Error("the ask-lab's mailbox kind declares no mailbox inventory");
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
    rewriteMailboxRows(baseUrl, () => []);
    openApp(baseUrl, "/inbox");
    await screen.findByTestId("nav-project-desk", undefined, { timeout: 10_000 });
    expect(screen.getAllByTestId("project-group").map((g) => g.getAttribute("data-project-id"))).toEqual(["desk", "empty"]);
  });

  it("a member who holds no session on a flow that declares the projects still sees them, and a Lab with no project setup has no coordinator", async () => {
    const { baseUrl } = await lab();
    // OTHER is a member of both projects, created none of them, and holds only a seat's session.
    (window as unknown as { happyDOM: { setURL(url: string): void } }).happyDOM.setURL(baseUrl);
    await createLabClients({ userId: OTHER, baseUrl }).sessions.createSession({ flowKind: ASKER_KIND, userId: OTHER, state: { workerId: "ops.asker" } });
    openApp(baseUrl, "/p/desk/stream", OTHER);
    await screen.findByTestId("nav-project-desk", undefined, { timeout: 10_000 });
    expect(screen.getAllByTestId("project-group").map((g) => g.getAttribute("data-project-id"))).toContain("empty");
    // The ask-lab's flows answer no `projectSetup`: it names no project coordinator, and the Stream says so.
    await screen.findByTestId("project-stream-no-coordinator", undefined, { timeout: 10_000 });
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

describe("a Lab that declares no projects is empty, not failed (D3)", () => {
  /** Pass every request on, except a POST that opens a session on `kind`, which answers `status`. */
  function refuseSessionsOn(kind: string, status: number) {
    const real = globalThis.fetch;
    vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      const url = String(input instanceof Request ? input.url : input);
      const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
      if (method === "POST" && url.includes(`/api/flows/${kind}/sessions`)) {
        return Promise.resolve(new Response(JSON.stringify({ error: `no ${kind} here` }), { status }));
      }
      return real(input, init);
    });
  }

  it("a pre-project Lab, whose flows declare no projects collection, shows its workstreams under No project and no failure", async () => {
    const { baseUrl } = await lab([]);
    const real = globalThis.fetch;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input instanceof Request ? input.url : input);
      if (!/\/manifest(\?|$)/.test(url)) return real(input, init);
      const body = (await (await real(input, init)).json()) as { resources: Array<{ pattern?: string }> };
      const resources = body.resources.filter((r) => r.pattern !== "projects/*");
      return new Response(JSON.stringify({ ...body, resources }), { status: 200, headers: { "content-type": "application/json" } });
    });
    (window as unknown as { happyDOM: { setURL(url: string): void } }).happyDOM.setURL(baseUrl);
    const snapshot = await createLabReader(createLabClients({ userId: ASK_LAB_USER_ID, baseUrl })).read();
    expect("projects" in snapshot && snapshot.projects).toEqual({ ok: true, value: { rows: [] } });

    openApp(baseUrl, "/inbox");
    await screen.findByTestId("nav-project-unassigned");
    expect(screen.queryByTestId("projects-failure")).toBeNull();
    expect(screen.getByTestId("nav-workstream-ops.desk")).toBeTruthy();
  });

  it("a Lab that doesn't serve the roster flow has nothing that declares projects: zero projects, not a failure", async () => {
    const { baseUrl } = await lab();
    (window as unknown as { happyDOM: { setURL(url: string): void } }).happyDOM.setURL(baseUrl);
    await createLabClients({ userId: OTHER, baseUrl }).sessions.createSession({ flowKind: ASKER_KIND, userId: OTHER, state: { workerId: "ops.asker" } });
    refuseSessionsOn(PROJECT_READER_KIND, 404);
    const snapshot = await createLabReader(createLabClients({ userId: OTHER, baseUrl })).read();
    expect("projects" in snapshot && snapshot.projects).toEqual({ ok: true, value: { rows: [] } });
  });

  it("a roster flow that can't be opened for this person is a failed projects read, never an empty list", async () => {
    const { baseUrl } = await lab();
    (window as unknown as { happyDOM: { setURL(url: string): void } }).happyDOM.setURL(baseUrl);
    await createLabClients({ userId: OTHER, baseUrl }).sessions.createSession({ flowKind: ASKER_KIND, userId: OTHER, state: { workerId: "ops.asker" } });
    refuseSessionsOn(PROJECT_READER_KIND, 503);
    const snapshot = await createLabReader(createLabClients({ userId: OTHER, baseUrl })).read();
    const projects = "projects" in snapshot ? snapshot.projects : undefined;
    expect(projects?.ok).toBe(false);
    expect(projects?.ok === false && projects.failure.message).toMatch(/no workforce-roster here/);
  });
});

describe("a project's tabs (BR-25 to BR-29)", () => {
  it("Brief is the row's brief; Board draws only the person's own workstream sessions; Workstreams lists the row's mailboxes", async () => {
    const { baseUrl } = await lab();
    openApp(baseUrl, "/p/desk/brief");
    expect((await screen.findByTestId("project-brief")).textContent).toBe((await storedRow(baseUrl, "desk")).brief);
    expect(screen.getByTestId("project-title").textContent).toBe("The desk");

    // A project's Board is the person's own workstreams' tasks, never the Lab's mailbox boards (S8).
    act(() => fireEvent.click(screen.getByRole("tab", { name: /board/i })));
    await screen.findByTestId("project-board-none");
    expect(screen.queryByTestId("project-lane")).toBeNull();

    act(() => fireEvent.click(screen.getByRole("tab", { name: /workstreams/i })));
    const listed = (await screen.findAllByTestId("project-workstream")).map((l) => l.getAttribute("data-mailbox-id"));
    expect(listed).toEqual((await storedRow(baseUrl, "desk")).workstreams);
  });

  it("Brief names the repository a project's code lives in, or says it runs on its files", async () => {
    const remote = "https://github.com/acme/desk.git";
    const { baseUrl } = await lab([
      { id: "desk", title: "The desk", brief: "Keep the request desk moving.", members: [OTHER], workstreams: ["ops.desk"], repository: remote },
      { id: "empty", title: "Nothing yet", members: [OTHER] },
    ]);
    openApp(baseUrl, "/p/desk/brief");
    expect((await screen.findByTestId("project-repository")).textContent).toBe(`Repository ${(await storedRow(baseUrl, "desk")).repository}`);
    expect(screen.getByTestId("project-brief").textContent).toBe("Keep the request desk moving.");
    cleanup();

    openApp(baseUrl, "/p/empty/brief");
    expect((await screen.findByTestId("project-repository")).textContent).toBe("No repository · runs on project files");
    await screen.findByTestId("project-brief-none");
  });

  it("a project with no workstreams and no brief names each empty tab", async () => {
    const { baseUrl } = await lab();
    openApp(baseUrl, "/p/empty/board");
    await screen.findByTestId("project-board-none");
    act(() => fireEvent.click(screen.getByRole("tab", { name: /workstreams/i })));
    await screen.findByTestId("project-entries-none");
    expect(screen.queryByTestId("project-workstreams")).toBeNull();
    act(() => fireEvent.click(screen.getByRole("tab", { name: /brief/i })));
    await screen.findByTestId("project-brief-none");
  });

  it("a private project is listed for its owner alone, at its own address", async () => {
    const { baseUrl } = await lab([
      { id: "desk", title: "The desk", members: [OTHER], workstreams: ["ops.desk"] },
      { id: "desk", title: "My notes", visibility: "private" },
    ]);
    openApp(baseUrl, "/inbox");
    const own = await screen.findByTestId("nav-project-private-desk", undefined, { timeout: 10_000 });
    expect(own.textContent).toContain("My notes · private");
    expect(screen.getByTestId("nav-project-desk").textContent).toContain("The desk");
    act(() => fireEvent.click(own));
    expect(window.location.pathname).toBe("/p/private/desk/stream");
    expect((await screen.findByTestId("project-title")).textContent).toBe("My notes");
    expect(screen.getByTestId("project").getAttribute("data-visibility")).toBe("private");
    cleanup();

    // Another person never reads it: their PROJECTS list the shared one only.
    (window as unknown as { happyDOM: { setURL(url: string): void } }).happyDOM.setURL(baseUrl);
    await createLabClients({ userId: OTHER, baseUrl }).sessions.createSession({ flowKind: ASKER_KIND, userId: OTHER, state: { workerId: "ops.asker" } });
    openApp(baseUrl, "/p/private/desk/brief", OTHER);
    await screen.findByTestId("nav-project-desk", undefined, { timeout: 10_000 });
    expect(screen.queryByTestId("nav-project-private-desk")).toBeNull();
    expect((await screen.findByTestId("project-missing")).textContent).toMatch(/You have no private project "desk"/);
  });

  it("No project: Board and Workstreams list its workstreams; Stream and Brief say it has no coordinator or brief", async () => {
    const { baseUrl } = await lab([{ id: "desk", title: "The desk", members: [OTHER], workstreams: ["ops.desk"] }]);
    openApp(baseUrl, "/p/unassigned/workstreams");
    const listed = (await screen.findAllByTestId("project-workstream")).map((l) => l.getAttribute("data-mailbox-id"));
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
            { id: "eng.a", kind: "mailbox", members: [] },
            { id: "ops.b", kind: "mailbox", members: [] },
            { id: "ops.c", kind: "mailbox", members: [] },
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
    visibility: "shared",
    repository: null,
    ...over,
  });

  it("a row's brief: an empty one stays an empty string; absent or not a string is no brief", () => {
    const row = { id: "p", title: "P", ownerUserId: ASK_LAB_USER_ID };
    expect(toProject({ ...row, brief: "" })?.brief).toBe("");
    expect(toProject({ ...row, brief: "Ship it." })?.brief).toBe("Ship it.");
    expect(toProject(row)?.brief).toBeNull();
    expect(toProject({ ...row, brief: 7 })?.brief).toBeNull();
  });

  it("a row's repository: a remote reads as written; a row from before the field, or null, is none", () => {
    const row = { id: "p", title: "P", ownerUserId: ASK_LAB_USER_ID };
    expect(toProject({ ...row, repository: "git@github.com:acme/p.git" })?.repository).toBe("git@github.com:acme/p.git");
    expect(toProject(row)?.repository).toBeNull();
    expect(toProject({ ...row, repository: null })?.repository).toBeNull();
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

});

describe("the gap registry", () => {
  it("names no project gap, and no copy anywhere says projects arrive with FIX-1650", async () => {
    expect(Object.keys(GAPS).filter((key) => key.startsWith("project"))).toEqual([]);
    expect(JSON.stringify(GAPS)).not.toMatch(/FIX-1650/);
    const src = join(__dirname, "..", "src");
    for (const file of ["gaps.ts", "surfaces/Project.tsx", "surfaces/Sidebar.tsx"]) {
      expect(readFileSync(join(src, file), "utf8"), file).not.toMatch(/arrives with FIX-1650/);
    }
    const { baseUrl } = await lab();
    openApp(baseUrl, "/p/desk/stream");
    await screen.findByTestId("project-stream-no-coordinator");
    for (const tab of ["board", "workstreams", "brief"]) {
      act(() => fireEvent.click(screen.getByRole("tab", { name: new RegExp(tab, "i") })));
      await eventually(async () => (screen.queryByRole("tabpanel")?.getAttribute("data-tabpanel") === tab ? true : undefined), tab);
      expect(document.body.textContent).not.toMatch(/FIX-1650/);
    }
  });
});
