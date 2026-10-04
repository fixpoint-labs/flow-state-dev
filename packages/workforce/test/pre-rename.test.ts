/**
 * A tree or a store from before mailboxes were renamed from channels is
 * refused by name, never misread and never skipped.
 *
 * What these defend: the rename keeps no read path for the old names, so the
 * only question is what a person sees when old data meets new code. Each case
 * asserts on the message a person reads — that it names the rename and says
 * what to do — not merely that something failed, because an old store already
 * failed before this existed, with advice that sent people the wrong way.
 *
 * The old names come from the one module that holds them, so this file spells
 * none of them itself.
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createManifestRegistry, defineFlow, discoveryTools } from "@flow-state-dev/core";
import { createInMemoryStores } from "@flow-state-dev/engine";
import { createTestContext, runForTest } from "@flow-state-dev/testing";
import { readDeclaredRoster, readMailboxesDirectory } from "../src/loader";
import { WorkforceCodeError, discoverWorkforceCode } from "../src/codegen";
import {
  MAILBOX_KIND,
  MAILBOX_POST_COMPONENT,
  findPreRenameMarks,
  mailboxInstances,
  openMailboxes,
  type MailboxManifest,
} from "../src/index";
import { PRE_RENAME_NAMES as OLD } from "../src/mailbox/pre-rename";

const roots: string[] = [];
afterEach(() => {
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A tree written from `{ "relative/path": contents }`; an entry ending in `/` is an empty folder. */
function tree(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "fsd-pre-rename-"));
  roots.push(root);
  for (const [rel, contents] of Object.entries(files)) {
    const full = join(root, rel);
    if (rel.endsWith("/")) {
      mkdirSync(full, { recursive: true });
      continue;
    }
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, contents);
  }
  return root;
}

const RECORD = "---\ndescription: Daily status.\nmembers: [eng.lead]\n---\n\nPost what you finished.\n";

describe("a tree from before the rename (BR-12)", () => {
  it("reports an old record file in an old folder, naming both new names, once per file", async () => {
    const root = tree({
      [`teams/eng/${OLD.recordFolder}/standup/${OLD.recordFile}`]: RECORD,
      [`teams/eng/${OLD.recordFolder}/incidents/${OLD.recordFile}`]: RECORD,
      "teams/eng/mailboxes/feature/MAILBOX.md": RECORD,
    });

    const { mailboxes, errors } = await readMailboxesDirectory(root);

    // The renamed one still loads; the old ones are each reported, never skipped.
    expect(mailboxes.map((m) => m.id)).toEqual(["eng.feature"]);
    expect(errors.map((e) => e.path).sort()).toEqual([
      `teams/eng/${OLD.recordFolder}/incidents/${OLD.recordFile}`,
      `teams/eng/${OLD.recordFolder}/standup/${OLD.recordFile}`,
    ]);
    for (const error of errors) {
      expect(error.kind).toBe("pre-rename-record");
      expect(error.error.message).toContain("teams/eng/mailboxes/");
      expect(error.error.message).toContain("MAILBOX.md");
      expect(error.error.message).toMatch(/renamed/);
    }
  });

  it("reports an old record file left in a renamed folder, rather than calling it missing", async () => {
    const root = tree({ [`teams/eng/mailboxes/standup/${OLD.recordFile}`]: RECORD });

    const { errors } = await readMailboxesDirectory(root);

    expect(errors).toHaveLength(1);
    expect(errors[0]!.path).toBe(`teams/eng/mailboxes/standup/${OLD.recordFile}`);
    expect(errors[0]!.kind).toBe("pre-rename-record");
    expect(errors[0]!.error.message).toContain("teams/eng/mailboxes/standup/MAILBOX.md");
  });

  it("reports an old folder that holds no record, so an emptied folder is not silent either", async () => {
    const root = tree({ [`teams/eng/${OLD.recordFolder}/`]: "" });

    const { errors } = await readMailboxesDirectory(root);

    expect(errors).toHaveLength(1);
    expect(errors[0]!.path).toBe(`teams/eng/${OLD.recordFolder}`);
    expect(errors[0]!.error.message).toContain("teams/eng/mailboxes/");
  });

  it("reports an old folder holding only a stray file as the folder, never as a record that is not there", async () => {
    const root = tree({ [`teams/eng/${OLD.recordFolder}/README.md`]: "Notes.\n" });

    const { errors } = await readMailboxesDirectory(root);

    expect(errors.map((e) => e.path)).toEqual([`teams/eng/${OLD.recordFolder}`]);
  });

  it("reaches the roster a host boots from, where its errors are fatal", async () => {
    const root = tree({ [`teams/eng/${OLD.recordFolder}/standup/${OLD.recordFile}`]: RECORD });

    const roster = await readDeclaredRoster(root);

    expect(roster.mailboxes).toEqual([]);
    expect(roster.problems).toEqual([
      expect.objectContaining({ layer: "mailbox", path: `teams/eng/${OLD.recordFolder}/standup/${OLD.recordFile}` }),
    ]);
  });
});

