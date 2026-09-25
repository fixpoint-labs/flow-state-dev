/**
 * `defineFacetedCollection` — a resource collection whose content bodies are
 * classified once, when written, by an app's evaluator block, with a search
 * over the stored answers that makes no model call.
 *
 * The app brings its own fields and its evaluator. The definer adds two
 * fields to the collection's state — `facets` (the evaluator's answers, keyed
 * by question id, stored exactly as returned) and `indexedAs` (which write the
 * facets may describe) — binds its own `reactTo.contentUpdated`, and returns
 * `{ collection, search, reindex, resources }`.
 *
 * Every body write inside a flow turn runs the reaction, which keeps three
 * rules:
 *
 * 1. Clear first. A blocking step clears `facets` and stamps a fresh
 *    `indexedAs` token in one state write, then reads the body. If the
 *    classification fails, the row has no facets rather than stale ones.
 * 2. Classify on a side chain. A failed or refused model call shows in the
 *    trace and does not fail the write. Nothing retries.
 * 3. Store only answers about the current body: the answers are written
 *    through `updateState`, conditioned on the token, so the check and the
 *    write commit together.
 *
 * Why the definer owns the collection: the reaction reads the collection and
 * the collection binds the reaction. Building the reaction first, then the
 * collection, then the blocks that declare it keeps that ordering here. The
 * reaction reads the collection through `ctx.resources[name]`, the flow's
 * registry keyed by accessor, which is why the flow must register the
 * returned `resources`.
 *
 * Refused when built, each with its reason: a non-evaluator, questions
 * computed per call, a `contentUpdated` binding, client body edits, a state
 * schema that isn't an object or already declares `facets` / `indexedAs`, a
 * question id of `minConfidence`, a parameterized key pattern, and evaluator
 * declarations the flow can't carry (a `flowConfigSchema`, a lazy single
 * resource, a resource accessor equal to `name`). Nothing here names,
 * resolves or builds a model.
 */
import { z, type ZodTypeAny, type ZodType } from "zod";
import { handler } from "../blocks/handler";
import { sequencer } from "../blocks/sequencer";
import { assertEvaluatorBlock, staticEvaluatorQuestions } from "../blocks/evaluator";
import type { JsonObject } from "../schema/common";
import type { BlockDefinition, BlockOutput, DeclaredResources } from "./block";
import type { ChoiceAnswer, EvaluatorAnswer, EvaluatorQuestion } from "./evaluation";
import type { CollectionClientConfig } from "./resource";
import {
  defineResourceCollection,
  isDefinedResourceCollection,
  type DefinedResourceCollection,
  type ResourceCollectionConfig,
  type ResourceCollectionRef,
} from "./resource-collection";
import { getPatternPrefix, isParameterizedPattern } from "./collection-patterns";
import {
  resourceContentChangeSchema,
  type ReactiveBindings,
  type ResourceContentChange,
} from "./resource-change";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Any evaluator block: its output carries `answers`. */
type AnyEvaluatorBlock = BlockDefinition<any, any, any, { answers: Record<string, EvaluatorAnswer> }>;

type AsStateObject<T> = T extends JsonObject ? T : JsonObject;

/** The answers an evaluator block returns, keyed by question id: what `facets` stores. */
export type FacetsOf<TEvaluator> = BlockOutput<TEvaluator> extends { answers: infer A } ? A : never;

/** The ids of the choice questions among a set of facets. */
type ChoiceIdsOf<TFacets> = {
  [K in keyof TFacets & string]: TFacets[K] extends ChoiceAnswer<any> ? K : never;
}[keyof TFacets & string];

/**
 * What a facet search takes: one optional value per choice question (its
 * option keys), plus an optional `minConfidence` in [0, 1].
 */
export type FacetSearchInput<TFacets> = {
  [K in ChoiceIdsOf<TFacets>]?: TFacets[K] extends ChoiceAnswer<infer O> ? O : never;
} & { minConfidence?: number };

/** What a facet search returns: the matching instance keys. */
export type FacetSearchOutput = { keys: string[] };

/** What reindex takes: `force` reclassifies every row with a body. */
export type FacetReindexInput = { force?: boolean };

