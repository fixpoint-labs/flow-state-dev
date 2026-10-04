/**
 * The board id the manager derives every run's checkout folder and branch
 * from — which ids it accepts, what it derives from them, and when it refuses.
 *
 * Three claims, and the order matters:
 *
 * 1. **Nobody's work moves.** Every id accepted before a board id could carry a
 *    dot derives byte for byte the checkout and branch it did then. The
 *    comparison is against `derivation-snapshot.json`, which was written by the
 *    code as it stood before the grammar widened — not re-derived here, which
 *    would only prove the function agrees with itself.
 * 2. **A mailbox's board is used as is.** `eng.feature.work` is accepted, and
 *    because nothing is translated it never shares a checkout or a branch with
 *    `eng-feature-work`, a name a board may already have. Ids that differ only
 *    in case shared before and still do: the derivation folds case, because a
 *    case-insensitive filesystem cannot tell them apart.
 * 3. **An id git cannot carry is refused when the manager is built**, naming
 *    it, before any row is claimed.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { handler } from "@flow-state-dev/core";
import { harnessRunHandleSchema, harnessRunInputSchema } from "@flow-state-dev/core";
import type { HarnessBlock } from "@flow-state-dev/core/types";
import { defineTaskCollection } from "@flow-state-dev/orchestration/tasks";
import { harnessManager } from "../src";
import { branchFor, checkoutPathFor, type RunLocation } from "../src/workspace";
import { seedRepo } from "./fixtures";

interface SnapshotRow {
  epic: string;
  principal: RunLocation["principal"];
  checkout: string;
  branch: string;
}

const HERE = dirname(fileURLToPath(import.meta.url));
const snapshot = JSON.parse(
  readFileSync(join(HERE, "derivation-snapshot.json"), "utf8"),
) as SnapshotRow[];
const CONFIG = { root: "/ws", sourceRepo: "/src", baseRef: "main" };
const ALICE = { userId: "u_devforce_lab" };

function derive(epic: string, principal: RunLocation["principal"] = ALICE) {
  const location: RunLocation = { principal, epic, issue: "FIX-1", phase: "implement" };
  return { checkout: checkoutPathFor(CONFIG, location), branch: branchFor(location) };
}

/** Git's own verdict on a branch name — the consumer the grammar answers to. */
function gitAcceptsBranch(branch: string): boolean {
  try {
    execFileSync("git", ["check-ref-format", "--branch", branch], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

describe("every board id accepted before derives what it did", () => {
  it("covers the ids it claims to", () => {
    // Or the loop below compares nothing and passes.
    expect(snapshot.length).toBeGreaterThanOrEqual(20);
    expect(snapshot.some((row) => row.epic === "devforce-tasks--t0--feature")).toBe(true);
  });

  it("derives the recorded checkout and branch for each, byte for byte", () => {
    for (const row of snapshot) {
      expect(derive(row.epic, row.principal), row.epic).toEqual({
        checkout: row.checkout,
        branch: row.branch,
      });
    }
  });

  it("keeps a case-only pair sharing, as it shared before", () => {
    const recorded = (epic: string) =>
      snapshot.find((row) => row.epic === epic && row.principal.userId === ALICE.userId)!;
    expect(recorded("Foo").checkout).toBe(recorded("foo").checkout);
    expect(derive("Foo")).toEqual(derive("foo"));
  });
});

describe("a mailbox's board id, used as is", () => {
  it("is accepted, and git accepts the branch it derives", () => {
    const { checkout, branch } = derive("eng.feature.work");
    expect(checkout).toContain("/eng.feature.work/");
    expect(branch).toContain("/eng.feature.work/");
    expect(gitAcceptsBranch(branch)).toBe(true);
  });

  it("never shares a checkout or a branch with an id that differs other than in case", () => {
    // Built to collide under any translation of the dot.
    const ids = ["eng.feature.work", "eng-feature-work", "eng_feature_work", "eng.feature-work"];
    const derived = ids.map((id) => derive(id));
    expect(new Set(derived.map((d) => d.checkout)).size).toBe(ids.length);
    expect(new Set(derived.map((d) => d.branch)).size).toBe(ids.length);
  });

  it("shares with an id that differs only in case, as every id does", () => {
    expect(derive("Eng.Feature.Work")).toEqual(derive("eng.feature.work"));
  });
});

describe("an id git cannot carry is refused when the manager is built", () => {
  const sourceRepo = mkdtempSync(join(tmpdir(), "harness-manager-board-id-repo-"));
  seedRepo(sourceRepo);

  const build = (boardCollectionId: string) =>
    harnessManager({
      boardCollectionId,
      boardCollection: defineTaskCollection({
        id: "board-id-spec",
        scope: "org" as const,
        stateSchema: z.object({ issue: z.string(), phase: z.string() }),
      }),
      tenant: undefined,
      phase: { phase: "implement", buildPrompt: () => "go", isDone: () => true },
      workspace: { root: join(tmpdir(), "harness-manager-board-id"), sourceRepo, baseRef: "main" },
      runTimeoutMs: 30_000,
      harness: () =>
        handler({
          name: "never-runs",
          inputSchema: harnessRunInputSchema,
          outputSchema: harnessRunHandleSchema,
          execute: async () => {
            throw new Error("a refused manager never runs");
          },
        }) as unknown as HarnessBlock,
    });

  const refused = [
    "x.lock",
    "x.LOCK",
    "eng.feature.lock",
    "a..b",
    ".a",
    "a.",
    "a/b",
    "a\\b",
    "..",
    "",
  ];

  for (const id of refused) {
    it(`refuses ${JSON.stringify(id)}, naming it`, () => {
      expect(() => build(id)).toThrow(`boardCollectionId "${id}"`);
    });
  }

  it("refuses exactly the ids git would refuse a branch for", () => {
    // The `.lock` pair is the case the grammar alone cannot see: the pattern
    // accepts `x.lock`, and git does not.
    for (const id of ["x.lock", "x.LOCK", "eng.feature.lock"]) {
      expect(gitAcceptsBranch(`conductor/${id.toLowerCase()}/leaf`), id).toBe(false);
    }
  });

  it("builds for a mailbox's board id and for an id accepted before", () => {
    expect(() => build("eng.feature.work")).not.toThrow();
    expect(() => build("devforce-tasks--t0--feature")).not.toThrow();
    // `.lock` is refused as an ending only, which is git's rule too.
    expect(() => build("a.lock.b")).not.toThrow();
    expect(gitAcceptsBranch(derive("a.lock.b").branch)).toBe(true);
  });
});
