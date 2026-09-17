/**
 * Specs for the channels convention loader: a folder with a `CHANNEL.md` in a
 * team's `channels/` slot becomes one neutral channel record.
 *
 * Same discipline as the worker and resources readers' specs — every tree is a
 * real temp directory read through the real function, because the behaviours
 * under test (what a symlink does, what an unreadable folder does) are
 * filesystem behaviours. BP-035: each failing case sits in the same tree as a
 * healthy channel, so a spec proves isolation and not just that the bad path
 * errors.
 *
 * What these specs are FOR, beyond "the function works":
 *
 * - A channel id is not a label. It becomes the flow instance id the binder
 *   registers and literally the session id the transcript lives in, so a spec
 *   that pins the minted id is pinning where an app's messages are stored.
 * - `errors` is collected rather than thrown because the caller owns boot
 *   policy. That only helps if a bad channel costs the app exactly that
 *   channel, which is why every failure spec keeps a healthy one beside it.
 * - `system:` is refused because a channel is a system channel by virtue of
 *   where it was declared. A file that could type it could mint an undeletable
 *   channel, so the refusal is a permissions rule wearing a parser's clothes.
 */
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import fsp from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readChannelsDirectory, readWorkforceDirectory } from "../src/loader";
import { CHANNEL_KIND, channelInstances } from "../src/index";

const roots: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of roots.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** A tree written from `{ "relative/path": contents }`. Directories are implied. */
function tree(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "fsd-channels-"));
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
flow: channel
members: [engineering.lead, engineering.analyst]
---

