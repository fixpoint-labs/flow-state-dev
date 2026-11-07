/**
 * The adopter-goal judge's rules (goal.mjs), pinned on small manifests and
 * throwaway directories: what turns the job red, how a row's outcome is
 * derived, what the control accepts, and what the ratchet and never-published
 * probes see. Each rule is here because getting it wrong lets the job report
 * progress that is not there, or hide a regression.
 *
 * Run: `node --test scripts/packed-install/goal.test.mjs`.
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import {
  changelogLines,
  gradeMovedNames,
  judge,
  judgeControl,
  outcomeOf,
  plantLineRemoval,
  probeNeverPublished,
  ratchetFailures,
  readManifest,
  runRatchet,
  validateManifest,
} from "./goal.mjs";

const manifest = (expect) => ({
  rows: [
    { id: "a", title: "A", assertions: ["a.one", "a.two"] },
    { id: "b", title: "B", assertions: ["b.one"] },
    { id: "c", title: "C", assertions: [] },
  ],
  expect,
});
const outcomes = (entries) => new Map(Object.entries(entries).map(([id, outcome]) => [id, { outcome, detail: [] }]));

// The committed manifest moves: each child flips its own lines to "pass" as its
// fix lands. So this checks only what never moves (shape, seven rows, 28 pinned
// controls). The all-fail starting state is pinned on a fixed fixture below.
test("the committed manifest is well formed and pins the 28 control tarballs", () => {
  const m = readManifest();
  assert.equal(m.rows.length, 7);
  assert.ok(Object.values(m.expect).every((e) => e === "fail" || e === "pass"));
  assert.equal(m.control.packages.length, 28);
  assert.ok(m.control.packages.every((p) => /^sha512-/.test(p.integrity)));
});

// The closure adds rows and never edits one: its journey is the seventh row,
// expected to pass, after the epic's six.
test("the closure row is last and carries the upgrade journey, expected to pass", () => {
  const m = readManifest();
  assert.deepEqual(m.rows.slice(0, 6).map((r) => r.id), ["surface", "onepath", "first-hour", "leakage", "shims", "types"]);
  assert.deepEqual(m.rows[6], { id: "closure", title: "Closure", assertions: ["closure.j5:moved-name-named"] });
  assert.equal(m.expect["closure.j5:moved-name-named"], "pass");
});

test("the all-fail starting state is green with 0 rows, and the control accepts it", () => {
  const start = manifest({ "a.one": "fail", "a.two": "fail", "b.one": "fail" });
  const run = outcomes({ "a.one": "fail", "a.two": "pending", "b.one": "fail" });
  const v = judge(start, run);
  assert.deepEqual([v.ok, v.rowsPassing], [true, 0]);
  assert.equal(judgeControl(start, run).ok, true);
});

test("an outcome that matches its expectation is green, and a row with no passing cell does not count", () => {
  const v = judge(manifest({ "a.one": "fail", "a.two": "fail", "b.one": "fail" }), outcomes({ "a.one": "fail", "a.two": "fail", "b.one": "fail" }));
  assert.equal(v.ok, true);
  assert.equal(v.rowsPassing, 0);
});

test("a pass against an expected fail is red: a child's fix landed and nobody flipped its line", () => {
  const v = judge(manifest({ "a.one": "fail", "a.two": "fail", "b.one": "fail" }), outcomes({ "a.one": "pass", "a.two": "fail", "b.one": "fail" }));
  assert.equal(v.ok, false);
  assert.deepEqual(v.mismatches, [{ id: "a.one", expect: "fail", outcome: "pass" }]);
});

test("a fail against an expected pass is red: someone moved another child's assertion back", () => {
  const v = judge(manifest({ "a.one": "pass", "a.two": "fail", "b.one": "fail" }), outcomes({ "a.one": "fail", "a.two": "fail", "b.one": "fail" }));
  assert.equal(v.ok, false);
  assert.equal(v.mismatches[0].id, "a.one");
});

test("pending counts as fail: an unbuilt check matches fail and cannot satisfy pass", () => {
  const asFail = judge(manifest({ "a.one": "fail", "a.two": "fail", "b.one": "fail" }), outcomes({ "a.one": "pending", "a.two": "fail", "b.one": "fail" }));
  assert.equal(asFail.ok, true);
  const asPass = judge(manifest({ "a.one": "pass", "a.two": "fail", "b.one": "fail" }), outcomes({ "a.one": "pending", "a.two": "fail", "b.one": "fail" }));
  assert.equal(asPass.ok, false);
});

test("an error is red even against an expected fail, so a broken leg cannot pass as an expected fail", () => {
  const v = judge(manifest({ "a.one": "fail", "a.two": "fail", "b.one": "fail" }), outcomes({ "a.one": "error", "a.two": "fail", "b.one": "fail" }));
  assert.equal(v.ok, false);
  assert.equal(v.errors[0].id, "a.one");
});

test("a listed assertion with no outcome, and an outcome nobody listed, are both red", () => {
  const m = manifest({ "a.one": "fail", "a.two": "fail", "b.one": "fail" });
  const missing = judge(m, outcomes({ "a.one": "fail", "a.two": "fail" }));
  assert.deepEqual(missing.missing, ["b.one"]);
  assert.equal(missing.ok, false);
  const unlisted = judge(m, outcomes({ "a.one": "fail", "a.two": "fail", "b.one": "fail", "z.new": "fail" }));
  assert.deepEqual(unlisted.unlisted, ["z.new"]);
  assert.equal(unlisted.ok, false);
});

test("a row passes only when every cell passes, and an empty row never passes", () => {
  const m = manifest({ "a.one": "pass", "a.two": "fail", "b.one": "pass" });
  const v = judge(m, outcomes({ "a.one": "pass", "a.two": "fail", "b.one": "pass" }));
  assert.equal(v.ok, true);
  assert.deepEqual(v.rows.map((r) => [r.id, r.passing]), [["a", false], ["b", true], ["c", false]]);
  assert.equal(v.rowsPassing, 1);
});

test("the manifest refuses duplicates, unknown expectations, missing prefixes and tracker ids", () => {
  const problems = validateManifest({
    rows: [
      { id: "a", assertions: ["a.one", "b.wrong-row", "a.FIX-12"] },
      { id: "b", assertions: ["a.one"] },
    ],
    expect: { "a.one": "fail", "b.wrong-row": "maybe", "a.FIX-12": "fail", "a.ghost": "fail" },
  });
  const text = problems.join("\n");
  assert.match(text, /a\.one is listed under a and b/);
  assert.match(text, /b\.wrong-row does not carry its row's prefix/);
  assert.match(text, /b\.wrong-row expects "maybe"/);
  assert.match(text, /a\.FIX-12 carries a tracker id/);
  assert.match(text, /expect\.a\.ghost names no listed assertion/);
});

test("under the control, only fail is accepted; pending is listed, pass and error are red", () => {
  const m = manifest({ "a.one": "fail", "a.two": "fail", "b.one": "fail" });
  assert.equal(judgeControl(m, outcomes({ "a.one": "fail", "a.two": "pending", "b.one": "fail" })).ok, true);
  const passed = judgeControl(m, outcomes({ "a.one": "pass", "a.two": "fail", "b.one": "fail" }));
  assert.deepEqual([passed.ok, passed.passed], [false, ["a.one"]]);
  assert.equal(judgeControl(m, outcomes({ "a.one": "error", "a.two": "fail", "b.one": "fail" })).ok, false);
  assert.equal(judgeControl(m, outcomes({ "a.one": "fail", "a.two": "fail" })).ok, false);
});

test("a check's return maps to one outcome, and anything unrecognisable is an error", () => {
  assert.equal(outcomeOf([]).outcome, "pass");
  assert.equal(outcomeOf(["x"]).outcome, "fail");
  assert.equal(outcomeOf({ pending: "not built" }).outcome, "pending");
  assert.equal(outcomeOf({ error: "boom" }).outcome, "error");
  assert.equal(outcomeOf(undefined).outcome, "error");
  assert.equal(outcomeOf({ pending: 1 }).outcome, "error");
});

test("a ratchet cell sees only its package's violations, and workforce's only its *_ENTRY names", () => {
  const violations = [
    { package: "@flow-state-dev/core", name: "x", detail: "no consumer" },
    { package: "@flow-state-dev/workforce", name: "WORKER_ENTRY", detail: "no consumer" },
    { package: "@flow-state-dev/workforce", name: "hireWorkforce", detail: "no consumer" },
  ];
  assert.equal(ratchetFailures(violations, { package: "@flow-state-dev/engine" }).length, 0);
  assert.equal(ratchetFailures(violations, { package: "@flow-state-dev/core" }).length, 1);
  assert.deepEqual(ratchetFailures(violations, { package: "@flow-state-dev/workforce", names: /_ENTRY$/ }), [
    "@flow-state-dev/workforce WORKER_ENTRY: no consumer",
  ]);
  assert.equal(ratchetFailures(violations, { package: "*" }).length, 3);
});

test("a wired ratchet whose strict run prints no JSON verdict is an error, not a pass", () => {
  const dir = mkdtempSync(join(tmpdir(), "goal-ratchet-"));
  try {
    writeFileSync(join(dir, "quiet.mjs"), "console.log('all good');\n");
    assert.throws(() => runRatchet(dir, "quiet.mjs", dir), /no JSON verdict/);
    writeFileSync(join(dir, "ok.mjs"), "console.log(JSON.stringify({ violations: [{ package: 'p', detail: process.argv.slice(2).join(' ') }] }));\n");
    const run = runRatchet(dir, "ok.mjs", "/some/tree");
    assert.equal(run.violations[0].detail, "--strict --json --root /some/tree");
    assert.throws(() => runRatchet(dir, "absent.mjs", dir), /does not exist/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the never-published probe names a refusal or a legacy read, ignores a live use, and fails on an absent package", () => {
  const nm = mkdtempSync(join(tmpdir(), "goal-never-"));
  const put = (rel, text) => {
    mkdirSync(dirname(join(nm, rel)), { recursive: true });
    writeFileSync(join(nm, rel), text);
  };
  try {
    const entries = [
      { id: "refused", pkg: "engine", name: /detachedDrainTimeoutMs/ },
      { id: "read", pkg: "orchestration", name: /\bquestions\b/ },
      { id: "live-only", pkg: "engine", name: /maxWorkstreamListLimit/ },
      { id: "absent", pkg: "workforce", name: /hopLimit/ },
    ];
    put(
      "@flow-state-dev/engine/dist/a.js",
      'throw new Error("`detachedDrainTimeoutMs` was removed");\nconst maxWorkstreamListLimit = 5;\n * history: maxWorkstreamListLimit was removed long ago\n',
    );
    put("@flow-state-dev/engine/dist/a.js.map", "detachedDrainTimeoutMs removed");
    put("@flow-state-dev/orchestration/dist/tasks/schema/retired-shapes.js", "const { questions } = row;\n");
    const failures = probeNeverPublished(nm, entries);
    assert.equal(failures.length, 3);
    assert.match(failures[0], /^refused: @flow-state-dev\/engine\/dist\/a\.js:1:/);
    assert.match(failures[1], /^read: .*retired-shapes\.js:1:/);
    assert.match(failures[2], /^absent: @flow-state-dev\/workforce has no installed dist/);
  } finally {
    rmSync(nm, { recursive: true, force: true });
  }
});

// ── closure.j5:moved-name-named ─────────────────────────────────────────────

test("a package's changelog lines are its pending changesets' and its CHANGELOG sections newer than the version upgraded from", () => {
  const changesets = [
    '---\n"@flow-state-dev/core": minor\n"@flow-state-dev/engine": minor\n---\n\n- `foo` is on `@flow-state-dev/core/types`.\n',
    '---\n"@flow-state-dev/react": patch\n---\n\n- `bar` is gone.\n',
  ];
  const changelog =
    "# @flow-state-dev/core\n\n## 0.6.0\n\n- `six` moved.\n\n## 0.5.0\n\n- `five` moved.\n\n## 0.4.0\n\n- `four` moved.\n\n## 0.3.9\n\n- `old` moved.\n";
  const lines = changelogLines("@flow-state-dev/core", { changesets, changelog, since: "0.4.0" });
  assert.ok(lines.includes("- `foo` is on `@flow-state-dev/core/types`."));
  assert.ok(lines.includes("- `six` moved.") && lines.includes("- `five` moved."));
  assert.ok(!lines.some((l) => /bar|four|old/.test(l)), "another package's changeset, and sections at or below 0.4.0, are not the upgrade's");
  assert.deepEqual(changelogLines("@flow-state-dev/core", { changesets: [], changelog: null, since: "0.4.0" }), []);
});

const dropped = (pkg, name, homes = [], extra = {}) => ({ pkg, name, homes, failsOnNew: true, ...extra });

test("a moved name passes only when a changelog line of its package names it with its new home", () => {
  const lines = new Map([
    ["@flow-state-dev/core", ["- Import these from `@flow-state-dev/core/types`: `Moved`, `Other`.", "- `Elsewhere` is on the root still."]],
  ]);
  const failures = gradeMovedNames(
    [
      dropped("@flow-state-dev/core", "Moved", ["@flow-state-dev/core/types"]),
      dropped("@flow-state-dev/core", "Elsewhere", ["@flow-state-dev/core/models"]),
      dropped("@flow-state-dev/core", "Unnamed", ["@flow-state-dev/core/types"]),
    ],
    lines,
  );
  assert.equal(failures.length, 2);
  assert.match(failures[0], /@flow-state-dev\/core Elsewhere: no changelog line names it with its new home \(@flow-state-dev\/core\/models\)/);
  assert.match(failures[1], /@flow-state-dev\/core Unnamed: no changelog line names it/);
});

test("a home may be written as its short subpath or its ./ subpath, a name must be whole, and a name with no home in its package needs only its line", () => {
  const lines = new Map([
    [
      "@flow-state-dev/engine",
      [
        "- On `engine/host`: `SessionStore`.",
        "- **Moved to `./internal`** from the root: `splitFrontmatter`.",
        "- `ValidationError` is no longer exported.",
        "- `RequestStoreX` moved.",
        "- `Spread` is on `./hostile`.",
      ],
    ],
  ]);
  const failures = gradeMovedNames(
    [
      dropped("@flow-state-dev/engine", "SessionStore", ["@flow-state-dev/engine/host"]),
      dropped("@flow-state-dev/engine", "splitFrontmatter", ["@flow-state-dev/engine/internal"]),
      dropped("@flow-state-dev/engine", "ValidationError"),
      dropped("@flow-state-dev/engine", "RequestStore", ["@flow-state-dev/engine/host"]),
      dropped("@flow-state-dev/engine", "Spread", ["@flow-state-dev/engine/host"]),
    ],
    lines,
  );
  assert.equal(failures.length, 2);
  assert.match(failures[0], /RequestStore: no changelog line names it$/);
  assert.match(failures[1], /Spread: no changelog line names it with its new home/, "`./hostile` is not `./host`");
});

test("a dropped name that still compiles from the root fails, and a journey that walked no name fails", () => {
  const lines = new Map([["@flow-state-dev/core", ["- `Kept` moved to `@flow-state-dev/core/types`."]]]);
  const failures = gradeMovedNames([dropped("@flow-state-dev/core", "Kept", ["@flow-state-dev/core/types"], { failsOnNew: false })], lines);
  assert.match(failures.join("\n"), /Kept: still compiles from the root on these tarballs/);
  assert.match(gradeMovedNames([], lines).join("\n"), /walked no name/);
});

test("the planted control removes every line naming one name, and only that name then fails", () => {
  const lines = new Map([["@flow-state-dev/core", ["- `A` and `B` are on `@flow-state-dev/core/types`.", "- `B` again, on `core/types`."]]]);
  const names = [dropped("@flow-state-dev/core", "A", ["@flow-state-dev/core/types"]), dropped("@flow-state-dev/core", "B", ["@flow-state-dev/core/types"])];
  assert.deepEqual(gradeMovedNames(names, lines), []);
  const planted = plantLineRemoval(lines, names[0]);
  assert.deepEqual(planted.get("@flow-state-dev/core"), ["- `B` again, on `core/types`."]);
  assert.equal(lines.get("@flow-state-dev/core").length, 2, "the plant copies; it does not edit the real lines");
  const failures = gradeMovedNames(names, planted);
  assert.equal(failures.length, 1);
  assert.match(failures[0], /core A: no changelog line names it/);
});
