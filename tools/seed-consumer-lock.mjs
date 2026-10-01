import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Seed only locked runtime artifacts before npm adds the supplied local tarballs.
 * npm ci caches those artifacts without caching registry version metadata. This
 * lets an offline fixture reuse exact versions without copying node_modules or
 * injecting dependencies that the packed package did not declare.
 */
export function seedConsumerLock(consumer, sourceRoot) {
  const source = JSON.parse(readFileSync(join(sourceRoot, "package-lock.json"), "utf8"));
  assert.equal(source.lockfileVersion, 3, "The consumer fixture requires the committed v3 lock.");
  const identity = { name: "aih-catalog-packed-consumer", version: "0.0.0" };
  const packages = Object.fromEntries(Object.entries(source.packages)
    .filter(([path, entry]) => path && entry.dev !== true));
  packages[""] = identity;
  mkdirSync(consumer, { recursive: true });
  writeFileSync(join(consumer, "package.json"), JSON.stringify({ ...identity, private: true }));
  writeFileSync(join(consumer, "package-lock.json"), JSON.stringify({
    ...identity, lockfileVersion: 3, requires: true, packages,
  }));
}
