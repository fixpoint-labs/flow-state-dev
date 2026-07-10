/**
 * Target model and dispatch resolution for `fsdev chat`. Pure — no I/O.
 *
 * A "target" is what a message routes to: a `(flowKind, action)` pair.
 */
import type { FlowInstance } from "@flow-state-dev/core/types";
import type { ParsedInput } from "./parse";
import type { HarnessState } from "./state";
import type { BuiltinCommand } from "./registry";

/** A flow action, addressed by flow kind + action name. */
export interface FlowActionTarget {
  flowKind: string;
  actionName: string;
}

/** What the loop should do with a parsed line, once resolved against state. */
export type Dispatch =
  | { kind: "builtin"; command: BuiltinCommand; args: string }
  | { kind: "turn"; target: FlowActionTarget; text: string }
  /** Unknown `/name`: send the RAW line (slash included) to the default target so
   *  the flow's own skill-slash-match can still fire. */
  | { kind: "fallthrough"; text: string }
  /** Free text (or a fall-through) but no default target is bound. */
  | { kind: "unbound" }
  /** Nothing to do (empty line, or a lone `/`); `hint` is an optional nudge. */
  | { kind: "noop"; hint?: string };

/**
 * Enumerate the available targets. Distinct kinds come from `list()`, but each
 * kind's actions are read from `get(kind)` — the registry-default instance, the
 * same instance turn execution resolves — because `get()` and `list()` order
 * instances differently when a kind has more than one.
 */
export function listTargets(registry: {
  list(): FlowInstance[];
  get(kind: string, id?: string): FlowInstance | undefined;
}): FlowActionTarget[] {
  const kinds = [...new Set(registry.list().map((f) => f.kind))];
  const targets: FlowActionTarget[] = [];
  for (const flowKind of kinds) {
    const instance = registry.get(flowKind);
    if (instance === undefined) continue;
    for (const actionName of Object.keys(instance.actions)) {
      targets.push({ flowKind, actionName });
    }
  }
  return targets;
}

/** Outcome of resolving a `flowKind` (+ optional action) against a target list. */
export type PickTargetResult =
  | { ok: true; target: FlowActionTarget }
  | { ok: false; reason: "unknown-flow"; flowKind: string; available: string[] }
  | { ok: false; reason: "unknown-action"; flowKind: string; actionName: string; actions: string[] }
  | { ok: false; reason: "ambiguous"; flowKind: string; actions: string[] };

/**
 * Resolve a `flowKind` (+ optional action) against the enumerated targets. Pure:
 * returns a structured `reason` on failure so each caller — config default,
 * positional startup binding, `/use` — formats the error under its own taxonomy
 * (config error vs discovery/invalid-args exit code vs a builtin `ok: false`).
 */
export function pickTarget(
  targets: FlowActionTarget[],
  flowKind: string,
  actionName: string | undefined,
): PickTargetResult {
  const forKind = targets.filter((t) => t.flowKind === flowKind);
  if (forKind.length === 0) {
    return { ok: false, reason: "unknown-flow", flowKind, available: [...new Set(targets.map((t) => t.flowKind))] };
  }
  if (actionName !== undefined) {
    const found = forKind.find((t) => t.actionName === actionName);
    if (found === undefined) {
      return { ok: false, reason: "unknown-action", flowKind, actionName, actions: forKind.map((t) => t.actionName) };
    }
    return { ok: true, target: found };
  }
  if (forKind.length > 1) {
    return { ok: false, reason: "ambiguous", flowKind, actions: forKind.map((t) => t.actionName) };
  }
  return { ok: true, target: forKind[0]! };
}

/** Resolve a parsed line into a dispatch decision against the current state. */
export function resolveDispatch(
  parsed: ParsedInput,
  state: HarnessState,
  builtins: ReadonlyMap<string, BuiltinCommand>,
): Dispatch {
  switch (parsed.kind) {
    case "empty":
      return { kind: "noop" };
    case "command": {
      if (parsed.name === "") {
        return { kind: "noop", hint: "type /help for commands" };
      }
      const builtin = builtins.get(parsed.name);
      if (builtin !== undefined) {
        return { kind: "builtin", command: builtin, args: parsed.args };
      }
      // Unknown /name: fall through to the flow as the raw line. Requires a bound
      // target — an unbound harness has nothing to fall through to.
      if (state.defaultTarget === undefined) return { kind: "unbound" };
      return { kind: "fallthrough", text: parsed.raw };
    }
    case "chat": {
      if (state.defaultTarget === undefined) return { kind: "unbound" };
      return { kind: "turn", target: state.defaultTarget, text: parsed.text };
    }
  }
}
