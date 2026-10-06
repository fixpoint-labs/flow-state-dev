/**
 * A seat the chief of staff hired is listed after a restart even when the
 * process died between the hire's roster write and its inventory row.
 *
 * The store is left the way that crash leaves it: the hired roster row, and no
 * inventory row for its address. DevTeam is then opened over it through its
 * own fsdev config, as the `shift-manager` command opens it after a restart, and the seat
 * is read the way Shift Manager reads TEAMS.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadFsdevConfig } from "@flow-state-dev/fsdev";
import { createSQLiteStores } from "@flow-state-dev/store-sqlite";
import { HIRED_ROSTER_PREFIX, seatAddress, toHiredSeatRow } from "@flow-state-dev/workforce";
import { LAB_ORG_ID } from "../teams/devteam/host.mts";
import { createLabClients } from "../src/lib/connection";
import { teamsOf, type LoadedSnapshot } from "../src/lib/derive";
import { createLabReader, STAFF_TEAM } from "../src/lib/reads";
import { serveLab, type ServedLab } from "./helpers/serve-lab";

const repo = fileURLToPath(new URL("../../../", import.meta.url));
const CONFIG = "packages/shift-manager/teams/devteam/fsdev.config.mts";
const SEAT = "helper";
const INCARNATION = "5d0b8f7e-2a41-4c39-9e6b-3f1a7c2d8e90";
const ADDRESS = seatAddress(LAB_ORG_ID, SEAT);

describe("DevTeam, restarted after a hire died before its inventory row", () => {
  let lab: ServedLab | undefined;
  let store: string;
  let snapshot: LoadedSnapshot;

  beforeAll(async () => {
    store = join(mkdtempSync(join(tmpdir(), "sm-hired-restart-")), "devteam.sqlite");
    const crashed = createSQLiteStores({ filename: store });
    const row = toHiredSeatRow({
      seatId: SEAT,
      flow: "agent",
      settings: {},
      instructions: "Help the team.",
      owningOrgId: LAB_ORG_ID,
      incarnation: INCARNATION,
    });
    await crashed.resourceState.set("org", LAB_ORG_ID, `${HIRED_ROSTER_PREFIX}${SEAT}`, row as never, "any" as never);
    crashed.close();

    process.env.DEVTEAM_STORE = store;
    const loaded = await loadFsdevConfig({ cwd: repo, configPath: CONFIG }).finally(() => delete process.env.DEVTEAM_STORE);
    if (loaded === undefined) throw new Error(`no config at ${CONFIG}`);
    lab = await serveLab(loaded.flowState);
    const devtool = loaded.flowState.meta.devtool;
    const clients = createLabClients({
      baseUrl: lab.baseUrl,
      userId: devtool?.userId ?? "devuser",
      ...(devtool?.bearerToken === undefined ? {} : { bearerToken: devtool.bearerToken }),
    });
    // Shift Manager checks a hired seat against the roster, which it reads
    // through one of the person's sessions on a flow that declares it: here,
    // a session with the chief of staff.
    await clients.sessions.createSession({ flowKind: "chief-of-staff", userId: clients.userId });
    const read = await createLabReader(clients).read();
    if (read.refused !== undefined) throw new Error(`refused: ${read.refused.message}`);
    if (read.unreachable !== undefined) throw new Error(`unreachable: ${read.unreachable.message}`);
    snapshot = read;
  }, 120_000);
  afterAll(async () => lab?.handle.close());

  it("lists the hired seat under Staff in TEAMS, as it does when the hire finished", () => {
    if (!snapshot.inventory.ok) throw new Error(snapshot.inventory.failure.message);
    const staff = teamsOf(snapshot.inventory.value.seats).find(({ team }) => team === STAFF_TEAM);
    expect(staff?.seats.find((seat) => seat.id === ADDRESS)).toMatchObject({ id: ADDRESS, kind: "agent" });
  });

  it("writes its inventory row as a hire's, carrying the incarnation its roster row carries", async () => {
    const reread = createSQLiteStores({ filename: store });
    const inventoryRow = await reread.resourceState.get("org", LAB_ORG_ID, `inventory/seats/${ADDRESS}`);
    reread.close();
    expect(inventoryRow?.state).toMatchObject({ id: ADDRESS, kind: "agent", hired: true, incarnation: INCARNATION });
  });
});
