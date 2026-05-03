import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    globals: false,
    // setupFiles run BEFORE every test file's imports — critical for the
    // WORK_DIR override since config.ts reads process.env at import time.
    setupFiles: ['./test/setup.ts'],
  },
});
