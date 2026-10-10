/**
 * A project's workstreams in Shift Manager, on the DevTeam Lab, which
 * installs the project coordinator and the standard workstream coordinator
 * (FIX-1793 S8, S9).
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
 * Checks (`specs/issues/FIX-1793/`): V8a (BR-35 to BR-37: opening a workstream
 * forks one coordinator of its own, which leads it, is its session's worker
 * and its owner's delegate record, and takes the project coordinator's post),
 * and V8 (BR-12, BR-18: a project view opens on the row and one entry prefix,
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
import { ActionRefused, runAction } from "../src/lib/action";
import { createLabClients, type LabClients } from "../src/lib/connection";
import {
  openWorkstreamWithCoordinator,
  readProject,
  readProjectSetup,
  workstreamCoordinatorId,
  type ProjectAddress,
  type ProjectSetup,
} from "../src/lib/projects";
import { createLabReader, PROJECT_READER_KIND, readerSessionId } from "../src/lib/reads";
import { readSessionItems } from "../src/lib/run";
import { workforceClientFor } from "../src/lib/workforce";
import { selectHarness } from "../teams/devteam/harness.mts";
import { LAB_USERS, openLab, type Lab } from "../teams/devteam/host.mts";
import { createNotifyLog } from "../teams/devteam/notify.mts";
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
    coderSeatId: "eng.coder",
    mailboxes: { addresses: {}, log: createNotifyLog() },
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
    return { clients, reader: readerSessionId(user.userId, PROJECT_READER_KIND), roster: () => workforce.roster() };
  };
  const setup = await readProjectSetup((await as(ALICE)).clients);
  if (setup === null) throw new Error("the DevTeam Lab answers no project setup");
  return { baseUrl, setup, as };
}

/** The person's own workers, by id. */
async function ownWorkers(person: Person): Promise<RosterEntry[]> {
  return (await person.roster()).filter((entry) => !entry.standard).sort((a, b) => a.id.localeCompare(b.id));
}

async function openAs(person: Person, setup: ProjectSetup, id: string, project: ProjectAddress = APOLLO) {
  return openWorkstreamWithCoordinator(person.clients, workforceClientFor(person.clients), setup, person.reader, { project, id, title: `The ${id}` });
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
  it("names the standard project coordinator and workstream coordinator, from the projects flow", async () => {
    const { setup } = await open();
    expect(setup).toEqual({ flow: "projects", projectCoordinator: "project-coordinator", workstreamCoordinator: "workstream-coordinator" });
  });
});

