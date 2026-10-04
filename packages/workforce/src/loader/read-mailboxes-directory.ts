/**
 * The mailboxes convention loader — read a workforce tree's mailboxes into
 * neutral records.
 *
 * Walks `<root>/teams/<teamId>/mailboxes/<mailboxName>/`, reads each mailbox's
 * `MAILBOX.md`, and returns one plain record per mailbox. Frontmatter is
 * carried verbatim, so a key a consumer claims tomorrow arrives unchanged
 * today; the only keys this reader itself reads are the dialect's own — a
 * required `description`, and the one key it refuses by name. It mints nothing
 * and registers nothing: turning a record into a running MailboxFlow instance
 * and its session is `mailboxInstances` / `openMailboxes`, and `flow:` is
 * theirs to resolve rather than this reader's to look at.
 *
 * **A mailbox is a folder, not a file** — the worker reader's shape rather than
 * the resources reader's, so a file in the `mailboxes/` slot does not occupy a
 * slot and is passed over in silence. A mailbox folder can later hold a sibling
 * file without a second convention being invented for it.
 *
 * Two rules run through the whole walk, both shared with the other readers.
 * **Symlinks are never followed**, at any level. And a path is judged by the
 * slot it occupies, not by what it looks like — a team's `workers/`,
 * `resources/` or `skills/` siblings are not mailboxes and are never reported as
 * near-misses.
 *
 * Node-only (`node:fs`), which is why it ships behind the `./loader` subpath
 * rather than the package root.
 */

import fs from "node:fs/promises";
import path from "node:path";
import {
  parseFrontmatterYaml,
  splitFrontmatter,
} from "@flow-state-dev/orchestration";
import {
  REFUSED_SYSTEM_KEY,
  REFUSED_SYSTEM_KEY_MESSAGE,
  type MailboxManifest,
} from "../manifest";
import { validateSegment } from "./segments";
import {
  IGNORED_ENTRIES,
  type PathReport,
  classify,
  openRoot,
  openStructuralDirectory,
  refusedSymlink,
  unreadable,
  walkTeams,
} from "./structural-directory";
import {
  PRE_RENAME_NAMES,
  preRenameRecordFolderProblem,
  preRenameRecordProblem,
} from "../mailbox/pre-rename";

/** The slot a mailbox folder sits in, under a team. */
const MAILBOXES_SLOT = "mailboxes";

/** The document that describes a mailbox. */
const MAILBOX_MD = "MAILBOX.md";

/**
 * Why one thing that should have produced a mailbox did not — the discriminant
 * on every entry in {@link ReadMailboxesDirectoryResult.errors}.
 *
 * Four conditions land in one flat array, and a caller that wants to tolerate
 * one class while refusing another needs to tell them apart without matching on
 * `error.message`. Every entry still carries the `path` it was observed at.
 */
export type MailboxManifestErrorKind =
  /** A structural folder — `teams`, a team, or a `mailboxes/` slot — is a symlink or is there and could not be listed. Every mailbox under it is missing. */
  | "unreadable-slot"
  /** One mailbox folder did not load: an unusable name, a symlinked folder, or a missing, unreadable or malformed `MAILBOX.md`. */
  | "mailbox-load-failed"
  /** A `MAILBOX.md` declares the refused `system:` key, so the mailbox is left out. */
  | "refused-declaration"
  /** A record file or a records folder under the name it had before mailboxes were renamed. Never read; the message names where it belongs now. */
  | "pre-rename-record";

/** One path that should have produced a mailbox and did not. */
export type MailboxManifestError = PathReport<MailboxManifestErrorKind>;

/** What `readMailboxesDirectory` hands back. */
export interface ReadMailboxesDirectoryResult {
  /** One record per mailbox that loaded, in walk order. */
  mailboxes: MailboxManifest[];
  /**
   * One entry per path that should have produced mailboxes and did not, keyed by
   * its slash-separated path relative to the root — deliberately not by an
   * identity, because a folder that breaks the segment rules has no identity to
   * be reported under.
   *
   * Usually a mailbox slot. It can also be a structural folder — `teams`,
   * `teams/<id>`, `teams/<id>/mailboxes` — when that folder is refused or
   * unreadable, because the mailboxes beneath it cannot be enumerated to be
   * named individually and silence there would hide all of them at once.
   *
   * Collected rather than thrown, for the reason the other readers collect: a
   * library that hands back data does not get to set an app's boot policy. That
   * makes treating a non-empty `errors` as fatal the caller's call to make
   * explicitly — and it is very often the right one, because a reported path is
   * a mailbox the app was supposed to have, and booting past it leaves a team
   * with nowhere to talk and nothing said about why.
   */
  errors: MailboxManifestError[];
}

