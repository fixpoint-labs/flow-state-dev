/**
 * Target model and dispatch resolution for `fsdev chat`. Pure — no I/O.
 *
 * A "target" is what a message routes to. Today the only kind is a
 * `(flowKind, action)` pair; the `Target` union and the exhaustive `Dispatch`
 * switch are shaped so later kinds ("skill", "workstream") slot in without a
 * redesign.
 */
import type { FlowInstance } from "@flow-state-dev/core/types";
import type { ParsedInput } from "./parse";
import type { HarnessState } from "./state";
import type { BuiltinCommand } from "./registry";

/** A flow action, addressed by flow kind + action name. */
export interface FlowActionTarget {
  kind: "flow-action";
  flowKind: string;
  actionName: string;
}

/**
 * The set of resolvable targets. Future kinds extend this union; `Dispatch` and
 * turn execution switch exhaustively over `Target["kind"]` so additions are
 * compile-checked.
 */
export type Target = FlowActionTarget;

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
      targets.push({ kind: "flow-action", flowKind, actionName });
    }
  }
  return targets;
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
