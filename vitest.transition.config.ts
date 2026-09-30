import { defineConfig } from "vitest/config";

// Reviewed donor checks, not an assertion that the greenfield public API exists.
export default defineConfig({
  test: {
    environment: "node",
    fileParallelism: false,
    include: [
      "tests/bootstrap/repo-ai-tools.test.ts",
      "tests/self-hosting/self-hosting.test.ts",
      "tests/transition-boundary.test.ts",
      "tests/supported/strict-json-reader.test.ts",
      "tests/supported/catalog-content-reader.test.ts",
      "tests/supported/catalog-index-generator.test.ts",
      "tests/supported/catalog-source-closure.test.ts",
      "tests/supported/catalog-collections.test.ts",
      "tests/supported/catalog-categories.test.ts",
      "tests/supported/catalog-presentation.test.ts",
      "tests/supported/catalog-runtime-descriptors.test.ts",
      "tests/supported/catalog-read-refusals.test.ts",
      "tests/supported/locale-independent-generation.test.ts",
      "tests/supported/upstream-fetch.test.ts",
      "tests/supported/upstream-producers.test.ts",
      "tests/supported/production-generators.test.ts",
    ],
  },
});
