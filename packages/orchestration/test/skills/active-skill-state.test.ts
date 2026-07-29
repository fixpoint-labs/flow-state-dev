import { describe, expect, it } from "vitest";
import {
  pushActiveSkill,
  readActiveSkills,
  unionAllowedTools,
  type ActiveSkillEntry,
} from "../../src/skills/active-skill-state";

const entry = (
  name: string,
  mode: "inline" = "inline",
  input?: string,
): ActiveSkillEntry => ({
  name,
  mode,
  input,
  activatedAt: 1,
});

describe("readActiveSkills", () => {
  it("returns [] for missing/invalid state", () => {
    expect(readActiveSkills(null)).toEqual([]);
    expect(readActiveSkills({})).toEqual([]);
    expect(readActiveSkills({ activeSkills: "not an array" })).toEqual([]);
  });
  it("returns the array when present", () => {
    expect(readActiveSkills({ activeSkills: [entry("foo")] })).toEqual([
      entry("foo"),
    ]);
  });
});

describe("pushActiveSkill", () => {
  it("appends a new entry", () => {
    const out = pushActiveSkill([], entry("foo"));
    expect(out).toEqual([entry("foo")]);
  });
  it("replaces existing entry with same name+mode", () => {
    const initial = [entry("foo", "inline", "old")];
    const out = pushActiveSkill(initial, entry("foo", "inline", "new"));
    expect(out).toHaveLength(1);
    expect(out[0]!.input).toBe("new");
  });
});

describe("unionAllowedTools", () => {
  it("returns undefined when no inline skill declares allowed-tools", () => {
    const active = [entry("foo"), entry("bar")];
    expect(
      unionAllowedTools(active, { foo: undefined, bar: undefined }),
    ).toBeUndefined();
  });

  it("unions allowed-tools across active inline skills", () => {
    const active = [entry("foo"), entry("bar")];
    expect(
      unionAllowedTools(active, { foo: ["a", "b"], bar: ["b", "c"] }),
    ).toEqual(["a", "b", "c"]);
  });

  // FIX-972: a skill name colliding with an `Object.prototype` member must not
  // resolve to the inherited member. `perSkillAllowed["constructor"]` returned
  // `Object` — truthy, and `.length > 0` because that is the constructor's
  // *arity*, not a list length — so it passed the old guard and then threw
  // `TypeError: list is not iterable`. The arity-0 members ("toString",
  // "valueOf") only escaped that crash by accident; the table asserts all four
  // behave identically, i.e. exactly like a skill declaring no `allowed-tools`.
  // Same name table as the FIX-965 sibling in
  // `workforce/test/materialize-agent.test.ts`.
  it.each(["constructor", "toString", "valueOf", "hasOwnProperty"])(
    "treats prototype-named skill %j as declaring no allowed-tools",
    (protoName) => {
      expect(unionAllowedTools([entry(protoName)], {})).toBeUndefined();
      // A sibling that really declares tools still restricts — and the
      // prototype-named skill contributes nothing to the union.
      expect(
        unionAllowedTools([entry(protoName), entry("foo")], {
          foo: ["a"],
        }),
      ).toEqual(["a"]);
    },
  );
});
