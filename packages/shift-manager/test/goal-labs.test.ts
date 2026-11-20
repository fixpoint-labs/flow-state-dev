/**
 * The shared reads over the goal Labs and the `fsd` profile, each loaded through its own fsdev
 * config the way the `shift-manager` command loads it (V4; BR-7, BR-13, BR-14).
 *
 * What the reads return is compared against the tree each Lab was opened from
 * and against the board rows its own store holds, never against a list written
 * here: this file names a config path and nothing inside the tree.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadFsdevConfig } from "@flow-state-dev/fsdev";
import { readWorkforceFolder, type WorkforceFolder } from "@flow-state-dev/workforce/loader";
import type { Client, SessionSummary } from "@flow-state-dev/client";
import { createInboxClient, type InboxHold } from "@flow-state-dev/orchestration/inbox";
import { inboxViewRef, workerInventoryResource, type InboxBoardTask, type InboxSuspensionDetail } from "@flow-state-dev/workforce/browser";
import { connect } from "../src/lib/connection";
import { collectionOfBoard } from "../src/lib/boards";
import { documentsOf } from "../src/lib/documents";
import { GENERAL_TEAM, toWorker, type Worker } from "../src/lib/workers";
import { teamsOf } from "../src/lib/shift";
import type { OutputItem } from "@flow-state-dev/core/items";
import { followRequest, readSessionItems, readRunFlow } from "./helpers/session-reads";
import { taskItems } from "../src/lib/task-items";
import { declaredBrowserReadable } from "./helpers/documents";
import { eventually, serveLab, type ServedLab } from "./helpers/serve-lab";

const repo = fileURLToPath(new URL("../../../", import.meta.url));

type Opened = { lab: ServedLab; roster: WorkforceFolder; workers: Worker[]; client: Client };

/** The user's sessions, dispatch runs included, as the directory lists them (`useSessionList`). */
const sessionsOf = (client: Client): Promise<SessionSummary[]> => client.sessions.list({ userId: client.userId, include: "dispatch-runs" });

/** The inbox view's answer, finished tasks too: what Tasks, Inbox and a task's screen draw from. */
const inboxOf = async (client: Client) => (await client.view(inboxViewRef, { done: true })).value;

/** Every hold the Inbox lists that waits on the user. */
const holdsOf = async (client: Client): Promise<InboxHold<InboxSuspensionDetail>[]> => (await inboxOf(client)).items.flatMap((item) => item.holds);

async function open(configPath: string, treePath: string): Promise<Opened> {
  // DevTeam and fsd keep a store across restarts; each open here gets its own.
  // fsd's coder defaults to Claude Code, which checks for an account at start;
  // these reads need no coder, so it opens on the scripted one.
  const dir = mkdtempSync(join(tmpdir(), "sm-goal-labs-"));
  process.env.DEVTEAM_STORE = join(dir, "devteam.sqlite");
  process.env.FSD_STORE = join(dir, "fsd.sqlite");
  process.env.DEVFORCE_LAB_HARNESS = "stub";
  const loaded = await loadFsdevConfig({ cwd: repo, configPath }).finally(() => {
    delete process.env.DEVTEAM_STORE;
    delete process.env.FSD_STORE;
    delete process.env.DEVFORCE_LAB_HARNESS;
  });
  if (loaded === undefined) throw new Error(`no config at ${configPath}`);
  const lab = await serveLab(loaded.flowState);
  const devtool = loaded.flowState.meta.devtool;
  const client = connect({
    baseUrl: lab.baseUrl,
    userId: devtool?.userId ?? "devuser",
    ...(devtool?.bearerToken === undefined ? {} : { bearerToken: devtool.bearerToken }),
  });
  // The worker inventory, read whole by org scope, as the directory reads it.
  const workers = (await client.resource(workerInventoryResource).listAll()).flatMap((row) => toWorker(row.value) ?? []);
  return { lab, roster: await readWorkforceFolder({ path: `${repo}/${treePath}`, claim: () => undefined }), workers, client };
}

