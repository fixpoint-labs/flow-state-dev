import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  resolve: {
    alias: {
      '@flow-state-dev/core': fileURLToPath(new URL('../core/src/index.ts', import.meta.url)),
      '@flow-state-dev/core/types': fileURLToPath(new URL('../core/src/types/index.ts', import.meta.url))
    }
  }
})
