/**
 * The rename guard (`scripts/check-mailbox-rename.mjs`), held to the failures
 * it exists for.
 *
 * Each case starts from a fixture tree the guard passes, then plants one thing
 * and asserts the guard fails on exactly that. A guard only ever seen green
 * proves nothing, and twice a survivor rule absorbed a product line, so the
 * planted product line lands in a file whose other lines ARE survivors.
 */
import { describe, expect, it } from "vitest";
import {
  scanTree,
  // @ts-expect-error — root check script, plain .mjs with no type declarations.
} from "../../../scripts/check-mailbox-rename.mjs";

type Scan = {
  unclassified: string[];
  productHits: Array<{ path: string; line: number; text: string }>;
  pathHits: string[];
  ok: boolean;
};

const scan = (files: Record<string, string>, extra: { paths?: string[] } = {}): Scan =>
  (scanTree as (tree: unknown) => Scan)({
    files: new Map(Object.entries(files)),
    paths: [...Object.keys(files), ...(extra.paths ?? [])],
    published: new Set(["workforce", "bullmq"]),
  });

/** A tree the guard passes: a survivor-only file, a renamed API file, an allowlisted one. */
const GREEN = {
  "packages/bullmq/src/stream-bridge.ts": "const channel = eventChannel(requestId);\n// events to a channel per request\n",
  "packages/workforce/src/mailbox/mailbox-flow.ts": "export const MAILBOX_KIND = \"mailbox\";\n",
  "packages/workforce/src/mailbox/pre-rename.ts": "export const OLD = { kind: \"channel\" };\n",
  "packages/workforce/README.md": "## Mailboxes\n\nOne conversation.\n\n### Upgrading from channels\n\nRename `CHANNEL.md`.\n",
};

/** The docs half: the mailboxes page with its upgrade section, and the redirect from the old page. */
const MAILBOXES_PAGE = "apps/docs/docs/workforce/mailboxes.md";
const DOCS: Record<string, string> = {
  [MAILBOXES_PAGE]: [
    "## Errors",
    "",
    "| `kind` | When |",
    "|--------|------|",
    "| `pre-rename-record` | A `CHANNEL.md`, or a team's `channels/` folder, from before mailboxes were renamed. One entry per old file, or one for a folder holding none, and the message names where it belongs now. Nothing in it is read. See [Upgrading from channels](#upgrading-from-channels). |",
    "",
    "## Upgrading from channels",
    "",
    "Mailboxes used to be called channels, everywhere.",
    "",
    "## What mailboxes do not do yet",
    "",
    "No join or leave.",
  ].join("\n"),
  "apps/docs/docusaurus.config.ts": [
    "      // The Workforce channels page became the mailboxes page.",
    "          {",
    '            from: "/docs/workforce/channels",',
    '            to: "/docs/workforce/mailboxes",',
    "          },",
  ].join("\n"),
};

describe("check-mailbox-rename", () => {
  it("passes the green fixture", () => {
    expect(scan(GREEN)).toMatchObject({ ok: true, productHits: [], pathHits: [], unclassified: [] });
  });

  it("counts a product line planted among survivors, rather than letting the file's survivor rule absorb it", () => {
    const planted = {
      ...GREEN,
      "packages/bullmq/src/stream-bridge.ts": `${GREEN["packages/bullmq/src/stream-bridge.ts"]}// a post on the support channel wakes its member seats\n`,
    };
    const result = scan(planted);
    expect(result.ok).toBe(false);
    expect(result.productHits).toEqual([
      { path: "packages/bullmq/src/stream-bridge.ts", line: 3, text: "// a post on the support channel wakes its member seats" },
    ]);
  });

  it("counts a wire-shaped field, which is how the pipe is spelled in code", () => {
    const result = scan({ ...GREEN, "packages/workforce/src/roster.ts": "  channels: z.array(z.unknown()),\n" });
    expect(result.productHits.map((hit) => hit.path)).toEqual(["packages/workforce/src/roster.ts"]);
  });

  it("fails on a record left under its old name even when its text never says the word", () => {
    const result = scan({ ...GREEN, "goals/zz/teams/eng/channels/feature/MAILBOX.md": "Post what you finished.\n" });
    expect(result.ok).toBe(false);
    expect(result.productHits).toEqual([]);
    expect(result.pathHits).toEqual(["goals/zz/teams/eng/channels/feature/MAILBOX.md"]);
  });

  it("fails on a file that says the word and belongs to no group", () => {
    const result = scan({ ...GREEN, "zz-planted/new-surface.ts": "export const kind = \"channel\";\n" });
    expect(result.unclassified).toEqual(["zz-planted/new-surface.ts"]);
    expect(result.ok).toBe(false);
  });

  it("reads the README past its upgrade section", () => {
    const readme = `${GREEN["packages/workforce/README.md"]}\n## Boards\n\nA channel holds a board.\n`;
    const result = scan({ ...GREEN, "packages/workforce/README.md": readme });
    expect(result.productHits).toEqual([{ path: "packages/workforce/README.md", line: 11, text: "A channel holds a board." }]);
  });

  it("reads the docs site like the code: a page that calls the mailbox a channel fails", () => {
    const site = { ...GREEN, "apps/docs/docs/workforce/overview.md": "A channel is a conversation.\n" };
    expect(scan(site).productHits).toEqual([
      { path: "apps/docs/docs/workforce/overview.md", line: 1, text: "A channel is a conversation." },
    ]);
  });

  it("holds a docs-site survivor phrase to the one page it covers, so a pipe sentence elsewhere that shares it still counts", () => {
    const line = "A mailbox gives every writer a channel back in.";
    const result = scan({ ...GREEN, "apps/docs/docs/workforce/overview.md": `${line}\n` });
    expect(result.productHits).toEqual([{ path: "apps/docs/docs/workforce/overview.md", line: 1, text: line }]);
  });

  it("lets the mailboxes page name the old words only in its upgrade section and the lines that point there", () => {
    expect(scan({ ...GREEN, ...DOCS })).toMatchObject({ ok: true, productHits: [], pathHits: [], unclassified: [] });

    // The same pipe-meaning sentence, planted past the upgrade section, counts.
    const planted = `${DOCS[MAILBOXES_PAGE]}\nA post on the support channel wakes its member seats.\n`;
    expect(scan({ ...GREEN, ...DOCS, [MAILBOXES_PAGE]: planted }).productHits).toEqual([
      { path: MAILBOXES_PAGE, line: 14, text: "A post on the support channel wakes its member seats." },
    ]);

    // An allowlisted line is held to its exact text, so an edit to it counts.
    const editedRow = DOCS[MAILBOXES_PAGE].replace("Nothing in it is read.", "Nothing in it is read; a channel still opens.");
    expect(scan({ ...GREEN, ...DOCS, [MAILBOXES_PAGE]: editedRow }).productHits.map((hit) => hit.line)).toEqual([5]);

    // The redirect's line is allowlisted in the config only, not on any page.
    const elsewhere = scan({ ...GREEN, "apps/docs/docs/workforce/overview.md": '            from: "/docs/workforce/channels",\n' });
    expect(elsewhere.productHits.map((hit) => hit.path)).toEqual(["apps/docs/docs/workforce/overview.md"]);
  });
});
