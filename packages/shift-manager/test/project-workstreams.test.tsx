/**
 * A project's workstreams in Shift Manager, on the DevTeam Lab, which
 * installs the project coordinator (FIX-1793 S8, S9).
 *
 * Two people in one shared project: the Lab's owner ("Alice") and a member
 * ("Bob"), and an organization member on no project, each with a secret of
 * their own. Everything goes through Shift Manager's own code
 * (`lib/projects.ts`, the project view) against the Lab's shipped routes.
 *
 * The models are scripted by block: the project coordinator's judgment
 * (`coordinator-judgment`) makes the tool calls a test names, then stops; an
 * `agent` worker's turn answers with a fixed line.
 *
 * Checks (`specs/issues/FIX-1793/`): V8b (BR-38, BR-39, BR-40, BR-42: the
 * person asks their project coordinator for work, and it opens a workstream
 * led by a worker on their roster that can lead, the EM, and hands the ask
 * into its session in the same turn; nothing is added to the roster), and
 * V8 (BR-12, BR-18: a project view opens on the row and one entry prefix,
 * its Board reads only the viewer's own workstream sessions, and another
 * person's entry is read, never their session).
 *
 * **Node first, then a DOM.** The DevTeam host's modules resolve files beside
 * them with `new URL(path, import.meta.url)`, which a DOM test file's
 * transform rewrites to the page's origin. So this file runs in Node, and the
 * view's checks put happy-dom's globals in place themselves, then load React
 * and the app.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { builtinEnvironments } from "vitest/environments";
import type { GeneratorModel, ModelResolver } from "@flow-state-dev/core/types";
import { inMemoryStores } from "@flow-state-dev/engine";
import { WORKER_ID_STATE_KEY, type RosterEntry } from "@flow-state-dev/workforce/browser";
import { runAction } from "../src/lib/action";
import { createLabClients, type LabClients } from "../src/lib/connection";
import { readProject, readProjectSetup, type ProjectAddress, type ProjectSetup } from "../src/lib/projects";
import { createLabReader, PROJECT_READER_FLOW, readerSessionId } from "../src/lib/reads";
import { readSessionItems } from "../src/lib/run";
import { workforceClientFor } from "../src/lib/workforce";
import { selectHarness } from "../teams/devteam/harness.mts";
import { LAB_USERS, openLab, type Lab } from "../teams/devteam/host.mts";
import { eventually, serveLab, type ServedLab } from "./helpers/serve-lab";

const APOLLO: ProjectAddress = { visibility: "shared", id: "apollo" };
const ALICE = LAB_USERS.owner;
const BOB = LAB_USERS.member;
const OUTSIDER = LAB_USERS.outsider;

type ToolCall = { toolName: string; args: Record<string, unknown> };

/** What the project coordinator's judgment calls on its next turn, one call per step. */
let judgmentCalls: ToolCall[] = [];

/** The judgment runs `judgmentCalls`, then stops; any other generator answers a fixed line. */
function scripted(): ModelResolver {
  let step = 0;
  const judgment: GeneratorModel = {
    modelId: "test/judgment",
    async generate() {
      throw new Error("the owned tool loop calls generateStep");
    },
    async generateStep() {
      const call = judgmentCalls[step];
      step += 1;
      if (call === undefined) {
        step = 0;
        judgmentCalls = [];
        return { text: "Handed on.", finishReason: "stop" };
      }
      return { toolCalls: [{ toolCallId: `t${step}`, ...call }], finishReason: "tool-calls" };
    },
  };
  const agent: GeneratorModel = {
    modelId: "test/agent",
    async generate() {
      throw new Error("the owned tool loop calls generateStep");
    },
    async generateStep() {
      return { text: "On it.", finishReason: "stop" };
    },
  };
  return Object.assign((_id: string, block?: string) => (block?.startsWith("coordinator-judgment") ? judgment : agent), {
    resolveId: (id: string) => id,
  }) as unknown as ModelResolver;
}

let lab: Lab | undefined;
let served: ServedLab | undefined;
let root: string | undefined;

beforeEach(() => {
  judgmentCalls = [];
});

afterEach(async () => {
  dom?.cleanup();
  vi.restoreAllMocks();
  await served?.handle.close();
  await lab?.dispose();
  if (root !== undefined) rmSync(root, { recursive: true, force: true });
  lab = undefined;
  served = undefined;
  root = undefined;
});

/** One person at the Lab: their connection, their workforce client, and their roster reading session. */
type Person = { clients: LabClients; reader: string; roster: () => Promise<RosterEntry[]> };

