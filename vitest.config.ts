import { defineConfig } from "vitest/config";

// The one test inventory: Catalog behavior through its public entry points (tests/catalog),
// plus the repository checks (publication refusal, repository instructions and helpers).
export default defineConfig({
  test: {
    environment: "node",
    fileParallelism: false,
    include: ["tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      reporter: ["text"],
    },
  },
});