/**
 * Read every `<root>/teams/<teamId>/mailboxes/<name>/` and return one neutral
 * manifest per mailbox.
 *
 * Throws only when `root` itself is refused — a symlink, or a path that cannot
 * be read at all. A configured root that does not exist, or that would take the
 * walk somewhere else entirely, is a wiring mistake, not a per-mailbox one.
 *
 * A root with no `teams/` is an empty result, and so is a team with no
 * `mailboxes/` folder: an app may declare no mailboxes in files. Everything else
 * that goes wrong lands in `errors`, so one bad folder never costs an app its
 * other mailboxes.
 */
export async function readMailboxesDirectory(
  root: string,
): Promise<ReadMailboxesDirectoryResult> {
  const mailboxes: MailboxManifest[] = [];
  const errors: MailboxManifestError[] = [];

  await openRoot(root);

  /** File a structural refusal the shared walk met on the way to a team. */
  const report = (at: string, error: Error): void => {
    errors.push({ path: at, error, kind: "unreadable-slot" });
  };

  for await (const team of walkTeams(root, report)) {
    errors.push(...(await preRenameRecords(team)));

    const slotPath = `${team.path}/${MAILBOXES_SLOT}`;
    const slot = await openStructuralDirectory(
      path.join(team.dir, MAILBOXES_SLOT),
      slotPath,
    );
    if (slot.refusal !== undefined) {
      errors.push({ path: slotPath, error: slot.refusal.error, kind: "unreadable-slot" });
    }
    if (slot.entries === undefined) continue;

    for (const mailboxName of slot.entries) {
      if (IGNORED_ENTRIES.has(mailboxName)) continue;

      const mailboxDir = path.join(team.dir, MAILBOXES_SLOT, mailboxName);
      const entryPath = `${slotPath}/${mailboxName}`;
      const entry = await classify(mailboxDir);
      // A file under `mailboxes/` does not occupy a mailbox slot — a slot is a
      // directory — so it is skipped rather than reported. Deliberately the
      // worker reader's rule and not the resources reader's inversion of it: a
      // mailbox IS a folder here, so a stray file carries no sign that anyone
      // meant it to be one.
      if (entry.kind === "absent" || entry.kind === "file") continue;

      // A record left under its old name in a renamed folder is reported as
      // what it is, rather than as a mailbox with no record.
      if (entry.kind === "directory") {
        const leftover = await classify(path.join(mailboxDir, PRE_RENAME_NAMES.recordFile));
        if (leftover.kind !== "absent") {
          const at = `${entryPath}/${PRE_RENAME_NAMES.recordFile}`;
          errors.push({
            path: at,
            error: new Error(preRenameRecordProblem(at, `${entryPath}/${MAILBOX_MD}`)),
            kind: "pre-rename-record",
          });
          continue;
        }
      }

      let loaded: MailboxManifest;
      try {
        if (entry.kind === "symlink") throw refusedSymlink("mailbox folder", mailboxName);
        if (entry.kind === "unreadable") {
          throw unreadable("Mailbox folder", mailboxName, entry.error);
        }
        loaded = await readMailboxSlot(team.id, mailboxName, mailboxDir);
      } catch (err) {
        errors.push({ path: entryPath, error: err as Error, kind: "mailbox-load-failed" });
        continue;
      }

      // A separate condition for a caller, so it is a separate branch: a folder
      // that could not be read is an author's typo, and a file declaring what
      // the declaration path decides is an author's misunderstanding. Checked
      // here rather than inside the parse so the two stay tellable apart by
      // control flow, the way the resources reader keeps them apart.
      if (Object.hasOwn(loaded.declared, REFUSED_SYSTEM_KEY)) {
        errors.push({
          path: entryPath,
          error: new Error(
            `${MAILBOX_MD} in "${mailboxName}/" ${REFUSED_SYSTEM_KEY_MESSAGE}`,
          ),
          kind: "refused-declaration",
        });
        continue;
      }

      mailboxes.push(loaded);
    }
  }

  return { mailboxes, errors };
}

/**
 * A team's records folder from before the rename, reported rather than
 * skipped: one entry per old record file in it, or one for the folder itself
 * when it holds none. Nothing in it is read as a mailbox.
 */
async function preRenameRecords(team: { dir: string; path: string }): Promise<MailboxManifestError[]> {
  const oldDir = path.join(team.dir, PRE_RENAME_NAMES.recordFolder);
  const oldPath = `${team.path}/${PRE_RENAME_NAMES.recordFolder}`;
  const newPath = `${team.path}/${MAILBOXES_SLOT}`;
  const found = await classify(oldDir);
  if (found.kind === "absent") return [];
  if (found.kind !== "directory") return [folderReport(oldPath, newPath)];

  let names: string[];
  try {
    names = (await fs.readdir(oldDir)).sort();
  } catch {
    return [folderReport(oldPath, newPath)];
  }
  const reports: MailboxManifestError[] = [];
  for (const name of names) {
    if (IGNORED_ENTRIES.has(name)) continue;
    // Only a folder can hold a record; anything else is left to the folder's own report.
    if ((await classify(path.join(oldDir, name))).kind !== "directory") continue;
    const file = await classify(path.join(oldDir, name, PRE_RENAME_NAMES.recordFile));
    if (file.kind === "absent") continue;
    const at = `${oldPath}/${name}/${PRE_RENAME_NAMES.recordFile}`;
    reports.push({
      path: at,
      error: new Error(preRenameRecordProblem(at, `${newPath}/${name}/${MAILBOX_MD}`)),
      kind: "pre-rename-record",
    });
  }
  return reports.length > 0 ? reports : [folderReport(oldPath, newPath)];
}