/** What reindex returns: the keys whose body it classified. */
export type FacetReindexOutput = { reindexed: string[] };

/**
 * The stored state of a faceted collection instance: the app's own fields,
 * plus `facets` (null until classified, and whenever a classification failed
 * or was superseded) and `indexedAs`.
 */
export type FacetedState<TState, TFacets> = TState & {
  facets: TFacets | null;
  indexedAs: string | null;
};

/** Config for {@link defineFacetedCollection}. */
export type FacetedCollectionConfig<
  TName extends string = string,
  TStateSchema extends z.AnyZodObject = z.AnyZodObject,
  TEvaluator extends AnyEvaluatorBlock = AnyEvaluatorBlock,
> = Omit<ResourceCollectionConfig, "stateSchema" | "reactTo" | "client"> & {
  /**
   * The accessor the collection is registered under. The returned
   * `resources` registers it under this name; the search, reindex and the
   * reaction read it from here.
   */
  name: TName;
  /**
   * The evaluator block that classifies each body. Its questions must be a
   * fixed object: they type the stored facets and the search's options. It
   * receives the body as its input.
   */
  evaluator: TEvaluator;
  /** The app's own fields. `facets` and `indexedAs` are added. */
  stateSchema: TStateSchema;
  /**
   * Client visibility. Reads and deletes are allowed; `content.create` and
   * `content.update` are refused, because a client body edit runs no
   * reaction and would leave facets describing text the row no longer has.
   */
  client?: CollectionClientConfig<AsStateObject<FacetedState<z.infer<TStateSchema>, FacetsOf<TEvaluator>>>>;
  /** The app's own `created` / `stateUpdated` / `deleted` bindings. `contentUpdated` is the definer's. */
  reactTo?: Omit<
    ReactiveBindings<AsStateObject<FacetedState<z.infer<TStateSchema>, FacetsOf<TEvaluator>>>>,
    "contentUpdated"
  >;
};

/** What {@link defineFacetedCollection} returns. */
export type FacetedCollection<TName extends string, TState extends JsonObject, TFacets> = {
  /** The collection. Declare it on your own blocks under `name`. */
  collection: DefinedResourceCollection<TState>;
  /** Filters stored facets and returns matching keys. Runs no model. Usable as an agent's tool. */
  search: BlockDefinition<ZodType<FacetSearchInput<TFacets>>, ZodType<FacetSearchOutput>>;
  /** Classifies rows without facets (every row with `force`) through the same path as a write. */
  reindex: BlockDefinition<ZodType<FacetReindexInput>, ZodType<FacetReindexOutput>>;
  /**
   * Pass to `defineFlow({ resources })`: the collection under `name`, plus
   * every resource the evaluator declares.
   */
  resources: { [K in TName]: DefinedResourceCollection<TState> } & DeclaredResources;
};

// ---------------------------------------------------------------------------
// Build-time checks
// ---------------------------------------------------------------------------

const RESERVED_FIELDS = ["facets", "indexedAs"] as const;

function refuse(name: string, message: string): never {
  throw new Error(`defineFacetedCollection "${name}": ${message}`);
}

/** The carried evaluator declarations, after refusing what the flow can't carry. */
function carriedEvaluatorResources(name: string, evaluator: AnyEvaluatorBlock): DeclaredResources {
  if ((evaluator.config as { flowConfigSchema?: unknown }).flowConfigSchema !== undefined) {
    refuse(
      name,
      `evaluator "${evaluator.name}" declares a flowConfigSchema. The reaction runs outside the flow's ` +
        "action graph, so the flow never learns the config it needs. Read that setting another way."
    );
  }
  const declared = evaluator.declaredResources ?? {};
  for (const [accessor, entry] of Object.entries(declared)) {
    if (accessor === name) {
      refuse(
        name,
        `evaluator "${evaluator.name}" declares a resource under "${accessor}", the collection's own accessor. ` +
          "Rename one of them."
      );
    }
    if (!isDefinedResourceCollection(entry) && (entry as { prefetchMode?: string }).prefetchMode === "lazy") {
      refuse(
        name,
        `evaluator "${evaluator.name}" declares "${accessor}" with prefetchMode: 'lazy'. A flow can't register a ` +
          "lazy single resource, so the reaction would run without it. Use prefetchMode: 'eager'."
      );
    }
  }
  return { ...declared };
}

