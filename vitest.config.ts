import { defineConfig } from "vitest/config";

// The one test inventory: Catalog behavior through its public entry points (tests/catalog),
// plus the repository checks (publication refusal, repository instructions and helpers).
// Every run first builds dist/catalog (tests/build-dist.ts), which the packed file list and
// the repository tools read.
export default defineConfig({
  test: {
    environment: "node",
    fileParallelism: false,
    include: ["tests/**/*.test.ts"],
    globalSetup: ["tests/build-dist.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      reporter: ["text"],
      // npm run test:cov fails below these (measured 85 / 81 / 96 / 89 when restored).
      thresholds: {
        statements: 80,
        branches: 80,
        functions: 80,
        lines: 80,
      },
    },
  },
});
