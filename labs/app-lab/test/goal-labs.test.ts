/**
 * The shared reads over the two goal Labs, each loaded through its own fsdev
 * config the way the start script loads it (V4; BR-7, BR-13, BR-14).
 *
 * What the reads return is compared against the tree each Lab was opened from
 * and against the board rows its own store holds, never against a list written
 * here: this file names a config path and nothing inside the tree.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { loadFsdevConfig } from "@flow-state-dev/fsdev";
import { readDeclaredRoster, type DeclaredRoster } from "@flow-state-dev/workforce/loader";
import { createLabClients } from "../src/lib/connection";
import { createLabReader, type BoardRow } from "../src/lib/reads";
import { teamsOf, type LoadedSnapshot } from "../src/lib/derive";
import type { OutputItem } from "@flow-state-dev/core/items";
import { followRequest, readSessionItems, resolveRunFlow, taskItems } from "../src/lib/run";
import { eventually, serveLab, type ServedLab } from "./helpers/serve-lab";

const repo = fileURLToPath(new URL("../../../", import.meta.url));

type Opened = { lab: ServedLab; roster: DeclaredRoster; snapshot: LoadedSnapshot };

type OpenedWithClients = Opened & { clients: ReturnType<typeof createLabClients> };

async function open(configPath: string, treePath: string): Promise<OpenedWithClients> {
  const loaded = await loadFsdevConfig({ cwd: repo, configPath });
  if (loaded === undefined) throw new Error(`no config at ${configPath}`);
  const lab = await serveLab(loaded.flowState);
  const devtool = loaded.flowState.meta.devtool;
  const clients = createLabClients({
    baseUrl: lab.baseUrl,
    userId: devtool?.userId ?? "devuser",
    ...(devtool?.bearerToken === undefined ? {} : { bearerToken: devtool.bearerToken }),
  });
  const snapshot = await createLabReader(clients).read();
  if (snapshot.refused !== undefined) throw new Error(`refused: ${snapshot.refused.message}`);
  return { lab, clients, roster: await readDeclaredRoster(`${repo}/${treePath}`), snapshot };
}

/** TEAMS, as the tree declares it: each team's seat ids. */
function declaredTeams(roster: DeclaredRoster): Record<string, string[]> {
  const teams: Record<string, string[]> = {};
  for (const worker of roster.workers) (teams[worker.id.split(".")[0]!] ??= []).push(worker.id);
  for (const ids of Object.values(teams)) ids.sort();
  return teams;
}

describe.each([
  ["multi-seat-collab", "goals/multi-seat-collab/lab/fsdev.config.mts", "goals/multi-seat-collab/lab/workforce"],
  ["devforce-lab", "goals/devforce-lab/lab/fsdev.config.mts", "goals/devforce-lab/lab/workforce"],
])("%s", (_name, configPath, treePath) => {
  let opened: Opened;
  beforeAll(async () => {
    opened = await open(configPath, treePath);
  }, 120_000);
  afterAll(async () => opened?.lab.handle.close());

  it("TEAMS is exactly the seats the Lab registered, per team, each with its kind", () => {
    const { snapshot, roster } = opened;
    if (!snapshot.inventory.ok) throw new Error(snapshot.inventory.failure.message);
    const read = Object.fromEntries(
      teamsOf(snapshot.inventory.value.seats).map(({ team, seats }) => [team, seats.map((s) => s.id).sort()]),
    );
    expect(read).toEqual(declaredTeams(roster));
    for (const seat of snapshot.inventory.value.seats) {
      expect(seat.kind).toBe(roster.workers.find((w) => w.id === seat.id)!.declared.flow);
    }
  });

  it("each workstream is exactly one declared channel, with its members", () => {
    const { snapshot, roster } = opened;
    if (!snapshot.inventory.ok) throw new Error(snapshot.inventory.failure.message);
    expect(
      snapshot.inventory.value.workstreams.map((w) => ({ id: w.id, members: [...w.members].sort() })).sort((a, b) =>
        a.id.localeCompare(b.id),
      ),
    ).toEqual(
      roster.channels
        .map((c) => ({ id: c.id, members: [...((c.declared.members as string[]) ?? [])].sort() }))
        .sort((a, b) => a.id.localeCompare(b.id)),
    );
  });

  it("each workstream's boards are exactly the boards its channel attaches", () => {
    const { snapshot, roster } = opened;
    for (const channel of roster.channels) {
      const boards = snapshot.boards[channel.id];
      if (boards === undefined || !boards.ok) throw new Error(`boards of ${channel.id} did not load`);
      const attached = ((channel.declared.boards as string[] | undefined) ?? []).map((name) => `${channel.id}.${name}`);
      expect(boards.value.refs.sort()).toEqual(attached.sort());
      for (const row of boards.value.rows) expect(attached).toContain(row.boardRef);
    }
  });
});

