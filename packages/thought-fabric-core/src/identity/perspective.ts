export interface PerspectiveConfig {
  role: string
  expertise?: string[]
}

export interface PerspectiveInstance {
  role: string
  expertise: string[]
}

/**
 * Define a perspective — a role and expertise that shape how an agent interprets information.
 */
export function perspective(_config: PerspectiveConfig): PerspectiveInstance {
  throw new Error('Not implemented — placeholder for Wave 2')
}
