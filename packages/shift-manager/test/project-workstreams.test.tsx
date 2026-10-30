/**
 * A project's workstreams in Shift Manager, on the DevTeam Lab, which
 * installs the project coordinator (FIX-1793 S8, S9).
 *
 * Two people in one shared project: the Lab's owner ("Alice") and a project member
 * ("Bob"), and an organization member on no project, each with a secret of
 * their own. Everything goes through Shift Manager's own code
 * (`lib/projects.ts`, the project view) against the Lab's shipped routes.
 *
 * The models are scripted by block: the project coordinator's judgment
 * (`coordinator-judgment`) makes the tool calls a test names, then stops; an
 * `agent` worker's turn answers with a fixed line.
 *
 * Checks (`specs/issues/FIX-1793/`): V8b (BR-38, BR-39, BR-40, BR-42: the
 * user asks their project coordinator for work, and it opens a workstream
 * led by a worker on their roster that can lead, the EM, and hands the ask
 * into its session in the same turn; nothing is added to the roster), and
 * V8 (BR-12, BR-18: a project view opens on the row and one entry prefix,
 * its Board reads only the viewer's own workstream sessions, and another
 * user's entry is read, never their session).
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
import type { Client } from "@flow-state-dev/client";
import { connect, type Connection } from "../src/lib/connection";
import { readProject, readProjectSetup, type ProjectAddress, type ProjectSetup } from "../src/lib/projects";
import { createLabReader, PROJECT_READER_FLOW, readerSessionId } from "../src/lib/reads";
import { readSessionItems } from "../src/lib/run";
import { createWorkforceClient } from "@flow-state-dev/workforce/browser";
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

/** Whether the lead fit check answers that a lead fits, by the lead and work it was asked about. Every lead fits by default. */
let leadFits: (asked: string) => boolean = () => true;

/** The judgment runs `judgmentCalls`, then stops; the lead fit check answers `leadFits`; any other generator answers a fixed line. */
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
  /** The one fit check, asked about the chosen lead: it picks the lead, or answers none fits. */
  const fit = {
    specificationVersion: "v4",
    provider: "test",
    modelId: "test/fit",
    supportedQuestionTypes: ["choice"],
    async doEvaluate(call: { questions: { worker: { criteria: Record<string, string> } } }) {
      const lead = Object.keys(call.questions.worker.criteria).find((key) => !key.startsWith("~"))!;
      const choice = leadFits(JSON.stringify(call)) ? lead : "~none-fits";
      return { answers: { worker: { type: "choice", choice } }, usage: { inputTokens: 1, outputTokens: 1 }, warnings: [] };
    },
  };
  return Object.assign(
    (_id: string, block?: string) => (block?.startsWith("coordinator-judgment") ? judgment : agent),
    {
      resolveId: (id: string) => id,
      resolveEvaluationModel: (_id: string, block?: string) => {
        if (block !== "workstream-lead-fit") throw new Error(`no evaluation model for ${block}`);
        return fit;
      },
    },
  ) as unknown as ModelResolver;
}

let lab: Lab | undefined;
let served: ServedLab | undefined;
let root: string | undefined;

