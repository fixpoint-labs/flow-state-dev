/**
 * A worker's standing rules for one user, as a list: its shape, the one
 * validator every writer goes through, and how the list reads in a prompt
 * (FIX-1945 S2).
 *
 * Pure: no storage, no context. The record (`./rules-record`) persists what
 * {@link applyRuleEdit} returns, and both writers, the rule tools and the
 * rules action, call it, so a limit can't hold on one path and break on the
 * other.
 *
 * A leaf, so the browser entry and the client share the list's shape.
 */
import { z } from "zod";

/** The most rules one worker keeps for one user. */
export const MAX_RULES = 20;

/** The most characters one rule may hold. */
export const MAX_RULE_CHARS = 300;

/** One standing rule: its text, when it was added, and the conversation it came from. */
export const standingRuleSchema = z.object({
  text: z.string(),
  /** Epoch milliseconds at the add. A change keeps it. */
  addedAt: z.number(),
  /** The conversation the rule was added in, or `null` when it was added on the Rules page. */
  sessionId: z.string().nullable().default(null)
});

export type StandingRule = z.infer<typeof standingRuleSchema>;

/**
 * A worker's rules for one user. `version` counts the writes the list has
 * taken: every write names the version it read, and one that read an older
 * list is refused rather than landing on a list it never saw.
 */
export const standingRulesStateSchema = z.object({
  version: z.number().int().min(0).default(0),
  rules: z.array(standingRuleSchema).default([])
});

export type StandingRules = z.infer<typeof standingRulesStateSchema>;

/** The list nobody has written yet. */
export const EMPTY_RULES: StandingRules = { version: 0, rules: [] };

/** One write to the list. Change and remove name the rule by number and quote its current text. */
export type RuleEdit =
  | { op: "add"; text: string }
  | { op: "change"; number: number; current: string; text: string }
  | { op: "remove"; number: number; current: string };

/** What a write came to: the new list and the line that says so, or the reason it was refused with the list as it stands. */
export type RuleEditOutcome =
  | { ok: true; list: StandingRules; line: string }
  | { ok: false; reason: string; list: StandingRules; full?: true };

/** Where an added rule came from: the conversation, or `null` for the Rules page. */
export interface RuleEditSource {
  readonly sessionId: string | null;
  readonly now: number;
}

/** Why `text` can't be a rule, or `undefined` when it can. */
function textProblem(text: string): string | undefined {
  if (text.length === 0) return "a rule can't be empty";
  if (/[\r\n]/.test(text)) return "a rule is one line, and this text has more than one";
  if (text.length > MAX_RULE_CHARS) {
    return `a rule is at most ${MAX_RULE_CHARS} characters, and this one is ${text.length}`;
  }
  return undefined;
}

const quote = (text: string) => `"${text}"`;

/** The one validator. A refusal returns `list` unchanged. */
export function applyRuleEdit(
  list: StandingRules,
  version: number,
  edit: RuleEdit,
  source: RuleEditSource
): RuleEditOutcome {
  const refuse = (reason: string, full?: true): RuleEditOutcome => ({ ok: false, reason, list, ...(full ? { full } : {}) });
  if (version !== list.version) {
    return refuse(`the rules changed since they were read (version ${version}, now ${list.version}); here they are as they stand`);
  }
  const next = (rules: StandingRule[]): StandingRules => ({ version: list.version + 1, rules });

  if (edit.op === "add") {
    const text = edit.text.trim();
    const problem = textProblem(text);
    if (problem !== undefined) return refuse(problem);
    if (list.rules.length >= MAX_RULES) {
      return refuse(
        `the list is full (${list.rules.length} of ${MAX_RULES}); merge or drop a rule before adding one`,
        true
      );
    }
    const rules = [...list.rules, { text, addedAt: source.now, sessionId: source.sessionId }];
    return { ok: true, list: next(rules), line: `✎ Rule added (${rules.length} of ${MAX_RULES}): ${quote(text)}` };
  }

  const index = edit.number - 1;
  const held = Number.isInteger(edit.number) ? list.rules[index] : undefined;
  if (held === undefined) {
    return refuse(`there is no rule ${edit.number}; the list has ${list.rules.length}`);
  }
  if (held.text !== edit.current.trim()) {
    return refuse(`rule ${edit.number} reads ${quote(held.text)}, not ${quote(edit.current.trim())}`);
  }

  if (edit.op === "remove") {
    const rules = list.rules.filter((_rule, at) => at !== index);
    return {
      ok: true,
      list: next(rules),
      line: `✎ Rule ${edit.number} removed (${rules.length} of ${MAX_RULES} left): ${quote(held.text)}`
    };
  }

  const text = edit.text.trim();
  const problem = textProblem(text);
  if (problem !== undefined) return refuse(problem);
  const rules = list.rules.map((rule, at) => (at === index ? { ...rule, text } : rule));
  return {
    ok: true,
    list: next(rules),
    line: `✎ Rule ${edit.number} changed: ${quote(held.text)} → ${quote(text)}`
  };
}

/** The list numbered from 1, as the tools and the action answer it. */
export function numberedRules(list: StandingRules): Array<{ number: number; text: string; addedAt: number; sessionId: string | null }> {
  return list.rules.map((rule, at) => ({ number: at + 1, ...rule }));
}

/** The prompt text, or `undefined` when the list is empty. */
export function renderRules(list: StandingRules): string | undefined {
  if (list.rules.length === 0) return undefined;
  const lines = list.rules.map((rule, at) => `${at + 1}. ${rule.text}`);
  return [
    "Standing rules (notes this user asked you to keep; follow them on every turn):",
    ...lines
  ].join("\n");
}
