import { defineConfig } from "vitest/config";

// The active test inventory during the source-to-plan rewrite (see docs/TRANSITION.md).
// New-model behavior lives under tests/catalog. The other entries are retained integrity
// checks over donor code that later slices adapt: strict JSON and frontmatter reading,
// source-link parsing, redirect-safe pinned fetching without hooks, the publication
// refusal with the packed package read, and repository instructions. Every other donor
// suite tests retired release-model formats and runs only in `npm run test:historical`.
export default defineConfig({
  test: {
    environment: "node",
    fileParallelism: false,
    include: [
      "tests/catalog/**/*.test.ts",
      "tests/bootstrap/repo-ai-tools.test.ts",
      "tests/self-hosting/self-hosting.test.ts",
      "tests/publication-guard.test.ts",
      "tests/supported/strict-json-reader.test.ts",
      "tests/supported/upstream-fetch.test.ts",
      "tests/release/parse-source-link.test.ts",
      "tests/producer/fetch.test.ts",
      "tests/producer/git-fixture.test.ts",
    ],
  },
});
