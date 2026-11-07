/**
 * `@flow-state-dev/core/internal` is core's one hidden entry: the runtime
 * seams our own packages share (the request host, wait gates, the dispatch,
 * request-end, spend, resume and board-notice seams, the side-chain pool) and
 * the internal item surface.
 *
 * Why it matters: core's root and `core/types` are what an adopter
 * autocompletes. A seam left there is a name no app author uses, and a seam
 * with two homes gets re-exported from both forever. So a seam on any public
 * entry fails here, `core/types` and `core/errors/suspension-error` included,
 * and `core/items/internal` is gone: core has one hidden entry, not two.
 *
 * Read through the same per-entry export index the export check uses.
 */
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { fsReader, packageEntryExports } from "../../../scripts/mechanism-exports.mjs";

const REPO = join(__dirname, "../../..");

/** The source files whose every export is a runtime seam. */
const INTERNAL_FILES = [
  "packages/core/src/types/request-host.ts",
  "packages/core/src/types/request-end.ts",
  "packages/core/src/types/request-resume.ts",
  "packages/core/src/types/board-notice.ts",
  "packages/core/src/types/wait-gate.ts",
  "packages/core/src/blocks/wait-on-request.ts",
  "packages/core/src/execution/request-side-chain-pool.ts",
  "packages/core/src/helpers/cache-tokens.ts",
  "packages/core/src/helpers/harness-sdk-version.ts",
  "packages/core/src/blocks/internal/replay-log.ts",
  "packages/core/src/blocks/internal/resolve-active-status-message.ts",
];

/** Seams declared in files that also hold public names. */
const INTERNAL_NAMES = [
  "resolveAllowedActions",
  "isFiveFieldCron",
  "DISPATCH_SEAM",
  "DispatchSeam",
  "dispatchThroughSeam",
  "NoDispatchSeamError",
];

/** The internal item surface, folded in from the old `core/items/internal`. */
const ITEM_INTERNALS = ["RuntimeItem", "BlockValueInternal", "refBlockValue", "resolveBlockValueInternal", "parseBlockInstanceId"];

type Entry = Map<string, { file: string; type: boolean }>;
const entries = (packageEntryExports(fsReader(REPO)) as Map<string, Map<string, Entry>>).get("@flow-state-dev/core")!;

describe("core/internal — core's one hidden entry", () => {
  it("carries the seams, the internal context type and the internal item surface", () => {
    const internal = entries.get("./internal");
    expect(internal, "core's exports map has no ./internal entry").toBeDefined();
    const missing = [
      ...INTERNAL_NAMES,
      ...ITEM_INTERNALS,
      "RequestHost",
      "requireRequestHost",
      "requestHostOf",
      "InternalBlockContext",
      "parkOnWait",
      "onRequestEnded",
      "REQUEST_END_SEAM",
      "REQUEST_SPEND_SEAM",
      "REQUEST_RESUME_SEAM",
      "BOARD_NOTICE_SEAM",
      "getRequestSideChainPool",
      "WAIT_DEADLINE_ENTRY",
    ].filter((name) => !internal!.has(name));
    expect(missing).toEqual([]);
  });

  it("is the only entry any seam resolves from", () => {
    const all = entries;
    const internal = all.get("./internal") ?? new Map();
    const elsewhere: string[] = [];
    const seams = new Set<string>();
    for (const [subpath, entry] of all) {
      for (const [name, { file }] of entry) {
        if (!INTERNAL_FILES.includes(file) && !INTERNAL_NAMES.includes(name)) continue;
        seams.add(name);
        if (subpath !== "./internal") elsewhere.push(`${subpath}: ${name}`);
      }
    }
    expect(elsewhere).toEqual([]);
    expect([...seams].filter((name) => !internal.has(name))).toEqual([]);
  });

  it("replaces core/items/internal rather than sitting beside it", () => {
    expect(entries.has("./items/internal")).toBe(false);
  });
});
