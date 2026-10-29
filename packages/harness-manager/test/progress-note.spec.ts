/**
 * The progress note a run's activity becomes, and how often it reaches the
 * task row (FIX-2290). The row write is a stub here; the fenced write on a
 * real board is `progress-from-a-run.spec.ts`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { STATUS_NOTE_LIMIT } from "@flow-state-dev/orchestration";
import { PROGRESS_NOTE_MS, progressNoteOf } from "../src";
import { throttledNotes } from "../src/progress-note";

describe("a run's activity as a note", () => {
  it("reads a message as its first non-empty line", () => {
    expect(progressNoteOf({ kind: "message", text: "\n  Tests pass;   writing the changeset.\nMore detail." })).toBe(
      "Tests pass; writing the changeset.",
    );
  });

  it("reads a tool call as what it touches, so a coordinator can say what the run is doing", () => {
    expect(progressNoteOf({ kind: "tool", name: "Edit", arguments: JSON.stringify({ file_path: "src/a.ts", old_string: "x" }) })).toBe(
      "Edit: src/a.ts",
    );
    expect(progressNoteOf({ kind: "tool", name: "command_execution", arguments: JSON.stringify({ command: "pnpm test" }) })).toBe(
      "command_execution: pnpm test",
    );
    // Nothing in the arguments says what it touches, or they aren't JSON: the name alone.
    expect(progressNoteOf({ kind: "tool", name: "TodoWrite", arguments: JSON.stringify({ todos: [] }) })).toBe("TodoWrite");
    expect(progressNoteOf({ kind: "tool", name: "Bash", arguments: "not json" })).toBe("Bash");
  });

  it("says nothing for an empty message, and never runs past the row's note limit", () => {
    expect(progressNoteOf({ kind: "message", text: " \n " })).toBeNull();
    const note = progressNoteOf({ kind: "message", text: "x".repeat(STATUS_NOTE_LIMIT + 50) })!;
    expect(note).toHaveLength(STATUS_NOTE_LIMIT);
  });
});

describe("how often a note reaches the row", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const recorder = (answer: () => boolean = () => true) => {
    const written: string[] = [];
    const notes = throttledNotes(async (note) => {
      written.push(note);
      return answer();
    });
    return { written, notes };
  };

  it("writes the first at once, then only the latest once per window, so a burst is one write", async () => {
    const { written, notes } = recorder();
    notes.report("Edit: src/a.ts");
    for (let i = 0; i < 50; i++) notes.report(`Bash: step ${i}`);
    expect(written).toEqual(["Edit: src/a.ts"]);

    await vi.advanceTimersByTimeAsync(PROGRESS_NOTE_MS);
    // The note moved, to where the run is now, not to each call it passed.
    expect(written).toEqual(["Edit: src/a.ts", "Bash: step 49"]);

    // A quiet window writes nothing; the next activity after it writes at once.
    await vi.advanceTimersByTimeAsync(PROGRESS_NOTE_MS);
    notes.report("Tests pass.");
    expect(written).toEqual(["Edit: src/a.ts", "Bash: step 49", "Tests pass."]);
  });

  it("bounds a ten-minute run that is busy the whole time", async () => {
    const { written, notes } = recorder();
    for (let ms = 0; ms < 10 * 60_000; ms += 100) {
      notes.report(`Read: file ${ms}`);
      await vi.advanceTimersByTimeAsync(100);
    }
    expect(written.length).toBeLessThanOrEqual(10 * 60_000 / PROGRESS_NOTE_MS + 1);
  });

  it("never writes the same note twice in a row", async () => {
    const { written, notes } = recorder();
    notes.report("Bash: pnpm test");
    notes.report("Bash: pnpm test");
    await vi.advanceTimersByTimeAsync(PROGRESS_NOTE_MS);
    expect(written).toEqual(["Bash: pnpm test"]);
  });

  it("writes nothing more once the row declined one: the attempt no longer holds it", async () => {
    const { written, notes } = recorder(() => false);
    notes.report("Edit: src/a.ts");
    await vi.advanceTimersByTimeAsync(0);
    notes.report("Edit: src/b.ts");
    await vi.advanceTimersByTimeAsync(PROGRESS_NOTE_MS);
    expect(written).toEqual(["Edit: src/a.ts"]);
  });

  it("writes a note again after a write of it failed, so a blip doesn't leave the row stale", async () => {
    const written: string[] = [];
    let fail = true;
    const notes = throttledNotes(async (note) => {
      written.push(note);
      if (fail) {
        fail = false;
        throw new Error("board unreachable");
      }
      return true;
    });
    notes.report("Bash: pnpm test");
    await vi.advanceTimersByTimeAsync(PROGRESS_NOTE_MS);
    notes.report("Bash: pnpm test");
    await vi.advanceTimersByTimeAsync(0);
    expect(written).toEqual(["Bash: pnpm test", "Bash: pnpm test"]);
  });

  it("drops what's pending when the step ends", async () => {
    const { written, notes } = recorder();
    notes.report("Edit: src/a.ts");
    notes.report("Edit: src/b.ts");
    notes.stop();
    await vi.advanceTimersByTimeAsync(PROGRESS_NOTE_MS);
    notes.report("Edit: src/c.ts");
    expect(written).toEqual(["Edit: src/a.ts"]);
  });
});
