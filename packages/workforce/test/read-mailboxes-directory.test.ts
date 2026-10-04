/**
 * Specs for the mailboxes convention loader: a folder with a `MAILBOX.md` in a
 * team's `mailboxes/` slot becomes one neutral mailbox record.
 *
 * Same discipline as the worker and resources readers' specs — every tree is a
 * real temp directory read through the real function, because the behaviours
 * under test (what a symlink does, what an unreadable folder does) are
 * filesystem behaviours. BP-035: each failing case sits in the same tree as a
 * healthy mailbox, so a spec proves isolation and not just that the bad path
 * errors.
 *
 * What these specs are FOR, beyond "the function works":
 *
 * - A mailbox id is not a label. It becomes the flow instance id the binder
 *   registers and literally the session id the transcript lives in, so a spec
 *   that pins the minted id is pinning where an app's messages are stored.
 * - `errors` is collected rather than thrown because the caller owns boot
 *   policy. That only helps if a bad mailbox costs the app exactly that
 *   mailbox, which is why every failure spec keeps a healthy one beside it.
 * - `system:` is refused because a mailbox is a system mailbox by virtue of
 *   where it was declared. A file that could type it could mint an undeletable
 *   mailbox, so the refusal is a permissions rule wearing a parser's clothes.
 */
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import fsp from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readMailboxesDirectory, readWorkforceDirectory } from "../src/loader";
import { MAILBOX_KIND, mailboxInstances } from "../src/index";

const roots: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of roots.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** A tree written from `{ "relative/path": contents }`. Directories are implied. */
function tree(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "fsd-mailboxes-"));
  roots.push(root);
  for (const [rel, contents] of Object.entries(files)) {
    const full = join(root, rel);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, contents);
  }
  return root;
}

/** Create an empty directory inside an existing root. */
function dir(root: string, rel: string): string {
  const full = join(root, rel);
  mkdirSync(full, { recursive: true });
  return full;
}

const STANDUP = `---
description: Where the engineering team posts daily status.
flow: mailbox
members: [engineering.lead, engineering.analyst]
---

Post what you finished, what you're on, and what's blocking you.
`;

/** A healthy mailbox that must survive every failure spec in the same tree. */
const HEALTHY = { "teams/engineering/mailboxes/standup/MAILBOX.md": STANDUP };

