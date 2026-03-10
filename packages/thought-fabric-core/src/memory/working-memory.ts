export interface WorkingMemoryConfig {
  capacity?: number
}

export interface WorkingMemoryInstance {
  add(item: string): void
  get(): string[]
  clear(): void
}

/**
 * Create a working memory instance for managing short-term context.
 */
export function workingMemory(_config?: WorkingMemoryConfig): WorkingMemoryInstance {
  throw new Error('Not implemented — placeholder for Wave 2')
}
