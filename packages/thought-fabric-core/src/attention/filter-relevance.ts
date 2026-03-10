export interface FilterRelevanceInput {
  items: string[]
  query: string
}

export interface RelevanceResult {
  relevant: string[]
  filtered: string[]
}

/**
 * Filter a set of items by relevance to a query.
 */
export function filterRelevance(_input: FilterRelevanceInput): RelevanceResult {
  throw new Error('Not implemented — placeholder for Wave 2')
}
