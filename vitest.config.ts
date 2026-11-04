import { env } from 'node:process';

import { coverageConfigDefaults, defineConfig } from 'vitest/config';

const ci = !!env['CI'];

export default defineConfig({
  test: {
    // the workers start without the env proxy, so nock sees the requests of fetch
    env: { NODE_USE_ENV_PROXY: '' },
    include: ['src/**/*.spec.ts'],
    coverage: {
      provider: 'v8',
      reporter: ci ? ['lcovonly', 'text'] : ['@containerbase/istanbul-reports-html', 'text'],
      include: ['src/**/*.ts'],
      exclude: [...coverageConfigDefaults.exclude, 'src/test-setup.ts'],
    },
    reporters: ci ? ['default', 'github-actions', 'junit'] : ['default'],
    outputFile: { junit: 'coverage/junit.xml' },
    // every test starts with the real env and without the spies of the tests before
    restoreMocks: true,
    unstubEnvs: true,
    setupFiles: ['src/test-setup.ts'],
  },
});
