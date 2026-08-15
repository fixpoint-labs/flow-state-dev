/**
 * The local review record on disk.
 *
 * The one thing here that is genuinely a decision rather than a read is
 * **numbering**, and it is tested for the property that matters: a submission's
 * identity is claimed once, from what is already on disk, on the write side.
 * An observer that minted identity while reading would be inventing the thing it
 * is supposed to be reporting, and two ticks racing would each report a
 * different one.
 */

import { afterEach, describe, expect, it } from "vitest";

import { openSubmission, readCheck, readSubmission, writeCheck } from "../../src/local/store";
import { createTestRepo, type TestRepo } from "./repo";

const AT = "2026-08-02T00:00:00Z";

let repo: TestRepo;

afterEach(async () => {
  await repo?.cleanup();
});

describe("opening a submission", () => {
  it("numbers from one and persists a record a human can read", async () => {
    repo = await createTestRepo();

    const first = await openSubmission(repo.root, "spec/FIX-1", "main", AT);

    expect(first).toEqual({ number: 1, branch: "spec/FIX-1", base: "main", openedAt: AT });
    expect(await readSubmission(repo.root, 1)).toEqual(first);
  });

  it("is idempotent per branch, so a re-entered phase does not open a second one", async () => {
    repo = await createTestRepo();

    const first = await openSubmission(repo.root, "spec/FIX-1", "main", AT);
    const again = await openSubmission(repo.root, "spec/FIX-1", "main", "2026-09-01T00:00:00Z");

    expect(again).toEqual(first);
  });

  it("gives a second branch the next number", async () => {
    repo = await createTestRepo();

    await openSubmission(repo.root, "spec/FIX-1", "main", AT);
    const second = await openSubmission(repo.root, "fix/FIX-1", "main", AT);

    expect(second.number).toBe(2);
  });

  it("gives each of two branches claimed at once a number of its own", async () => {
    repo = await createTestRepo();

    const [a, b] = await Promise.all([
      openSubmission(repo.root, "spec/FIX-1", "main", AT),
      openSubmission(repo.root, "fix/FIX-1", "main", AT),
    ]);

    expect(new Set([a.number, b.number]).size).toBe(2);
    expect(await readSubmission(repo.root, a.number)).toMatchObject({ branch: a.branch });
    expect(await readSubmission(repo.root, b.number)).toMatchObject({ branch: b.branch });
  });
});

describe("check records", () => {
  it("are keyed by commit, so the base's status is the same read", async () => {
    repo = await createTestRepo();

    await writeCheck(repo.root, "abc123", { conclusion: "success", at: AT, command: "pnpm test" });

    expect(await readCheck(repo.root, "abc123")).toEqual({
      conclusion: "success",
      at: AT,
      command: "pnpm test",
    });
    expect(await readCheck(repo.root, "def456")).toBeNull();
  });
});