describe("readMailboxesDirectory", () => {
  it("turns a team's mailbox folder into a record carrying what the file declared", async () => {
    const { mailboxes, errors } = await readMailboxesDirectory(tree(HEALTHY));

    expect(errors).toEqual([]);
    expect(mailboxes).toHaveLength(1);
    // Team-qualified and dot-joined: this string is the flow instance id and
    // the session id, not a display name.
    expect(mailboxes[0]!.id).toBe("engineering.standup");
    // Verbatim, `flow:` included — the reader does not resolve a kind, and a
    // key nobody has claimed yet still has to arrive unchanged.
    expect(mailboxes[0]!.declared).toEqual({
      description: "Where the engineering team posts daily status.",
      flow: "mailbox",
      members: ["engineering.lead", "engineering.analyst"],
    });
    expect(mailboxes[0]!.body).toBe(
      "Post what you finished, what you're on, and what's blocking you.\n",
    );
  });

  it("qualifies every mailbox by its team, so two teams can each have a standup", async () => {
    const { mailboxes, errors } = await readMailboxesDirectory(
      tree({
        ...HEALTHY,
        "teams/engineering/mailboxes/incidents/MAILBOX.md": STANDUP,
        "teams/marketing/mailboxes/standup/MAILBOX.md": STANDUP,
      }),
    );

    expect(errors).toEqual([]);
    expect(mailboxes.map((c) => c.id).sort()).toEqual([
      "engineering.incidents",
      "engineering.standup",
      "marketing.standup",
    ]);
  });

  it("reads a tree with no mailboxes as empty rather than as broken", async () => {
    // Three shapes of "this app declares no mailboxes in files", none of which
    // is a mistake: no `teams/` at all, a team with no `mailboxes/` folder, and
    // an empty `mailboxes/` folder.
    const noTeams = await readMailboxesDirectory(tree({ "README.md": "not a tree" }));
    expect(noTeams).toEqual({ mailboxes: [], errors: [] });

    const noSlot = await readMailboxesDirectory(
      tree({ "teams/engineering/workers/lead/WORKER.md": "---\ndescription: Leads.\n---\n" }),
    );
    expect(noSlot).toEqual({ mailboxes: [], errors: [] });

    const emptyRoot = tree({ "README.md": "not a tree" });
    dir(emptyRoot, "teams/engineering/mailboxes");
    expect(await readMailboxesDirectory(emptyRoot)).toEqual({ mailboxes: [], errors: [] });
  });

  it("throws only when the root itself cannot be read", async () => {
    // The root is a wiring mistake, not a mailbox-shaped one: there is no
    // per-mailbox path to report it under, and returning empty would boot an
    // app with no mailboxes and nothing said.
    await expect(
      readMailboxesDirectory(join(tmpdir(), "fsd-mailboxes-absent-root")),
    ).rejects.toThrow(/Failed to read/);
  });

  it("refuses a symlinked root without following it", async () => {
    // The root is the one level a bare `readdir` would follow. Every nested
    // structural folder is classified first, so `teams -> /outside` is refused;
    // a root that is itself a link has to be refused the same way, or the whole
    // tree comes from somewhere the caller never configured.
    const root = tree({ "real/teams/engineering/mailboxes/standup/MAILBOX.md": STANDUP });
    symlinkSync(join(root, "real"), join(root, "linked"));

    // Control: the tree behind the link loads perfectly, so the refusal below
    // is the symlink and not a broken fixture.
    const direct = await readMailboxesDirectory(join(root, "real"));
    expect(direct.mailboxes.map((c) => c.id)).toEqual(["engineering.standup"]);

    await expect(readMailboxesDirectory(join(root, "linked"))).rejects.toThrow(/Symlinked/);
  });

  // R1 — the worker reader's error contract, on the mailboxes path. Each case
  // shares a tree with the healthy mailbox, which must still load: that is the
  // whole promise of collecting errors instead of throwing.
  describe("honours the worker reader's error contract", () => {
    it("reports a mailbox folder with no MAILBOX.md, naming the route out", async () => {
      const root = tree({ ...HEALTHY, "teams/engineering/mailboxes/lounge/README.md": "hi" });
      const { mailboxes, errors } = await readMailboxesDirectory(root);

      expect(mailboxes.map((c) => c.id)).toEqual(["engineering.standup"]);
      expect(errors).toHaveLength(1);
      expect(errors[0]!.path).toBe("teams/engineering/mailboxes/lounge");
      expect(errors[0]!.kind).toBe("mailbox-load-failed");
      // An author standing here needs the route, not just the wall: a mailbox
      // that behaves differently is a different flow kind, not a different
      // filename.
      expect(errors[0]!.error.message).toMatch(/has no MAILBOX\.md/);
      expect(errors[0]!.error.message).toMatch(/mailboxInstances/);
    });

    it("reports a MAILBOX.md with no frontmatter", async () => {
      const root = tree({
        ...HEALTHY,
        "teams/engineering/mailboxes/lounge/MAILBOX.md": "# Just a body\n",
      });
      const { mailboxes, errors } = await readMailboxesDirectory(root);

      expect(mailboxes.map((c) => c.id)).toEqual(["engineering.standup"]);
      expect(errors).toHaveLength(1);
      expect(errors[0]!.path).toBe("teams/engineering/mailboxes/lounge");
      expect(errors[0]!.kind).toBe("mailbox-load-failed");
      expect(errors[0]!.error.message).toMatch(/no frontmatter/);
    });

    it("reports a `description` that is missing or empty", async () => {
      const root = tree({
        ...HEALTHY,
        "teams/engineering/mailboxes/lounge/MAILBOX.md": "---\nflow: mailbox\n---\n\nbody\n",
        "teams/marketing/mailboxes/blank/MAILBOX.md": '---\ndescription: "   "\n---\n\nbody\n',
      });
      const { mailboxes, errors } = await readMailboxesDirectory(root);

      expect(mailboxes.map((c) => c.id)).toEqual(["engineering.standup"]);
      expect(errors.map((e) => e.path).sort()).toEqual([
        "teams/engineering/mailboxes/lounge",
        "teams/marketing/mailboxes/blank",
      ]);
      for (const entry of errors) {
        expect(entry.kind).toBe("mailbox-load-failed");
        expect(entry.error.message).toMatch(/non-empty `description`/);
      }
    });

    it("reports a mailbox folder name that breaks the segment rules, in mailbox terms", async () => {
      const root = tree({ ...HEALTHY, "teams/engineering/mailboxes/Stand Up/MAILBOX.md": STANDUP });
      const { mailboxes, errors } = await readMailboxesDirectory(root);

      expect(mailboxes.map((c) => c.id)).toEqual(["engineering.standup"]);
      expect(errors).toHaveLength(1);
      expect(errors[0]!.path).toBe("teams/engineering/mailboxes/Stand Up");
      expect(errors[0]!.kind).toBe("mailbox-load-failed");
      expect(errors[0]!.error.message).toMatch(/lowercase letters, digits, and single hyphens/);
      // The label the validator is called with, pinned: a mailbox folder told
      // it is a bad "Worker folder name" sends the author looking in the wrong
      // slot, and the reason the rule exists is the mailbox's own id.
      expect(errors[0]!.error.message).toMatch(/^Mailbox folder name/);
      expect(errors[0]!.error.message).toMatch(/mailbox's identity/);
    });

    it("reports a team folder name that breaks the segment rules", async () => {
      const root = tree({ ...HEALTHY, "teams/Engineering/mailboxes/standup/MAILBOX.md": STANDUP });
      const { mailboxes, errors } = await readMailboxesDirectory(root);

      expect(mailboxes.map((c) => c.id)).toEqual(["engineering.standup"]);
      expect(errors).toHaveLength(1);
      expect(errors[0]!.path).toBe("teams/Engineering/mailboxes/standup");
      expect(errors[0]!.kind).toBe("mailbox-load-failed");
      expect(errors[0]!.error.message).toMatch(/lowercase letters, digits, and single hyphens/);
    });

    it("refuses a symlinked mailbox folder without following it", async () => {
      const root = tree({ ...HEALTHY, "outside/MAILBOX.md": STANDUP });
      symlinkSync(join(root, "outside"), join(root, "teams/engineering/mailboxes/linked"));

      const { mailboxes, errors } = await readMailboxesDirectory(root);

      expect(mailboxes.map((c) => c.id)).toEqual(["engineering.standup"]);
      expect(errors).toHaveLength(1);
      expect(errors[0]!.path).toBe("teams/engineering/mailboxes/linked");
      expect(errors[0]!.kind).toBe("mailbox-load-failed");
      expect(errors[0]!.error.message).toMatch(/Symlinked/);
    });

    it("refuses a symlinked MAILBOX.md without following it", async () => {
      const root = tree({ ...HEALTHY, "outside/secret.md": STANDUP });
      dir(root, "teams/engineering/mailboxes/lounge");
      symlinkSync(
        join(root, "outside/secret.md"),
        join(root, "teams/engineering/mailboxes/lounge/MAILBOX.md"),
      );

      const { mailboxes, errors } = await readMailboxesDirectory(root);

      expect(mailboxes.map((c) => c.id)).toEqual(["engineering.standup"]);
      expect(errors).toHaveLength(1);
      expect(errors[0]!.path).toBe("teams/engineering/mailboxes/lounge");
      expect(errors[0]!.kind).toBe("mailbox-load-failed");
      expect(errors[0]!.error.message).toMatch(/Symlinked/);
    });

    it("reports a symlinked `teams/` once, rather than reading the tree as empty", async () => {
      // The one level where a refusal costs the app EVERY mailbox. There is no
      // healthy mailbox to survive beside it — which is the point: without the
      // report, an app with a misconfigured tree boots with zero mailboxes and
      // an empty `errors` for its fatal check to look at.
      const root = tree({ "outside/teams/engineering/mailboxes/standup/MAILBOX.md": STANDUP });
      symlinkSync(join(root, "outside/teams"), join(root, "teams"));

      const { mailboxes, errors } = await readMailboxesDirectory(root);

      expect(mailboxes).toEqual([]);
      expect(errors).toHaveLength(1);
      expect(errors[0]!.path).toBe("teams");
      expect(errors[0]!.kind).toBe("unreadable-slot");
      expect(errors[0]!.error.message).toMatch(/Symlinked/);
    });

    it("refuses a symlinked team folder instead of dropping its mailboxes", async () => {
      // One level below the `teams/` case above, and the level the shared team
      // walk has to carry the refusal at: a symlinked team reads a whole team's
      // mailboxes from outside the configured root.
      const root = tree({
        ...HEALTHY,
        "outside/marketing/mailboxes/standup/MAILBOX.md": STANDUP,
      });
      symlinkSync(join(root, "outside/marketing"), join(root, "teams/marketing"));

      const { mailboxes, errors } = await readMailboxesDirectory(root);

      expect(mailboxes.map((c) => c.id)).toEqual(["engineering.standup"]);
      expect(errors).toHaveLength(1);
      expect(errors[0]!.path).toBe("teams/marketing");
      expect(errors[0]!.kind).toBe("unreadable-slot");
      expect(errors[0]!.error.message).toBe(
        'Symlinked team folder "marketing" — refused for safety',
      );
    });

    it("reports a team folder it cannot stat rather than dropping its mailboxes", async () => {
      // `absent` and `unreadable` stay apart at the team level for the reason
      // they do at the slot level: folded together, a team we cannot stat is
      // skipped in silence and every mailbox under it disappears with `errors`
      // empty for the caller's fatal check to look at.
      //
      // Injected rather than provoked because the suite runs as root, where a
      // permission bit denies us nothing. The real route is a `teams/` that is
      // readable but not searchable (`r--` rather than `r-x`): `readdir` lists
      // the team fine, then `lstat` on it fails with EACCES.
      const root = tree({
        ...HEALTHY,
        "teams/marketing/mailboxes/standup/MAILBOX.md": STANDUP,
      });
      const locked = join(root, "teams/marketing");
      const real = fsp.lstat.bind(fsp);
      vi.spyOn(fsp, "lstat").mockImplementation(((target: Parameters<typeof real>[0]) => {
        if (String(target) === locked) {
          const err = new Error(`EACCES: permission denied, lstat '${locked}'`);
          (err as NodeJS.ErrnoException).code = "EACCES";
          return Promise.reject(err);
        }
        return real(target);
      }) as unknown as typeof fsp.lstat);

      const { mailboxes, errors } = await readMailboxesDirectory(root);

      expect(mailboxes.map((c) => c.id)).toEqual(["engineering.standup"]);
      expect(errors).toHaveLength(1);
      expect(errors[0]!.path).toBe("teams/marketing");
      expect(errors[0]!.kind).toBe("unreadable-slot");
      expect(errors[0]!.error.message).toMatch(/^Team folder "marketing" could not be read: /);
    });

    it("refuses a symlinked mailboxes slot without following it", async () => {
      const root = tree({ ...HEALTHY, "outside/standup/MAILBOX.md": STANDUP });
      dir(root, "teams/marketing");
      symlinkSync(join(root, "outside"), join(root, "teams/marketing/mailboxes"));

      const { mailboxes, errors } = await readMailboxesDirectory(root);

      expect(mailboxes.map((c) => c.id)).toEqual(["engineering.standup"]);
      expect(errors).toHaveLength(1);
      expect(errors[0]!.path).toBe("teams/marketing/mailboxes");
      expect(errors[0]!.kind).toBe("unreadable-slot");
      expect(errors[0]!.error.message).toMatch(/Symlinked/);
    });

    it("reports a structural folder that exists and cannot be listed, under its own path", async () => {
      // Only genuine absence may read as empty. Every other `readdir` failure
      // has to stay visible, or a whole team's mailboxes drop out with the
      // caller's fatal-on-errors guard unable to see it. ENOTDIR stands in for
      // the class here because the suite runs as root, where a permission bit
      // would not deny us anything; EACCES takes the same branch.
      const { mailboxes, errors } = await readMailboxesDirectory(
        tree({ ...HEALTHY, "teams/marketing/mailboxes": "not a directory\n" }),
      );

      expect(mailboxes.map((c) => c.id)).toEqual(["engineering.standup"]);
      expect(errors).toHaveLength(1);
      expect(errors[0]!.path).toBe("teams/marketing/mailboxes");
      expect(errors[0]!.kind).toBe("unreadable-slot");
      expect(errors[0]!.error.message).toMatch(/could not be read/i);
    });

    it("reports an unreadable mailbox folder rather than skipping it", async () => {
      // `absent` and `unreadable` stay apart for exactly this case: folded
      // together, a folder we cannot stat would be skipped in silence and the
      // mailbox would simply not exist.
      const root = tree({ ...HEALTHY, "teams/engineering/mailboxes/locked/MAILBOX.md": STANDUP });
      const locked = join(root, "teams/engineering/mailboxes/locked");
      const real = fsp.lstat.bind(fsp);
      vi.spyOn(fsp, "lstat").mockImplementation(((target: Parameters<typeof real>[0]) => {
        if (String(target) === locked) {
          const err = new Error(`EACCES: permission denied, lstat '${locked}'`);
          (err as NodeJS.ErrnoException).code = "EACCES";
          return Promise.reject(err);
        }
        return real(target);
      }) as unknown as typeof fsp.lstat);

      const { mailboxes, errors } = await readMailboxesDirectory(root);

      expect(mailboxes.map((c) => c.id)).toEqual(["engineering.standup"]);
      expect(errors).toHaveLength(1);
      expect(errors[0]!.path).toBe("teams/engineering/mailboxes/locked");
      expect(errors[0]!.kind).toBe("mailbox-load-failed");
      expect(errors[0]!.error.message).toMatch(/could not be read/i);
    });

    it("reports an unreadable MAILBOX.md as unreadable, not as missing", async () => {
      // The distinction the whole `absent`/`unreadable` split exists for, at
      // the file level. Folded together, a MAILBOX.md we cannot stat is
      // reported as a folder that has none — which sends the author to write a
      // file that is already sitting there.
      const root = tree({ ...HEALTHY, "teams/engineering/mailboxes/locked/MAILBOX.md": STANDUP });
      const locked = join(root, "teams/engineering/mailboxes/locked/MAILBOX.md");
      const real = fsp.lstat.bind(fsp);
      vi.spyOn(fsp, "lstat").mockImplementation(((target: Parameters<typeof real>[0]) => {
        if (String(target) === locked) {
          const err = new Error(`EACCES: permission denied, lstat '${locked}'`);
          (err as NodeJS.ErrnoException).code = "EACCES";
          return Promise.reject(err);
        }
        return real(target);
      }) as unknown as typeof fsp.lstat);

      const { mailboxes, errors } = await readMailboxesDirectory(root);

      expect(mailboxes.map((c) => c.id)).toEqual(["engineering.standup"]);
      expect(errors).toHaveLength(1);
      expect(errors[0]!.path).toBe("teams/engineering/mailboxes/locked");
      expect(errors[0]!.kind).toBe("mailbox-load-failed");
      expect(errors[0]!.error.message).toMatch(/MAILBOX\.md .*could not be read/i);
      expect(errors[0]!.error.message).not.toMatch(/has no MAILBOX\.md/);
    });

    it("ignores editor and OS droppings, before they are read as names", async () => {
      // A dropping that is a FILE is already skipped by the slot rule, so the
      // ignore list only shows its hand on one that is a directory: without it,
      // `.DS_Store` reaches the segment validator and an app boots with an
      // error about a file nobody wrote.
      const root = tree({ ...HEALTHY, "teams/.DS_Store": "junk" });
      dir(root, "teams/engineering/mailboxes/.DS_Store");

      const { mailboxes, errors } = await readMailboxesDirectory(root);

      expect(errors).toEqual([]);
      expect(mailboxes.map((c) => c.id)).toEqual(["engineering.standup"]);
    });

    it("skips a file in the mailboxes slot in silence", async () => {
      // The deliberate divergence from the resources reader, which reports a
      // DIRECTORY in its slot because a resource is a file. Here a mailbox IS a
      // folder, so a loose file carries no sign anyone meant it to be a
      // mailbox — and reporting it would make `mailboxes/README.md` an error.
      const root = tree({
        ...HEALTHY,
        "teams/engineering/mailboxes/README.md": "how this team's mailboxes work\n",
        "teams/engineering/mailboxes/notes.txt": "scratch",
      });

      const { mailboxes, errors } = await readMailboxesDirectory(root);

      expect(errors).toEqual([]);
      expect(mailboxes.map((c) => c.id)).toEqual(["engineering.standup"]);
    });
  });

  // R2 — the one error class this convention adds. `system` is derived from
  // where a mailbox was declared; a file that could declare it could mint a
  // mailbox the delete verb will later refuse to remove.
  describe("refuses a file that declares its own `system` status", () => {
    it("reports a MAILBOX.md declaring `system:`, naming the file and the rule", async () => {
      const root = tree({
        ...HEALTHY,
        "teams/engineering/mailboxes/general/MAILBOX.md":
          "---\ndescription: Tries to make itself undeletable.\nsystem: true\n---\n\nbody\n",
      });

      const { mailboxes, errors } = await readMailboxesDirectory(root);

      expect(mailboxes.map((c) => c.id)).toEqual(["engineering.standup"]);
      expect(errors).toHaveLength(1);
      expect(errors[0]!.path).toBe("teams/engineering/mailboxes/general");
      // Its own condition, not folded into the load failures: an author who
      // mistyped a folder and an author who misunderstood the model need
      // telling apart by a caller, without matching on `error.message`.
      expect(errors[0]!.kind).toBe("refused-declaration");
      expect(errors[0]!.error.message).toContain("MAILBOX.md in \"general/\"");
      expect(errors[0]!.error.message).toMatch(/not a setting a mailbox declares/);
      expect(errors[0]!.error.message).toMatch(/Where a mailbox is declared is what decides it/);
    });

    it("refuses `system: false` too — the key is refused, not its value", async () => {
      // A file declaring `system: false` is not harmless: it is the same author
      // believing the file decides, and carried verbatim it would reach a
      // reconciler that has to guess whether the author meant it.
      const root = tree({
        ...HEALTHY,
        "teams/engineering/mailboxes/general/MAILBOX.md":
          "---\ndescription: Believes it can opt out.\nsystem: false\n---\n\nbody\n",
      });

      const { mailboxes, errors } = await readMailboxesDirectory(root);

      expect(mailboxes.map((c) => c.id)).toEqual(["engineering.standup"]);
      expect(errors).toHaveLength(1);
      expect(errors[0]!.kind).toBe("refused-declaration");
    });

    it("leaves every other unclaimed key alone", async () => {
      // The refusal is one key by name, not a closed list: this reader's job is
      // to carry what it does not understand, so the consumer that claims a key
      // tomorrow finds it unchanged. `system` is the single exception, and the
      // gatekeeping of what a mailbox may declare belongs to the binder.
      const root = tree({
        "teams/engineering/mailboxes/standup/MAILBOX.md":
          "---\ndescription: Daily status.\ntopic: status\nretention: 30d\n---\n\nbody\n",
      });

      const { mailboxes, errors } = await readMailboxesDirectory(root);

      expect(errors).toEqual([]);
      expect(mailboxes[0]!.declared).toEqual({
        description: "Daily status.",
        topic: "status",
        retention: "30d",
      });
    });
  });

  // BP-035, the interaction paths. Each half below is already proved on its
  // own above or in a sibling suite; these are the two places where two
  // separately-correct halves could still disagree with each other.
  describe("shares the tree with what already reads it", () => {
    it("walks teams/ only — an org mailbox is invisible, not an error", async () => {
      // The mailboxes convention is team-scoped, and whether it should widen to
      // `org/` is deliberately somebody else's open question. The shared team
      // walk hands this reader no `org/` scope, so a planted org mailbox is
      // neither loaded nor reported: silence is what leaves that question open,
      // where an error would answer it by implying the folder means something.
      const { mailboxes, errors } = await readMailboxesDirectory(
        tree({ ...HEALTHY, "org/mailboxes/announce/MAILBOX.md": STANDUP }),
      );

      expect(mailboxes.map((c) => c.id)).toEqual(["engineering.standup"]);
      expect(errors).toEqual([]);
    });

    it("reads only its own slot, and leaves the worker reader reading only its own", async () => {
      // Both readers walk `teams/<id>/`. A slot rule that judged a path by what
      // it looks like rather than by the slot it occupies would make each
      // reader report the other's folders as near-misses — an app with workers
      // AND mailboxes would boot with errors for things that are perfectly fine.
      const root = tree({
        ...HEALTHY,
        "teams/engineering/workers/lead/WORKER.md": "---\ndescription: Leads the team.\n---\n\nLead.\n",
        "teams/engineering/resources/handbook.md": "---\ndescription: How we work.\n---\n\nDoc.\n",
      });

      const fromMailboxes = await readMailboxesDirectory(root);
      expect(fromMailboxes.errors).toEqual([]);
      expect(fromMailboxes.mailboxes.map((c) => c.id)).toEqual(["engineering.standup"]);

      const fromWorkers = await readWorkforceDirectory(root);
      expect(fromWorkers.errors).toEqual([]);
      expect(fromWorkers.workers.map((w) => w.id)).toEqual(["engineering.lead"]);
    });

    it("produces records the binder can actually bind", async () => {
      // The reader's output shape is only worth anything if the consumer takes
      // it: `id` becomes the session id, `declared` is read for the kind and
      // the members, and `body` becomes the charter. Proving the reader alone
      // and the binder alone leaves exactly the gap where the two disagree —
      // a `flow:` the reader carried as something the binder cannot resolve, or
      // a key the reader passed that the binder's closed list refuses.
      const { mailboxes, errors } = await readMailboxesDirectory(tree(HEALTHY));
      expect(errors).toEqual([]);

      const instances = mailboxInstances(mailboxes);

      expect(instances.map((i) => i.id)).toEqual([MAILBOX_KIND]);
    });
  });
});