Post what you finished, what you're on, and what's blocking you.
`;

/** A healthy channel that must survive every failure spec in the same tree. */
const HEALTHY = { "teams/engineering/channels/standup/CHANNEL.md": STANDUP };

describe("readChannelsDirectory", () => {
  it("turns a team's channel folder into a record carrying what the file declared", async () => {
    const { channels, errors } = await readChannelsDirectory(tree(HEALTHY));

    expect(errors).toEqual([]);
    expect(channels).toHaveLength(1);
    // Team-qualified and dot-joined: this string is the flow instance id and
    // the session id, not a display name.
    expect(channels[0]!.id).toBe("engineering.standup");
    // Verbatim, `flow:` included — the reader does not resolve a kind, and a
    // key nobody has claimed yet still has to arrive unchanged.
    expect(channels[0]!.declared).toEqual({
      description: "Where the engineering team posts daily status.",
      flow: "channel",
      members: ["engineering.lead", "engineering.analyst"],
    });
    expect(channels[0]!.body).toBe(
      "Post what you finished, what you're on, and what's blocking you.\n",
    );
  });

  it("qualifies every channel by its team, so two teams can each have a standup", async () => {
    const { channels, errors } = await readChannelsDirectory(
      tree({
        ...HEALTHY,
        "teams/engineering/channels/incidents/CHANNEL.md": STANDUP,
        "teams/marketing/channels/standup/CHANNEL.md": STANDUP,
      }),
    );

    expect(errors).toEqual([]);
    expect(channels.map((c) => c.id).sort()).toEqual([
      "engineering.incidents",
      "engineering.standup",
      "marketing.standup",
    ]);
  });

  it("reads a tree with no channels as empty rather than as broken", async () => {
    // Three shapes of "this app declares no channels in files", none of which
    // is a mistake: no `teams/` at all, a team with no `channels/` folder, and
    // an empty `channels/` folder.
    const noTeams = await readChannelsDirectory(tree({ "README.md": "not a tree" }));
    expect(noTeams).toEqual({ channels: [], errors: [] });

    const noSlot = await readChannelsDirectory(
      tree({ "teams/engineering/workers/lead/WORKER.md": "---\ndescription: Leads.\n---\n" }),
    );
    expect(noSlot).toEqual({ channels: [], errors: [] });

    const emptyRoot = tree({ "README.md": "not a tree" });
    dir(emptyRoot, "teams/engineering/channels");
    expect(await readChannelsDirectory(emptyRoot)).toEqual({ channels: [], errors: [] });
  });

  it("throws only when the root itself cannot be read", async () => {
    // The root is a wiring mistake, not a channel-shaped one: there is no
    // per-channel path to report it under, and returning empty would boot an
    // app with no channels and nothing said.
    await expect(
      readChannelsDirectory(join(tmpdir(), "fsd-channels-absent-root")),
    ).rejects.toThrow(/Failed to read/);
  });

  it("refuses a symlinked root without following it", async () => {
    // The root is the one level a bare `readdir` would follow. Every nested
    // structural folder is classified first, so `teams -> /outside` is refused;
    // a root that is itself a link has to be refused the same way, or the whole
    // tree comes from somewhere the caller never configured.
    const root = tree({ "real/teams/engineering/channels/standup/CHANNEL.md": STANDUP });
    symlinkSync(join(root, "real"), join(root, "linked"));

    // Control: the tree behind the link loads perfectly, so the refusal below
    // is the symlink and not a broken fixture.
    const direct = await readChannelsDirectory(join(root, "real"));
    expect(direct.channels.map((c) => c.id)).toEqual(["engineering.standup"]);

    await expect(readChannelsDirectory(join(root, "linked"))).rejects.toThrow(/Symlinked/);
  });

  // R1 — the worker reader's error contract, on the channels path. Each case
  // shares a tree with the healthy channel, which must still load: that is the
  // whole promise of collecting errors instead of throwing.
  describe("honours the worker reader's error contract", () => {
    it("reports a channel folder with no CHANNEL.md, naming the route out", async () => {
      const root = tree({ ...HEALTHY, "teams/engineering/channels/lounge/README.md": "hi" });
      const { channels, errors } = await readChannelsDirectory(root);

      expect(channels.map((c) => c.id)).toEqual(["engineering.standup"]);
      expect(errors).toHaveLength(1);
      expect(errors[0]!.path).toBe("teams/engineering/channels/lounge");
      expect(errors[0]!.kind).toBe("channel-load-failed");
      // An author standing here needs the route, not just the wall: a channel
      // that behaves differently is a different flow kind, not a different
      // filename.
      expect(errors[0]!.error.message).toMatch(/has no CHANNEL\.md/);
      expect(errors[0]!.error.message).toMatch(/channelInstances/);
    });

    it("reports a CHANNEL.md with no frontmatter", async () => {
      const root = tree({
        ...HEALTHY,
        "teams/engineering/channels/lounge/CHANNEL.md": "# Just a body\n",
      });
      const { channels, errors } = await readChannelsDirectory(root);

      expect(channels.map((c) => c.id)).toEqual(["engineering.standup"]);
      expect(errors).toHaveLength(1);
      expect(errors[0]!.path).toBe("teams/engineering/channels/lounge");
      expect(errors[0]!.kind).toBe("channel-load-failed");
      expect(errors[0]!.error.message).toMatch(/no frontmatter/);
    });

    it("reports a `description` that is missing or empty", async () => {
      const root = tree({
        ...HEALTHY,
        "teams/engineering/channels/lounge/CHANNEL.md": "---\nflow: channel\n---\n\nbody\n",
        "teams/marketing/channels/blank/CHANNEL.md": '---\ndescription: "   "\n---\n\nbody\n',
      });
      const { channels, errors } = await readChannelsDirectory(root);

      expect(channels.map((c) => c.id)).toEqual(["engineering.standup"]);
      expect(errors.map((e) => e.path).sort()).toEqual([
        "teams/engineering/channels/lounge",
        "teams/marketing/channels/blank",
      ]);
      for (const entry of errors) {
        expect(entry.kind).toBe("channel-load-failed");
        expect(entry.error.message).toMatch(/non-empty `description`/);
      }
    });

    it("reports a channel folder name that breaks the segment rules, in channel terms", async () => {
      const root = tree({ ...HEALTHY, "teams/engineering/channels/Stand Up/CHANNEL.md": STANDUP });
      const { channels, errors } = await readChannelsDirectory(root);

      expect(channels.map((c) => c.id)).toEqual(["engineering.standup"]);
      expect(errors).toHaveLength(1);
      expect(errors[0]!.path).toBe("teams/engineering/channels/Stand Up");
      expect(errors[0]!.kind).toBe("channel-load-failed");
      expect(errors[0]!.error.message).toMatch(/lowercase letters, digits, and single hyphens/);
      // The label the validator is called with, pinned: a channel folder told
      // it is a bad "Worker folder name" sends the author looking in the wrong
      // slot, and the reason the rule exists is the channel's own id.
      expect(errors[0]!.error.message).toMatch(/^Channel folder name/);
      expect(errors[0]!.error.message).toMatch(/channel's identity/);
    });

    it("reports a team folder name that breaks the segment rules", async () => {
      const root = tree({ ...HEALTHY, "teams/Engineering/channels/standup/CHANNEL.md": STANDUP });
      const { channels, errors } = await readChannelsDirectory(root);

      expect(channels.map((c) => c.id)).toEqual(["engineering.standup"]);
      expect(errors).toHaveLength(1);
      expect(errors[0]!.path).toBe("teams/Engineering/channels/standup");
      expect(errors[0]!.kind).toBe("channel-load-failed");
      expect(errors[0]!.error.message).toMatch(/lowercase letters, digits, and single hyphens/);
    });

    it("refuses a symlinked channel folder without following it", async () => {
      const root = tree({ ...HEALTHY, "outside/CHANNEL.md": STANDUP });
      symlinkSync(join(root, "outside"), join(root, "teams/engineering/channels/linked"));

      const { channels, errors } = await readChannelsDirectory(root);

      expect(channels.map((c) => c.id)).toEqual(["engineering.standup"]);
      expect(errors).toHaveLength(1);
      expect(errors[0]!.path).toBe("teams/engineering/channels/linked");
      expect(errors[0]!.kind).toBe("channel-load-failed");
      expect(errors[0]!.error.message).toMatch(/Symlinked/);
    });

    it("refuses a symlinked CHANNEL.md without following it", async () => {
      const root = tree({ ...HEALTHY, "outside/secret.md": STANDUP });
      dir(root, "teams/engineering/channels/lounge");
      symlinkSync(
        join(root, "outside/secret.md"),
        join(root, "teams/engineering/channels/lounge/CHANNEL.md"),
      );

      const { channels, errors } = await readChannelsDirectory(root);

      expect(channels.map((c) => c.id)).toEqual(["engineering.standup"]);
      expect(errors).toHaveLength(1);
      expect(errors[0]!.path).toBe("teams/engineering/channels/lounge");
      expect(errors[0]!.kind).toBe("channel-load-failed");
      expect(errors[0]!.error.message).toMatch(/Symlinked/);
    });

    it("reports a symlinked `teams/` once, rather than reading the tree as empty", async () => {
      // The one level where a refusal costs the app EVERY channel. There is no
      // healthy channel to survive beside it — which is the point: without the
      // report, an app with a misconfigured tree boots with zero channels and
      // an empty `errors` for its fatal check to look at.
      const root = tree({ "outside/teams/engineering/channels/standup/CHANNEL.md": STANDUP });
      symlinkSync(join(root, "outside/teams"), join(root, "teams"));

      const { channels, errors } = await readChannelsDirectory(root);

      expect(channels).toEqual([]);
      expect(errors).toHaveLength(1);
      expect(errors[0]!.path).toBe("teams");
      expect(errors[0]!.kind).toBe("unreadable-slot");
      expect(errors[0]!.error.message).toMatch(/Symlinked/);
    });

    it("refuses a symlinked channels slot without following it", async () => {
      const root = tree({ ...HEALTHY, "outside/standup/CHANNEL.md": STANDUP });
      dir(root, "teams/marketing");
      symlinkSync(join(root, "outside"), join(root, "teams/marketing/channels"));

      const { channels, errors } = await readChannelsDirectory(root);

      expect(channels.map((c) => c.id)).toEqual(["engineering.standup"]);
      expect(errors).toHaveLength(1);
      expect(errors[0]!.path).toBe("teams/marketing/channels");
      expect(errors[0]!.kind).toBe("unreadable-slot");
      expect(errors[0]!.error.message).toMatch(/Symlinked/);
    });

    it("reports a structural folder that exists and cannot be listed, under its own path", async () => {
      // Only genuine absence may read as empty. Every other `readdir` failure
      // has to stay visible, or a whole team's channels drop out with the
      // caller's fatal-on-errors guard unable to see it. ENOTDIR stands in for
      // the class here because the suite runs as root, where a permission bit
      // would not deny us anything; EACCES takes the same branch.
      const { channels, errors } = await readChannelsDirectory(
        tree({ ...HEALTHY, "teams/marketing/channels": "not a directory\n" }),
      );

      expect(channels.map((c) => c.id)).toEqual(["engineering.standup"]);
      expect(errors).toHaveLength(1);
      expect(errors[0]!.path).toBe("teams/marketing/channels");
      expect(errors[0]!.kind).toBe("unreadable-slot");
      expect(errors[0]!.error.message).toMatch(/could not be read/i);
    });

    it("reports an unreadable channel folder rather than skipping it", async () => {
      // `absent` and `unreadable` stay apart for exactly this case: folded
      // together, a folder we cannot stat would be skipped in silence and the
      // channel would simply not exist.
      const root = tree({ ...HEALTHY, "teams/engineering/channels/locked/CHANNEL.md": STANDUP });
      const locked = join(root, "teams/engineering/channels/locked");
      const real = fsp.lstat.bind(fsp);
      vi.spyOn(fsp, "lstat").mockImplementation(((target: Parameters<typeof real>[0]) => {
        if (String(target) === locked) {
          const err = new Error(`EACCES: permission denied, lstat '${locked}'`);
          (err as NodeJS.ErrnoException).code = "EACCES";
          return Promise.reject(err);
        }
        return real(target);
      }) as unknown as typeof fsp.lstat);

      const { channels, errors } = await readChannelsDirectory(root);

      expect(channels.map((c) => c.id)).toEqual(["engineering.standup"]);
      expect(errors).toHaveLength(1);
      expect(errors[0]!.path).toBe("teams/engineering/channels/locked");
      expect(errors[0]!.kind).toBe("channel-load-failed");
      expect(errors[0]!.error.message).toMatch(/could not be read/i);
    });

    it("reports an unreadable CHANNEL.md as unreadable, not as missing", async () => {
      // The distinction the whole `absent`/`unreadable` split exists for, at
      // the file level. Folded together, a CHANNEL.md we cannot stat is
      // reported as a folder that has none — which sends the author to write a
      // file that is already sitting there.
      const root = tree({ ...HEALTHY, "teams/engineering/channels/locked/CHANNEL.md": STANDUP });
      const locked = join(root, "teams/engineering/channels/locked/CHANNEL.md");
      const real = fsp.lstat.bind(fsp);
      vi.spyOn(fsp, "lstat").mockImplementation(((target: Parameters<typeof real>[0]) => {
        if (String(target) === locked) {
          const err = new Error(`EACCES: permission denied, lstat '${locked}'`);
          (err as NodeJS.ErrnoException).code = "EACCES";
          return Promise.reject(err);
        }
        return real(target);
      }) as unknown as typeof fsp.lstat);

      const { channels, errors } = await readChannelsDirectory(root);

      expect(channels.map((c) => c.id)).toEqual(["engineering.standup"]);
      expect(errors).toHaveLength(1);
      expect(errors[0]!.path).toBe("teams/engineering/channels/locked");
      expect(errors[0]!.kind).toBe("channel-load-failed");
      expect(errors[0]!.error.message).toMatch(/CHANNEL\.md .*could not be read/i);
      expect(errors[0]!.error.message).not.toMatch(/has no CHANNEL\.md/);
    });

    it("ignores editor and OS droppings, before they are read as names", async () => {
      // A dropping that is a FILE is already skipped by the slot rule, so the
      // ignore list only shows its hand on one that is a directory: without it,
      // `.DS_Store` reaches the segment validator and an app boots with an
      // error about a file nobody wrote.
      const root = tree({ ...HEALTHY, "teams/.DS_Store": "junk" });
      dir(root, "teams/engineering/channels/.DS_Store");

      const { channels, errors } = await readChannelsDirectory(root);

      expect(errors).toEqual([]);
      expect(channels.map((c) => c.id)).toEqual(["engineering.standup"]);
    });

    it("skips a file in the channels slot in silence", async () => {
      // The deliberate divergence from the resources reader, which reports a
      // DIRECTORY in its slot because a resource is a file. Here a channel IS a
      // folder, so a loose file carries no sign anyone meant it to be a
      // channel — and reporting it would make `channels/README.md` an error.
      const root = tree({
        ...HEALTHY,
        "teams/engineering/channels/README.md": "how this team's channels work\n",
        "teams/engineering/channels/notes.txt": "scratch",
      });

      const { channels, errors } = await readChannelsDirectory(root);

      expect(errors).toEqual([]);
      expect(channels.map((c) => c.id)).toEqual(["engineering.standup"]);
    });
  });

  // R2 — the one error class this convention adds. `system` is derived from
  // where a channel was declared; a file that could declare it could mint a
  // channel the delete verb will later refuse to remove.
  describe("refuses a file that declares its own `system` status", () => {
    it("reports a CHANNEL.md declaring `system:`, naming the file and the rule", async () => {
      const root = tree({
        ...HEALTHY,
        "teams/engineering/channels/general/CHANNEL.md":
          "---\ndescription: Tries to make itself undeletable.\nsystem: true\n---\n\nbody\n",
      });

      const { channels, errors } = await readChannelsDirectory(root);

      expect(channels.map((c) => c.id)).toEqual(["engineering.standup"]);
      expect(errors).toHaveLength(1);
      expect(errors[0]!.path).toBe("teams/engineering/channels/general");
      // Its own condition, not folded into the load failures: an author who
      // mistyped a folder and an author who misunderstood the model need
      // telling apart by a caller, without matching on `error.message`.
      expect(errors[0]!.kind).toBe("refused-declaration");
      expect(errors[0]!.error.message).toContain("CHANNEL.md in \"general/\"");
      expect(errors[0]!.error.message).toMatch(/not a setting a channel declares/);
      expect(errors[0]!.error.message).toMatch(/Where a channel is declared is what decides it/);
    });

    it("refuses `system: false` too — the key is refused, not its value", async () => {
      // A file declaring `system: false` is not harmless: it is the same author
      // believing the file decides, and carried verbatim it would reach a
      // reconciler that has to guess whether the author meant it.
      const root = tree({
        ...HEALTHY,
        "teams/engineering/channels/general/CHANNEL.md":
          "---\ndescription: Believes it can opt out.\nsystem: false\n---\n\nbody\n",
      });

      const { channels, errors } = await readChannelsDirectory(root);

      expect(channels.map((c) => c.id)).toEqual(["engineering.standup"]);
      expect(errors).toHaveLength(1);
      expect(errors[0]!.kind).toBe("refused-declaration");
    });

    it("leaves every other unclaimed key alone", async () => {
      // The refusal is one key by name, not a closed list: this reader's job is
      // to carry what it does not understand, so the consumer that claims a key
      // tomorrow finds it unchanged. `system` is the single exception, and the
      // gatekeeping of what a channel may declare belongs to the binder.
      const root = tree({
        "teams/engineering/channels/standup/CHANNEL.md":
          "---\ndescription: Daily status.\ntopic: status\nretention: 30d\n---\n\nbody\n",
      });

      const { channels, errors } = await readChannelsDirectory(root);

      expect(errors).toEqual([]);
      expect(channels[0]!.declared).toEqual({
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
    it("reads only its own slot, and leaves the worker reader reading only its own", async () => {
      // Both readers walk `teams/<id>/`. A slot rule that judged a path by what
      // it looks like rather than by the slot it occupies would make each
      // reader report the other's folders as near-misses — an app with workers
      // AND channels would boot with errors for things that are perfectly fine.
      const root = tree({
        ...HEALTHY,
        "teams/engineering/workers/lead/WORKER.md": "---\ndescription: Leads the team.\n---\n\nLead.\n",
        "teams/engineering/resources/handbook.md": "---\ndescription: How we work.\n---\n\nDoc.\n",
      });

      const fromChannels = await readChannelsDirectory(root);
      expect(fromChannels.errors).toEqual([]);
      expect(fromChannels.channels.map((c) => c.id)).toEqual(["engineering.standup"]);

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
      const { channels, errors } = await readChannelsDirectory(tree(HEALTHY));
      expect(errors).toEqual([]);

      const instances = channelInstances(channels);

      expect(instances.map((i) => i.id)).toEqual([CHANNEL_KIND]);
    });
  });
});
