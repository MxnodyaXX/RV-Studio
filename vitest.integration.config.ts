import { defineConfig } from 'vitest/config'

// Runs against a real (non-production) Supabase project. See tests/integration/README.md.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/integration/**/*.test.ts'],
    testTimeout: 30000,
  },
})
