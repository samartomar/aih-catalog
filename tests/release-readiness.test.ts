import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8").replace(/\r\n/gu, "\n");

describe("@aihq/catalog release boundary (#12)", () => {
  it("uses the same Apache-2.0 public-package boundary as Core", () => {
    const manifest = JSON.parse(read("package.json")) as Record<string, unknown>;
    expect(manifest.license).toBe("Apache-2.0");
    expect(manifest.publishConfig).toEqual({ access: "public" });
    expect(read("LICENSE")).toContain("Apache License\n                           Version 2.0");
    expect(
      createHash("sha256")
        .update(readFileSync(resolve(root, "LICENSE")))
        .digest("hex"),
    ).toBe("c71d239df91726fc519c6eb72d318ec65820627232b2f796219e87dcf35d0ab4");
    expect(read("README.md")).toContain("[Apache-2.0](LICENSE)");
  });

  it("pins one tag-only, main-bound package release workflow", () => {
    const workflow = read(".github/workflows/release.yml");
    expect(workflow).toContain('- "v-catalog-*"');
    expect(workflow).not.toMatch(/workflow_dispatch|workflow_call|pull_request_target/);
    expect(workflow).toContain(
      "git fetch --no-tags origin +refs/heads/main:refs/remotes/origin/main",
    );
    expect(workflow).toContain('if [ "$GITHUB_SHA" != "$main_sha" ]; then');
    expect(workflow).toContain(['tag="$', '{GITHUB_REF_NAME#v-catalog-}"'].join(""));
    expect(workflow).toContain('if [ "$ver" != "$tag" ]; then');
    expect(workflow).toContain("name: npm-publish");
    expect(workflow).toContain("https://www.npmjs.com/package/@aihq/catalog");
    expect(workflow).not.toContain("packages: write");
    expect(workflow).not.toContain("NPM_TOKEN");
    expect(workflow).not.toContain("NODE_AUTH_TOKEN");

    const actions = [...workflow.matchAll(/^\s*(?:-\s*)?uses:\s*([^@\s]+)@([^\s#]+).*$/gmu)];
    expect(actions.length).toBeGreaterThanOrEqual(6);
    for (const [, action, revision] of actions) {
      expect(action).toMatch(/^[\w.-]+\/[\w.-]+$/u);
      expect(revision).toMatch(/^[0-9a-f]{40}$/u);
    }
  });

  it("isolates candidate execution from protected publication permissions", () => {
    const workflow = read(".github/workflows/release.yml");
    const verificationStart = workflow.indexOf("  verify-and-pack:\n");
    const publishStart = workflow.indexOf("  npm-publish:\n");
    expect(verificationStart).toBeGreaterThanOrEqual(0);
    expect(publishStart).toBeGreaterThan(verificationStart);

    const verification = workflow.slice(verificationStart, publishStart);
    const publication = workflow.slice(publishStart);
    expect(verification).toMatch(/permissions:\n\s+contents:\s*read/);
    expect(verification).not.toMatch(/(?:id-token|attestations):\s*write/);
    expect(verification).not.toMatch(/contents:\s*write/);
    expect(verification).toContain("npm run verify");
    expect(verification).toContain("npm pack --ignore-scripts");
    expect(verification).toContain("Smoke-install the exact packed tarball");
    expect(verification).toContain("Upload immutable exact release candidate");

    expect(publication).toContain("needs: verify-and-pack");
    expect(publication).toMatch(/id-token:\s*write/);
    expect(publication).toMatch(/attestations:\s*write/);
    expect(publication).toMatch(/contents:\s*write/);
    expect(publication).not.toMatch(/npm (?:ci|run|install|pack)/);
    expect(publication).not.toContain("actions/checkout");
    expect(publication).not.toContain("sha256sum -c");
    expect(publication).toContain("actions/setup-node@820762786026740c76f36085b0efc47a31fe5020");
    expect(publication).toContain('node-version: "24"');
    expect(publication).toContain("package-manager-cache: false");
    expect(publication).toContain('npm publish "$tarball" --ignore-scripts');
  });

  it("keeps package publication separate from catalog-head and receipt authority", () => {
    const workflow = read(".github/workflows/release.yml");
    expect(workflow).not.toContain("gh workflow run");
    expect(workflow).not.toContain("name: catalog-signing");
    expect(workflow).not.toMatch(/generate-candidate|sign-candidate|emit-qualification-receipt/);
    expect(workflow).not.toContain("catalogSha256");
    expect(workflow).not.toContain("qualificationReceiptSha256");
  });

  it("runs full gates, packs once, and preserves one exact tarball", () => {
    const workflow = read(".github/workflows/release.yml");
    expect(workflow).toContain('node-version: "24"');
    expect(workflow).toContain("package-manager-cache: false");
    expect(workflow).toContain("npm ci --ignore-scripts");
    expect(workflow).toContain("npm run verify");
    expect(workflow).toContain("npm run verify:core-v2-lock");
    expect(workflow).toContain("npm run verify:default-evidence-chain");
    expect(workflow).toContain("npm run verify:cold-external-admin");
    expect(workflow).toContain("npm run verify:workflow-action-pins");
    expect(workflow).toContain("npm run test:cov");
    expect(workflow.match(/npm pack --ignore-scripts/gmu)).toHaveLength(1);
    expect(workflow).toContain('sha256sum "$tarball"');
    expect(workflow).toContain("tarball_sha256");
    expect(workflow).toContain("artifact-id");
    expect(workflow).toContain("artifact-digest");
    expect(workflow).toContain("actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a");
    expect(workflow).toContain(
      "actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c",
    );
    expect(workflow).toContain("artifact-ids:");
    expect(workflow).toContain("EXPECTED_TARBALL_SHA256");
    expect(workflow).toContain("EXPECTED_ARTIFACT_SHA256");
    expect(workflow).toContain('test "$actual_sha256" = "$EXPECTED_TARBALL_SHA256"');
    expect(workflow).toContain(
      ['test "$api_digest" = "sha256:$', '{EXPECTED_ARTIFACT_SHA256}"'].join(""),
    );
    expect(workflow).toContain("Sign trusted checksum and retain provenance bundle");
    expect(workflow).toContain(
      'printf \'%s  %s\\n\' "$EXPECTED_TARBALL_SHA256" "$(basename "$TARBALL")" > SHA256SUMS.txt',
    );
    expect(workflow).toContain(['file: "$', '{{ env.TARBALL }}"'].join(""));
    expect(workflow).toContain(
      ["TARBALL: $", "{{ needs.verify-and-pack.outputs.tarball }}"].join(""),
    );
    expect(workflow).toContain(['subject-path: "$', '{{ env.TARBALL }}"'].join(""));
    expect(workflow).toContain(
      'npm install --prefix "$consumer" --ignore-scripts --no-audit --no-fund "$tarball"',
    );
    expect(workflow).toContain('"$consumer/node_modules/.bin/aih-supported" --help');
    expect(workflow).toContain(
      'npm publish "$tarball" --ignore-scripts --provenance --access public --tag "$dist_tag"',
    );
    expect(workflow).toContain("format: spdx-json");
    expect(workflow).toContain("upload-artifact: false");
    expect(workflow).toContain("upload-release-assets: false");
    expect(workflow).toContain("cosign sign-blob --yes");
    expect(workflow).toContain("gh release create");
  });

  it("re-observes main and the tag before publication and checks packed identity", () => {
    const workflow = read(".github/workflows/release.yml");
    const publication = workflow.slice(workflow.indexOf("  npm-publish:\n"));
    expect(publication).toContain("Revalidate current main and tag before publication");
    expect(publication).toContain("git fetch --no-tags origin");
    expect(publication).toContain('tag_sha="$(git rev-parse "refs/tags/$GITHUB_REF_NAME^{}")"');
    expect(publication).toContain(
      'if [ "$GITHUB_SHA" != "$main_sha" ] || [ "$GITHUB_SHA" != "$tag_sha" ]; then',
    );
    expect(publication).toContain('test "$GITHUB_REF" = "refs/tags/$GITHUB_REF_NAME"');
    expect(publication).toContain("Validate packed manifest identity");
    expect(publication).toContain('manifest.name !== "@aihq/catalog"');
    expect(publication).toContain("manifest.version !== tag");

    const sbomIndex = publication.indexOf("Generate tarball-scoped SPDX SBOM");
    const attestIndex = publication.indexOf("Attest build provenance for the exact tarball");
    const signIndex = publication.indexOf("Sign trusted checksum and retain provenance bundle");
    const publishIndex = publication.indexOf(
      "Publish exact tarball through npm trusted publishing",
    );
    const releaseIndex = publication.indexOf("Create immutable GitHub Release evidence");
    const verificationIndexes = [...publication.matchAll(/Verify exact tarball before/gmu)].map(
      (match) => match.index ?? -1,
    );
    expect(verificationIndexes).toHaveLength(5);
    expect(verificationIndexes[0]).toBeLessThan(sbomIndex);
    expect(verificationIndexes[1]).toBeLessThan(attestIndex);
    expect(verificationIndexes[2]).toBeLessThan(signIndex);
    expect(verificationIndexes[3]).toBeLessThan(publishIndex);
    expect(verificationIndexes[4]).toBeLessThan(releaseIndex);
  });

  it("documents bootstrap, authority, verification, and immutable failure behavior", () => {
    const releasing = read("RELEASING.md");
    expect(releasing).toContain("package must already exist");
    expect(releasing).toContain(
      "samartomar/aih-catalog, workflow `release.yml`, environment `npm-publish`",
    );
    expect(releasing).toContain("full-SHA publication authorization");
    expect(releasing).toContain("one-use GitHub bootstrap path");
    expect(releasing).toContain("never delete, move, or reuse the tag");
    expect(releasing).toContain("npm view @aihq/catalog@0.1.0");
    expect(releasing).toContain("gh attestation verify ./aihq-catalog-0.1.0.tgz");
    expect(releasing).not.toContain("gh attestation verify ./node_modules/@aihq/catalog");
    expect(releasing).toContain("Package publication is not Catalog signing authority");

    const readme = read("README.md");
    expect(readme).toContain("npm install --save-exact @aihq/catalog@0.1.0");
    expect(readme).toContain("gh attestation verify ./aihq-catalog-0.1.0.tgz");
    expect(readme).toContain("npm provenance");
    expect(readme).toMatch(/GitHub build\s+attestation/u);
    expect(readme).toContain("has not been published");
  });

  it("packs the license, default data, command, and library under the exact identity", () => {
    const raw = execFileSync(
      process.execPath,
      [process.env.npm_execpath ?? "", "pack", "--ignore-scripts", "--dry-run", "--json"],
      { cwd: root, encoding: "utf8" },
    );
    const packedManifests = JSON.parse(raw) as Array<{
      name: string;
      version: string;
      filename: string;
      files: Array<{ path: string }>;
    }>;
    expect(packedManifests).toHaveLength(1);
    const packed = packedManifests[0];
    if (packed === undefined) throw new Error("npm pack produced no manifest");
    expect(packed).toMatchObject({
      name: "@aihq/catalog",
      version: "0.1.0",
      filename: "aihq-catalog-0.1.0.tgz",
    });
    const paths = packed.files.map(({ path }) => path);
    expect(paths).toContain("LICENSE");
    expect(paths).toContain("README.md");
    expect(paths).toContain("defaults/default-catalog-v2.json");
    expect(paths).toContain("dist/cli.js");
    expect(paths).toContain("dist/index.js");
  });
});
