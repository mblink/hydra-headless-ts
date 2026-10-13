import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'dist/',
        'lib/',
        '**/*.test.ts',
        '**/*.spec.ts',
        'vitest.config.ts',
        'rollup.config.js',
      ],
    },
    include: ['src/**/*.test.ts', 'src/**/*.spec.ts'],
    // Need a running Hydra; `npm run test:hydra` runs them
    exclude: ['node_modules', 'dist', 'lib', 'src/**/*.hydra.test.ts'],
  },
})
