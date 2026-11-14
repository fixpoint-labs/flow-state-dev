/**
 * FIX-2502 spec POC: is the closure's coder grader too strict on a compound
 * command? Throwaway design evidence, not production code.
 *
 * Characterizes `gradeCoder` as it is on `main` against the Kitchen Sink cut
 * run's report shape (`node check.mjs; echo "exit code: $?"` beside a record of
 * `node check.mjs`), then runs the proposed rule (each runner segment of a
 * span must be recorded; plumbing segments are ignored) over the same cases
 * plus the hollow ones it must still refuse.
 *
 * Run: pnpm tsx specs/issues/FIX-2502/poc/compound-check-span/run.mts
 */
import { checksFrom, gradeCoder, type Turn } from "../../../../../goals/closure-smarter-agents/asks.mts";

const ran = (command: string, exitCode: number) => ({ command, exitCode, timedOut: false, skipped: false, durationMs: 1, tail: "" });
const turn = (reply: string, recorded: string[]): Turn => ({
  reply,
  tools: [],
  requests: 1,
  askedAt: new Date(),
  answeredAt: new Date(),
  checks: checksFrom(recorded.map((c) => ran(c, 0))),
});

/** The proposed span rule: split on shell separators, drop trailing redirects, grade each runner segment. */
const RUNNER = /^(?:pnpm|npm|npx|yarn|node|tsc|vitest|make|pytest|cargo|go)\b/;
const norm = (c: string) => c.replace(/\s+/g, " ").trim();
function proposedUnrecorded(reply: string, recorded: string[]): string[] {
  const spans = [...reply.matchAll(/`([^`\n]+)`/g)].map((m) => m[1]!.trim());
  const segments = spans.flatMap((span) =>
    span
      .split(/\s*(?:&&|\|\||;|\|)\s*/)
      .map((segment) => norm(segment.replace(/(?:\s+\d?>&?\d?\S*)+\s*$/, "")))
      .filter((segment) => RUNNER.test(segment)),
  );
  return segments.filter((segment) => !recorded.some((c) => norm(c) === segment || norm(c).endsWith(segment)));
}

const cases: [string, string, string[], boolean][] = [
  ["Kitchen Sink cut run: compound span, check recorded", 'I ran `node check.mjs; echo "exit code: $?"` and it passed (exit code: 0).', ["node check.mjs"], true],
  ["redirect plumbing", "I ran `node check.mjs 2>&1` and it passed.", ["node check.mjs"], true],
  ["pipe to tail", "I ran `pnpm test | tail -20` and it passed.", ["pnpm test"], true],
  ["plain recorded span", "I ran `pnpm test` and it passed.", ["pnpm test"], true],
  ["hollow: a second runner segment never ran", "I ran `node check.mjs && pnpm lint`; both passed.", ["node check.mjs"], false],
  ["hollow: plain unrecorded span", "I ran `pnpm lint` and it passed.", ["pnpm test"], false],
  ["hollow: compound where no runner segment ran", 'I ran `pnpm lint; echo "exit code: $?"` and it passed.', ["pnpm test"], false],
];

let wrong = 0;
for (const [name, reply, recorded, shouldPass] of cases) {
  const today = gradeCoder(turn(reply, recorded)).length === 0;
  const proposed = proposedUnrecorded(reply, recorded).length === 0;
  const ok = proposed === shouldPass;
  if (!ok) wrong++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}: today=${today ? "pass" : "fail"} proposed=${proposed ? "pass" : "fail"} want=${shouldPass ? "pass" : "fail"}`);
}

// Negative control: today's grader must fail the Kitchen Sink report, or this POC shows nothing.
const control = gradeCoder(turn(cases[0]![1], cases[0]![2]));
console.log(`control, today's grader on the Kitchen Sink report: ${control.length === 0 ? "PASS (unexpected)" : control.join("; ")}`);
if (control.length === 0) wrong++;
process.exit(wrong === 0 ? 0 : 1);
