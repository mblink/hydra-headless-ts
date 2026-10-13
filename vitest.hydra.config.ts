import { defineConfig } from 'vitest/config'

// `npm run test:hydra`: the tests that need a running Hydra (see src/test/auth-flow.hydra.test.ts)
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.hydra.test.ts'],
    testTimeout: 30_000,
  },
})
