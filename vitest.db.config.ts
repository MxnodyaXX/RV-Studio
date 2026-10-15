import { defineConfig } from 'vitest/config'

// Database tests: real migrations in PGlite (no Docker needed).
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/db/**/*.test.ts'],
    testTimeout: 60000,
    hookTimeout: 120000,
    pool: 'forks',
  },
})
