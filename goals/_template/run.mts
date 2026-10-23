/**
 * Goal check runner — real model, real path, out of CI.
 *
 * Copy this with the goal folder, then fill in the body: load the held-out
 * fixture, drive the real path with a real model, and assert on the
 * user-visible surface — graded against the fixture, never the implementation's
 * own internal output. `runGoal` prints the PASS / FAIL / CAN'T TELL verdict and
 * sets the exit code; return `failures` (empty means PASS) plus the `evidence`
 * inspected, and floor every list an assertion grades with `tell.over`.
 *
 * The shared helpers live in `goals/lib` — use them rather than re-deriving:
 * they encode the techniques in README.md → "Script techniques", and the two
 * bugs that showed up when goals hand-rolled them (a partial env strip, and
 * reading the FIRST item snapshot instead of the latest).
 *
 * Run: pnpm tsx goals/<describe>/<it>/run.mts
 */
import {
  KITCHEN_SINK,
  DEFAULT_MODEL,
  goalTmpDir,
  loadFixture,
  messageText,
  readCapture,
  runFsdev,
  runGoal,
} from "../lib/index.mts";
import { join } from "node:path";

// 1. Load the held-out fixture. Nothing below should hardcode its contents —
//    swapping it for another valid input must still pass a correct impl.
const fixture = loadFixture<{ message: string; mustContain: string }>(import.meta.url);

const CAPTURE = join(goalTmpDir("<slug>"), "run.json");

await runGoal((failures, tell) => {
  // 2. Drive the REAL path with a REAL model, capturing the run. cwd must be
  //    the app dir — `fsdev` config search is cwd-only.
  const exit = runFsdev({
    app: KITCHEN_SINK,
    flow: "<flow>",
    action: "<action>",
    input: fixture,
    model: DEFAULT_MODEL,
    capture: CAPTURE,
  });
  if (exit !== 0) return { failures: [`fsdev run exited ${exit}`], evidence: "" };

  // `readCapture` reconstructs the FINAL state of each item (latest snapshot per
  // id). Do NOT filter `item_added` and take `e.item` — streamed assistant text
  // lands in LATER snapshots, so the first one is usually empty and grading it
  // is a false FAIL.
  const capture = readCapture(CAPTURE);
  if (capture.result.success !== true) {
    return {
      failures: [`flow did not complete: ${JSON.stringify(capture.result.error ?? "unknown")}`],
      evidence: "",
    };
  }

  // 3. Assert on the user-visible surface, graded against the fixture — NOT on
  //    implementation internals. Grade the assistant messages AND the action's
  //    terminal output together, which is the surface a user sees: either alone
  //    can miss the answer.
  //    Note: worker/block execution items are `type: "block_trace"` carrying an
  //    internal `BlockValueInternal` value — never unwrap those.
  const answer = [
    ...capture.items.filter((i) => i.type === "message" && i.role !== "user").map(messageText),
    String(capture.result.output ?? ""),
  ]
    .join("\n")
    .trim();
  // emptyIs only when empty is the claim. README → Script techniques #5.
  tell.over("answer · text", [answer].filter((text) => text.length > 0));
  if (!answer.toLowerCase().includes(fixture.mustContain.toLowerCase())) {
    failures.push(
      `answer did not contain "${fixture.mustContain}": ${JSON.stringify(answer.slice(0, 200))}`,
    );
  }

  return { failures, evidence: "<what was inspected, and why it can't be faked>" };
});
