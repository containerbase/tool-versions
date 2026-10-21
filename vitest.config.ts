import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // the workers start without the env proxy, so nock sees the requests of fetch
    env: { NODE_USE_ENV_PROXY: '' },
    include: ['src/**/*.spec.ts'],
    setupFiles: ['src/test-setup.ts'],
  },
});
