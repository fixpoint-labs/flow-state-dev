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
import { readDeclaredRoster, type DeclaredRoster } from "@flow-state-dev/workforce/loader";
import type { Client } from "@flow-state-dev/client";
import { connect } from "../src/lib/connection";
import { collectionOfBoard, createLabReader, GENERAL_TEAM, type Ask, type BoardRow } from "../src/lib/reads";
import { teamsOf, type LoadedSnapshot } from "../src/lib/derive";
import type { OutputItem } from "@flow-state-dev/core/items";
import { followRequest, readSessionItems, resolveRunFlow, taskItems } from "../src/lib/run";
import { declaredBrowserReadable } from "./helpers/documents";
import { eventually, serveLab, type ServedLab } from "./helpers/serve-lab";

const repo = fileURLToPath(new URL("../../../", import.meta.url));

type Opened = { lab: ServedLab; roster: DeclaredRoster; snapshot: LoadedSnapshot; client: Client };

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
  const snapshot = await createLabReader(client).read();
  if (snapshot.refused !== undefined) throw new Error(`refused: ${snapshot.refused.message}`);
  if (snapshot.unreachable !== undefined) throw new Error(`unreachable: ${snapshot.unreachable.message}`);
  return { lab, roster: await readDeclaredRoster(`${repo}/${treePath}`), snapshot, client };
}

/** TEAMS, as the tree declares it: each team's worker ids, an org worker (no team in its id) under General. */
function declaredTeams(roster: DeclaredRoster): Record<string, string[]> {
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
    const { snapshot, roster } = opened;
    if (!snapshot.inventory.ok) throw new Error(snapshot.inventory.failure.message);
    const read = Object.fromEntries(
      teamsOf(snapshot.inventory.value.workers).map(({ team, workers }) => [team, workers.map((s) => s.id).sort()]),
    );
    expect(read).toEqual(declaredTeams(roster));
    for (const worker of snapshot.inventory.value.workers) {
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
    const sent = await client.flow(flowKind).send("createTask_tasks", { goal: "a row the snapshot must hold", assignee }, { sessionId: conversation });
    const taskId = await eventually(async () => {
      const listed = (await client.sessions.requests(conversation, { includeResultOutput: true, limit: 50 })) as Array<{
        id: string;
        result?: { output?: { taskId?: string } };
      }>;
      return listed.find((r) => r.id === sent.id)?.result?.output?.taskId;
    }, "the filing's answer");

    const snapshot = await createLabReader(client).read();
    if (snapshot.refused !== undefined || snapshot.unreachable !== undefined) throw new Error("the Lab did not load");
    const boards = snapshot.boards[conversation];
    if (boards === undefined || !boards.ok) throw new Error(`the conversation's board did not load: ${JSON.stringify(boards)}`);
    expect(boards.value.refs).toEqual([`${conversation}.tasks`]);
    expect(boards.value.rows.map((r) => [r.id, r.assignee, r.boardRef])).toEqual([[taskId, assignee, `${conversation}.tasks`]]);
  }, 60_000);

  // Jump to finds a document through the flow of a session the user has. fsd
  // opens no session at start (no ask, no workstream), so a fresh fsd open has
  // none to find yet; the claim is checked on the Labs that open one.
  it.runIf(name !== "fsd")("Jump to finds exactly the declared documents the tree lets a browser read, and each opens with the file's body", async () => {
    const { snapshot, roster, client } = opened;
    if (!snapshot.resources.ok) throw new Error(snapshot.resources.failure.message);
    const readable = roster.documents.filter(declaredBrowserReadable);
    expect(snapshot.resources.value.map((r) => r.ref).sort()).toEqual(readable.map((doc) => doc.ref).sort());
    for (const found of snapshot.resources.value) {
      const read = await client.resources.getResourceContent(found.sessionId, found.ref);
      expect(String(read.content).trim()).toBe(readable.find((doc) => doc.ref === found.ref)!.body.trim());
    }
  });

  // The Lab the epic pins for the closure's leg a: Jump to reaches a declared
  // document on it, so the resources destination is never empty there.
  it.runIf(name === "devteam")("serves at least one declared document to Jump to", () => {
    const { snapshot } = opened;
    if (!snapshot.resources.ok) throw new Error(snapshot.resources.failure.message);
    expect(snapshot.resources.value.length).toBeGreaterThan(0);
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
    const { snapshot, client } = opened;
    const reader = createLabReader(client);
    if (!snapshot.asks.ok) throw new Error(snapshot.asks.failure.message);
    const ask = snapshot.asks.value.find((a) => a.kind === "approval");
    if (ask === undefined) throw new Error("the Lab raised no approval to answer");

    await reader.resume(ask, { action: "approve" });

    // Live: the run's request stream (what the Session tab follows) delivers
    // its steps, stamped with this task, before anything is stored.
    const running = await eventually<BoardRow>(async () => {
      const next = await reader.read();
      if (next.refused !== undefined) throw new Error(next.refused.message);
      if (next.unreachable !== undefined) throw new Error(next.unreachable.message);
      const row = Object.values(next.boards).flatMap((b) => (b.ok ? b.value.rows : []))[0];
      return row?.status === "in_progress" && row.run !== null ? row : undefined;
    }, "the approved row to start", 30_000);
    const flowId = await resolveRunFlow(client, running.run!.sessionId);
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
    const review = await eventually<Ask>(async () => {
      const next = await reader.read();
      if (next.refused !== undefined) throw new Error(next.refused.message);
      if (next.unreachable !== undefined) throw new Error(next.unreachable.message);
      return next.asks.ok ? next.asks.value.find((a) => a.kind === "review" && a.sessionId === running.run!.sessionId) : undefined;
    }, "the run's review to wait in Inbox", 45_000);
    await reader.resume(review, { action: "submit", data: { verdict: "accepted" } });

    let last: BoardRow | undefined;
    const settled = await eventually<BoardRow>(async () => {
      last = (await reader.readBoard(running.ownerSessionId)).find((r) => r.id === running.id);
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
