/**
 * A mailbox set up while the app runs is a mailbox like any other to the
 * readers that list mailboxes: `discover` lists it with the members its
 * session holds now, and `setWorkstreams` accepts it as a project's workstream.
 *
 * `discover` is read over the rows the real entries wrote, straight out of
 * storage, so a row the entries failed to write is one `discover` cannot see.
 * The case that matters is a membership row that fails to land: the mailbox
 * row is written first, from the session, so the listing still shows the
 * session's members and never the list before the change.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { defineFlow } from "@flow-state-dev/core";
import type { ManifestEntry } from "@flow-state-dev/core";
import {
  defineProjectBlocks,
  openMailboxAtRunTime,
  workforceManifestSources,
  type MailboxManifest
} from "../src/index";
import { host, ORG_ID, USER_ID } from "./run-time-mailbox-host";

const hosts: Array<{ dispose: () => Promise<void> }> = [];
afterEach(async () => {
  while (hosts.length > 0) await hosts.pop()!.dispose();
});

const FEATURE: MailboxManifest = {
  id: "eng.feature",
  declared: { members: ["eng.ivy"], boards: ["work"], description: "Feature work." },
  body: "C."
};

const LOGIN = {
  orgId: ORG_ID,
  team: "platform",
  name: "login",
  description: "The login page.",
  charter: "Build and ship the login page.",
  members: ["platform.ada"]
};

const lab = defineFlow({ kind: "lab", actions: { ...defineProjectBlocks().actions } } as never);

async function boot() {
  const h = await host([FEATURE], { inventory: true, flows: { lab: lab as never } });
  hosts.push(h);
  const open = openMailboxAtRunTime({ client: h.client, run: h.run, userId: USER_ID, teams: ["eng", "platform"] });
  // The file mailbox's first rows, as `openInventory` writes them at boot.
  await h.run({ action: "registerMailboxInInventory", input: {}, userId: USER_ID, orgId: ORG_ID, flowKind: "mailbox", sessionId: "eng.feature" });

  /** `discover`'s mailboxes domain, over the mailbox rows storage holds now. */
  const discover = async (): Promise<ManifestEntry[]> => {
    const [source] = workforceManifestSources({ roster: { workers: [], mailboxes: [FEATURE] }, inventory: { mailboxes: "rows" } });
    const stored = await h.stores.resourceState.getByPrefix("org", ORG_ID, "inventory/mailboxes/");
    const rows = Object.values(stored).map((record) => ({ state: (record as { state: unknown }).state }));
    const ctx = {
      resources: { rows: { pattern: "inventory/mailboxes/*", create: async () => undefined, list: async () => rows } },
      org: { identity: { orgId: ORG_ID, id: ORG_ID } }
    };
    return source!.entries(ctx as never);
  };
  return { ...h, open, discover };
}

const entryOf = (entries: ManifestEntry[], id: string) => entries.find((entry) => entry.id === id);

describe("discover", () => {
  it("lists a run-time mailbox beside the file's, with its description and its members now", async () => {
    const h = await boot();
    await h.open.setUp(LOGIN);
    await h.open.subscribe({ orgId: ORG_ID, mailboxId: "platform.login", workers: ["platform.hire"] });

    const entries = await h.discover();
    expect(entries.map((entry) => entry.id).sort()).toEqual(["eng.feature", "platform.login"]);
    expect(entryOf(entries, "platform.login")).toMatchObject({
      kind: "mailbox",
      purpose: "The login page.",
      contract: expect.stringContaining("2 members: platform.ada, platform.hire.")
    });
  });

  it("shows the session's members when a membership row fails to land", async () => {
    const h = await boot();
    await h.open.setUp(LOGIN);
    const set = h.stores.resourceState.set.bind(h.stores.resourceState);
    vi.spyOn(h.stores.resourceState, "set").mockImplementation(((...args: Parameters<typeof set>) => {
      const key = String(args[2]);
      if (key.startsWith("inventory/members/platform.hire")) return Promise.reject(new Error("row write failed"));
      return set(...args);
    }) as typeof set);

    await expect(
      h.open.subscribe({ orgId: ORG_ID, mailboxId: "platform.login", workers: ["platform.hire"] })
    ).rejects.toThrow(/row write failed/);

    // The session took the change, the membership row did not, and the listing follows the session.
    expect((await h.stateOf("platform.login"))!.members).toEqual(["platform.ada", "platform.hire"]);
    expect(await h.row("inventory/members/platform.hire/platform.login")).toBeUndefined();
    expect(entryOf(await h.discover(), "platform.login")!.contract).toContain("platform.ada, platform.hire.");
  });

  it("drops an unsubscribed worker from the listing, and its membership row is gone", async () => {
    const h = await boot();
    await h.open.setUp({ ...LOGIN, members: ["platform.ada", "platform.bob"] });
    expect(await h.row("inventory/members/platform.bob/platform.login")).toBeDefined();

    await h.open.unsubscribe({ orgId: ORG_ID, mailboxId: "platform.login", workers: ["platform.bob"] });
    expect(await h.row("inventory/members/platform.bob/platform.login")).toBeUndefined();
    expect(entryOf(await h.discover(), "platform.login")!.contract).toMatch(/^1 member: platform\.ada\./);
  });

  it("keeps listing a file mailbox only when its file declares it", async () => {
    // The run-time rule does not open the join up: a file mailbox's row with
    // its file gone is still withheld.
    const h = await boot();
    await h.open.setUp(LOGIN);
    const [source] = workforceManifestSources({ roster: { workers: [], mailboxes: [] }, inventory: { mailboxes: "rows" } });
    const stored = await h.stores.resourceState.getByPrefix("org", ORG_ID, "inventory/mailboxes/");
    const rows = Object.values(stored).map((record) => ({ state: (record as { state: unknown }).state }));
    const entries = await source!.entries({
      resources: { rows: { pattern: "inventory/mailboxes/*", create: async () => undefined, list: async () => rows } }
    } as never);
    expect(entries.map((entry) => entry.id)).toEqual(["platform.login"]);
  });
});

describe("setWorkstreams", () => {
  it("accepts a run-time mailbox as a project's workstream", async () => {
    const h = await boot();
    await h.open.setUp(LOGIN);
    const lab = (action: string, input: unknown) =>
      h.run({ action, input, userId: USER_ID, orgId: ORG_ID, flowKind: "lab", sessionId: "lab", source: "http" });

    await lab("createProject", { id: "launch", title: "Launch" });
    const set = (await lab("setWorkstreams", { projectId: "launch", workstreams: ["platform.login", "eng.feature"] })) as {
      project: { workstreams: string[] };
    };
    expect(set.project.workstreams).toEqual(["platform.login", "eng.feature"]);
  });
});
