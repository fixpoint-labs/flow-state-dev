export interface ScoreSalienceInput {
  content: string
  context?: string
}

export interface SalienceScore {
  score: number
  reasoning: string
}

/**
 * Score how salient a piece of content is given a context.
 */
export function scoreSalience(_input: ScoreSalienceInput): SalienceScore {
  throw new Error('Not implemented — placeholder for Wave 2')
}
