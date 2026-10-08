/**
 * Private and shared projects (FIX-1793 BR-1 to BR-4, BR-6), on the real
 * engine and the real HTTP router, as users of two organizations.
 *
 * A shared project is a row in the organization; a private one is the same
 * row in its owner's user scope. Every read and write after the create names
 * the project by its address, its visibility and its id.
 */
import { describe, expect, it } from "vitest";
import { defineProjectBlocks, PRIVATE_PROJECTS_RESOURCE, PROJECTS_RESOURCE } from "../src/index";
import { bootProjectsHost, OTHER_ORG, refusal, type ProjectsHost } from "./projects-harness";

const blocks = defineProjectBlocks();
const boot = () => bootProjectsHost({ lab: () => ({ ...blocks.actions }) });

const shared = (id: string) => ({ visibility: "shared" as const, id });
const mine = (id: string) => ({ visibility: "private" as const, id });

/** The project ids `user` lists through the browser read of `ref`. */
async function ids(h: ProjectsHost, user: string, ref: string, org?: string): Promise<string[]> {
  const session = await h.openSession(user, "lab", undefined, org);
  return (await h.listed(user, session, ref, org)).map((item) => String(item.data.id)).sort();
}

describe("private and shared projects", () => {
  it("keeps a private project its owner's: nobody else lists, reads or writes it, and her other org doesn't see it (BR-1)", async () => {
    const h = await boot();
    const lab = await h.openSession("alice", "lab");
    const created = await h.ok("alice", "lab", lab, "createProject", { id: "notes", title: "My notes", visibility: "private" });
    expect(created).toMatchObject({ created: true, visibility: "private", project: { id: "notes", ownerUserId: "alice", members: ["alice"] } });

    // Each of the lists below reads rows when there are rows to read: Bob's
    // own private project, and one Alice keeps in her other org.
    const bobLab = await h.openSession("bob", "lab");
    await h.ok("bob", "lab", bobLab, "createProject", { id: "bobs", title: "Bob's", visibility: "private" });
    const elsewhere = await h.openSession("alice", "lab", undefined, OTHER_ORG);
    await h.ok("alice", "lab", elsewhere, "createProject", { id: "elsewhere", title: "Beta", visibility: "private" }, OTHER_ORG);

    expect(await ids(h, "alice", PRIVATE_PROJECTS_RESOURCE)).toEqual(["notes"]);
    expect(await ids(h, "bob", PRIVATE_PROJECTS_RESOURCE)).toEqual(["bobs"]);
    expect(await ids(h, "bob", PROJECTS_RESOURCE)).toEqual([]);
    expect(await ids(h, "alice", PROJECTS_RESOURCE)).toEqual([]);
    expect(await ids(h, "alice", PRIVATE_PROJECTS_RESOURCE, OTHER_ORG)).toEqual(["elsewhere"]);

    expect(refusal(await h.act("bob", "lab", bobLab, "readProjectFiles", { project: mine("notes") }))).toContain("no-such-project");
    expect(
      refusal(await h.act("bob", "lab", bobLab, "setRepository", { project: mine("notes"), repository: "git@github.com:bob/x.git" }))
    ).toContain("no-such-project");
    expect(refusal(await h.act("bob", "lab", bobLab, "readProjectFiles", { project: shared("notes") }))).toContain("no-such-project");
    // Her own reads and writes reach it by its address.
    expect(await h.ok("alice", "lab", lab, "readProjectFiles", { project: mine("notes") })).toEqual({ files: [] });
    const set = await h.ok("alice", "lab", lab, "setRepository", { project: mine("notes"), repository: "git@github.com:alice/notes.git" });
    expect(set.project.repository).toBe("git@github.com:alice/notes.git");
  });

  it("makes a create that names no visibility a shared project, which everyone in the org lists with its repository (BR-2, BR-6)", async () => {
    const h = await boot();
    const lab = await h.openSession("alice", "lab");
    const created = await h.ok("alice", "lab", lab, "createProject", {
      id: "apollo",
      title: "Apollo",
      repository: "git@github.com:acme/apollo.git"
    });
    expect(created).toMatchObject({ created: true, visibility: "shared" });

    const malloryLab = await h.openSession("mallory", "lab");
    expect(await h.listed("mallory", malloryLab, PROJECTS_RESOURCE)).toEqual([
      expect.objectContaining({ data: expect.objectContaining({ id: "apollo", repository: "git@github.com:acme/apollo.git" }) })
    ]);
    expect(await ids(h, "alice", PROJECTS_RESOURCE, OTHER_ORG)).toEqual([]);
  });

  it("refuses a private create that lists anyone but its owner, or lists workstreams, and writes nothing (BR-3)", async () => {
    const h = await boot();
    const lab = await h.openSession("alice", "lab");
    const withBob = await h.act("alice", "lab", lab, "createProject", {
      id: "notes",
      title: "My notes",
      visibility: "private",
      members: ["alice", "bob"]
    });
    expect(withBob.settled).not.toBe("completed");
    expect(refusal(withBob)).toContain("private-has-members");

    const withWorkstreams = await h.act("alice", "lab", lab, "createProject", {
      id: "notes",
      title: "My notes",
      visibility: "private",
      workstreams: ["eng.feature"]
    });
    expect(withWorkstreams.settled).not.toBe("completed");
    expect(refusal(withWorkstreams)).toContain("private-has-workstreams");
    expect(await ids(h, "alice", PRIVATE_PROJECTS_RESOURCE)).toEqual([]);

    // Naming only herself is no one else.
    const self = await h.ok("alice", "lab", lab, "createProject", { id: "notes", title: "My notes", visibility: "private", members: ["alice"] });
    expect(self.project.members).toEqual(["alice"]);
  });

  it("keeps a private and a shared project with one id apart, each reached by its address (BR-4)", async () => {
    const h = await boot();
    const aliceLab = await h.openSession("alice", "lab");
    const bobLab = await h.openSession("bob", "lab");
    await h.ok("bob", "lab", bobLab, "createProject", { id: "apollo", title: "The org's Apollo", members: ["alice"] });
    const hers = await h.ok("alice", "lab", aliceLab, "createProject", { id: "apollo", title: "Alice's Apollo", visibility: "private" });
    expect(hers).toMatchObject({ created: true, project: { ownerUserId: "alice", title: "Alice's Apollo" } });

    await h.ok("alice", "lab", aliceLab, "setRepository", { project: mine("apollo"), repository: "git@github.com:alice/apollo.git" });
    const [orgRow] = await h.listed("alice", aliceLab, PROJECTS_RESOURCE);
    const [privateRow] = await h.listed("alice", aliceLab, PRIVATE_PROJECTS_RESOURCE);
    expect(orgRow!.data).toMatchObject({ title: "The org's Apollo", ownerUserId: "bob", repository: null });
    expect(privateRow!.data).toMatchObject({ title: "Alice's Apollo", ownerUserId: "alice", repository: "git@github.com:alice/apollo.git" });
  });

  it("binds no talk session for a private project: rooms are shared projects' (BR-1)", async () => {
    const h = await boot();
    const lab = await h.openSession("alice", "lab");
    await h.ok("alice", "lab", lab, "createProject", { id: "notes", title: "My notes", visibility: "private" });
    const [row] = await h.listed("alice", lab, PRIVATE_PROJECTS_RESOURCE);
    // Give a bind that was dispatched time to land.
    await new Promise((r) => setTimeout(r, 100));
    const [again] = await h.listed("alice", lab, PRIVATE_PROJECTS_RESOURCE);
    expect(row!.data.sessions).toEqual([]);
    expect(again!.data.sessions).toEqual([]);
  });
});