/** The DevTeam Lab with one shared project, Apollo, whose members are Alice and Bob. */
async function open(): Promise<{ baseUrl: string; setup: ProjectSetup; as: (user: { userId: string; bearer: string }) => Promise<Person> }> {
  const harness = selectHarness();
  root = mkdtempSync(join(tmpdir(), "sm-project-workstreams-"));
  lab = await openLab({
    modelResolver: scripted(),
    stores: inMemoryStores(),
    harness: harness.slot,
    runTimeoutMs: harness.runTimeoutMs,
    workspace: { root, remotes: { allow: ["file"] } },
    coderWorkerId: "eng.coder",
    inventory: true,
    projects: [{ id: APOLLO.id, title: "Apollo", members: [BOB.userId] }],
  });
  served = await serveLab(lab.state);
  const baseUrl = served.baseUrl;
  // With a DOM in place, the page is on the Lab's origin, as the shift-manager command serves it.
  if (typeof window !== "undefined") (window as unknown as { happyDOM: { setURL(url: string): void } }).happyDOM.setURL(baseUrl);
  const as = async (user: { userId: string; bearer: string }): Promise<Person> => {
    const clients = createLabClients({ userId: user.userId, baseUrl, bearerToken: user.bearer });
    // The Lab read opens the person's reading session on the roster flow, as the app does.
    await createLabReader(clients).read();
    const workforce = workforceClientFor(clients);
    return { clients, reader: readerSessionId(user.userId, PROJECT_READER_FLOW), roster: () => workforce.roster() };
  };
  const setup = await readProjectSetup((await as(ALICE)).clients);
  if (setup === null) throw new Error("the DevTeam Lab answers no project setup");
  return { baseUrl, setup, as };
}

/** The person's own workers, by id. */
async function ownWorkers(person: Person): Promise<RosterEntry[]> {
  return (await person.roster()).filter((entry) => !entry.standard).sort((a, b) => a.id.localeCompare(b.id));
}

/** The DevTeam's one worker that can lead a workstream. */
const EM = "eng.em";

/** Open a workstream over HTTP, as an app may, naming the EM as its lead. */
async function openAs(person: Person, setup: ProjectSetup, id: string, project: ProjectAddress = APOLLO) {
  return runAction(person.clients, setup.flow, readerSessionId(person.clients.userId, setup.flow), "openWorkstream", {
    project,
    id,
    title: `The ${id}`,
    lead: EM,
  });
}

/**
 * Ask the person's project coordinator for work, its judgment scripted to
 * read the leads, open `id` with `lead`, and hand the ask in, in one turn.
 */
async function askFor(person: Person, setup: ProjectSetup, id: string, message: string, lead = EM) {
  judgmentCalls = [
    { toolName: "listLeads", args: {} },
    { toolName: "openWorkstream", args: { project: APOLLO, id, title: `The ${id}`, lead, objectives: [message] } },
    { toolName: "handOff", args: { worker: lead, target: `shared/apollo/${id}` } },
  ];
  const pc = await projectCoordinator(person, setup);
  await runAction(person.clients, "coordinator", pc, "run", { message });
  return pc;
}

/** Whether a session's items carry `word`. */
async function holds(person: Person, sessionId: string, word: string): Promise<boolean> {
  const { items } = await readSessionItems(person.clients, sessionId);
  return JSON.stringify(items).includes(word);
}

/** What `listLeads` answered in a conversation, each call's lead ids. */
async function leadsOffered(person: Person, sessionId: string): Promise<string[][]> {
  const { items } = await readSessionItems(person.clients, sessionId);
  return (items as Array<{ type?: string; blockName?: string; output?: { leads?: Array<{ id: string }> } }>)
    .filter((item) => item.type === "tool_output" && item.blockName === "listLeads")
    .map((item) => (item.output?.leads ?? []).map((lead) => lead.id));
}

/** The person's project coordinator session for Apollo, found or started as the Stream tab does. */
async function projectCoordinator(person: Person, setup: ProjectSetup): Promise<string> {
  return (await workforceClientFor(person.clients).ensureWorkerSession({ worker: setup.projectCoordinator!, projectId: APOLLO })).id;
}

async function delegatesOf(person: Person, sessionId: string) {
  const { output } = await runAction(person.clients, "coordinator", sessionId, "listDelegates", {});
  return (output as { delegates: Array<{ worker: string; target?: string; takes: string }> }).delegates;
}

