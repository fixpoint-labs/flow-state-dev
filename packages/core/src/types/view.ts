// FIX-2623.
/**
 * A view: the one hook a screen uses to watch an answer the server computes.
 *
 * A view is a block with a scope. It runs where its data lives: on a session,
 * or at user or org scope with no session at all. Its context refuses every
 * write and every model call, so watching a view never changes what it reads
 * and never pays for a model. The engine records what each run read, and the
 * answer names the change topics those reads fall under, so a client stays
 * current by listening to them without naming a topic itself.
 *
 * The block must declare an output schema: {@link ViewOutput} is that
 * schema's type, so a screen never holds an untyped answer.
 */
import type { ChangeKind, WireTopic } from "@flow-state-dev/contracts";
import type { BlockDefinition, BlockInput, BlockOutput } from "./block";

/** Where a view runs: on a session, or at the caller's user or org scope with no session. */
export type ViewScope = "session" | "user" | "org";

/** The element type of a block whose output is a list, else `never`. */
export type ViewElement<TBlock extends BlockDefinition> =
  BlockOutput<TBlock> extends readonly (infer TElement)[] ? TElement : never;

/** What an author writes for {@link defineView}. */
export type ViewConfig<
  TBlock extends BlockDefinition = BlockDefinition,
  TScope extends ViewScope = ViewScope
> = {
  /**
   * Where the view runs. `"user"` and `"org"` run with no session: the caller's
   * user and org come from the verified principal, and a block that reaches
   * for `ctx.session` is refused with `NoSessionError`.
   */
  scope: TScope;
  /** The block that computes the answer. It must declare an `outputSchema`. */
  block: TBlock;
  /** Overrides `block.inputSchema` for the view's input, as on an action. */
  inputSchema?: TBlock["inputSchema"];
  /**
   * The row's key, for a view whose answer is a list. With it the answer must
   * be an array whose rows have distinct string keys, and a screen keeps rows
   * by key.
   *
   * Method syntax on purpose: its parameter is checked bivariantly, so a view
   * with no list (whose entry is `never`) is still a `ViewDefinition` under
   * `strictFunctionTypes`. An author's `key` is still typed by the entry.
   */
  key?(entry: ViewElement<TBlock>): string;
  /** Human-readable description, for tooling. Defaults to `block.description`. */
  description?: string;
};

/** A view as {@link defineView} returns it. Install it in a flow's `views`. */
export type ViewDefinition<
  TBlock extends BlockDefinition = BlockDefinition,
  TScope extends ViewScope = ViewScope
> = Readonly<ViewConfig<TBlock, TScope>> & { readonly kind: "view" };

/** The answer a view computes: its block's output type. Never `unknown`. */
export type ViewOutput<TView extends { block: BlockDefinition }> = BlockOutput<TView["block"]>;

/** The input a view takes: its block's input type. */
export type ViewInput<TView extends { block: BlockDefinition }> = BlockInput<TView["block"]>;

// FIX-2625 D1.
/**
 * The change a view's run is asked to answer for: the notice that woke its
 * watcher, with the ids it named. Ids are the publisher's (a task on a
 * `board` notice, an entry's storage key on a `resource` notice), never row
 * keys: only the view knows which of its rows an id touches.
 */
export type ViewChange = {
  readonly topic: WireTopic;
  readonly kind: ChangeKind;
  readonly ids: readonly string[];
};

/**
 * What a view's block sees of its run, as `ctx.view`: set on every block of a
 * view's run, child blocks included, and absent anywhere else.
 */
export interface ViewRunContext {
  /**
   * The change this run may answer for, or `undefined` on a whole run (a
   * first read, a connect, a notice with no ids, a view with no `key`).
   */
  readonly changed?: ViewChange;
  /**
   * Answer for just some rows: `entries` are placed by key over the rows the
   * screen holds (a key it holds is replaced in place, a new one goes last),
   * and `removed` keys are dropped. Return what this returns. Opt-in: a view
   * that never calls it answers whole. Answer whole whenever a change could
   * move a row or put a new one anywhere but last: a partial answer never
   * reorders rows.
   *
   * @throws When the run has no `changed`, or the view declares no `key`.
   */
  partial<TEntries extends readonly unknown[]>(entries: TEntries, options?: { removed?: readonly string[] }): TEntries;
}