describe("a kinds folder from before the rename (BR-13)", () => {
  it("refuses to generate, naming the folder kinds now live in", async () => {
    const root = tree({ [`${OLD.kindsFolder}/digest.ts`]: "export default {};\n" });

    const error = await discoverWorkforceCode(root).then(
      () => undefined,
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(WorkforceCodeError);
    const problems = (error as WorkforceCodeError).problems;
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(`"${OLD.kindsFolder}"`);
    expect(problems[0]).toContain("flows/mailboxes");
  });
});

describe("a kind named for the old built-in", () => {
  // Every session on it would read as data from before the rename, so the boot
  // after the first would refuse the app's own store. Refused where it is named.
  it("is refused by fsdev gen, in either flow folder", async () => {
    for (const folder of ["flows/mailboxes", "flows/workers"]) {
      const root = tree({ [`${folder}/${OLD.kind}.ts`]: "export default {};\n" });

      const error = await discoverWorkforceCode(root).then(
        () => undefined,
        (caught: unknown) => caught,
      );

      expect(error, folder).toBeInstanceOf(WorkforceCodeError);
      expect((error as WorkforceCodeError).problems, folder).toEqual([
        expect.stringMatching(new RegExp(`"${folder}/${OLD.kind}\\.ts".*renamed to mailboxes.*another name`)),
      ]);
    }
  });

  it("is refused by mailboxInstances, before anything is registered", () => {
    const kind = defineFlow({ kind: OLD.kind, cardinality: "singleton", actions: {} } as never);

    expect(() =>
      mailboxInstances([{ id: "eng.standup", declared: { flow: OLD.kind }, body: "Post." }], {
        kinds: { [OLD.kind]: kind as never },
      }),
    ).toThrow(new RegExp(`"${OLD.kind}".*renamed to mailboxes.*another name`));
  });
});

describe("a store from before the rename, at boot (BR-14)", () => {
  /** A session store holding one session at `id`, as a store written before the rename would. */
  function storeHolding(id: string, flowKind: string) {
    const sessions = new Map<string, Record<string, unknown>>([
      [id, { id, flowKind, flowId: flowKind, userId: "u_42", state: { members: [], instructions: "" } }],
    ]);
    const deleted: string[] = [];
    const client = {
      createSession: async (options: Record<string, unknown>) => {
        if (sessions.has(String(options.sessionId))) {
          throw Object.assign(new Error("Request failed (409)"), { status: 409 });
        }
        sessions.set(String(options.sessionId), { ...options });
        return { id: String(options.sessionId) };
      },
      getSession: async (sessionId: string) => sessions.get(sessionId) as never,
      deleteSession: async (sessionId: string) => {
        deleted.push(sessionId);
        sessions.delete(sessionId);
      },
    };
    return { client, deleted };
  }

  const roster: MailboxManifest[] = [{ id: "eng.standup", declared: { members: [] }, body: "Post." }];

  it("stops, saying the store predates the rename and must be reset, not that ids collide", async () => {
    const { client, deleted } = storeHolding("eng.standup", OLD.kind);

    const error = await openMailboxes(roster, { client, userId: "u_42" }).then(
      () => undefined,
      (caught: unknown) => caught as Error,
    );

    expect(error?.message).toContain('mailbox "eng.standup" could not be opened');
    expect(error?.message).toMatch(/written before channels were renamed to mailboxes/);
    expect(error?.message).toMatch(/start from an empty store/i);
    expect(error?.message).not.toMatch(/collision|rename the mailbox/);
    // Refused, not repaired: the old session is still there.
    expect(deleted).toEqual([]);
  });

  it("still calls another flow's session at the id a collision", async () => {
    const { client } = storeHolding("eng.standup", "support-inbox");

    await expect(openMailboxes(roster, { client, userId: "u_42" })).rejects.toThrow(/id collision/);
  });
});

describe("an agent asking for the old discovery domain (BR-18)", () => {
  it("is refused with the valid domains listed, as any unknown domain is", async () => {
    const { discover } = discoveryTools(createManifestRegistry([]));

    const result = (await runForTest(discover as never, { domain: OLD.discoveryDomain, detail: "thin" } as never, createTestContext())) as {
      domains: unknown[];
      problem?: string;
    };

    expect(result.domains).toEqual([]);
    expect(result.problem).toContain(`Unknown domain "${OLD.discoveryDomain}"`);
    expect(result.problem).toContain("seats, mailboxes, skills, resources");
  });
});

describe("what marks a store as written before the rename (BR-17)", () => {
  const ORG = "acme";
  const now = Date.now();

  async function session(stores: ReturnType<typeof createInMemoryStores>, id: string, flowKind: string) {
    await stores.session.set(
      id,
      { id, flowKind, flowId: flowKind, userId: "u_42", orgId: ORG, state: {}, lineageId: `lin_${id}`, version: 0, createdAt: now, updatedAt: now, journal: [] } as never,
      "absent",
    );
  }

  async function postedLine(stores: ReturnType<typeof createInMemoryStores>, sessionId: string, flowKind: string, component: string) {
    const id = `req_${sessionId}_${component}`;
    await stores.request.set(
      id,
      {
        id, flowKind, flowId: flowKind, actionName: "post", userId: "u_42", sessionId, orgId: ORG, source: "http",
        status: "completed", startedAtMs: now, state: {}, lineageId: `lin_${id}`, version: 0, createdAt: now, updatedAt: now, journal: [],
      } as never,
      "absent",
    );
    stores.request.persistItems(id, [
      { id: `item_${id}`, type: "component", component, data: { body: "hello" }, status: "completed", createdAt: now } as never,
    ]);
  }

  it("marks a session on the old built-in kind, whatever its id", async () => {
    const stores = createInMemoryStores();
    await session(stores, "eng.standup", OLD.kind);

    const marks = await findPreRenameMarks(stores, { mailboxIds: [], orgIds: [ORG] });

    expect(marks.sessions).toEqual([{ id: "eng.standup", why: expect.stringContaining(`"${OLD.kind}"`) }]);
  });

  it("marks a custom-kind mailbox by the line its transcript holds, since its kind never changed", async () => {
    const stores = createInMemoryStores();
    await session(stores, "eng.digest", "digest");
    await postedLine(stores, "eng.digest", "digest", OLD.postComponent);

    const marks = await findPreRenameMarks(stores, { mailboxIds: ["eng.digest"], orgIds: [ORG] });

    expect(marks.sessions).toEqual([{ id: "eng.digest", why: expect.stringContaining(`"${OLD.postComponent}"`) }]);
  });

  it("marks an organization by an inventory row filed under the old key", async () => {
    const stores = createInMemoryStores();
    await stores.resourceState.set("org", ORG, `${OLD.inventoryPrefix}eng.digest`, { id: "eng.digest" } as never, "any" as never);

    const marks = await findPreRenameMarks(stores, { mailboxIds: [], orgIds: [ORG] });

    expect(marks.organizations).toEqual([ORG]);
  });

  it("leaves a fresh store with a custom-kind mailbox unmarked, so it opens", async () => {
    const stores = createInMemoryStores();
    await session(stores, "eng.digest", "digest");
    await postedLine(stores, "eng.digest", "digest", MAILBOX_POST_COMPONENT);
    await session(stores, "eng.standup", MAILBOX_KIND);
    await stores.resourceState.set("org", ORG, "inventory/mailboxes/eng.digest", { id: "eng.digest" } as never, "any" as never);

    const marks = await findPreRenameMarks(stores, { mailboxIds: ["eng.digest", "eng.standup"], orgIds: [ORG] });

    expect(marks).toEqual({ sessions: [], organizations: [] });
  });
});
