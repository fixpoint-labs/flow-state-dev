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
import { createLabClients, type LabClients } from "../src/lib/connection";
import { createLabReader } from "../src/lib/reads";
import { teamsOf, type LoadedSnapshot } from "../src/lib/derive";
import { serveLab, type ServedLab } from "./helpers/serve-lab";

const repo = fileURLToPath(new URL("../../../", import.meta.url));

type Opened = { lab: ServedLab; roster: DeclaredRoster; snapshot: LoadedSnapshot; clients: LabClients };

async function open(configPath: string, treePath: string): Promise<Opened> {
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
  return { lab, roster: await readDeclaredRoster(`${repo}/${treePath}`), snapshot, clients };
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
])("%s", (name, configPath, treePath) => {
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

  it("Jump to finds exactly the declared documents the tree lets a browser read, and each opens with the file's body", async () => {
    const { snapshot, roster, clients } = opened;
    if (!snapshot.resources.ok) throw new Error(snapshot.resources.failure.message);
    const readable = roster.documents.filter(
      (doc) => (doc.declared.client as { content?: { read?: unknown } } | undefined)?.content?.read === true,
    );
    expect(snapshot.resources.value.map((r) => r.ref).sort()).toEqual(readable.map((doc) => doc.ref).sort());
    for (const found of snapshot.resources.value) {
      const read = await clients.resources.getResourceContent(found.sessionId, found.ref);
      expect(String(read.content).trim()).toBe(readable.find((doc) => doc.ref === found.ref)!.body.trim());
    }
  });

  // The Lab the epic pins for the closure's leg a: Jump to reaches a declared
  // document on it, so the resources destination is never empty there.
  it.runIf(name === "devforce-lab")("serves at least one declared document to Jump to", () => {
    const { snapshot } = opened;
    if (!snapshot.resources.ok) throw new Error(snapshot.resources.failure.message);
    expect(snapshot.resources.value.length).toBeGreaterThan(0);
  });
});