describe("the Lab's project setup (S9)", () => {
  it("names the standard project coordinator, from the projects flow, and no workstream coordinator", async () => {
    const { setup } = await open();
    expect(setup).toEqual({ flow: "projects", projectCoordinator: "project-coordinator" });
  });
});

describe("opening a workstream by asking the project coordinator (V8b: BR-38 to BR-40, BR-42)", () => {
  it("opens one led by the EM and hands the ask into its session in the same turn, adding nobody to her roster", async () => {
    const { setup, as } = await open();
    const alice = await as(ALICE);
    expect(await ownWorkers(alice)).toEqual([]);

    const pc = await askFor(alice, setup, "checkout", "Please add guest checkout, PERIWINKLE-7319.");
    // It was offered only the worker that can lead: the coder, the reviewer and the coordinators lead nothing (BR-42).
    await eventually(async () => ((await leadsOffered(alice, pc)).length > 0 ? true : undefined), "the leads read");
    expect(await leadsOffered(alice, pc)).toEqual([[EM]]);
    expect(await ownWorkers(alice)).toEqual([]);

    // The EM leads the entry, and its session is the workstream session.
    const read = await readProject(alice.clients, alice.reader, APOLLO);
    const entry = read!.entries.find((e) => e.id === "checkout")!;
    expect(entry).toMatchObject({ owner: ALICE.userId, lead: EM });
    const session = await alice.clients.sessions.getSession(entry.sessionId!);
    expect(session.state?.[WORKER_ID_STATE_KEY]).toBe(EM);

    // Her project coordinator holds one record for it, and the hand-off in that turn reached the workstream session.
    const records = await delegatesOf(alice, pc);
    expect(records.map(({ worker, target }) => ({ worker, target }))).toEqual([{ worker: EM, target: "shared/apollo/checkout" }]);
    await eventually(async () => ((await holds(alice, entry.sessionId!, "PERIWINKLE-7319")) ? true : undefined), "the ask in the workstream session");
  });

  it("opens a second with the same lead as a second session and record, and a post to one lands only there (BR-40)", async () => {
    const { setup, as } = await open();
    const alice = await as(ALICE);
    await askFor(alice, setup, "checkout", "Please add guest checkout.");
    const pc = await askFor(alice, setup, "search", "Make search fuzzy, CINDER-0612.");
    const entries = (await readProject(alice.clients, alice.reader, APOLLO))!.entries;
    const checkout = entries.find((e) => e.id === "checkout")!;
    const search = entries.find((e) => e.id === "search")!;
    expect([checkout.lead, search.lead]).toEqual([EM, EM]);
    expect(checkout.sessionId).not.toBe(search.sessionId);
    expect((await delegatesOf(alice, pc)).map(({ worker, target }) => ({ worker, target }))).toEqual([
      { worker: EM, target: "shared/apollo/checkout" },
      { worker: EM, target: "shared/apollo/search" },
    ]);
    await eventually(async () => ((await holds(alice, search.sessionId!, "CINDER-0612")) ? true : undefined), "the ask in search's session");
    expect(await holds(alice, checkout.sessionId!, "CINDER-0612")).toBe(false);
  });

  it("lets a worker the chief of staff hired for her lead, and refuses the coder (BR-38, BR-42)", async () => {
    const { setup, as } = await open();
    const alice = await as(ALICE);
    await runAction(alice.clients, PROJECT_READER_FLOW, alice.reader, "hire", {
      id: "release-lead",
      flow: "agent",
      description: "Runs a release.",
      settings: { delegates: ["eng.coder"] },
    });
    const pc = await askFor(alice, setup, "release", "Cut the release, AMBER-4410.", "release-lead");
    await eventually(async () => ((await leadsOffered(alice, pc)).length > 0 ? true : undefined), "the leads read");
    expect(await leadsOffered(alice, pc)).toEqual([[EM, "release-lead"].sort()]);
    const entry = (await readProject(alice.clients, alice.reader, APOLLO))!.entries.find((e) => e.id === "release")!;
    expect(entry.lead).toBe("release-lead");
    await eventually(async () => ((await holds(alice, entry.sessionId!, "AMBER-4410")) ? true : undefined), "the ask in the hired lead's session");

    // The coder leads no workstream: it runs on `coder`, and lists no delegates.
    await expect(
      runAction(alice.clients, setup.flow, readerSessionId(ALICE.userId, setup.flow), "openWorkstream", {
        project: APOLLO,
        id: "coded",
        title: "Coded",
        lead: "eng.coder",
      }),
    ).rejects.toThrow(/cannot-lead/);
    expect((await readProject(alice.clients, alice.reader, APOLLO))!.entries.map((e) => e.id)).toEqual(["release"]);
  });

  it("drops the record when she marks the workstream done, and moving it back out of done restores it", async () => {
    const { setup, as } = await open();
    const alice = await as(ALICE);
    const pc = await askFor(alice, setup, "checkout", "Please add guest checkout.");
    const update = (status: string) =>
      runAction(alice.clients, setup.flow, readerSessionId(ALICE.userId, setup.flow), "updateWorkstream", { project: APOLLO, id: "checkout", status });

    await update("done");
    await eventually(async () => ((await delegatesOf(alice, pc)).length === 0 ? true : undefined), "the record removed");
    await update("on-track");
    await eventually(
      async () => ((await delegatesOf(alice, pc)).some((d) => d.worker === EM && d.target === "shared/apollo/checkout") ? true : undefined),
      "the record restored",
    );
    expect(await ownWorkers(alice)).toEqual([]);
  });
});