function checkConfig(config: FacetedCollectionConfig): Record<string, EvaluatorQuestion> {
  const { name } = config;
  if (typeof name !== "string" || name.length === 0) {
    throw new Error("defineFacetedCollection: name must be a non-empty string (the collection's accessor).");
  }
  assertEvaluatorBlock(config.evaluator, {
    slot: `defineFacetedCollection "${name}": evaluator`,
    helper: "evaluator({ name, model, questions })",
    questions: "a fixed questions object",
  });
  const questions = staticEvaluatorQuestions(config.evaluator);
  if (questions === undefined) {
    refuse(
      name,
      `evaluator "${config.evaluator.name}" computes its questions per call. The stored facets and the search's ` +
        "options need a fixed set: build the evaluator with a fixed questions object."
    );
  }
  if ("minConfidence" in questions) {
    refuse(name, 'a question id is "minConfidence", which collides with the search option. Rename the question.');
  }
  if (isParameterizedPattern(config.pattern)) {
    refuse(
      name,
      `pattern "${config.pattern}" has parameters. A content change can't address a parameterized row by key; ` +
        'use a wildcard pattern such as "tickets/*" or "docs/**".'
    );
  }
  if ((config.reactTo as { contentUpdated?: unknown } | undefined)?.contentUpdated !== undefined) {
    refuse(
      name,
      "reactTo.contentUpdated is bound. The faceted collection owns that reaction; bind created, " +
        "stateUpdated or deleted instead."
    );
  }
  const content = (config.client as { content?: { create?: boolean; update?: boolean } } | undefined)?.content;
  if (content?.create === true || content?.update === true) {
    refuse(
      name,
      "client.content.create and client.content.update are refused. A client body edit runs no reaction, " +
        "so the row would keep facets about text it no longer has. Write bodies through a flow action."
    );
  }
  if (!(config.stateSchema instanceof z.ZodObject)) {
    refuse(name, "stateSchema must be a z.object(): facets and indexedAs are added to it.");
  }
  for (const field of RESERVED_FIELDS) {
    if (field in config.stateSchema.shape) {
      refuse(
        name,
        `stateSchema already declares "${field}". The faceted collection adds facets and indexedAs itself; ` +
          "delete them from your stateSchema."
      );
    }
  }
  return questions;
}

// ---------------------------------------------------------------------------
// Schemas from the questions
// ---------------------------------------------------------------------------

function optionKeys(question: EvaluatorQuestion): [string, ...string[]] {
  return Object.keys(question.criteria ?? {}) as [string, ...string[]];
}

/** The stored answer schema for one question. `confidence` and `probabilities` are optional. */
function answerSchema(question: EvaluatorQuestion): ZodTypeAny {
  const extra = {
    probabilities: z.record(z.string(), z.number()).optional(),
    confidence: z.number().optional(),
  };
  switch (question.type) {
    case "choice":
      return z.object({ type: z.literal("choice"), choice: z.enum(optionKeys(question)), ...extra });
    case "score":
      return z.object({ type: z.literal("score"), score: z.number(), ...extra });
    case "boolean":
      return z.object({ type: z.literal("boolean"), probability: z.number(), confidence: z.number().optional() });
  }
}

function facetsSchema(questions: Record<string, EvaluatorQuestion>): ZodTypeAny {
  return z.object(Object.fromEntries(Object.entries(questions).map(([id, q]) => [id, answerSchema(q)])));
}

function choiceIds(questions: Record<string, EvaluatorQuestion>): string[] {
  return Object.entries(questions)
    .filter(([, q]) => q.type === "choice")
    .map(([id]) => id);
}

function searchInputSchema(name: string, questions: Record<string, EvaluatorQuestion>): ZodTypeAny {
  const fields: Record<string, ZodTypeAny> = {};
  for (const id of choiceIds(questions)) {
    const q = questions[id]!;
    const asked = typeof q.instructions === "string" ? `: ${q.instructions}` : "";
    fields[id] = z.enum(optionKeys(q)).optional().describe(`Only ${name} with this answer to "${id}"${asked}`);
  }
  fields.minConfidence = z
    .number()
    .min(0)
    .max(1)
    .optional()
    .describe("Only answers the model reported at least this confidence for");
  return z.object(fields);
}

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

