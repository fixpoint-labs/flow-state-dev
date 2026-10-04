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
  PAGE_NOT_YET_MOVED,
  scanTree,
  // @ts-expect-error — root check script, plain .mjs with no type declarations.
} from "../../../scripts/check-mailbox-rename.mjs";

type Scan = {
  unclassified: string[];
  productHits: Array<{ path: string; line: number; text: string }>;
  pathHits: string[];
  ok: boolean;
};

const scan = (files: Record<string, string>, extra: { paths?: string[]; site?: boolean } = {}): Scan =>
  (scanTree as (tree: unknown) => Scan)({
    files: new Map(Object.entries(files)),
    paths: [...Object.keys(files), ...(extra.paths ?? [])],
    published: new Set(["workforce", "bullmq"]),
    ...(extra.site === undefined ? {} : { site: extra.site }),
  });

/** A tree the guard passes: a survivor-only file, a renamed API file, an allowlisted one. */
const GREEN = {
  "packages/bullmq/src/stream-bridge.ts": "const channel = eventChannel(requestId);\n// events to a channel per request\n",
  "packages/workforce/src/mailbox/mailbox-flow.ts": "export const MAILBOX_KIND = \"mailbox\";\n",
  "packages/workforce/src/mailbox/pre-rename.ts": "export const OLD = { kind: \"channel\" };\n",
  "packages/workforce/README.md": "## Mailboxes\n\nOne conversation.\n\n### Upgrading from channels\n\nRename `CHANNEL.md`.\n",
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

  it("strips only the not-yet-moved page's path from a line, never the words around it", () => {
    expect("see ../docs/docs/workforce/channels.md#which-organization".replace(PAGE_NOT_YET_MOVED as RegExp, "")).toBe("see ../docs/docs/");
    const linkOnly = scan({ ...GREEN, "apps/kitchen-sink/README.md": "[who runs it](../docs/docs/workforce/channels.md#who-runs-it)\n" });
    expect(linkOnly.ok).toBe(true);
    const withWords = scan({ ...GREEN, "apps/kitchen-sink/README.md": "[which organization a channel runs in](../docs/docs/workforce/channels.md)\n" });
    expect(withWords.productHits.map((hit) => hit.path)).toEqual(["apps/kitchen-sink/README.md"]);
  });

  it("leaves the docs site to the docs half of the rename until it is put in scope", () => {
    const site = { ...GREEN, "apps/docs/docs/workforce/overview.md": "A channel is a conversation.\n" };
    expect(scan(site).ok).toBe(true);
    expect(scan(site, { site: true }).productHits.map((hit) => hit.path)).toEqual(["apps/docs/docs/workforce/overview.md"]);
  });
});