// Approve & run on the DevForce tree, the way App Lab does it (FIX-1692). The
// Lab's own config is loaded as the start script loads it, the waiting ask is
// answered through App Lab's one answer path, and the row and its run are read
// through the reads the task screen uses. Before the fix the config's harness
// could never finish the phase: the run recorded no step and the row went back
// to pending with nothing left to run it.
describe("devforce-lab: an approved task's run", () => {
  let opened: OpenedWithClients;
  beforeAll(async () => {
    opened = await open("goals/devforce-lab/lab/fsdev.config.mts", "goals/devforce-lab/lab/workforce");
  }, 120_000);
  afterAll(async () => opened?.lab.handle.close());

  it("shows its steps while it runs, and settles the row the Tasks list and the task screen both read", async () => {
    const { snapshot, clients } = opened;
    const reader = createLabReader(clients);
    if (!snapshot.asks.ok) throw new Error(snapshot.asks.failure.message);
    const ask = snapshot.asks.value.find((a) => a.kind === "approval");
    if (ask === undefined) throw new Error("the Lab raised no approval to answer");

    await reader.resume(ask, { action: "approve" });

    // Live: while the row is still running, the run's request stream (what the
    // Session tab follows) delivers its steps, stamped with this task.
    const running = await eventually<BoardRow>(async () => {
      const next = await reader.read();
      if (next.refused !== undefined) throw new Error(next.refused.message);
      const row = Object.values(next.boards).flatMap((b) => (b.ok ? b.value.rows : []))[0];
      return row?.status === "in_progress" && row.run !== null ? row : undefined;
    }, "the approved row to start", 30_000);
    const flowId = await resolveRunFlow(clients, running.run!.sessionId);
    const streamed: OutputItem[] = [];
    let rowStatusAtFirstStep: string | undefined;
    const follower = followRequest(clients, { flowId, requestId: running.run!.requestId }, {
      onItem: (item) => {
        streamed.push(item);
        if (rowStatusAtFirstStep === undefined && taskItems(streamed, running.boardRef, running.id).items.length > 0) {
          void reader.readBoard(running.channelId, running.boardRef).then((rows) => {
            rowStatusAtFirstStep ??= rows.find((r) => r.id === running.id)?.status;
          });
        }
      },
      onStatus: () => {},
      onError: () => {},
    });

    let last: BoardRow | undefined;
    const settled = await eventually<BoardRow>(async () => {
      const next = await reader.read();
      if (next.refused !== undefined) throw new Error(next.refused.message);
      last = Object.values(next.boards).flatMap((b) => (b.ok ? b.value.rows : []))[0];
      return last !== undefined && last.status !== "pending" && last.status !== "in_progress" ? last : undefined;
    }, "the approved row to settle", 45_000).catch((error: Error) => {
      throw new Error(`${error.message}; last read ${last?.status ?? "no row"}: ${last?.error ?? ""}`);
    });

    follower.close();
    expect(taskItems(streamed, running.boardRef, running.id).items.length).toBeGreaterThan(0);
    expect(rowStatusAtFirstStep).toBe("in_progress");
    expect(settled.status).toBe("completed");
    expect(settled.run).not.toBeNull();
    const { items } = await readSessionItems(clients, settled.run!.sessionId);
    expect(taskItems(items, settled.boardRef, settled.id).items.length).toBeGreaterThan(0);
  }, 90_000);
});
