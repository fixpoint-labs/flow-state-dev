/**
 * The channels convention loader — read a workforce tree's channels into
 * neutral records.
 *
 * Walks `<root>/teams/<teamId>/channels/<channelName>/`, reads each channel's
 * `CHANNEL.md`, and returns one plain record per channel. Frontmatter is
 * carried verbatim, so a key a consumer claims tomorrow arrives unchanged
 * today; the only keys this reader itself reads are the dialect's own — a
 * required `description`, and the one key it refuses by name. It mints nothing
 * and registers nothing: turning a record into a running ChannelFlow instance
 * and its session is `channelInstances` / `openChannels`, and `flow:` is
 * theirs to resolve rather than this reader's to look at.
 *
 * **A channel is a folder, not a file** — the worker reader's shape rather than
 * the resources reader's, so a file in the `channels/` slot does not occupy a
 * slot and is passed over in silence. A channel folder can later hold a sibling
 * file without a second convention being invented for it.
 *
 * Two rules run through the whole walk, both shared with the other readers.
 * **Symlinks are never followed**, at any level. And a path is judged by the
 * slot it occupies, not by what it looks like — a team's `workers/`,
 * `resources/` or `skills/` siblings are not channels and are never reported as
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
  type ChannelManifest,
} from "../manifest";
import { validateSegment } from "./segments";
import {
  type PathReport,
  classify,
  openStructuralDirectory,
  refusedSymlink,
  unreadable,
} from "./structural-directory";

/** Filenames that are never a channel folder — editor and OS droppings. */
const IGNORED_ENTRIES = new Set([".DS_Store", "Thumbs.db"]);

/** The slot a channel folder sits in, under a team. */
const CHANNELS_SLOT = "channels";

/** The document that describes a channel. */
const CHANNEL_MD = "CHANNEL.md";

/**
 * Why one thing that should have produced a channel did not — the discriminant
 * on every entry in {@link ReadChannelsDirectoryResult.errors}.
 *
 * Three conditions land in one flat array, and a caller that wants to tolerate
 * one class while refusing another needs to tell them apart without matching on
 * `error.message`. Every entry still carries the `path` it was observed at.
 */
export type ChannelManifestErrorKind =
  /** A structural folder — `teams`, a team, or a `channels/` slot — is a symlink or is there and could not be listed. Every channel under it is missing. */
  | "unreadable-slot"
  /** One channel folder did not load: an unusable name, a symlinked folder, or a missing, unreadable or malformed `CHANNEL.md`. */
  | "channel-load-failed"
  /** A `CHANNEL.md` declares the refused `system:` key, so the channel is left out. */
  | "refused-declaration";

/** One path that should have produced a channel and did not. */
export type ChannelManifestError = PathReport<ChannelManifestErrorKind>;

/** What `readChannelsDirectory` hands back. */
export interface ReadChannelsDirectoryResult {
  /** One record per channel that loaded, in walk order. */
  channels: ChannelManifest[];
  /**
   * One entry per path that should have produced channels and did not, keyed by
   * its slash-separated path relative to the root — deliberately not by an
   * identity, because a folder that breaks the segment rules has no identity to
   * be reported under.
   *
   * Usually a channel slot. It can also be a structural folder — `teams`,
   * `teams/<id>`, `teams/<id>/channels` — when that folder is refused or
   * unreadable, because the channels beneath it cannot be enumerated to be
   * named individually and silence there would hide all of them at once.
   *
   * Collected rather than thrown, for the reason the other readers collect: a
   * library that hands back data does not get to set an app's boot policy. That
   * makes treating a non-empty `errors` as fatal the caller's call to make
   * explicitly — and it is very often the right one, because a reported path is
   * a channel the app was supposed to have, and booting past it leaves a team
   * with nowhere to talk and nothing said about why.
   */
  errors: ChannelManifestError[];
}

/**
 * Read every `<root>/teams/<teamId>/channels/<name>/` and return one neutral
 * manifest per channel.
 *
 * Throws only when `root` itself is refused — a symlink, or a path that cannot
 * be read at all. A configured root that does not exist, or that would take the
 * walk somewhere else entirely, is a wiring mistake, not a per-channel one.
 *
 * A root with no `teams/` is an empty result, and so is a team with no
 * `channels/` folder: an app may declare no channels in files. Everything else
 * that goes wrong lands in `errors`, so one bad folder never costs an app its
 * other channels.
 */