type StoredAnswer = { choice?: unknown; confidence?: number };

/**
 * True when stored facets satisfy every value the query names. A row with no
 * facets (never classified, failed, cleared, or stored before the field
 * existed, so `undefined`) never matches. A minimum confidence applies to the
 * answers the query names; an answer that carries no confidence fails it.
 */
function matchesFacets(
  facets: Record<string, StoredAnswer> | null | undefined,
  query: Record<string, unknown>,
  ids: readonly string[]
): boolean {
  if (facets == null) return false;
  const minConfidence = query.minConfidence as number | undefined;
  for (const id of ids) {
    const value = query[id];
    if (value === undefined) continue;
    const answer = facets[id];
    if (answer === undefined || answer.choice !== value) return false;
    if (minConfidence !== undefined) {
      if (answer.confidence === undefined || answer.confidence < minConfidence) return false;
    }
  }
  return true;
}

// ---------------------------------------------------------------------------
// defineFacetedCollection()
// ---------------------------------------------------------------------------

/**
 * Define a resource collection whose bodies are classified once, on write, by
 * `evaluator`, storing its answers as `facets`. Returns the collection, a
 * search over stored answers (optional `minConfidence`, no model call), a
 * reindex for rows without facets (`force` for all), and the `resources` to
 * register on the flow.
 *
 * @example
 * const tickets = defineFacetedCollection({
 *   name: "tickets",
 *   pattern: "tickets/*",
 *   scope: "user",
 *   stateSchema: z.object({ title: z.string() }),
 *   evaluator: triage,
 * });
 * defineFlow({
 *   kind: "support",
 *   resources: tickets.resources,
 *   actions: { search: { block: tickets.search }, reindex: { block: tickets.reindex } },
 * });
 */
export function defineFacetedCollection<
  const TName extends string,
  TStateSchema extends z.AnyZodObject,
  TEvaluator extends AnyEvaluatorBlock,
