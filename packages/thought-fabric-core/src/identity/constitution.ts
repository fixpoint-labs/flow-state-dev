export interface ConstitutionConfig {
  values: string[]
  constraints?: string[]
}

export interface ConstitutionInstance {
  values: string[]
  constraints: string[]
  evaluate(action: string): { allowed: boolean; reason: string }
}

/**
 * Define a constitution — a set of values and constraints that guide agent behavior.
 */
export function constitution(_config: ConstitutionConfig): ConstitutionInstance {
  throw new Error('Not implemented — placeholder for Wave 2')
}