export async function readChannelsDirectory(
  root: string,
): Promise<ReadChannelsDirectoryResult> {
  const channels: ChannelManifest[] = [];
  const errors: ChannelManifestError[] = [];

  // The root is classified before it is listed, for the reason every nested
  // structural folder is: a bare `readdir` follows a symlink, and a symlinked
  // root would load the whole tree from somewhere the caller never configured.
  // It throws rather than landing in `errors` because the root is the one level
  // whose failure is a wiring mistake, not a channel-shaped one.
  if ((await classify(root)).kind === "symlink") {
    throw refusedSymlink("workforce directory", root);
  }

  try {
    await fs.readdir(root);
  } catch (err) {
    throw new Error(
      `Failed to read workforce directory "${root}": ${(err as Error).message}`,
    );
  }

  const teams = await openStructuralDirectory(path.join(root, "teams"), "teams");
  if (teams.refusal !== undefined) {
    errors.push({ path: "teams", error: teams.refusal.error, kind: "unreadable-slot" });
  }
  if (teams.entries === undefined) return { channels, errors };

  for (const teamId of teams.entries) {
    if (IGNORED_ENTRIES.has(teamId)) continue;

    const teamDir = path.join(root, "teams", teamId);
    const teamPath = `teams/${teamId}`;
    const team = await classify(teamDir);
    if (team.kind === "symlink") {
      errors.push({
        path: teamPath,
        error: refusedSymlink("team folder", teamId),
        kind: "unreadable-slot",
      });
      continue;
    }
    if (team.kind === "unreadable") {
      errors.push({
        path: teamPath,
        error: unreadable("Team folder", teamId, team.error),
        kind: "unreadable-slot",
      });
      continue;
    }
    if (team.kind !== "directory") continue;

    const slotPath = `${teamPath}/${CHANNELS_SLOT}`;
    const slot = await openStructuralDirectory(
      path.join(teamDir, CHANNELS_SLOT),
      slotPath,
    );
    if (slot.refusal !== undefined) {
      errors.push({ path: slotPath, error: slot.refusal.error, kind: "unreadable-slot" });
    }
    if (slot.entries === undefined) continue;

    for (const channelName of slot.entries) {
      if (IGNORED_ENTRIES.has(channelName)) continue;

      const channelDir = path.join(teamDir, CHANNELS_SLOT, channelName);
      const entryPath = `${slotPath}/${channelName}`;
      const entry = await classify(channelDir);
      // A file under `channels/` does not occupy a channel slot — a slot is a
      // directory — so it is skipped rather than reported. Deliberately the
      // worker reader's rule and not the resources reader's inversion of it: a
      // channel IS a folder here, so a stray file carries no sign that anyone
      // meant it to be one.
      if (entry.kind === "absent" || entry.kind === "file") continue;

      let loaded: ChannelManifest;
      try {
        if (entry.kind === "symlink") throw refusedSymlink("channel folder", channelName);
        if (entry.kind === "unreadable") {
          throw unreadable("Channel folder", channelName, entry.error);
        }
        loaded = await readChannelSlot(teamId, channelName, channelDir);
      } catch (err) {
        errors.push({ path: entryPath, error: err as Error, kind: "channel-load-failed" });
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
            `${CHANNEL_MD} in "${channelName}/" ${REFUSED_SYSTEM_KEY_MESSAGE}`,
          ),
          kind: "refused-declaration",
        });
        continue;
      }

      channels.push(loaded);
    }
  }

  return { channels, errors };
}

/**
 * Read one channel slot into a manifest. Throws when the slot cannot produce
 * one; the caller turns that into an `errors` entry keyed by the slot's path.
 */
async function readChannelSlot(
  teamId: string,
  channelName: string,
  channelDir: string,
): Promise<ChannelManifest> {
  // Identity first: a slot whose segments break the rules has no id to be
  // reported under, so there is nothing to be gained by reading its file.
  const id = mintChannelId(teamId, channelName);

  const md = await classify(path.join(channelDir, CHANNEL_MD));

  if (md.kind === "symlink") {
    throw refusedSymlink(CHANNEL_MD, `${channelName}/${CHANNEL_MD}`);
  }

  // A file that is there and unreadable is not a file that is missing: falling
  // through would read this slot as empty rather than as broken.
  if (md.kind === "unreadable") {
    throw unreadable(CHANNEL_MD, `${channelName}/${CHANNEL_MD}`, md.error);
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
      `Channel folder "${channelName}" has no ${CHANNEL_MD}. A channel folder declares one ` +
        `channel, and every channel is a ${CHANNEL_MD}. A channel that behaves differently ` +
        `is a different flow kind: define the flow in your app, pass it to channelInstances ` +
        `in \`kinds\`, and name it in this channel's \`flow:\`.`,
    );
  }

  const text = await fs.readFile(path.join(channelDir, CHANNEL_MD), "utf8");
  const { declared, body } = parseChannelMd(text, channelName);

  return { id, declared, body };
}

/**
 * Parse a `CHANNEL.md` into its declared settings and its body. Shares the
 * `WORKER.md`/`SKILL.md` frontmatter dialect deliberately: these are the
 * convention files an author writes by hand, and a second dialect would mean
 * learning one teaches the wrong thing about the others.
 *
 * `description` is required and everything else is carried verbatim, including
 * `flow:` — which kind a channel runs is the binder's to resolve, and a reader
 * that checked it would be a second place an app's kinds map has to be known.
 * The one refused key is checked by the caller, which reports it as its own
 * condition.
 */
function parseChannelMd(
  text: string,
  channelName: string,
): { declared: Record<string, unknown>; body: string } {
  const { yaml, body } = splitFrontmatter(text);
  if (yaml.trim().length === 0) {
    throw new Error(
      `${CHANNEL_MD} in "${channelName}/" has no frontmatter — a channel file needs at least a \`description\``,
    );
  }

  const declared = parseFrontmatterYaml(yaml);
  const description = declared["description"];
  if (typeof description !== "string" || description.trim().length === 0) {
    throw new Error(
      `${CHANNEL_MD} in "${channelName}/" must declare a non-empty \`description\``,
    );
  }

  return { declared, body };
}

/**
 * Mint a channel's whole identity from its folder: `"<teamId>.<channelName>"`.
 *
 * The one place this string is built. Team-qualified so two teams can each have
 * a "standup" without coordinating names, and dot-joined for the reason a
 * worker id is: the identity becomes a flow instance id and, for a channel,
 * literally its session id, and a `/` in one survives registration and then
 * fails to address.
 *
 * Throws when either segment breaks the rules, naming the rule: an id that
 * cannot be addressed is worse than a startup failure.
 */
function mintChannelId(teamId: string, channelName: string): string {
  validateSegment(teamId, "Team");
  validateSegment(channelName, "Channel");
  return `${teamId}.${channelName}`;
}
