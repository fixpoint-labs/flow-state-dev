/**
 * `listProjects`: the projects the caller is a member of, on the real engine
 * and the real HTTP router, as users of two organizations. A shared project
 * the caller isn't a member of is never listed, though its row is readable in
 * the organization: a coordinator choosing where work lands picks from this
 * list, so a project it lists is one the caller can file work in.
 */
import { describe, expect, it } from "vitest";
import { defineProjectBlocks } from "../src/index";
import { bootProjectsHost, OTHER_ORG } from "./projects-harness";

const blocks = defineProjectBlocks();
const boot = () => bootProjectsHost({ lab: () => ({ ...blocks.actions }) });

describe("listProjects", () => {
  it("lists the caller's shared projects and their own private ones, with each one's repository, and nobody else's", async () => {
    const h = await boot();
    const as = async (user: string, org?: string) => ({ user, org, session: await h.openSession(user, "lab", undefined, org) });
    const alice = await as("alice");
    const bob = await as("bob");
    const carol = await as("carol");
    const create = (who: { user: string; org?: string; session: string }, input: Record<string, unknown>) =>
      h.ok(who.user, "lab", who.session, "createProject", input, who.org);

    await create(alice, { id: "apollo", title: "Apollo", members: ["bob"], repository: "git@github.com:acme/apollo.git" });
    await create(alice, { id: "zeus", title: "Zeus" });
    await create(alice, { id: "notes", title: "Notes", visibility: "private" });
    await create(bob, { id: "bobs", title: "Bob's", visibility: "private" });
    // Carol's shared project has a repository, and neither Alice nor Bob is a member.
    await create(carol, { id: "ledger", title: "Ledger", repository: "git@github.com:acme/ledger.git" });
    // Alice's project in her other organization.
    await create(await as("alice", OTHER_ORG), { id: "elsewhere", title: "Beta", repository: "git@github.com:beta/x.git" });

    const list = async (who: { user: string; org?: string; session: string }) =>
      ((await h.ok(who.user, "lab", who.session, "listProjects", {}, who.org)) as { projects: unknown[] }).projects;

    expect(await list(alice)).toEqual([
      { visibility: "shared", id: "apollo", title: "Apollo", repository: "git@github.com:acme/apollo.git" },
      { visibility: "shared", id: "zeus", title: "Zeus", repository: null },
      { visibility: "private", id: "notes", title: "Notes", repository: null }
    ]);
    // A member Alice named lists her project, and not the one she kept to herself.
    expect(await list(bob)).toEqual([
      { visibility: "shared", id: "apollo", title: "Apollo", repository: "git@github.com:acme/apollo.git" },
      { visibility: "private", id: "bobs", title: "Bob's", repository: null }
    ]);
    expect(await list(carol)).toEqual([
      { visibility: "shared", id: "ledger", title: "Ledger", repository: "git@github.com:acme/ledger.git" }
    ]);
  });
});