describe("opening a workstream from a project (V8a: BR-35 to BR-37)", () => {
  it("forks exactly one coordinator onto her roster, which leads it, is its session's worker and her delegate record, and takes a post", async () => {
    const { setup, as } = await open();
    const alice = await as(ALICE);
    expect(await ownWorkers(alice)).toEqual([]);

    const opened = await openAs(alice, setup, "checkout");
    expect(opened.forked).toBe(true);
    const lead = workstreamCoordinatorId(APOLLO, "checkout");
    // One new worker of hers, forked from the standard workstream coordinator, on the flow it names.
    expect((await ownWorkers(alice)).map((w) => [w.id, w.flow, w.forkedFrom])).toEqual([[lead, "agent", "workstream-coordinator"]]);

    // It leads the entry, and its session is the workstream session.
    const read = await readProject(alice.clients, alice.reader, APOLLO);
    const entry = read!.entries.find((e) => e.id === "checkout")!;
    expect(entry).toMatchObject({ owner: ALICE.userId, lead });
    expect(entry.sessionId).not.toBeNull();
    const session = await alice.clients.sessions.getSession(entry.sessionId!);
    expect(session.state?.[WORKER_ID_STATE_KEY]).toBe(lead);

    // Her project coordinator holds one record for it, addressed to the workstream, as a delegate that takes posts.
    const pc = await projectCoordinator(alice, setup);
    const records = await delegatesOf(alice, pc);
    expect(records.map(({ worker, target }) => ({ worker, target }))).toEqual([{ worker: lead, target: "shared/apollo/checkout" }]);
    // Its flow takes posts (and tasks): the record is one a post can be handed to.
    expect(["posts", "both"]).toContain(records[0]!.takes);

    // A post the project coordinator hands to it lands in its workstream session.
    judgmentCalls = [{ toolName: "handOff", args: { worker: lead, target: "shared/apollo/checkout" } }];
    await runAction(alice.clients, "coordinator", pc, "run", { message: "Please add guest checkout, PERIWINKLE-7319." });
    await eventually(async () => {
      const { items } = await readSessionItems(alice.clients, entry.sessionId!);
      return JSON.stringify(items).includes("PERIWINKLE-7319") ? true : undefined;
    }, "the handed post in the workstream session");
  });

  it("gives her second workstream a second coordinator, and leaves Bob's roster as it was", async () => {
    const { setup, as } = await open();
    const alice = await as(ALICE);
    const bob = await as(BOB);
    const bobBefore = await ownWorkers(bob);
    await openAs(alice, setup, "checkout");
    await openAs(alice, setup, "search");
    expect((await ownWorkers(alice)).map((w) => w.id)).toEqual(
      [workstreamCoordinatorId(APOLLO, "checkout"), workstreamCoordinatorId(APOLLO, "search")].sort(),
    );
    expect(await ownWorkers(bob)).toEqual(bobBefore);
    // Hers alone: naming it as Bob's lead is refused like a missing worker.
    await expect(
      runAction(bob.clients, setup.flow, readerSessionId(BOB.userId, setup.flow), "openWorkstream", {
        project: APOLLO,
        id: "borrowed",
        title: "Borrowed",
        lead: workstreamCoordinatorId(APOLLO, "checkout"),
      }),
    ).rejects.toThrow(ActionRefused);
    expect(await ownWorkers(bob)).toEqual(bobBefore);
  });

  it("forks once for a repeated open and for two opens at once", async () => {
    const { setup, as } = await open();
    const alice = await as(ALICE);
    const first = await openAs(alice, setup, "checkout");
    const again = await openAs(alice, setup, "checkout");
    expect([first.forked, again.forked]).toEqual([true, false]);
    const both = await Promise.all([openAs(alice, setup, "search"), openAs(alice, setup, "search")]);
    expect(both.filter((b) => b.forked)).toHaveLength(1);
    expect((await ownWorkers(alice)).map((w) => w.id)).toEqual(
      [workstreamCoordinatorId(APOLLO, "checkout"), workstreamCoordinatorId(APOLLO, "search")].sort(),
    );
    const read = await readProject(alice.clients, alice.reader, APOLLO);
    expect(read!.entries.map((e) => e.id).sort()).toEqual(["checkout", "search"]);
  });

  it("refuses an open over another worker of hers at that id, naming it, and writes nothing", async () => {
    const { setup, as } = await open();
    const alice = await as(ALICE);
    const lead = workstreamCoordinatorId(APOLLO, "checkout");
    await runAction(alice.clients, PROJECT_READER_KIND, alice.reader, "hire", { id: lead });
    await expect(openAs(alice, setup, "checkout")).rejects.toThrow(new RegExp(`"${lead.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}" is already a worker of yours`));
    expect((await readProject(alice.clients, alice.reader, APOLLO))!.entries).toEqual([]);
  });

  it("a refused open (not-a-member) fires the coordinator it forked, so the roster is as it was", async () => {
    const { setup, as } = await open();
    const outsider = await as(OUTSIDER);
    const before = await ownWorkers(outsider);
    await expect(openAs(outsider, setup, "sneak")).rejects.toThrow(/member/);
    expect(await ownWorkers(outsider)).toEqual(before);
  });

  it("keeps the coordinator when she marks the workstream done, and moving it back out of done restores the record", async () => {
    const { setup, as } = await open();
    const alice = await as(ALICE);
    await openAs(alice, setup, "checkout");
    const lead = workstreamCoordinatorId(APOLLO, "checkout");
    const pc = await projectCoordinator(alice, setup);
    const update = (status: string) =>
      runAction(alice.clients, setup.flow, readerSessionId(ALICE.userId, setup.flow), "updateWorkstream", { project: APOLLO, id: "checkout", status });

    await update("done");
    await eventually(async () => ((await delegatesOf(alice, pc)).length === 0 ? true : undefined), "the record removed");
    expect((await ownWorkers(alice)).map((w) => w.id)).toEqual([lead]);

    await update("on-track");
    await eventually(
      async () => ((await delegatesOf(alice, pc)).some((d) => d.worker === lead && d.target === "shared/apollo/checkout") ? true : undefined),
      "the record restored",
    );
    expect((await ownWorkers(alice)).map((w) => w.id)).toEqual([lead]);
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
    dom = { ...(await loadDom()), teardown: () => env.teardown(globalThis) };
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
    expect(details.textContent).toContain(`led by ${workstreamCoordinatorId(APOLLO, "search")}`);
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
    openApp(alice.clients, baseUrl, "/p/apollo/stream");
    const conversation = await screen.findByTestId("project-stream-conversation", undefined, { timeout: 10_000 });
    expect(conversation.getAttribute("data-session-id")).toBe(await projectCoordinator(alice, setup));
    expect(conversation.getAttribute("data-seat-id")).toBe("project-coordinator");
  });
});
