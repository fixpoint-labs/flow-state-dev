/**
 * The slash menu — verbs while the name is being typed, then board ids
 * for verbs that take one. The board is the authority; this does not
 * invent a second index.
 */
import {
  SLASH_HINTS,
  SLASH_NEEDS_ARG,
  slashArgPrefix,
  slashMatches,
} from "./parse";
import { rowRunning, selectedQuestions, selectedRow, type ViewState } from "./types";

/** One row in the slash dropdown. */
export interface SlashMenuItem {
  /** Prompt after Tab. */
  fill: string;
  /** Left column — ` /status` or ` FIX-1`. */
  label: string;
  hint: string;
  /** Enter should leave the line for more typing. */
  needsMore: boolean;
}

/** Items for the open slash line, or empty when there is nothing to offer. */
export function slashMenu(state: ViewState): SlashMenuItem[] {
  const verbs = slashMatches(state.input);
  if (verbs.length > 0) {
    return verbs.map((verb) => ({
      fill: SLASH_NEEDS_ARG.has(verb) ? `/${verb} ` : `/${verb}`,
      label: `/${verb}`,
      hint: SLASH_HINTS[verb as keyof typeof SLASH_HINTS] ?? "",
      needsMore: SLASH_NEEDS_ARG.has(verb),
    }));
  }
  const arg = slashArgPrefix(state.input);
  if (arg === null) return [];
  return argChoices(state, arg.verb, arg.prefix).map((choice) => ({
    fill: arg.verb === "answer" ? `/${arg.verb} ${choice.value} ` : `/${arg.verb} ${choice.value}`,
    label: choice.value,
    hint: choice.hint,
    needsMore: arg.verb === "answer",
  }));
}

function argChoices(
  state: ViewState,
  verb: string,
  prefix: string,
): { value: string; hint: string }[] {
  if (verb === "answer") return questionChoices(state, prefix);
  return issueChoices(state, prefix, verb === "abort" || verb === "stop");
}

function questionChoices(
  state: ViewState,
  prefix: string,
): { value: string; hint: string }[] {
  const out: { value: string; hint: string }[] = [];
  const seen = new Set<string>();
  const add = (id: string, hint: string) => {
    if (seen.has(id)) return;
    if (prefix !== "" && !id.toLowerCase().startsWith(prefix)) return;
    seen.add(id);
    out.push({ value: id, hint });
  };
  for (const question of selectedQuestions(state)) {
    add(question.question, question.text);
  }
  for (const row of state.rows) {
    if (row === selectedRow(state)) continue;
    for (const question of row.questions) {
      add(question.question, row.issue ?? row.taskId);
    }
  }
  return out;
}

function issueChoices(
  state: ViewState,
  prefix: string,
  runningFirst: boolean,
): { value: string; hint: string }[] {
  const out: { value: string; hint: string }[] = [];
  const seen = new Set<string>();
  const add = (id: string, hint: string) => {
    if (id === "" || seen.has(id.toLowerCase())) return;
    if (prefix !== "" && !id.toLowerCase().startsWith(prefix)) return;
    seen.add(id.toLowerCase());
    out.push({ value: id, hint });
  };
  const selected = selectedRow(state);
  const rows = runningFirst
    ? [...state.rows.filter(rowRunning), ...state.rows.filter((row) => !rowRunning(row))]
    : state.rows;
  if (selected !== undefined && !runningFirst) {
    add(selected.issue ?? selected.taskId, selected.status);
  }
  for (const row of rows) {
    if (!runningFirst && row === selected) continue;
    add(row.issue ?? row.taskId, row.status);
  }
  if (runningFirst && selected !== undefined && rowRunning(selected)) {
    const id = selected.issue ?? selected.taskId;
    const at = out.findIndex((item) => item.value === id);
    if (at > 0) {
      const [hit] = out.splice(at, 1);
      if (hit !== undefined) out.unshift(hit);
    }
  }
  return out;
}