beforeEach(() => {
  judgmentCalls = [];
  leadFits = () => true;
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

/** One user at the Lab: their connection, their workforce client, and their roster reading session. */
type User = { client: Client; connection: Connection; reader: string; roster: () => Promise<RosterEntry[]> };

/** The DevTeam Lab with one shared project, Apollo, whose project members are Alice and Bob. */
async function open(): Promise<{ baseUrl: string; setup: ProjectSetup; as: (user: { userId: string; bearer: string }) => Promise<User> }> {
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
  const as = async (user: { userId: string; bearer: string }): Promise<User> => {
    const connection = { userId: user.userId, baseUrl, bearerToken: user.bearer };
    const client = connect(connection);
    // The Lab read opens the user's reading session on the roster flow, as the app does.
    await createLabReader(client).read();
    const workforce = createWorkforceClient(client);
    return { client, connection, reader: readerSessionId(user.userId, PROJECT_READER_FLOW), roster: () => workforce.roster() };
  };
  const setup = await readProjectSetup((await as(ALICE)).client);
  if (setup === null) throw new Error("the DevTeam Lab answers no project setup");
  return { baseUrl, setup, as };
}

/** The user's own workers, by id. */
async function ownWorkers(user: User): Promise<RosterEntry[]> {
  return (await user.roster()).filter((entry) => !entry.standard).sort((a, b) => a.id.localeCompare(b.id));
}

/** The DevTeam's lead for features. */
const EM = "eng.em";

/** The DevTeam's lead for research, planning and other work that isn't building software. */
const GENERAL_LEAD = "general-lead";

/** Open a workstream over HTTP, as an app may, naming the EM as its lead. */
async function openAs(user: User, setup: ProjectSetup, id: string, project: ProjectAddress = APOLLO) {
  return runAction(user.client, setup.flow, readerSessionId(user.client.userId, setup.flow), "openWorkstream", {
    project,
    id,
    title: `The ${id}`,
    lead: EM,
  });
}

/**
 * Ask the user's project coordinator for work, its judgment scripted to
 * read the leads, open `id` with `lead`, and hand the ask in, in one turn.
 */
async function askFor(user: User, setup: ProjectSetup, id: string, message: string, lead = EM) {
  judgmentCalls = [
    { toolName: "listLeads", args: {} },
    { toolName: "openWorkstream", args: { project: APOLLO, id, title: `The ${id}`, lead, objectives: [message] } },
    { toolName: "createTask", args: { goal: message, assignee: lead, target: `shared/apollo/${id}`, session: "ongoing", resultTo: "conversation" } },
  ];
  const pc = await projectCoordinator(user, setup);
  await runAction(user.client, "coordinator", pc, "respond", { message });
  return pc;
}

/** Whether a session's items carry `word`. */
async function holds(user: User, sessionId: string, word: string): Promise<boolean> {
  const { items } = await readSessionItems(user.client, sessionId);
  return JSON.stringify(items).includes(word);
}

/** What `listLeads` answered in a conversation, each call's lead ids. */
async function leadsOffered(user: User, sessionId: string): Promise<string[][]> {
  const { items } = await readSessionItems(user.client, sessionId);
  return (items as Array<{ type?: string; blockName?: string; output?: { leads?: Array<{ id: string }> } }>)
    .filter((item) => item.type === "tool_output" && item.blockName === "listLeads")
    .map((item) => (item.output?.leads ?? []).map((lead) => lead.id));
}

/** The user's project coordinator session for Apollo, found or started as the Stream tab does. */
async function projectCoordinator(user: User, setup: ProjectSetup): Promise<string> {
  return (await createWorkforceClient(user.client).ensureWorkerSession({ worker: setup.projectCoordinator!, projectId: APOLLO })).id;
}

async function delegatesOf(user: User, sessionId: string) {
  const { output } = await runAction(user.client, "coordinator", sessionId, "listDelegates", {});
  return (output as { delegates: Array<{ worker: string; target?: string; takes: string }> }).delegates;
}

describe("the Lab's project setup (S9)", () => {
  it("names the standard project coordinator, from the projects flow, and no workstream coordinator", async () => {
    const { setup } = await open();
    expect(setup).toEqual({ flow: "projects", projectCoordinator: "project-coordinator" });
  });
});

describe("opening a workstream by asking the project coordinator (V8b: BR-38 to BR-40, BR-42)", () => {
  it("reads workers only through listLeads: its discovery lists none of the workers that can't lead", async () => {
    // A coordinator that could list every worker once picked itself as a lead, was refused, and retried.
    const { setup, as } = await open();
    const alice = await as(ALICE);
    judgmentCalls = [{ toolName: "discover", args: { domain: "workers", detail: "full" } }];
    const pc = await projectCoordinator(alice, setup);
    await runAction(alice.client, "coordinator", pc, "respond", { message: "Who can lead a research workstream?" });
    const { items } = await readSessionItems(alice.client, pc);
    const found = (items as Array<{ type?: string; toolCall?: { name?: string }; output?: unknown }>).filter(
      (item) => item.type === "tool_output" && item.toolCall?.name === "discover",
    );
    expect(found).toHaveLength(1);
    const domains = (found[0]!.output as { domains: Array<{ domain: string; entries: unknown[] }> }).domains;
    expect(domains.flatMap((d) => d.entries)).toEqual([]);
  });

  it("opens one led by the EM and hands the ask into its session in the same turn, adding nobody to her roster", async () => {
    const { setup, as } = await open();
    const alice = await as(ALICE);
    expect(await ownWorkers(alice)).toEqual([]);

    const pc = await askFor(alice, setup, "checkout", "Please add guest checkout, PERIWINKLE-7319.");
    // It was offered only the workers that can lead: the coder, the reviewer, the researcher and the coordinators lead nothing (BR-42).
    await eventually(async () => ((await leadsOffered(alice, pc)).length > 0 ? true : undefined), "the leads read");
    expect((await leadsOffered(alice, pc)).map((ids) => [...ids].sort())).toEqual([[EM, GENERAL_LEAD].sort()]);
    expect(await ownWorkers(alice)).toEqual([]);

    // The EM leads the entry, and its session is the workstream session.
    const read = await readProject(alice.client, alice.reader, APOLLO);
    const entry = read!.entries.find((e) => e.id === "checkout")!;
    expect(entry).toMatchObject({ owner: ALICE.userId, lead: EM });
    const session = await alice.client.sessions.get(entry.sessionId!);
    expect(session.state?.[WORKER_ID_STATE_KEY]).toBe(EM);

    // Her project coordinator holds one record for it, and the dispatch in that turn reached the workstream session.
    const records = await delegatesOf(alice, pc);
    expect(records.map(({ worker, target }) => ({ worker, target }))).toEqual([{ worker: EM, target: "shared/apollo/checkout" }]);
    await eventually(async () => ((await holds(alice, entry.sessionId!, "PERIWINKLE-7319")) ? true : undefined), "the ask in the workstream session");
  });

  it("opens a second with the same lead as a second session and record, and a message routed to one lands only there (BR-40)", async () => {
    const { setup, as } = await open();
    const alice = await as(ALICE);
    await askFor(alice, setup, "checkout", "Please add guest checkout.");
    const pc = await askFor(alice, setup, "search", "Make search fuzzy, CINDER-0612.");
    const entries = (await readProject(alice.client, alice.reader, APOLLO))!.entries;
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

  it("lets a worker the Shift Coordinator hired for her lead, and refuses the coder (BR-38, BR-42)", async () => {
    const { setup, as } = await open();
    const alice = await as(ALICE);
    await runAction(alice.client, PROJECT_READER_FLOW, alice.reader, "hire", {
      id: "release-lead",
      flow: "agent",
      description: "Runs a release.",
      settings: { delegates: ["eng.coder"] },
    });
    const pc = await askFor(alice, setup, "release", "Cut the release, AMBER-4410.", "release-lead");
    await eventually(async () => ((await leadsOffered(alice, pc)).length > 0 ? true : undefined), "the leads read");
    expect((await leadsOffered(alice, pc)).map((ids) => [...ids].sort())).toEqual([[EM, GENERAL_LEAD, "release-lead"].sort()]);
    const entry = (await readProject(alice.client, alice.reader, APOLLO))!.entries.find((e) => e.id === "release")!;
    expect(entry.lead).toBe("release-lead");
    await eventually(async () => ((await holds(alice, entry.sessionId!, "AMBER-4410")) ? true : undefined), "the ask in the hired lead's session");

    // The coder leads no workstream: it runs on `coder`, and lists no delegates.
    await expect(
      runAction(alice.client, setup.flow, readerSessionId(ALICE.userId, setup.flow), "openWorkstream", {
        project: APOLLO,
        id: "coded",
        title: "Coded",
        lead: "eng.coder",
      }),
    ).rejects.toThrow(/cannot-lead/);
    expect((await readProject(alice.client, alice.reader, APOLLO))!.entries.map((e) => e.id)).toEqual(["release"]);
  });

  it("refuses research under the EM, whose description says it files features, and opens it under the general lead", async () => {
    const { setup, as } = await open();
    const alice = await as(ALICE);
    // The check is asked about each pick: the EM doesn't do research, by its own description.
    const asked: string[] = [];
    leadFits = (prompt) => {
      asked.push(prompt);
      return !prompt.includes(EM);
    };
    const research = { project: APOLLO, id: "research", title: "Research what to build next", objectives: ["Rank three ideas, SAFFRON-2207."] };
    judgmentCalls = [
      { toolName: "listLeads", args: {} },
      { toolName: "openWorkstream", args: { ...research, lead: EM } },
      { toolName: "openWorkstream", args: { ...research, lead: GENERAL_LEAD } },
      { toolName: "createTask", args: { goal: "Research what to build next", assignee: GENERAL_LEAD, target: "shared/apollo/research", session: "ongoing", resultTo: "conversation" } },
    ];
    const pc = await projectCoordinator(alice, setup);
    await runAction(alice.client, "coordinator", pc, "respond", { message: "Open a workstream to research what to build next, SAFFRON-2207." });

    const { items } = await readSessionItems(alice.client, pc);
    const opens = (items as Array<{ type?: string; blockName?: string }>).filter(
      (item) => item.type === "tool_output" && item.blockName === "openWorkstream",
    );
    expect(opens).toHaveLength(2);
    expect(JSON.stringify(opens[0])).toContain("lead-doesnt-fit");
    // The check read each lead's own description, from its file.
    expect(asked).toHaveLength(2);
    expect(asked[0]).toContain("Files each feature as a task for the coder");
    expect(asked[1]).toContain("Leads research and planning");

    const entries = (await readProject(alice.client, alice.reader, APOLLO))!.entries;
    expect(entries.map((e) => ({ id: e.id, lead: e.lead }))).toEqual([{ id: "research", lead: GENERAL_LEAD }]);
    expect((await delegatesOf(alice, pc)).map(({ worker, target }) => ({ worker, target }))).toEqual([
      { worker: GENERAL_LEAD, target: "shared/apollo/research" },
    ]);
    await eventually(async () => ((await holds(alice, entries[0]!.sessionId!, "SAFFRON-2207")) ? true : undefined), "the ask in the general lead's session");
    expect(await ownWorkers(alice)).toEqual([]);
  });

  it("drops the record when she marks the workstream done, and moving it back out of done restores it", async () => {
    const { setup, as } = await open();
    const alice = await as(ALICE);
    const pc = await askFor(alice, setup, "checkout", "Please add guest checkout.");
    const update = (status: string) =>
      runAction(alice.client, setup.flow, readerSessionId(ALICE.userId, setup.flow), "updateWorkstream", { project: APOLLO, id: "checkout", status });

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

  /** Open the app as `client` at `path`. */
  function openApp(connection: Connection, baseUrl: string, path: string) {
    (window as unknown as { happyDOM: { setURL(url: string): void } }).happyDOM.setURL(`${baseUrl}${path}`);
    const { render, App } = dom!;
    render(<App connection={connection} />);
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
    const entries = (await readProject(alice.client, alice.reader, APOLLO))!.entries;
    const own = entries.find((e) => e.owner === ALICE.userId)!;
    const his = entries.find((e) => e.owner === BOB.userId)!;

    const seen = recordRequests();
    openApp(alice.connection, baseUrl, "/p/apollo/workstreams");
    const listed = await screen.findAllByTestId("project-entry", undefined, { timeout: 10_000 });
    expect(listed.map((li) => [li.getAttribute("data-owner"), li.getAttribute("data-workstream-id")]).sort()).toEqual(
      [
        [ALICE.userId, "checkout"],
        [BOB.userId, "search"],
      ].sort(),
    );
    // The view's reads: the row by its key, and the entries by the project's one prefix. No other entry read.
    // Each read is one of each, so they come in pairs: the view's, and the sidebar's for the project on screen.
    // The Lab's own read never lists entries.
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
    await eventually(async () => (seen.slice(boardFrom).some((r) => r.path.includes("/reads/listTasks_tasks")) ? true : undefined), "a task read");
    const taskReads = seen.slice(boardFrom).filter((r) => r.path.includes("/reads/listTasks_tasks"));
    expect(taskReads.every((r) => r.path.includes(own.sessionId!))).toBe(true);
    // A read, never the action: a poll stores no request (FIX-2286).
    expect(seen.some((r) => r.path.includes("/actions/listTasks_tasks"))).toBe(false);
    expect(seen.some((r) => r.path.includes(his.sessionId!) || r.body.includes(his.sessionId!))).toBe(false);

    // Bob's entry: its details and report, never his session.
    act(() => fireEvent.click(screen.getByRole("tab", { name: /workstreams/i })));
    const bobs = (await screen.findAllByTestId("project-entry")).find((li) => li.getAttribute("data-owner") === BOB.userId)!;
    act(() => fireEvent.click(bobs.querySelector("button")!));
    const details = await screen.findByTestId("project-entry-details");
    // DevTeam's `eng/workers/em/WORKER.md` names the EM; the entry shows that name, not its id.
    expect(details.textContent).toContain("led by Engineering Manager");
    await eventually(async () => (/No report yet|didn't load/.test(screen.getByTestId("project-entry-report").textContent ?? "") ? true : undefined), "the report read");
    expect(seen.some((r) => r.path.includes(his.sessionId!) || r.body.includes(his.sessionId!))).toBe(false);

    // Her own entry opens on its lead's workstream session.
    act(() => fireEvent.click(screen.getByTestId("project-entry-back")));
    const hers = (await screen.findAllByTestId("project-entry")).find((li) => li.getAttribute("data-owner") === ALICE.userId)!;
    act(() => fireEvent.click(hers.querySelector("button")!));
    const conversation = await screen.findByTestId("project-entry-conversation", undefined, { timeout: 10_000 });
    expect(conversation.getAttribute("data-session-id")).toBe(own.sessionId);
  });

  it("shows a workstream's objectives and which are met, on its row and on its owner's own view", async () => {
    const { screen, act, fireEvent, within } = dom!;
    const { baseUrl, setup, as } = await open();
    const alice = await as(ALICE);
    const bob = await as(BOB);
    const objectives = [
      { text: "Survey the repo", met: true },
      { text: "Write up findings", met: false },
    ];
    for (const user of [alice, bob]) {
      await openAs(user, setup, "survey");
      await runAction(user.client, setup.flow, readerSessionId(user.client.userId, setup.flow), "updateWorkstream", { project: APOLLO, id: "survey", objectives });
    }
    const marks = (root: HTMLElement) =>
      within(root).getAllByTestId("project-entry-objective").map((li) => [li.textContent?.includes("Survey the repo") ? "survey" : "write-up", li.getAttribute("data-met")]);
    const rowOf = async (owner: string) => (await screen.findAllByTestId("project-entry", undefined, { timeout: 10_000 })).find((li) => li.getAttribute("data-owner") === owner)!;

    openApp(alice.connection, baseUrl, "/p/apollo/workstreams");
    const hers = await rowOf(ALICE.userId);
    expect(hers.textContent).toContain("1 of 2 objectives met");

    act(() => fireEvent.click(hers.querySelector("button")!));
    await screen.findByTestId("project-entry-conversation", undefined, { timeout: 10_000 });
    expect(marks(screen.getByTestId("project-entry-own"))).toEqual([
      ["survey", "true"],
      ["write-up", "false"],
    ]);

    // Bob's entry draws the same list on its details.
    act(() => fireEvent.click(screen.getByTestId("project-entry-back")));
    const his = await rowOf(BOB.userId);
    act(() => fireEvent.click(his.querySelector("button")!));
    expect(marks(await screen.findByTestId("project-entry-details"))).toEqual([
      ["survey", "true"],
      ["write-up", "false"],
    ]);
  });

  it("its Stream is her project coordinator session, linked to the project", async () => {
    const { screen } = dom!;
    const { baseUrl, setup, as } = await open();
    const alice = await as(ALICE);
    await openAs(alice, setup, "checkout");
    const seen = recordRequests();
    openApp(alice.connection, baseUrl, "/p/apollo/stream");
    const conversation = await screen.findByTestId("project-stream-conversation", undefined, { timeout: 10_000 });
    expect(conversation.getAttribute("data-session-id")).toBe(await projectCoordinator(alice, setup));
    expect(conversation.getAttribute("data-worker-id")).toBe("project-coordinator");
    // Stream draws no entry, so it never reads them; nor does Brief. The only entry reads are the
    // sidebar's, for the project on screen open beneath it, by its one prefix; closed, it reads none.
    const entryReads = () => seen.filter((r) => /\/resources\/(workstreams|privateWorkstreams)\b/.test(r.path));
    const { act, fireEvent, within } = dom!;
    const group = screen.getByTestId("nav-project-apollo").closest("[data-testid='project-group']") as HTMLElement;
    await within(group).findAllByTestId("nav-workstream", undefined, { timeout: 10_000 });
    expect(entryReads().map((r) => r.path.replace(/^.*\?/, "?"))).toEqual(entryReads().map(() => "?limit=200&topicPrefix=workstreams/apollo/"));
    act(() => fireEvent.click(within(group).getByTestId("nav-project-apollo-toggle")));
    const closedAt = entryReads().length;
    act(() => fireEvent.click(screen.getByRole("tab", { name: /brief/i })));
    await screen.findByTestId(/^project-brief(-none)?$/);
    // Longer than a poll: a closed project's read would have come round again by now.
    await new Promise((resolve) => setTimeout(resolve, 5_500));
    expect(entryReads()).toHaveLength(closedAt);
    // Workstreams does, by the project's one prefix.
    act(() => fireEvent.click(screen.getByRole("tab", { name: /workstreams/i })));
    await screen.findAllByTestId("project-entry", undefined, { timeout: 10_000 });
    expect(entryReads().length).toBeGreaterThan(0);
  });

  it("its Stream draws an open the coordinator retried as an attempt, not a failure", async () => {
    const { screen, act, fireEvent, within } = dom!;
    const { baseUrl, setup, as } = await open();
    const alice = await as(ALICE);
    leadFits = (prompt) => !prompt.includes(EM);
    const research = { project: APOLLO, id: "research", title: "Research what to build next", objectives: ["Rank three ideas."] };
    judgmentCalls = [
      { toolName: "listLeads", args: {} },
      { toolName: "openWorkstream", args: { ...research, lead: EM } },
      { toolName: "openWorkstream", args: { ...research, lead: GENERAL_LEAD } },
    ];
    const pc = await projectCoordinator(alice, setup);
    await runAction(alice.client, "coordinator", pc, "respond", { message: "Open a workstream to research what to build next." });

    openApp(alice.connection, baseUrl, "/p/apollo/stream");
    const conversation = await screen.findByTestId("project-stream-conversation", undefined, { timeout: 10_000 });
    // The run of calls is one line, and the open that went through on its retry doesn't turn it red.
    const line = await within(conversation).findByRole("button", { name: /^Used 3 tools$/ }, { timeout: 10_000 });
    act(() => fireEvent.click(line));
    expect(within(conversation).getByText("Tried openWorkstream")).toBeTruthy();
    expect(within(conversation).queryByText("openWorkstream failed")).toBeNull();
  });

  it("lists a workstream opened while its Workstreams tab is open, with no reload or navigation", async () => {
    // A workstream is opened elsewhere, by the Shift Coordinator or a project coordinator in another
    // window, while the user sits on the list. It must show there as it opens, or they read
    // "No workstreams" for work they just asked for.
    const { screen } = dom!;
    const { baseUrl, setup, as } = await open();
    const alice = await as(ALICE);
    openApp(alice.connection, baseUrl, "/p/apollo/workstreams");
    await screen.findByTestId("project-entries-none", undefined, { timeout: 10_000 });

    await openAs(alice, setup, "research");
    const listed = await screen.findAllByTestId("project-entry", undefined, { timeout: 15_000 });
    expect(listed.map((li) => [li.getAttribute("data-owner"), li.getAttribute("data-workstream-id")])).toEqual([[ALICE.userId, "research"]]);
    expect(screen.getByTestId("project-progress").getAttribute("data-workstreams")).toBe("1");
  });

  it("keeps the list on screen when a later read fails, and doesn't swap it for the failure", async () => {
    // A poll that fails must not blank a list the user is reading; only a first read that fails shows the failure.
    const { screen } = dom!;
    const { baseUrl, setup, as } = await open();
    const alice = await as(ALICE);
    await openAs(alice, setup, "checkout");
    openApp(alice.connection, baseUrl, "/p/apollo/workstreams");
    await screen.findAllByTestId("project-entry", undefined, { timeout: 10_000 });

    const real = globalThis.fetch;
    let failed = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = input instanceof Request ? input.url : String(input);
      if (decodeURIComponent(url).includes("topicPrefix=workstreams/apollo/")) {
        failed += 1;
        return new Response(JSON.stringify({ error: "unavailable" }), { status: 503, headers: { "content-type": "application/json" } });
      }
      return real(input, init);
    });
    await eventually(async () => (failed > 0 ? true : undefined), "a poll that fails", 15_000);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(screen.queryByTestId("project-read-failure")).toBeNull();
    expect(screen.getAllByTestId("project-entry").map((li) => li.getAttribute("data-workstream-id"))).toEqual(["checkout"]);
  });

  it("nests a project's workstreams under it in the sidebar, read only once it is open, and each opens its own view", async () => {
    // Finding a workstream should be one look at the sidebar, not a trip through the project's tabs.
    // A closed project reads nothing, so a Lab of many projects isn't read whole (BR-18).
    const { screen, act, fireEvent, within } = dom!;
    const { baseUrl, setup, as } = await open();
    const alice = await as(ALICE);
    const bob = await as(BOB);
    await openAs(alice, setup, "checkout");
    await openAs(bob, setup, "search");

    const seen = recordRequests();
    openApp(alice.connection, baseUrl, "/inbox");
    const group = (await screen.findByTestId("nav-project-apollo", undefined, { timeout: 10_000 })).closest("[data-testid='project-group']") as HTMLElement;
    await screen.findByTestId("inbox-empty", undefined, { timeout: 10_000 });
    expect(group.getAttribute("data-open")).toBe("false");
    expect(within(group).queryAllByTestId("nav-workstream")).toEqual([]);
    expect(seen.filter((r) => /\/resources\/(workstreams|privateWorkstreams)\b/.test(r.path))).toEqual([]);

    act(() => fireEvent.click(within(group).getByTestId("nav-project-apollo-toggle")));
    const nested = await within(group).findAllByTestId("nav-workstream", undefined, { timeout: 10_000 });
    expect(nested.map((b) => [b.getAttribute("data-owner"), b.getAttribute("data-workstream-id")]).sort()).toEqual(
      [
        [ALICE.userId, "checkout"],
        [BOB.userId, "search"],
      ].sort(),
    );
    const entryReads = seen.filter((r) => /\/resources\/(workstreams|privateWorkstreams)\b/.test(r.path));
    expect(entryReads.map((r) => r.path.replace(/^.*\?/, "?"))).toEqual(entryReads.map(() => "?limit=200&topicPrefix=workstreams/apollo/"));

    // Bob's opens on his entry's view, and is the sidebar's current row.
    act(() => fireEvent.click(nested.find((b) => b.getAttribute("data-owner") === BOB.userId)!));
    const details = await screen.findByTestId("project-entry-details", undefined, { timeout: 10_000 });
    expect(details.textContent).toContain("led by Engineering Manager");
    const current = within(group).getAllByTestId("nav-workstream").find((b) => b.getAttribute("aria-current") === "page");
    expect(current?.getAttribute("data-workstream-id")).toBe("search");

    // Closed again, its workstreams leave the sidebar even while the project is on screen.
    act(() => fireEvent.click(within(group).getByTestId("nav-project-apollo-toggle")));
    expect(within(group).queryAllByTestId("nav-workstream")).toEqual([]);
  });

  it("shows a workstream opened elsewhere under its project in the sidebar, with no reload", async () => {
    // The coordinator opens workstreams in its own turn; the user on the project's screen must see it land.
    const { screen, within } = dom!;
    const { baseUrl, setup, as } = await open();
    const alice = await as(ALICE);
    openApp(alice.connection, baseUrl, "/p/apollo/stream");
    const group = (await screen.findByTestId("nav-project-apollo", undefined, { timeout: 10_000 })).closest("[data-testid='project-group']") as HTMLElement;
    // The project on screen is open in the sidebar.
    await within(group).findByTestId("nav-workstreams-none", undefined, { timeout: 10_000 });

    await openAs(alice, setup, "research");
    const nested = await within(group).findAllByTestId("nav-workstream", undefined, { timeout: 15_000 });
    expect(nested.map((b) => b.getAttribute("data-workstream-id"))).toEqual(["research"]);
    expect(nested[0]!.textContent).toContain("The research");
  });

  it("flags an entry gone quiet by the project's progress, one clock for the row and the count (BR-19)", async () => {
    const { setup, as } = await open();
    const alice = await as(ALICE);
    const bob = await as(BOB);
    await openAs(alice, setup, "checkout");
    await openAs(bob, setup, "search");
    const fresh = (await readProject(alice.client, alice.reader, APOLLO))!;
    expect(fresh.progress.stale).toEqual([]);
    expect(fresh.entries.map((e) => e.stale)).toEqual([false, false]);
    // Eight days on, both are quiet; once Bob's is done it is never stale, in the row as in the count.
    const later = Date.now() + 8 * 24 * 60 * 60 * 1000;
    await runAction(bob.client, setup.flow, readerSessionId(BOB.userId, setup.flow), "updateWorkstream", {
      project: APOLLO,
      id: "search",
      status: "done",
    });
    const quiet = (await readProject(alice.client, alice.reader, APOLLO, later))!;
    const flagged = quiet.entries.filter((e) => e.stale).map((e) => `${e.owner}/${e.id}`);
    expect(flagged).toEqual([`${ALICE.userId}/checkout`]);
    expect(quiet.progress.stale.map((e) => `${e.owner}/${e.id}`)).toEqual(flagged);
  });
});
