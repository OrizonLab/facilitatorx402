import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./src/tests/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/tests/**', 'src/index.ts'],
    },
    testTimeout: 30000,
  },
  resolve: {
    alias: {
      '@http': '/src/http',
      '@app': '/src/application',
      '@protocol': '/src/protocol',
      '@crypto': '/src/crypto',
      '@settlement': '/src/settlement',
      '@infra': '/src/infrastructure',
    },
  },
})
