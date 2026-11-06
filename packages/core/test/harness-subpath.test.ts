/**
 * `@flow-state-dev/core/harness` is the one home of the coding-harness
 * vocabulary: the harness contract, the run's plan record, the session's
 * pull-request record, and the helpers a harness package calls.
 *
 * Why it matters: an adopter autocompleting the root sees no harness name, and
 * someone building around a coding agent finds the whole contract on one
 * documented subpath, not split between the root and `core/types`. A name with
 * two public homes gets re-exported from both forever, so a harness name on any
 * other public entry fails here, `core/types` included.
 *
 * Read through the same per-entry export index the export check uses.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { fsReader, packageEntryExports } from "../../../scripts/mechanism-exports.mjs";

const REPO = join(__dirname, "../../..");

/** The source files whose exports are harness vocabulary. */
const HARNESS_FILES = [
  "packages/core/src/types/harness.ts",
  "packages/core/src/types/harness-plan.ts",
  "packages/core/src/types/pull-requests.ts",
  "packages/core/src/helpers/harness-activity.ts",
  "packages/core/src/helpers/harness-env.ts",
  "packages/core/src/helpers/harness-steering.ts",
  "packages/core/src/helpers/pull-request-recorder.ts",
  "packages/core/src/helpers/run-duration.ts",
];

/** Called only by core's own plan and pull-request code: on no public entry. */
const UNEXPORTED = ["planConversationPrefix", "findOpenedPullRequests"];

type Entry = Map<string, { file: string; type: boolean }>;
const entries = (packageEntryExports(fsReader(REPO)) as Map<string, Map<string, Entry>>).get("@flow-state-dev/core")!;

/** Every name a harness file declares with `export` (each one declares its exports in place). */
function declaredNames(): string[] {
  return HARNESS_FILES.flatMap((file) =>
    [...readFileSync(join(REPO, file), "utf8").matchAll(/^export (?:async )?(?:function|const|type|interface|class) (\w+)/gm)].map(
      (m) => m[1]!,
    ),
  );
}

describe("core/harness — the one home of the harness vocabulary", () => {
  it("is a public entry carrying the harness contract, plan record and pull-request record", () => {
    const harness = entries.get("./harness");
    expect(harness, "core's exports map has no ./harness entry").toBeDefined();
    for (const name of [
      "HarnessBlock",
      "HarnessRunInput",
      "harnessRunInputSchema",
      "reportHarnessSpend",
      "OBSERVED_PLAN",
      "replacePlanList",
      "OBSERVED_PULL_REQUESTS",
      "recordPullRequests",
      "harnessEnv",
      "HARNESS_BASE_PASS",
      "HarnessModelInfo",
      "HarnessModelList",
      "harnessSteering",
      "formatRunDuration",
    ]) {
      expect(harness!.has(name), `${name} is not on core/harness`).toBe(true);
    }
  });

  it("carries every name the harness files export, and no harness name resolves from another public entry", () => {
    const harness = entries.get("./harness") ?? new Map();
    const elsewhere: string[] = [];
    for (const [subpath, entry] of entries) {
      if (subpath === "./harness") continue;
      for (const [name, { file }] of entry) if (HARNESS_FILES.includes(file)) elsewhere.push(`${subpath}: ${name}`);
    }
    expect(elsewhere).toEqual([]);
    const missing = declaredNames().filter((name) => !UNEXPORTED.includes(name) && !harness.has(name));
    expect(missing).toEqual([]);
  });

  it("does not export the two names only core's own plan and pull-request code calls", () => {
    const exported = [...entries].flatMap(([subpath, entry]) =>
      UNEXPORTED.filter((name) => entry.has(name)).map((name) => `${subpath}: ${name}`),
    );
    expect(exported).toEqual([]);
  });
});