/** TEAMS, as the tree declares it: each team's worker ids, an org worker (no team in its id) under General. */
function declaredTeams(roster: WorkforceFolder): Record<string, string[]> {
  const teams: Record<string, string[]> = {};
  for (const worker of roster.workers) {
    (teams[worker.id.includes(".") ? worker.id.split(".")[0]! : GENERAL_TEAM] ??= []).push(worker.id);
  }
  for (const ids of Object.values(teams)) ids.sort();
  return teams;
}

describe.each([
  ["multi-worker-collab", "packages/shift-manager/test/fixtures/multi-worker-collab/fsdev.config.mts", "packages/shift-manager/test/fixtures/multi-worker-collab/workforce"],
  ["devteam", "packages/shift-manager/teams/devteam/fsdev.config.mts", "packages/shift-manager/teams/devteam/workforce"],
  ["fsd", "packages/shift-manager/teams/devteam/fsd.fsdev.config.mts", "packages/shift-manager/teams/devteam/workforce"],
])("%s", (name, configPath, treePath) => {
  let opened: Opened;
  beforeAll(async () => {
    opened = await open(configPath, treePath);
  }, 120_000);
  afterAll(async () => opened?.lab.handle.close());

  it("TEAMS is exactly the workers the Lab registered, per team, each with its worker flow", () => {
    const { workers: registered, roster } = opened;
    const read = Object.fromEntries(teamsOf(registered).map(({ team, workers }) => [team, workers.map((s) => s.id).sort()]));
    expect(read).toEqual(declaredTeams(roster));
    for (const worker of registered) {
      expect(worker.kind).toBe(roster.workers.find((w) => w.id === worker.id)!.declared.flow);
    }
  });

  // multi-worker-collab declares no board: the planner files on its own
  // conversation's, so its rows reach Shift Manager as that conversation's
  // board, keyed by the conversation.
  it.runIf(name === "multi-worker-collab")("a row filed on a conversation's board is that conversation's board", async () => {
    const { roster, client } = opened;
    const filer = roster.workers.find((w) => Array.isArray(w.declared.delegates) && w.declared.flow !== "coordinator");
    if (filer === undefined) throw new Error("the tree declares no worker that files for delegates");
    const assignee = (filer.declared.delegates as string[])[0]!;
    const flowKind = String(filer.declared.flow);
    const conversation = (
      await client.flow(flowKind).createSession({ state: { workerId: filer.id } })
    ).id;
    const sent = await client.flow(flowKind).send("createTask_tasks", { goal: "a row the inbox view must hold", assignee }, { sessionId: conversation });
    const taskId = await eventually(async () => {
      const listed = (await client.sessions.requests(conversation, { includeResultOutput: true, limit: 50 })) as Array<{
        id: string;
        result?: { output?: { taskId?: string } };
      }>;
      return listed.find((r) => r.id === sent.id)?.result?.output?.taskId;
    }, "the filing's answer");

    const rows = (await inboxOf(client)).tasks.filter((r) => r.ownerSessionId === conversation);
    expect(rows.map((r) => [r.id, r.assignee, r.boardRef])).toEqual([[taskId, assignee, `${conversation}.tasks`]]);
  }, 60_000);

  // Jump to finds a document through the flow of a session the user has. fsd
  // opens no session at start (no ask, no workstream), so a fresh fsd open has
  // none to find yet; the claim is checked on the Labs that open one.
  it.runIf(name !== "fsd")("Jump to finds exactly the declared documents the tree lets a browser read, and each opens with the file's body", async () => {
    const { roster, client } = opened;
    // Jump to's documents (`documents.ts`): each listed flow's manifest, through the first listed session of it.
    const documents = await documentsOf(client, await sessionsOf(client));
    const readable = roster.documents.filter(declaredBrowserReadable);
    expect(documents.map((r) => r.ref).sort()).toEqual(readable.map((doc) => doc.ref).sort());
    for (const found of documents) {
      const read = await client.resources.getResourceContent(found.sessionId, found.ref);
      expect(String(read.content).trim()).toBe(readable.find((doc) => doc.ref === found.ref)!.body.trim());
    }
  });

  // The Lab the epic pins for the closure's leg a: Jump to reaches a declared
  // document on it, so the resources destination is never empty there.
  it.runIf(name === "devteam")("serves at least one declared document to Jump to", async () => {
    const { client } = opened;
    expect((await documentsOf(client, await sessionsOf(client))).length).toBeGreaterThan(0);
  });
});

