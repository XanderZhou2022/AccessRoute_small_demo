import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    // The full story replay computes hundreds of routes; bound CPU contention on laptops.
    maxWorkers: 2,
    testTimeout: 15_000,
  },
});
