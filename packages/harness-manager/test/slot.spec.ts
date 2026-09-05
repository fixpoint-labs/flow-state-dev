/**
 * The harness slot, and the two option surfaces it replaced.
 *
 * These drive `harnessManager` DIRECTLY, with a fake harness the package's own
 * tests own — which is the point of the slot and the cheapest possible proof of
 * it. Nothing here imports a coding agent, and neither does the package: if that
 * ever stops being true, the import sweep at the bottom of this file fails.
 *
 * The end-to-end behaviours — a real board, a real hand-off, a real claim gate —
 * stay with `labs/conductor`, which is this package's first consumer and drives
 * the whole loop through its own flow. Duplicating that here would be a second
 * copy of a suite, not a second thing tested.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { defineCapability, defineResourceCollection, handler } from "@flow-state-dev/core";
import { harnessRunInputSchema, harnessRunHandleSchema } from "@flow-state-dev/core";
import type { HarnessBlock } from "@flow-state-dev/core/types";
import { defineTaskCollection } from "@flow-state-dev/orchestration/tasks";
import { harnessManager, RUNS, INBOX, type HarnessFeeds } from "../src";
import { joinIdentity, tenantSegment } from "../src/workspace";
import { seedRepo } from "./fixtures";

const EPIC = "slot-test";
const BOARD_ID = joinIdentity("conductor-tasks", tenantSegment(undefined), EPIC);

const sourceRepo = mkdtempSync(join(tmpdir(), "harness-manager-slot-repo-"));
seedRepo(sourceRepo);
const workspace = { root: join(tmpdir(), "harness-manager-slot"), sourceRepo, baseRef: "main" };

const tasks = defineTaskCollection({
  id: BOARD_ID,
  scope: "user" as const,
  stateSchema: z.object({ issue: z.string(), phase: z.string() }),
});

/**
 * A harness that conforms to the neutral contract and knows nothing about any
 * vendor.
 *
 * It records the feeds it was handed so the slot's shape can be asserted, and
 * returns a handle that parses against `harnessRunHandleSchema` — which is the
 * runtime half of "the manager drives any conforming harness".
 */
function fakeHarness(seen: { feeds?: HarnessFeeds }) {
  return (feeds: HarnessFeeds): HarnessBlock => {
    seen.feeds = feeds;
    return handler({
      name: "fake-harness",
      inputSchema: harnessRunInputSchema,
      outputSchema: harnessRunHandleSchema,
      execute: async () => ({
        source: "fake/test",
        status: "completed" as const,
        sessionId: "sess_fake",
        url: null,
        dispatchedAt: Date.now(),
        outcome: "finished" as const,
        finalMessage: null,
        usage: null,
        cost: null,
      }),
    }) as unknown as HarnessBlock;
  };
}

const phase = {
  phase: "implement",
  buildPrompt: () => "go",
  isDone: () => true,
};

function build(extra: Record<string, unknown> = {}) {
  const seen: { feeds?: HarnessFeeds } = {};
  const worker = harnessManager({
    boardCollectionId: BOARD_ID,
    boardCollection: tasks,
    tenant: undefined,
    phase,
    workspace,
    runTimeoutMs: 30_000,
    harness: fakeHarness(seen),
    ...extra,
  } as never);
  return { worker, seen };
}

describe("the harness slot", () => {
  it("hands the harness all three feeds in one call, at construction", () => {
    // One call, three feeds. The constraint is not decoration: a harness that
    // throws on the deadline returns no handle, so a slot feeding only `cwd`
    // and `resume` would lose the session on exactly the kill resume exists
    // for — `onSession` is the write side, and it has to arrive with them.
    const { seen } = build();

    expect(seen.feeds).toBeDefined();
    expect(typeof seen.feeds!.cwd).toBe("function");
    expect(typeof seen.feeds!.resume).toBe("function");
    expect(typeof seen.feeds!.onSession).toBe("function");
  });

  it("builds a manager from a harness that has nothing to do with any vendor", () => {
    // Decision 1, at its cheapest: a block conforming to the neutral contract is
    // all the manager needs. This one is twenty lines of test code.
    const { worker } = build();

    expect(worker).toBeDefined();
    expect((worker as { name?: string }).name).toBe("harness-manager");
  });

  it("resolves `null` from the resume feed when no previous session is on state", () => {
    // Attempt 1, and every attempt after one whose harness confirmed nothing.
    // `null` — never `""`, and never the id that was sent.
    const { seen } = build();
    const empty = { sequencer: { state: {} } };

    expect(seen.feeds!.resume(empty as never)).toBeNull();
  });

  it("reads the previous session off the manager's own state, not off input", () => {
    // BP-031, structurally: the feed takes the context alone, so there is no
    // input to read even if a caller wanted it to.
    const { seen } = build();
    const withPrevious = { sequencer: { state: { previousSessionId: "sess_prev" } } };

    expect(seen.feeds!.resume(withPrevious as never)).toBe("sess_prev");
    expect(seen.feeds!.resume.length).toBe(1);
    expect(seen.feeds!.cwd.length).toBe(1);
  });
});

