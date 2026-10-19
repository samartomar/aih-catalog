import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, expect, it } from "vitest";
import { acquireBaselineArtifact, readInstalledRelease } from "../../src/release/node.js";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true });
});
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "catalog-baseline-installed-"));
  roots.push(root);
  cpSync(
    resolve(import.meta.dirname, "../fixtures/release-baseline/release"),
    join(root, "release"),
    { recursive: true },
  );
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({
      name: "@aihq/catalog",
      version: "0.1.0",
      exports: { "./release.json": "./release/release.json" },
    }),
  );
  return root;
}
it("reads the shipped exact inventory and fixture artifact through the public Node seam", async () => {
  const root = fixture(),
    result = await readInstalledRelease({ root });
  expect(result.valid).toBe(true);
  const baseline = result.release?.baseline;
  expect(baseline?.scope.namespace).toBe("package-relative");
  if (!baseline) throw new Error("Expected fixture baseline");
  const artifact = await acquireBaselineArtifact(baseline.artifact, { packageRoot: root });
  expect(artifact.length).toBe(baseline.artifact.byteLength);
});
it("refuses changed or absent shipped baseline members without fetching or authenticating", async () => {
  for (const path of ["content-inventory.json", "baseline.json"]) {
    const root = fixture();
    writeFileSync(join(root, "release", path), "changed");
    const result = await readInstalledRelease({ root });
    expect(result.valid).toBe(false);
    expect(result.diagnostics.some((d) => /baseline|member/.test(d.reason))).toBe(true);
  }
});
it("bounds acquisition and refuses private/traversing artifact paths", async () => {
  const root = fixture(),
    result = await readInstalledRelease({ root });
  const artifact = result.release?.baseline?.artifact;
  if (!artifact) throw new Error("Expected fixture artifact");
  for (const path of ["../baseline.json", "C:/private/baseline.json", "/tmp/baseline.json"]) {
    await expect(
      acquireBaselineArtifact(
        { ...artifact, location: { kind: "package", path } },
        { packageRoot: root },
      ),
    ).rejects.toThrow("baseline-package-location-invalid");
  }
  await expect(
    acquireBaselineArtifact(
      { ...artifact, byteLength: 16 * 1024 * 1024 + 1 },
      { packageRoot: root },
    ),
  ).rejects.toThrow("baseline-package-artifact-limit");
  await expect(
    acquireBaselineArtifact(artifact, { packageRoot: root, signal: AbortSignal.abort() }),
  ).rejects.toThrow();
});