/** The DOM and the app, once the view's checks put them in place. */
let dom: (Awaited<ReturnType<typeof loadDom>> & { teardown(): Promise<void> }) | undefined;

async function loadDom() {
  const [testing, app] = await Promise.all([import("@testing-library/react"), import("../src/App")]);
  return { ...testing, App: app.App };
}

describe("a project view (V8: BR-12, BR-18)", () => {
  beforeAll(async () => {
    const env = await builtinEnvironments["happy-dom"].setup(globalThis, {});
    dom = { ...(await loadDom()), teardown: async () => {
        await env.teardown(globalThis);
      },
    };
  });
  afterAll(async () => {
    await dom?.teardown();
    dom = undefined;
  });

  /** Open the app as `clients` at `path`. */
  function openApp(clients: LabClients, baseUrl: string, path: string) {
    (window as unknown as { happyDOM: { setURL(url: string): void } }).happyDOM.setURL(`${baseUrl}${path}`);
    const { render, App } = dom!;
    render(<App clients={clients} />);
  }

  /** Every request the page sends, as `METHOD path?query`, with each action's session. */
  function recordRequests() {
    const real = globalThis.fetch;
    const seen: Array<{ method: string; path: string; body: string }> = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      seen.push({
        method: (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase(),
        path: decodeURIComponent(url.pathname + url.search),
        body: typeof init?.body === "string" ? init.body : "",
      });
      return real(input, init);
    });
    return seen;
  }

  it("opens on the row and one entry prefix; its Board reads only her own workstream sessions; Bob's entry is read, never his session", async () => {
    const { screen, act, fireEvent } = dom!;
    const { baseUrl, setup, as } = await open();
    const alice = await as(ALICE);
    const bob = await as(BOB);
    await openAs(alice, setup, "checkout");
    await openAs(bob, setup, "search");
    const entries = (await readProject(alice.clients, alice.reader, APOLLO))!.entries;
    const own = entries.find((e) => e.owner === ALICE.userId)!;
    const his = entries.find((e) => e.owner === BOB.userId)!;

    const seen = recordRequests();
    openApp(alice.clients, baseUrl, "/p/apollo/workstreams");
    const listed = await screen.findAllByTestId("project-entry", undefined, { timeout: 10_000 });
    expect(listed.map((li) => [li.getAttribute("data-owner"), li.getAttribute("data-workstream-id")]).sort()).toEqual(
      [
        [ALICE.userId, "checkout"],
        [BOB.userId, "search"],
      ].sort(),
    );
    // The view's reads: the row by its key, and the entries by the project's one prefix. No other entry read.
    // Each read of the view is one of each, so they come in pairs; the Lab's own read (the sidebar's) never lists entries.
    const workstreamReads = seen.filter((r) => /\/resources\/(workstreams|privateWorkstreams)\b/.test(r.path));
    const rowReads = seen.filter((r) => /\/resources\/projects\/apollo\b/.test(r.path));
    expect(workstreamReads.length).toBeGreaterThan(0);
    expect(workstreamReads.map((r) => r.path.replace(/^.*\?/, "?"))).toEqual(workstreamReads.map(() => "?limit=200&topicPrefix=workstreams/apollo/"));
    expect(rowReads).toHaveLength(workstreamReads.length);

    // The Board: one lane per workstream of hers, each read from its own session; Bob's is never read.
    const boardFrom = seen.length;
    act(() => fireEvent.click(screen.getByRole("tab", { name: /board/i })));
    const lanes = await screen.findAllByTestId("project-lane");
    expect(lanes.map((lane) => lane.getAttribute("data-session-id"))).toEqual([own.sessionId]);
    await eventually(async () => (seen.slice(boardFrom).some((r) => r.path.includes("/actions/listTasks_tasks")) ? true : undefined), "a task read");
    const taskReads = seen.slice(boardFrom).filter((r) => r.path.includes("/actions/listTasks_tasks"));
    expect(taskReads.every((r) => r.body.includes(own.sessionId!))).toBe(true);
    expect(seen.some((r) => r.path.includes(his.sessionId!) || r.body.includes(his.sessionId!))).toBe(false);

    // Bob's entry: its details and report, never his session.
    act(() => fireEvent.click(screen.getByRole("tab", { name: /workstreams/i })));
    const bobs = (await screen.findAllByTestId("project-entry")).find((li) => li.getAttribute("data-owner") === BOB.userId)!;
    act(() => fireEvent.click(bobs.querySelector("button")!));
    const details = await screen.findByTestId("project-entry-details");
    expect(details.textContent).toContain(`led by ${EM}`);
    await eventually(async () => (/No report yet|didn't load/.test(screen.getByTestId("project-entry-report").textContent ?? "") ? true : undefined), "the report read");
    expect(seen.some((r) => r.path.includes(his.sessionId!) || r.body.includes(his.sessionId!))).toBe(false);

    // Her own entry opens on its lead's workstream session.
    act(() => fireEvent.click(screen.getByTestId("project-entry-back")));
    const hers = (await screen.findAllByTestId("project-entry")).find((li) => li.getAttribute("data-owner") === ALICE.userId)!;
    act(() => fireEvent.click(hers.querySelector("button")!));
    const conversation = await screen.findByTestId("project-entry-conversation", undefined, { timeout: 10_000 });
    expect(conversation.getAttribute("data-session-id")).toBe(own.sessionId);
  });

  it("its Stream is her project coordinator session, linked to the project", async () => {
    const { screen } = dom!;
    const { baseUrl, setup, as } = await open();
    const alice = await as(ALICE);
    await openAs(alice, setup, "checkout");
    const seen = recordRequests();
    openApp(alice.clients, baseUrl, "/p/apollo/stream");
    const conversation = await screen.findByTestId("project-stream-conversation", undefined, { timeout: 10_000 });
    expect(conversation.getAttribute("data-session-id")).toBe(await projectCoordinator(alice, setup));
    expect(conversation.getAttribute("data-worker-id")).toBe("project-coordinator");
    // Stream draws no entry, so it never reads them; nor does Brief.
    const entryReads = () => seen.filter((r) => /\/resources\/(workstreams|privateWorkstreams)\b/.test(r.path));
    expect(entryReads()).toEqual([]);
    const { act, fireEvent } = dom!;
    act(() => fireEvent.click(screen.getByRole("tab", { name: /brief/i })));
    await screen.findByTestId(/^project-brief(-none)?$/);
    expect(entryReads()).toEqual([]);
    // Workstreams does, by the project's one prefix.
    act(() => fireEvent.click(screen.getByRole("tab", { name: /workstreams/i })));
    await screen.findAllByTestId("project-entry", undefined, { timeout: 10_000 });
    expect(entryReads().length).toBeGreaterThan(0);
  });

  it("flags an entry gone quiet by the project's progress, one clock for the row and the count (BR-19)", async () => {
    const { setup, as } = await open();
    const alice = await as(ALICE);
    const bob = await as(BOB);
    await openAs(alice, setup, "checkout");
    await openAs(bob, setup, "search");
    const fresh = (await readProject(alice.clients, alice.reader, APOLLO))!;
    expect(fresh.progress.stale).toEqual([]);
    expect(fresh.entries.map((e) => e.stale)).toEqual([false, false]);
    // Eight days on, both are quiet; once Bob's is done it is never stale, in the row as in the count.
    const later = Date.now() + 8 * 24 * 60 * 60 * 1000;
    await runAction(bob.clients, setup.flow, readerSessionId(BOB.userId, setup.flow), "updateWorkstream", {
      project: APOLLO,
      id: "search",
      status: "done",
    });
    const quiet = (await readProject(alice.clients, alice.reader, APOLLO, later))!;
    const flagged = quiet.entries.filter((e) => e.stale).map((e) => `${e.owner}/${e.id}`);
    expect(flagged).toEqual([`${ALICE.userId}/checkout`]);
    expect(quiet.progress.stale.map((e) => `${e.owner}/${e.id}`)).toEqual(flagged);
  });
});