describe("a phase's own preconditions, at the manager's door", () => {
  it("runs `validate` when the manager is constructed", () => {
    // **A construction-time preflight is worthless if only one wrapper calls
    // it.** The wiring used to live in this repository's own flow builder, so a
    // host constructing `harnessManager` directly — which is what the README
    // demonstrates — silently skipped it. What that costs is exactly what
    // `validate` exists to prevent: a phase's permanent precondition failure
    // (the implement phase reads the source repository's `origin`) landing
    // AFTER a paid agent run, once per retry, until the budget is gone.
    let seen: unknown = "never ran";
    build({
      phase: {
        ...phase,
        validate: (ws: unknown) => {
          seen = ws;
          return "the-validated-value";
        },
      },
    });

    expect(seen).toEqual(workspace);
  });

  it("refuses at construction when `validate` throws", () => {
    // The refusal is the point: a phase's precondition is configuration, and
    // configuration fails at startup where an operator can see it rather than
    // once per claimed attempt.
    expect(() =>
      build({
        phase: {
          ...phase,
          validate: () => {
            throw new Error("this phase needs an origin remote");
          },
        },
      }),
    ).toThrow(/needs an origin remote/);
  });

  it("gives two managers from one PhaseSpec their own validated value", () => {
    // What `validate` learns belongs to THIS manager. A phase that stored it on
    // itself would hand it to the next one, and a construction that then failed
    // would leave the pin behind for a corrected retry to trip over.
    let calls = 0;
    const shared = { ...phase, validate: () => `run-${++calls}` };

    build({ phase: shared });
    build({ phase: shared });

    expect(calls).toBe(2);
  });
});

describe("a phase's collections ride `uses`", () => {
  const notes = defineResourceCollection({
    name: "phase-notes",
    pattern: "phase-notes/**",
    scope: "user" as const,
    stateSchema: z.object({ text: z.string().nullable().default(null) }),
  });

  const capabilityDeclaring = (accessor: string) =>
    defineCapability({
      name: `phase-cap-${accessor}`,
      resources: { [accessor]: notes },
    });

  it("accepts a capability that brings a collection of its own", () => {
    expect(() => build({ uses: [capabilityDeclaring("phase-notes")] })).not.toThrow();
  });

  it("refuses a capability claiming the run record", () => {
    // Overriding `runs` sends the manager's bookkeeping into a collection the
    // status surface never reads: the row is written, and every read of it
    // answers nothing.
    expect(() => build({ uses: [capabilityDeclaring(RUNS)] })).toThrow(
      /the manager owns/,
    );
  });

  it("refuses a capability claiming the question inbox", () => {
    // A run would park on a question no operator could see and no answer could
    // reach.
    expect(() => build({ uses: [capabilityDeclaring(INBOX)] })).toThrow(
      /the manager owns/,
    );
  });

  it("refuses a capability claiming the board ledger", () => {
    // The worst of the three: the live-claim fence would consult unrelated
    // rows, defeating the whole attempt-fence mechanism while every test that
    // does not stage two attempts still passes.
    expect(() => build({ uses: [capabilityDeclaring(BOARD_ID)] })).toThrow(
      /the manager owns/,
    );
  });

  it("has no `readable` slot left to declare", () => {
    // The bespoke record is gone, replaced by the framework's standard channel.
    // Asserted because a leftover would be a second way to say one thing, and
    // the reserved guard now watches only the one that remains.
    expect(() => build({ phase: { ...phase, readable: {} } })).not.toThrow();
    expect(readFileSync(join(SRC, "manager.ts"), "utf8")).not.toMatch(
      /readable: Record<string, DeclaredResourceEntry>/,
    );
  });
});

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src");

/**
 * **No harness is imported anywhere in this package** (decision 1).
 *
 * A source check, because the property is about the SET of files rather than
 * any behaviour: the manager is meant to drive any conforming harness, and one
 * import of one vendor is what would quietly make that false again. A test that
 * merely ran a fake harness would still pass with `claudeCodeAgent` imported
 * beside it.
 */
describe("the package imports no coding harness", () => {
  it("names no harness package in any source file", () => {
    const files = readdirSync(SRC).filter((f) => f.endsWith(".ts"));
    // Or the assertion below examines nothing and passes vacuously.
    expect(files.length).toBeGreaterThanOrEqual(6);

    for (const file of files) {
      const src = readFileSync(join(SRC, file), "utf8");
      const imports = [...src.matchAll(/from "([^"]+)"/g)].map((m) => m[1]!);
      for (const specifier of imports) {
        expect(
          specifier,
          `${file} imports ${specifier} — this package drives any conforming ` +
            `harness and must import none of them`,
        ).not.toMatch(/claude-code|codex|@anthropic|openai/i);
      }
    }
  });
});
