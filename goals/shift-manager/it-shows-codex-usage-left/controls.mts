/**
 * The goal's five controls. Each is a scratch patch to the usage record's one
 * module, applied as the Lab under test loads it (`goals/lib/module-patch.mjs`).
 */
import type { ModulePatch } from "../../lib/module-patch.mts";

export const CONTROL_NAMES = ["ignore-age", "unavailable-as-zero", "last-write-wins", "throttle-ignores-failures", "key-by-account"] as const;
export type ControlName = (typeof CONTROL_NAMES)[number];

/** One control: the assertions that must go red, and its patches. */
export interface Control {
  name: ControlName;
  assertions: string[];
  patches: ModulePatch[];
  does: string;
}

const USAGE = "packages/harness-manager/src/harness-usage.ts";

export const CONTROLS: Record<ControlName, Control> = {
  "ignore-age": {
    name: "ignore-age",
    assertions: ["d:rolled-over", "e:age"],
    patches: [
      { module: USAGE, from: String.raw`ageMs: Math\.max\(0, now - window\.checkedAt\),`, to: "ageMs: 0," },
      { module: USAGE, from: String.raw`rolledOver: window\.resetsAt !== null && window\.resetsAt < now,`, to: "rolledOver: false," },
      { module: USAGE, from: String.raw`ageMs: state\.checkedAt === null \? null : Math\.max\(0, now - state\.checkedAt\),`, to: "ageMs: state.checkedAt === null ? null : 0," },
    ],
    does: "the query returns every reading as fresh and no window as rolled over",
  },
  "unavailable-as-zero": {
    name: "unavailable-as-zero",
    assertions: ["b:no-percent", "c:no-percent"],
    patches: [
      {
        module: USAGE,
        from: String.raw`        windows: \[\],\n        checkedAt,`,
        to: '        windows: [{ id: "codex:primary", label: null, minutes: 300, usedPercent: 0, level: null, resetsAt: null, checkedAt, origin: "read" }],\n        checkedAt,',
      },
    ],
    does: "a harness with no number is stored as one window at 0%",
  },
  "last-write-wins": {
    name: "last-write-wins",
    assertions: ["a:leaves-the-stored-one"],
    patches: [
      {
        module: USAGE,
        from: String.raw`if \(stored\.checkedAt !== null && checkedAt < stored\.checkedAt\) return \{ state: \{\}, result: "refused-older" \};`,
        to: "",
      },
    ],
    does: "the writer takes every reading, however old",
  },
  "throttle-ignores-failures": {
    name: "throttle-ignores-failures",
    assertions: ["g:one-child"],
    patches: [
      {
        module: USAGE,
        from: String.raw`if \(stored\.lastAttemptAt !== null && now - stored\.lastAttemptAt < USAGE_REFRESH_EVERY_MS\) \{`,
        to: "if (stored.checkedAt !== null && now - stored.checkedAt < USAGE_REFRESH_EVERY_MS) {",
      },
    ],
    does: "the minute between refreshes is counted from the last good reading, so a failing reader is tried on every look",
  },
  "key-by-account": {
    name: "key-by-account",
    assertions: ["h:no-earlier-percent"],
    patches: [
      {
        module: USAGE,
        from: String.raw`const record = await rowOf\(ctx, harness\);`,
        to: 'const record = await rowOf(ctx, reading.status === "windows" && reading.accountId !== null ? `${harness}-${hashKeySegment(reading.accountId)}` : harness);',
      },
    ],
    does: "each account gets its own row, so a sign-in change leaves the earlier account's row",
  },
};
