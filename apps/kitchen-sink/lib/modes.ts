/**
 * Kitchen Sink's modes: what the picker at `/` lists, in its order, and where
 * each one opens.
 *
 * A leaf module (BP-019): the browser imports it for the picker's labels and
 * a harness frame's flow kind, and the server imports it for the gate. Whether
 * a mode can run on this host is not here; that is `lib/harness-gate.ts`,
 * decided on the server.
 */

/** Every mode's id, in the picker's order. */
export type ModeId = "flow-state" | "claude-code" | "codex" | "cursor";

/** A coding harness mode: every mode except Flow State. */
export type HarnessModeId = Exclude<ModeId, "flow-state">;

/** One mode as the picker lists it. */
export interface KitchenSinkMode {
  readonly id: ModeId;
  /** The name a person reads on the picker and at the top of the mode's rail. */
  readonly label: string;
  /** The mode's own address. */
  readonly href: `/${string}`;
  /**
   * A harness mode's session flow kind, whose sessions its rail lists. Unset
   * until the mode's own issue registers that flow; a harness mode without one
   * is "not built yet". The kinds are pinned: `claude-code-session`,
   * `codex-session`, `cursor-session`. Always unset for Flow State, whose rail
   * is its own.
   */
  readonly flowKind?: string;
}

/** The four modes, in the order the picker shows them. */
export const MODES: readonly KitchenSinkMode[] = [
  { id: "flow-state", label: "Flow State", href: "/flow-state" },
  { id: "claude-code", label: "Claude Code", href: "/claude-code", flowKind: "claude-code-session" },
  { id: "codex", label: "Codex", href: "/codex", flowKind: "codex-session" },
  { id: "cursor", label: "Cursor", href: "/cursor", flowKind: "cursor-session" },
];

/** The mode with this id. */
export function modeById(id: ModeId): KitchenSinkMode {
  const mode = MODES.find((m) => m.id === id);
  if (mode === undefined) throw new Error(`unknown Kitchen Sink mode: ${id}`);
  return mode;
}

/** Whether a mode is a coding harness mode. */
export function isHarnessMode(id: ModeId): id is HarnessModeId {
  return id !== "flow-state";
}

/**
 * A built harness mode's flow kind. Throws for a mode with none: the gate
 * makes a harness mode available only once it has one, so a caller holding an
 * available mode trusts that rather than falling back to "not built yet".
 */
export function flowKindOf(mode: KitchenSinkMode): string {
  if (mode.flowKind === undefined) throw new Error(`Kitchen Sink mode ${mode.id} has no flow kind: it is not built.`);
  return mode.flowKind;
}