// Approve & run on the DevTeam tree, the way Shift Manager does it (FIX-1692). The
// Lab's own config is loaded as the `shift-manager` command loads it, the waiting ask is
// answered through Shift Manager's one answer path, and the row and its run are read
// through the reads the task screen uses. Before the fix the config's harness
// could never finish the phase: the run recorded no step and the row went back
// to pending with nothing left to run it.
/** The DevTeam profile's step-pace override (`STEP_MS_ENV` in its `harness.mts`). */
const STEP_MS_ENV = "DEVFORCE_LAB_STEP_MS";

describe("devteam: an approved task's run", () => {
  let opened: Opened;
  // The EM's task is judged by Jev before it closes, and the scripted run makes
  // no real change, so with the gateway reachable Jev rightly fails it. This
  // checks the stream and the settle, not the judge: with no gateway key the
  // judge can't run, and the task closes on its own check (`judged: false`).
  const gatewayKey = process.env.AI_GATEWAY_API_KEY;
  beforeAll(async () => {
    delete process.env.AI_GATEWAY_API_KEY;
    // Settling is what this checks, so the scripted run does not wait out the
    // pacing a user watching needs. The it-shows-and-stops goal keeps it.
    process.env[STEP_MS_ENV] = "0";
    try {
      opened = await open("packages/shift-manager/teams/devteam/fsdev.config.mts", "packages/shift-manager/teams/devteam/workforce");
    } finally {
      delete process.env[STEP_MS_ENV];
    }
  }, 120_000);
  afterAll(async () => {
    if (gatewayKey !== undefined) process.env.AI_GATEWAY_API_KEY = gatewayKey;
    await opened?.lab.handle.close();
  });

  it("streams its steps, stamped with the task, waits for its review, and settles the row the Tasks list and the task screen both read", async () => {
    const { client } = opened;
    // Inbox's one answer path (`useInboxAnswer`).
    const inbox = createInboxClient(client);
    const ask = (await holdsOf(client)).find((hold) => hold.ask.kind === "approval");
    if (ask === undefined) throw new Error("the Lab raised no approval to answer");

    await inbox.answerOne(ask, { approved: true });

    // Live: the run's request stream (what the Session tab follows) delivers
    // its steps, stamped with this task, before anything is stored.
    const running = await eventually<InboxBoardTask>(async () => {
      const row = (await inboxOf(client)).tasks[0];
      return row?.status === "in_progress" && row.run !== null ? row : undefined;
    }, "the approved row to start", 30_000);
    const flowId = await readRunFlow(client, running.run!.sessionId);
    const streamed: OutputItem[] = [];
    const follower = followRequest(client, { flowId, requestId: running.run!.requestId }, {
      onItem: (item) => {
        streamed.push(item);
      },
      onStatus: () => {},
      onError: () => {},
    });

    // The profile holds a run that committed for the user's review: Inbox
    // shows it, and accepting it is what lets the row complete.
    const review = await eventually(async () => {
      return (await holdsOf(client)).find((hold) => hold.ask.kind === "review" && hold.source.kind === "suspension" && hold.source.sessionId === running.run!.sessionId);
    }, "the run's review to wait in Inbox", 45_000);
    await inbox.answerOne(review, { value: { verdict: "accepted" } });

    let last: InboxBoardTask | undefined;
    const settled = await eventually<InboxBoardTask>(async () => {
      last = (await inboxOf(client)).tasks.find((r) => r.ownerSessionId === running.ownerSessionId && r.id === running.id);
      return last !== undefined && last.status !== "pending" && last.status !== "in_progress" ? last : undefined;
    }, "the approved row to settle", 45_000).catch((error: Error) => {
      throw new Error(`${error.message}; last read ${last?.status ?? "no row"}: ${last?.error ?? ""}`);
    });

    follower.close();
    expect(taskItems(streamed, collectionOfBoard(running.boardRef), running.id).items.length).toBeGreaterThan(0);
    expect(settled.status).toBe("completed");
    expect(settled.run).not.toBeNull();
    const { items } = await readSessionItems(client, settled.run!.sessionId);
    expect(taskItems(items, collectionOfBoard(settled.boardRef), settled.id).items.length).toBeGreaterThan(0);
  }, 90_000);
});
