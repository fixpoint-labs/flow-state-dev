/**
 * The one validator every standing-rules writer goes through (FIX-1945 S2,
 * V2): its limits, its stale-quote and stale-version refusals, and the text a
 * turn reads. Pure, so each refusal is checked against the list it leaves
 * untouched.
 */
import { describe, expect, it } from "vitest";
import {
  EMPTY_RULES,
  MAX_RULES,
  MAX_RULE_CHARS,
  applyRuleEdit,
  renderRules,
  type StandingRules
} from "../src/standing-rules/rules-list";

const at = { sessionId: "talk-1", now: 1_000 };

/** A list of `n` rules, `rule 1` … `rule n`, at version `n`. */
function listOf(n: number): StandingRules {
  return {
    version: n,
    rules: Array.from({ length: n }, (_, i) => ({ text: `rule ${i + 1}`, addedAt: i, sessionId: null }))
  };
}

describe("adding a rule", () => {
  it("adds it at the end, bumps the version, and says which rule and the count", () => {
    const outcome = applyRuleEdit(listOf(2), 2, { op: "add", text: "  Name the project first.  " }, at);
    expect(outcome).toEqual({
      ok: true,
      list: {
        version: 3,
        rules: [...listOf(2).rules, { text: "Name the project first.", addedAt: 1_000, sessionId: "talk-1" }]
      },
      line: `✎ Rule added (3 of ${MAX_RULES}): "Name the project first."`
    });
  });

  it("refuses a 21st rule, naming the cap and the count, and marks it full so the user is told (BR-16)", () => {
    const full = listOf(MAX_RULES);
    const outcome = applyRuleEdit(full, MAX_RULES, { op: "add", text: "one more" }, at);
    expect(outcome).toMatchObject({ ok: false, full: true, list: full });
    expect(outcome.ok ? "" : outcome.reason).toContain(`${MAX_RULES} of ${MAX_RULES}`);
    // One below the cap still adds: the refusal is the cap, not the count being large.
    expect(applyRuleEdit(listOf(MAX_RULES - 1), MAX_RULES - 1, { op: "add", text: "last" }, at).ok).toBe(true);
  });

  it("refuses empty text, more than one line, and over the character limit, with the reason (BR-17)", () => {
    const list = listOf(1);
    const reasonOf = (text: string) => {
      const outcome = applyRuleEdit(list, 1, { op: "add", text }, at);
      expect(outcome.ok).toBe(false);
      expect(outcome.list).toBe(list);
      return outcome.ok ? "" : outcome.reason;
    };
    expect(reasonOf("   ")).toMatch(/empty/);
    expect(reasonOf("first line\nsecond line")).toMatch(/one line/);
    expect(reasonOf("x".repeat(MAX_RULE_CHARS + 1))).toMatch(new RegExp(`${MAX_RULE_CHARS}`));
    expect(applyRuleEdit(list, 1, { op: "add", text: "x".repeat(MAX_RULE_CHARS) }, at).ok).toBe(true);
  });
});

describe("changing and removing a rule", () => {
  it("changes the numbered rule when the quote matches, keeping when and where it was added (BR-2)", () => {
    const outcome = applyRuleEdit(listOf(3), 3, { op: "change", number: 2, current: "rule 2", text: "rule two" }, at);
    expect(outcome).toMatchObject({ ok: true, line: '✎ Rule 2 changed: "rule 2" → "rule two"' });
    expect(outcome.list.rules[1]).toEqual({ text: "rule two", addedAt: 1, sessionId: null });
    expect(outcome.list.version).toBe(4);
  });

  it("removes the numbered rule when the quote matches, and renumbers the rest (BR-2)", () => {
    const outcome = applyRuleEdit(listOf(3), 3, { op: "remove", number: 1, current: "rule 1" }, at);
    expect(outcome).toMatchObject({ ok: true, line: `✎ Rule 1 removed (2 of ${MAX_RULES} left): "rule 1"` });
    expect(outcome.list.rules.map((rule) => rule.text)).toEqual(["rule 2", "rule 3"]);
  });

  it("refuses a number whose rule no longer reads as quoted, and one that doesn't exist (BR-15)", () => {
    const list = listOf(3);
    const stale = applyRuleEdit(list, 3, { op: "remove", number: 2, current: "rule 3" }, at);
    expect(stale).toMatchObject({ ok: false, list });
    expect(stale.ok ? "" : stale.reason).toContain('rule 2 reads "rule 2"');
    expect(applyRuleEdit(list, 3, { op: "change", number: 4, current: "rule 4", text: "x" }, at)).toMatchObject({ ok: false, list });
    expect(applyRuleEdit(list, 3, { op: "change", number: 0, current: "rule 1", text: "x" }, at)).toMatchObject({ ok: false, list });
  });
});

describe("a write that read an older list (BR-18)", () => {
  it("is refused with the list as it stands, for an add as for a change", () => {
    const list = listOf(2);
    expect(applyRuleEdit(list, 1, { op: "add", text: "late" }, at)).toMatchObject({ ok: false, list });
    expect(applyRuleEdit(list, 1, { op: "change", number: 1, current: "rule 1", text: "x" }, at)).toMatchObject({
      ok: false,
      list
    });
  });
});

describe("the text a turn reads", () => {
  it("numbers every rule, and is absent for an empty list (BR-6, BR-7)", () => {
    expect(renderRules(EMPTY_RULES)).toBeUndefined();
    const text = renderRules(listOf(2))!;
    expect(text.split("\n").slice(1)).toEqual(["1. rule 1", "2. rule 2"]);
  });

  it("stays near the per-turn budget at the cap", () => {
    // D3's price: 20 rules of 300 characters is about 1,500 tokens on every turn.
    const full: StandingRules = {
      version: MAX_RULES,
      rules: Array.from({ length: MAX_RULES }, () => ({ text: "x".repeat(MAX_RULE_CHARS), addedAt: 0, sessionId: null }))
    };
    expect(renderRules(full)!.length).toBeLessThan(MAX_RULES * (MAX_RULE_CHARS + 6) + 120);
  });
});
