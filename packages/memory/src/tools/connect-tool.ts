/**
 * `createConnectTool` — agent-invocable relation-graph tool (FIX-745 read-side).
 *
 * Where the recall tool searches facts and episodes by relevance, the connect
 * tool walks the semantic resource's typed-edge graph (relations tier). The
 * agent installs it on a generator via `tools: [mem.tool.connect()]` like any
 * other framework tool. It is only installed when the relations tier is enabled
 * (see the `connect` preset in the composed memory capability).
 *
 * Two modes, selected by whether the agent supplies `to`:
 *   - `from` + `to` → `shortestPath`: the chain of edges connecting the two
 *     entities. Unreachable within `depth` → empty results (not an error).
 *   - `from` only   → `egoGraph`: every edge connected to `from` within `depth`.
 *
 * The tool reuses the recall tool's result envelope shape (`RecallToolResult`)
 * so the model sees one consistent structure across both memory tools. Edges
 * render via `edgeToMemoryItem`. Every failure path (relations disabled, bad
 * input, traversal error) returns the error envelope `{ error, query, strategy }`
 * rather than throwing into the generator.
 */

import { handler } from '@flow-state-dev/core'
import { z } from 'zod'
import type { Edge } from '@flow-state-dev/core/graph'
import { edgeToMemoryItem } from './types'
import type { RecallResultItem, RecallToolResult } from './types'
import { canonicalizeSubject, edgesOf } from '../internal/helpers'

/** Zod schema for the connect tool's input parameters. */
export const connectToolInputSchema = z.object({
  from: z.string().min(1).describe('Entity to start from (subject name).'),
  to: z
    .string()
    .optional()
    .describe(
      'If given, find the connection path to this entity. If omitted, return everything connected to `from`.',
    ),
  depth: z
    .number()
    .int()
    .min(1)
    .max(6)
    .optional()
    .describe('Max hops (default 2).'),
})

/** Inferred input shape from `connectToolInputSchema`. */
export type ConnectToolInput = z.infer<typeof connectToolInputSchema>

/** Strategy identifier surfaced on the connect tool's result envelope. */
export const CONNECT_STRATEGY = 'graph'

/** Default traversal depth when the agent omits `depth`. */
export const DEFAULT_CONNECT_DEPTH = 2

/**
 * Description shown to the LLM when the connect tool is installed. Exported so
 * consumers wiring custom tool sets can reuse the wording.
 */
export const connectToolDescription =
  'Call to explore how entities in your memory are related. ' +
  'Pass `from` alone to list everything connected to that entity, ' +
  'or `from` and `to` to find the relationship path between two entities. ' +
  'Use this when a question is about connections between people, places, or things.'

/** Render an ordered edge list into the connect tool's success envelope. */
function buildConnectResult(edges: Edge[], query: string): RecallToolResult {
  const results: RecallResultItem[] = edges.map((edge, i) => {
    const item = edgeToMemoryItem(edge)
    return {
      id: item.id,
      content: item.content,
      source: item.source,
      score: edges.length > 0 ? 1 - i / edges.length : 0,
      metadata: {
        from: item.from,
        to: item.to,
        relationType: item.relationType,
        confidence: item.confidence,
      },
      truncated: false,
    }
  })
  return {
    results,
    query,
    strategy: CONNECT_STRATEGY,
    totalMatched: results.length,
    truncatedTo: results.length,
  }
}

/** Options for `createConnectTool`. */
export type CreateConnectToolOptions = {
  /** Strategy identifier surfaced on results. Defaults to `'graph'`. */
  strategyName?: string
}

/**
 * Create the connect tool — a handler the agent calls as a tool.
 *
 * Returns a block named `memory/connect`. Reads the edge API from
 * `ctx.resources.semanticMemory.edges`; when that is absent the relations tier
 * is disabled and the tool returns an error envelope so the agent can recover.
 */
export function createConnectTool(opts: CreateConnectToolOptions = {}) {
  const strategyName = opts.strategyName ?? CONNECT_STRATEGY

  return handler({
    name: 'memory/connect',
    description: connectToolDescription,
    inputSchema: connectToolInputSchema,
    execute: async (input: ConnectToolInput, ctx): Promise<RecallToolResult> => {
      // Echo a sensible query string on every envelope (success or error).
      const query = input.to ? `${input.from} -> ${input.to}` : input.from

      try {
        const edges = edgesOf(ctx)
        if (!edges) {
          return {
            error:
              'The relations graph is not enabled for this memory. Enable the relations tier to use connect.',
            query,
            strategy: strategyName,
          }
        }

        const from = canonicalizeSubject(input.from)
        const depth = input.depth ?? DEFAULT_CONNECT_DEPTH

        if (input.to) {
          const to = canonicalizeSubject(input.to)
          const path = edges.shortestPath(from, to, { depth })
          // Unreachable within depth → empty results, not an error.
          return buildConnectResult(path ?? [], query)
        }

        const ego = edges.egoGraph(from, { depth })
        return buildConnectResult(ego.edges, query)
      } catch (err) {
        // All failures are non-fatal — the agent sees a recoverable envelope.
        return {
          error: err instanceof Error ? err.message : String(err),
          query,
          strategy: strategyName,
        }
      }
    },
  })
}
