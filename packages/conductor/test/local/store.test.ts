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

import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  openSubmission,
  readCheck,
  readReviews,
  readSubmission,
  submissionDir,
  writeCheck,
} from "../../src/local/store";
import { createTestRepo, type TestRepo } from "./repo";

const AT = "2026-08-02T00:00:00Z";

let repo: TestRepo;

afterEach(async () => {
  vi.restoreAllMocks();
  await repo?.cleanup();
});

/** Write a verdict file as a human's editor would leave it, contents and all. */
async function writeReview(number: number, name: string, body: string): Promise<void> {
  const file = path.join(submissionDir(repo.root, number), "reviews", name);
  await repo.write(path.relative(repo.root, file), body);
}

/** Read the inbox with a fixed head, so only the parsing is under test. */
function reviewsOf(number: number) {
  return readReviews(repo.root, number, () => Promise.resolve("head0"));
}

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

describe("a verdict file conductor cannot read", () => {
  it("is skipped on the whole payload, not just on JSON syntax", async () => {
    repo = await createTestRepo();
    const { number } = await openSubmission(repo.root, "spec/FIX-1", "main", AT);
    vi.spyOn(console, "warn").mockImplementation(() => {});

    // Every one of these parses as JSON and none of them is a verdict. Checking
    // syntax alone lets each one through as a `ReviewFacts` whose fields are not
    // what their types say — a number where the verdict goes, a number where the
    // commit goes, a whole verdict where the reviewer's name goes.
    await writeReview(number, "a.json", JSON.stringify({ reviewer: "a", state: 1 }));
    await writeReview(number, "b.json", JSON.stringify({ state: "APPROVED", sha: 42 }));
    await writeReview(number, "c.json", JSON.stringify({ state: "APPROVED", at: ["now"] }));
    await writeReview(number, "d.json", JSON.stringify(["APPROVED"]));
    await writeReview(number, "e.json", JSON.stringify({ reviewer: "e", state: "aproved" }));

    await expect(reviewsOf(number)).resolves.toEqual([]);
  });

  it("names the file and the reason, so the reviewer being ignored can find out", async () => {
    repo = await createTestRepo();
    const { number } = await openSubmission(repo.root, "spec/FIX-1", "main", AT);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await writeReview(number, "bob.json", JSON.stringify({ reviewer: "bob", state: 1 }));
    await reviewsOf(number);

    // Inert must not mean invisible: a verdict dropped for a typo is a human
    // waiting on a gate that will never move, with nothing anywhere to say why.
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toContain("bob.json");
    expect(String(warn.mock.calls[0]![0])).toContain("state");
  });

  it("still takes a verdict in the case the reviewer happened to type it in", async () => {
    repo = await createTestRepo();
    const { number } = await openSubmission(repo.root, "spec/FIX-1", "main", AT);

    await writeReview(number, "alice.json", JSON.stringify({ state: "approved", at: AT }));

    expect(await reviewsOf(number)).toMatchObject([{ reviewer: "alice", state: "APPROVED" }]);
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