/** The one report for an old records folder that holds no old record file. */
function folderReport(oldPath: string, newPath: string): MailboxManifestError {
  return {
    path: oldPath,
    error: new Error(preRenameRecordFolderProblem(oldPath, newPath)),
    kind: "pre-rename-record",
  };
}

/**
 * Read one mailbox slot into a manifest. Throws when the slot cannot produce
 * one; the caller turns that into an `errors` entry keyed by the slot's path.
 */
async function readMailboxSlot(
  teamId: string,
  mailboxName: string,
  mailboxDir: string,
): Promise<MailboxManifest> {
  // Identity first: a slot whose segments break the rules has no id to be
  // reported under, so there is nothing to be gained by reading its file.
  const id = mintMailboxId(teamId, mailboxName);

  const md = await classify(path.join(mailboxDir, MAILBOX_MD));

  if (md.kind === "symlink") {
    throw refusedSymlink(MAILBOX_MD, `${mailboxName}/${MAILBOX_MD}`);
  }

  // A file that is there and unreadable is not a file that is missing: falling
  // through would read this slot as empty rather than as broken.
  if (md.kind === "unreadable") {
    throw unreadable(MAILBOX_MD, `${mailboxName}/${MAILBOX_MD}`, md.error);
  }

  // The slot is empty of the one filename this loader knows. Whatever else is
  // in the folder, the author has a route, and this message is the only place
  // they are standing when they find out — so it names the route rather than
  // just the wall. The same sentence for every such slot, for the reason the
  // worker reader gives: recognizing a second filename in order to say
  // something kinder about it is how that filename becomes a thing the
  // framework means to run.
  if (md.kind !== "file") {
    throw new Error(
      `Mailbox folder "${mailboxName}" has no ${MAILBOX_MD}. A mailbox folder declares one ` +
        `mailbox, and every mailbox is a ${MAILBOX_MD}. A mailbox that behaves differently ` +
        `is a different flow kind: define the flow in your app, pass it to mailboxInstances ` +
        `in \`kinds\`, and name it in this mailbox's \`flow:\`.`,
    );
  }

  const text = await fs.readFile(path.join(mailboxDir, MAILBOX_MD), "utf8");
  const { declared, body } = parseMailboxMd(text, mailboxName);

  return { id, declared, body };
}

/**
 * Parse a `MAILBOX.md` into its declared settings and its body. Shares the
 * `WORKER.md`/`SKILL.md` frontmatter dialect deliberately: these are the
 * convention files an author writes by hand, and a second dialect would mean
 * learning one teaches the wrong thing about the others.
 *
 * `description` is required and everything else is carried verbatim, including
 * `flow:` — which kind a mailbox runs is the binder's to resolve, and a reader
 * that checked it would be a second place an app's kinds map has to be known.
 * The one refused key is checked by the caller, which reports it as its own
 * condition.
 */
function parseMailboxMd(
  text: string,
  mailboxName: string,
): { declared: Record<string, unknown>; body: string } {
  const { yaml, body } = splitFrontmatter(text);
  if (yaml.trim().length === 0) {
    throw new Error(
      `${MAILBOX_MD} in "${mailboxName}/" has no frontmatter — a mailbox file needs at least a \`description\``,
    );
  }

  const declared = parseFrontmatterYaml(yaml);
  const description = declared["description"];
  if (typeof description !== "string" || description.trim().length === 0) {
    throw new Error(
      `${MAILBOX_MD} in "${mailboxName}/" must declare a non-empty \`description\``,
    );
  }

  return { declared, body };
}

/**
 * Mint a mailbox's whole identity from its folder: `"<teamId>.<mailboxName>"`.
 *
 * The one place this string is built. Team-qualified so two teams can each have
 * a "standup" without coordinating names, and dot-joined for the reason a
 * worker id is: the identity becomes a flow instance id and, for a mailbox,
 * literally its session id, and a `/` in one survives registration and then
 * fails to address.
 *
 * Throws when either segment breaks the rules, naming the rule: an id that
 * cannot be addressed is worse than a startup failure.
 */
function mintMailboxId(teamId: string, mailboxName: string): string {
  validateSegment(teamId, "Team");
  validateSegment(mailboxName, "Mailbox");
  return `${teamId}.${mailboxName}`;
}