>(
  config: FacetedCollectionConfig<TName, TStateSchema, TEvaluator>
): FacetedCollection<TName, AsStateObject<FacetedState<z.infer<TStateSchema>, FacetsOf<TEvaluator>>>, FacetsOf<TEvaluator>> {
  const questions = checkConfig(config as unknown as FacetedCollectionConfig);
  const carried = carriedEvaluatorResources(config.name, config.evaluator);
  const { name, evaluator, stateSchema: appStateSchema, reactTo, ...rest } = config;
  const prefix = getPatternPrefix(config.pattern);
  const keyOf = (path: string) => (prefix.length > 0 ? path.slice(prefix.length + 1) : path);
  const ids = choiceIds(questions);

  /**
   * The collection, read through the flow's registry. The reaction's blocks
   * can't declare it: the collection's `reactTo` needs them first. A
   * collection registered under another accessor is a wiring bug, so it fails
   * the write loudly instead of skipping indexing.
   */
  const collectionOf = (ctx: { resources: unknown }): ResourceCollectionRef<JsonObject> => {
    const registry = ctx.resources as Record<string, unknown>;
    const ref = registry[name];
    if (typeof ref !== "object" || ref === null || typeof (ref as { get?: unknown }).get !== "function") {
      throw new Error(
        `defineFacetedCollection "${name}": no collection is registered under "${name}". ` +
          `Pass the returned resources to defineFlow({ resources }) so it is registered under "${name}".`
      );
    }
    return ref as ResourceCollectionRef<JsonObject>;
  };

  const stamped = z.object({ key: z.string(), token: z.string(), body: z.string() });
  type Stamp = z.infer<typeof stamped>;

  // Rule 1: clear the facets and stamp a fresh token in one blocking write,
  // then read the body. Whichever reaction holds the current token also read
  // the newest body.
  const clearAndStamp = handler({
    name: `${name}-clear-facets`,
    inputSchema: resourceContentChangeSchema(),
    outputSchema: stamped,
    execute: async (change: ResourceContentChange, ctx) => {
      const ref = await collectionOf(ctx).get(change.key);
      const token = crypto.randomUUID();
      await ref.patchState({ facets: null, indexedAs: token });
      const body = (await ref.readContent()) ?? "";
      return { key: change.key, token, body };
    },
  });

  // Rule 3: store the answers only if this classification's token is still
  // current. `updateState`'s updater runs against the stored row and re-runs
  // on a version conflict, so the check and the write commit together.
  const storeIfCurrent = handler({
    name: `${name}-store-facets`,
    inputSchema: z.object({ answers: z.record(z.string(), z.unknown()) }),
    parentInputSchema: stamped,
    execute: async ({ answers }, ctx) => {
      const { key, token } = ctx.parent!.input as Stamp;
      const ref = await collectionOf(ctx).getOptional(key);
      if (ref === undefined) return;
      await ref.updateState((state) =>
        state.indexedAs === token ? { ...state, facets: answers as JsonObject } : state
      );
    },
  });

  // Rule 2: classify on a side chain, so a failed model call doesn't fail the
  // write. The side chain drains before the turn ends.
  const classify = sequencer({ name: `${name}-classify`, inputSchema: stamped })
    .step((stamp: Stamp) => stamp.body, evaluator)
    .step(storeIfCurrent);

  const reaction = sequencer({ name: `${name}-index-facets`, inputSchema: resourceContentChangeSchema() })
    .step(clearAndStamp)
    .sideChainIf((stamp: Stamp) => stamp.body.trim().length > 0, classify);

  const stateSchema = appStateSchema.extend({
    facets: facetsSchema(questions).nullable().default(null),
    indexedAs: z.string().nullable().default(null),
  });

  const collection = defineResourceCollection({
    ...rest,
    stateSchema,
    reactTo: { ...(reactTo as ReactiveBindings | undefined), contentUpdated: reaction },
  } as ResourceCollectionConfig & { stateSchema: ZodTypeAny });

  const declared = { [name]: collection } as Record<string, typeof collection>;

  const search = handler({
    name: `search-${name}`,
    description:
      `Find ${name} by their stored classifications` +
      (ids.length > 0 ? ` (${ids.join(", ")})` : "") +
      ". Filters stored answers; makes no model call.",
    inputSchema: searchInputSchema(name, questions),
    outputSchema: z.object({ keys: z.array(z.string()) }),
    resources: declared,
    execute: async (query: Record<string, unknown>, ctx) => {
      const rows = await (ctx.resources as Record<string, ResourceCollectionRef<JsonObject>>)[name]!.list();
      const keys = rows
        .filter((row) =>
          matchesFacets(row.state.facets as Record<string, StoredAnswer> | null | undefined, query, ids)
        )
        .map((row) => keyOf(row.path));
      return { keys };
    },
  });

  const reindexInput = z.object({ force: z.boolean().optional() });
  const selectForReindex = handler({
    name: `${name}-select-for-reindex`,
    inputSchema: reindexInput,
    resources: declared,
    execute: async (input: FacetReindexInput, ctx): Promise<ResourceContentChange[]> => {
      const rows = await (ctx.resources as Record<string, ResourceCollectionRef<JsonObject>>)[name]!.list();
      return (
        rows
          // `== null` also picks up rows stored before `facets` existed.
          .filter((row) => input.force === true || row.state.facets == null)
          .map((row) => ({ key: keyOf(row.path), ref: row.path, kind: "contentUpdated" as const }))
      );
    },
  });

  // Reindex runs the same reaction a body write does, once per selected row.
  const reindex = sequencer({ name: `reindex-${name}`, inputSchema: reindexInput })
    .step(selectForReindex)
    .forEach(reaction)
    .step(
      handler({
        name: `${name}-reindex-summary`,
        inputSchema: z.array(stamped),
        outputSchema: z.object({ reindexed: z.array(z.string()) }),
        execute: async (stamps: Stamp[]) => ({
          reindexed: stamps.filter((s) => s.body.trim().length > 0).map((s) => s.key),
        }),
      })
    );

  return {
    collection,
    search,
    reindex,
    resources: { ...carried, [name]: collection },
  } as unknown as FacetedCollection<
    TName,
    AsStateObject<FacetedState<z.infer<TStateSchema>, FacetsOf<TEvaluator>>>,
    FacetsOf<TEvaluator>
  >;
}
