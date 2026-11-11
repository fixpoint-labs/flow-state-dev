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
