import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8").replace(/\r\n/gu, "\n");

function inlineModuleFollowing(workflow: string, marker: string): string {
  const markerIndex = workflow.indexOf(marker);
  expect(markerIndex).toBeGreaterThanOrEqual(0);
  const delimiterIndex = workflow.indexOf("<<'NODE'\n", markerIndex);
  expect(delimiterIndex).toBeGreaterThanOrEqual(0);
  const bodyStart = delimiterIndex + "<<'NODE'\n".length;
  const bodyEnd = workflow.indexOf("\n          NODE", bodyStart);
  expect(bodyEnd).toBeGreaterThan(bodyStart);
  return workflow.slice(bodyStart, bodyEnd).replace(/^ {10}/gmu, "");
}

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

  it("pins one tag-only, main-bound Trusted Publishing workflow", () => {
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
    expect(workflow).not.toContain("v-catalog-0.1.3");
    expect(workflow).not.toContain("secrets.NPM_TOKEN");
    expect(workflow).not.toContain("NPM_BOOTSTRAP_TOKEN");
    expect(workflow).not.toContain("REGISTRY_OBSERVATION");
    expect(workflow).not.toContain('npm view "@aihq/catalog"');
    expect(workflow).not.toContain("npm whoami");
    expect(workflow).toContain("Publish exact tarball through npm Trusted Publishing");
    expect(workflow).toContain("dist_tag=next");
    expect(workflow).not.toContain("dist_tag=latest");
    expect(workflow).toContain("--prerelease");
    expect(workflow).toContain(
      ['if [ -n "$', '{NODE_AUTH_TOKEN:-}" ] || [ -n "$', '{NPM_TOKEN:-}" ]; then'].join(""),
    );

    const candidate = workflow.slice(
      workflow.indexOf("  verify-and-pack:\n"),
      workflow.indexOf("  npm-publish:\n"),
    );
    expect(candidate).not.toContain("NODE_AUTH_TOKEN");
    expect(candidate).not.toContain("NPM_BOOTSTRAP_TOKEN");

    const actions = [...workflow.matchAll(/^\s*(?:-\s*)?uses:\s*([^@\s]+)@([^\s#]+).*$/gmu)];
    expect(actions.length).toBeGreaterThanOrEqual(6);
    for (const [, action, revision] of actions) {
      expect(action).toMatch(/^[\w.-]+\/[\w.-]+$/u);
      expect(revision).toMatch(/^[0-9a-f]{40}$/u);
    }
  });

  it("verifies the Catalog repository before adding the nested Core checkout", () => {
    const workflow = read(".github/workflows/release.yml");
    const sourceVerification = workflow.indexOf("name: Verify exact source candidate");
    const coreCheckout = workflow.indexOf("repository: samartomar/ai-harness");
    expect(sourceVerification).toBeGreaterThanOrEqual(0);
    expect(coreCheckout).toBeGreaterThanOrEqual(0);
    expect(sourceVerification).toBeLessThan(coreCheckout);
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
    expect(publication).not.toContain("registry-url:");
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
      'npm publish "$tarball" --ignore-scripts --provenance --access public --registry "https://registry.npmjs.org/" --tag "$dist_tag"',
    );
    expect(workflow).toContain("format: spdx-json");
    expect(workflow).toContain("upload-artifact: false");
    expect(workflow).toContain("upload-release-assets: false");
    expect(workflow).toContain("cosign sign-blob --yes");
    expect(workflow).toContain("gh release create");
  });

  it("accepts only a stable unambiguous npm CLI version at the Trusted Publishing boundary", () => {
    const workflow = read(".github/workflows/release.yml");
    const validator = inlineModuleFollowing(workflow, 'npm_version="$(npm --version)"');
    const validate = (version: string) =>
      spawnSync(process.execPath, ["--input-type=module", "-", version], {
        input: validator,
        encoding: "utf8",
      });

    for (const accepted of ["11.5.1", "11.5.2", "11.6.0", "12.0.0"]) {
      expect(validate(accepted).status, accepted).toBe(0);
    }
    for (const rejected of [
      "11.5.0",
      "10.99.99",
      "11.5.1-beta.0",
      "11.5.1+build.1",
      "v11.5.1",
      "11.5",
      "011.5.1",
      "999999999999999999999999.5.1",
      "",
    ]) {
      expect(validate(rejected).status, rejected).not.toBe(0);
    }
  });

  it("rejects a packed manifest that tries to redirect npm publication", () => {
    const workflow = read(".github/workflows/release.yml");
    const validator = inlineModuleFollowing(workflow, "Validate packed manifest identity");
    const fixtureRoot = mkdtempSync(join(tmpdir(), "aih-catalog-release-manifest-"));
    try {
      const packageRoot = join(fixtureRoot, "package");
      mkdirSync(packageRoot);
      const validate = (publishConfig: Record<string, unknown>) => {
        writeFileSync(
          join(packageRoot, "package.json"),
          JSON.stringify({
            name: "@aihq/catalog",
            version: "0.1.3",
            publishConfig,
          }),
        );
        execFileSync("tar", ["-czf", "candidate.tgz", "package"], {
          cwd: fixtureRoot,
        });
        return spawnSync(process.execPath, ["--input-type=module", "-", "candidate.tgz", "0.1.3"], {
          cwd: fixtureRoot,
          input: validator,
          encoding: "utf8",
        });
      };

      expect(validate({ access: "public" }).status).toBe(0);
      expect(validate({ access: "public", registry: "https://attacker.invalid/" }).status).not.toBe(
        0,
      );
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
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
    expect(publication).toContain('--repo "$GITHUB_REPOSITORY"');
    expect(publication).toContain("Validate packed manifest identity");
    expect(publication).toContain('manifest.name !== "@aihq/catalog"');
    expect(publication).toContain("manifest.version !== tag");

    const sbomIndex = publication.indexOf("Generate tarball-scoped SPDX SBOM");
    const attestIndex = publication.indexOf("Attest build provenance for the exact tarball");
    const signIndex = publication.indexOf("Sign trusted checksum and retain provenance bundle");
    const publishIndex = publication.indexOf(
      "Publish exact tarball through npm Trusted Publishing",
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

    const trustedPublishStep = publication.slice(publishIndex, releaseIndex);
    const liveRefIndex = trustedPublishStep.indexOf(
      "Revalidate live main and tag immediately before the effect",
    );
    const finalHashIndex = trustedPublishStep.indexOf('actual_sha256="$(sha256sum "$TARBALL"');
    const effectIndex = trustedPublishStep.indexOf('npm publish "$tarball"');
    expect(liveRefIndex).toBeGreaterThanOrEqual(0);
    expect(finalHashIndex).toBeGreaterThan(liveRefIndex);
    expect(effectIndex).toBeGreaterThan(finalHashIndex);
    expect(trustedPublishStep).not.toContain("NPM_BOOTSTRAP_TOKEN");
    expect(trustedPublishStep).not.toContain("secrets.");
    expect(trustedPublishStep).not.toContain('npm view "@aihq/catalog"');
  });

  it("documents tokenless publication, authority, verification, and immutable failure behavior", () => {
    const releasing = read("RELEASING.md");
    expect(releasing).toContain(
      "npm trust github @aihq/catalog --file release.yml --repo samartomar/aih-catalog --env npm-publish --allow-publish",
    );
    expect(releasing).toContain("npm trust list @aihq/catalog");
    expect(releasing).toContain("full-SHA publication authorization");
    expect(releasing).toContain("GitHub bootstrap secret is absent");
    expect(releasing).toContain("owner confirmed revocation");
    expect(releasing).toContain("issuecomment-5422642774");
    expect(releasing).toContain("release prerequisites; never restore the bootstrap token path");
    expect(releasing).not.toContain("**Bypass 2FA** enabled");
    expect(releasing).not.toContain("NPM_BOOTSTRAP_TOKEN");
    expect(releasing).toContain("never delete, move, or reuse the tag");
    expect(releasing).toContain("semver:none|patch|minor|major");
    expect(releasing).toContain("publishes under npm `next`");
    expect(releasing).toContain("separate promotion authorization");
    expect(releasing).toContain("public installed Catalog/Core/\nScanner acceptance");
    expect(releasing).toContain('npm view "@aihq/catalog@$version"');
    expect(releasing).toContain('gh attestation verify "./aihq-catalog-$version.tgz"');
    expect(releasing).not.toContain("gh attestation verify ./node_modules/@aihq/catalog");
    expect(releasing).toContain("Package publication is not Catalog signing authority");

    const readme = read("README.md");
    expect(readme).toContain('npm install --save-exact "@aihq/catalog@$version"');
    expect(readme).toContain('gh release view "v-catalog-$version"');
    expect(readme).toContain('gh attestation verify "./aihq-catalog-$version.tgz"');
    expect(readme).toContain("npm provenance");
    expect(readme).toMatch(/GitHub build\s+attestation/u);
    expect(readme).toMatch(/Package and GitHub Release\s+availability are live state/u);
    expect(readme).not.toContain("has not been published");
    expect(read("ai-coding/project.md")).not.toContain("prepublication");
    expect(read("ai-coding/supported-catalog-v2.md")).not.toContain("Publication remains deferred");
  });

  it("enforces package-bearing and repository-only release classes in CI", () => {
    const semver = read(".github/workflows/semver-label.yml");
    expect(semver).toContain("semver:none|semver:patch|semver:minor|semver:major");
    expect(semver).toContain("Exactly one semver:* label is required");
    expect(read("VERSIONING.md")).toContain("cannot start or bump a package cut");
  });

  it("packs the license, default data, command, and library under the exact identity", () => {
    const raw = execFileSync(
      process.execPath,
      [process.env.npm_execpath ?? "", "pack", "--ignore-scripts", "--dry-run", "--json"],
      { cwd: root, encoding: "utf8", maxBuffer: 4 * 1024 * 1024, timeout: 30_000 },
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
      version: "0.2.0",
      filename: "aihq-catalog-0.2.0.tgz",
    });
    const paths = packed.files.map(({ path }) => path);
    expect(paths).toContain("LICENSE");
    expect(paths).toContain("README.md");
    expect(paths).toContain("defaults/default-catalog-v2.json");
    expect(paths).toContain("dist/cli.js");
    expect(paths).toContain("dist/index.js");
    expect(paths).toContain(
      "defaults/sources/github.com/samartomar/ai-harness/54ceab4118aade25a8a07608532b434feb0a6e6b/packs/governance-quality/aih-gov-doctor/SKILL.md",
    );
  }, 45_000);
});

// Core's version 2 sibling-compatibility artifact, shaped as the producer writes it: one
// catalog-candidate combination (Catalog at next, the supported Core and Scan at latest),
// one scan-candidate combination, and raw observations that are never promotable.
function compatibilityFixture() {
  const sha = "a".repeat(64);
  const integrity = "sha512-catalog-0.3.0";
  const core = {
    package: "@aihq/core",
    version: "0.7.0",
    distTag: "latest",
    tarballSha256: "c".repeat(64),
    tarballIntegrity: "sha512-core-0.7.0",
  };
  const scan = {
    package: "@aihq/scan",
    version: "0.4.0",
    distTag: "latest",
    tarballSha256: "d".repeat(64),
    tarballIntegrity: "sha512-scan-0.4.0",
  };
  const catalogLatest = {
    package: "@aihq/catalog",
    version: "0.2.0",
    distTag: "latest",
    tarballSha256: "f".repeat(64),
    tarballIntegrity: "sha512-catalog-0.2.0",
  };
  // Every id the producer emits, in the producer's order. The old published Scan cannot
  // pass Scan's own checks; that is visible to the owner but does not refuse Catalog.
  const contractChecks = [
    { id: "catalog-readers", status: "passed" },
    { id: "catalog-subject-digests", status: "passed" },
    { id: "scan-organization-evidence-schema-lock", status: "failed" },
    { id: "scan-decision-schema-lock", status: "unavailable" },
    { id: "catalog-decision-schema-lock", status: "passed" },
    { id: "catalog-qualification-receipt-schema-lock", status: "passed" },
    { id: "supported-clis-shape", status: "passed" },
    { id: "refusal-input-unknown-version", status: "passed" },
    { id: "refusal-evidence-unknown-version", status: "passed" },
    { id: "refusal-scan-core-contract-unknown", status: "passed" },
    { id: "refusal-catalog-index-unknown-version", status: "passed" },
    { id: "scan-custody-negative", status: "failed" },
  ];
  const catalogCandidate = {
    combination: "catalog-candidate",
    candidate: {
      package: "@aihq/catalog",
      version: "0.3.0",
      distTag: "next",
      tarballSha256: sha,
      tarballIntegrity: integrity,
    },
    baseline: [core, scan],
    environment: { os: "ubuntu-latest", node: "22", npm: "11.6.2" },
    lockfileSha256: "e".repeat(64),
    contractChecks,
  };
  const scanCandidate = {
    combination: "scan-candidate",
    candidate: {
      package: "@aihq/scan",
      version: "0.5.0",
      distTag: "next",
      tarballSha256: "b".repeat(64),
      tarballIntegrity: "sha512-scan-0.5.0",
    },
    baseline: [core, catalogLatest],
    environment: { os: "ubuntu-latest", node: "22" },
    lockfileSha256: "9".repeat(64),
    contractChecks: contractChecks.map((check) => ({ ...check, status: "passed" })),
  };
  const allNextObservation = {
    leg: "registry-all-next",
    combination: "all-next",
    status: "tested",
    os: "ubuntu-latest",
    node: "22",
    packages: [
      { ...core, role: "all-next" },
      { ...scanCandidate.candidate, role: "all-next" },
      { ...catalogCandidate.candidate, role: "all-next" },
    ],
    lockfileSha256: "8".repeat(64),
    contractChecks: contractChecks.map((check) => ({ ...check, status: "passed" })),
  };
  const evidence = {
    format: "core-sibling-compatibility",
    version: 2,
    runId: "35733767496",
    runAttempt: "2",
    core: { repository: "samartomar/ai-harness", commit: "1".repeat(40) },
    resolvedAt: "2026-09-23T05:17:41.000Z",
    baseline: {
      "@aihq/core": { latest: core, next: null },
      "@aihq/scan": { latest: scan, next: scanCandidate.candidate },
      "@aihq/catalog": { latest: catalogLatest, next: catalogCandidate.candidate },
    },
    candidates: [scanCandidate, catalogCandidate],
    observations: [allNextObservation],
    limitation:
      "Evidence of what was tested, not authorization and not a dependency pin. A candidate is promotable only for the exact bytes it names, against the exact baseline it names.",
  };
  const withCandidate = (changed: Record<string, unknown>) => ({
    ...evidence,
    candidates: [scanCandidate, { ...catalogCandidate, ...changed }],
  });
  // Every check passed in the all-next run, and no catalog-candidate combination exists.
  const allNextOnly = { ...evidence, candidates: [scanCandidate] };
  const v1 = {
    format: "core-sibling-compatibility",
    version: 1,
    runId: 35733767496,
    runAttempt: 2,
    legs: [
      {
        ...catalogCandidate.candidate,
        contractChecks: contractChecks.map((check) => ({ ...check, status: "passed" })),
      },
    ],
  };
  return { sha, integrity, core, scan, catalogCandidate, evidence, withCandidate, allNextOnly, v1 };
}

describe("@aihq/catalog promotion readiness gate", () => {
  it("gates promotion on Core's compatibility evidence without moving a dist tag", () => {
    const workflow = read(".github/workflows/promotion-readiness.yml");
    // The required check to protect with is the workflow name plus the job id.
    expect(workflow).toContain("name: promotion-readiness");
    expect(workflow).toContain("promotion-readiness / authorize");
    expect(workflow).toContain("  authorize:");
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).not.toMatch(
      /^\s*(push|pull_request|workflow_call|schedule|pull_request_target):/mu,
    );
    expect(workflow).toMatch(/permissions:\n\s+contents: read\n\s+actions: read/u);
    expect(workflow).not.toMatch(/contents:\s*write|id-token:\s*write|packages:\s*write/u);
    expect(workflow).not.toMatch(/secrets\.|NODE_AUTH_TOKEN|NPM_TOKEN/u);
    for (const input of [
      "candidate_version:",
      "compatibility_run_id:",
      "compatibility_run_attempt:",
      "promotion_authorization_comment:",
    ])
      expect(workflow, input).toContain(input);
    expect(workflow).toContain("core-sibling-compatibility");
    expect(workflow).toContain("--repo samartomar/ai-harness");
    expect(workflow).toContain('npm view "@aihq/catalog@$CANDIDATE_VERSION" dist.integrity');
    expect(workflow).toContain('npm view "@aihq/catalog" dist-tags --json');
    expect(workflow).toContain("--ignore-scripts");
    // npm pack writes into --pack-destination without creating it, so the directory must
    // be created before the pack runs, inside the same step.
    const packIndex = workflow.indexOf(
      'npm pack "@aihq/catalog@$CANDIDATE_VERSION" --ignore-scripts --pack-destination candidate',
    );
    expect(packIndex).toBeGreaterThan(0);
    const packStepStart = workflow.lastIndexOf("      - name:", packIndex);
    const mkdirIndex = workflow.indexOf("mkdir -p candidate\n", packStepStart);
    expect(mkdirIndex).toBeGreaterThan(packStepStart);
    expect(mkdirIndex).toBeLessThan(packIndex);
    expect(workflow).toContain('sha256sum "candidate/aihq-catalog-$CANDIDATE_VERSION.tgz"');
    // The version 2 combination this package reads, and the only passing check status.
    expect(workflow).toContain('"combination":"catalog-candidate"');
    expect(workflow).toContain('"package":"@aihq/catalog"');
    expect(workflow).toContain('"status":"passed"');
    expect(workflow).toContain('entry.combination === "catalog-candidate"');
    expect(workflow).toContain('entry.candidate?.package === "@aihq/catalog"');
    expect(workflow).toContain('matching[0].status !== "passed"');
    expect(workflow).not.toContain("evidence.legs");
    expect(workflow).toContain(
      "the published tarball bytes differ from the bytes the compatibility run tested",
    );
    // The supported Core and Scan the candidate was tested against are re-observed live
    // before the validator runs, and the validator reads only those live files.
    const reobserveIndex = workflow.indexOf("- name: Re-observe the supported Core and sibling");
    const downloadStepIndex = workflow.indexOf(
      "- name: Download Core's sibling-compatibility evidence",
    );
    const validatorStepIndex = workflow.indexOf(
      "- name: Refuse unless the tested bytes are the bytes being promoted",
    );
    expect(reobserveIndex).toBeGreaterThan(downloadStepIndex);
    expect(validatorStepIndex).toBeGreaterThan(reobserveIndex);
    const reobserveStep = workflow.slice(reobserveIndex, validatorStepIndex);
    for (const command of [
      'npm view "@aihq/core" dist-tags --json > live-baseline-core-dist-tags.json',
      'npm view "@aihq/core@$core_version" dist.integrity --json > live-baseline-core-integrity.json',
      'npm view "@aihq/scan" dist-tags --json > live-baseline-scan-dist-tags.json',
      'npm view "@aihq/scan@$scan_version" dist.integrity --json > live-baseline-scan-integrity.json',
    ])
      expect(reobserveStep, command).toContain(command);
    // The versions reach the shell only after a whole-string semver re-check.
    expect(reobserveStep).toContain('[[ "$core_version" =~ $semver ]]');
    expect(reobserveStep).toContain('[[ "$scan_version" =~ $semver ]]');
    expect(reobserveStep).not.toContain("${{");
    expect(workflow).toContain("npm dist-tag add @aihq/catalog@$CANDIDATE_VERSION latest");
    // The commands exist only inside the printed heredoc, never as an executed step.
    expect(workflow).toContain("Print the promotion commands without running them");
    const heredocStart = workflow.indexOf("cat <<EOF");
    const heredocEnd = workflow.indexOf("EOF", heredocStart + "cat <<EOF".length);
    expect(heredocStart).toBeGreaterThan(0);
    expect(heredocEnd).toBeGreaterThan(heredocStart);
    const outsideHeredoc =
      workflow.slice(0, heredocStart) + workflow.slice(heredocEnd + "EOF".length);
    expect(outsideHeredoc).not.toMatch(/npm dist-tag (add|rm)/u);
    expect(outsideHeredoc).not.toContain("gh release edit");
    expect(workflow).toContain("it is not the owner's promotion authorization");

    const releasing = read("RELEASING.md");
    expect(releasing).toContain("promotion-readiness / authorize");
    expect(releasing).toContain("A green run is evidence, not\n   authorization.");
    expect(releasing).toContain("Authorize promoting @aihq/catalog@X.Y.Z from next to latest");
    expect(releasing).toContain("`catalog-candidate`");
    expect(releasing).toContain("Re-observe the supported Core and sibling");
    for (const id of [
      "catalog-readers",
      "catalog-subject-digests",
      "catalog-decision-schema-lock",
      "catalog-qualification-receipt-schema-lock",
      "supported-clis-shape",
      "refusal-input-unknown-version",
      "refusal-catalog-index-unknown-version",
    ])
      expect(releasing, id).toContain(`\`${id}\``);
    // Initial-release sequencing: Core first, and all-next evidence is never independent.
    expect(releasing).toContain("Core is promoted first");
    expect(releasing).toContain("`all-next`");
  });

  it("re-observes only a well-formed supported Core and Scan baseline from the artifact", () => {
    const workflow = read(".github/workflows/promotion-readiness.yml");
    const reader = inlineModuleFollowing(workflow, "Re-observe the supported Core and sibling");
    const fixtureRoot = mkdtempSync(join(tmpdir(), "aih-catalog-promotion-baseline-"));
    try {
      mkdirSync(join(fixtureRoot, "compatibility"));
      const reobserve = (artifact: unknown) => {
        rmSync(join(fixtureRoot, "baseline-core-version.txt"), { force: true });
        rmSync(join(fixtureRoot, "baseline-scan-version.txt"), { force: true });
        writeFileSync(
          join(fixtureRoot, "compatibility", "core-sibling-compatibility.json"),
          JSON.stringify(artifact),
        );
        return spawnSync(process.execPath, ["--input-type=module", "-"], {
          cwd: fixtureRoot,
          input: reader,
          encoding: "utf8",
          env: { ...process.env },
        });
      };
      const fixture = compatibilityFixture();
      const ok = reobserve(fixture.evidence);
      expect(ok.status, ok.stderr).toBe(0);
      expect(readFileSync(join(fixtureRoot, "baseline-core-version.txt"), "utf8")).toBe("0.7.0");
      expect(readFileSync(join(fixtureRoot, "baseline-scan-version.txt"), "utf8")).toBe("0.4.0");

      const withBaseline = (baseline: unknown) => fixture.withCandidate({ baseline });
      const [core, scan] = fixture.catalogCandidate.baseline;
      for (const [label, artifact, reason] of [
        ["v1", fixture.v1, "declares an unknown format or version"],
        [
          "all-next only",
          fixture.allNextOnly,
          "names no single @aihq/catalog candidate tested against the supported Core",
        ],
        [
          "Core at next",
          withBaseline([{ ...core, distTag: "next" }, scan]),
          "does not name the supported Core and sibling",
        ],
        ["no Scan", withBaseline([core]), "does not name the supported Core and sibling"],
        [
          "shell in a version",
          withBaseline([{ ...core, version: "0.7.0 && curl example.invalid" }, scan]),
          "does not name the supported Core and sibling",
        ],
        [
          "multi-line version",
          withBaseline([{ ...core, version: "0.7.0\n0.7.1" }, scan]),
          "does not name the supported Core and sibling",
        ],
      ] as const) {
        const result = reobserve(artifact);
        expect(result.status, label).toBe(1);
        expect(result.stderr, label).toMatch(/^refused: /u);
        expect(result.stderr, label).toContain(reason);
      }
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });

  it("refuses compatibility evidence unless it comes from Core's own main compatibility run", () => {
    const workflow = read(".github/workflows/promotion-readiness.yml");
    // The run is described before its artifact is downloaded, through env-only inputs.
    const describeIndex = workflow.indexOf(
      'gh api "repos/samartomar/ai-harness/actions/runs/$COMPATIBILITY_RUN_ID" > compatibility-run.json',
    );
    const downloadIndex = workflow.indexOf('gh run download "$COMPATIBILITY_RUN_ID"');
    expect(describeIndex).toBeGreaterThan(0);
    expect(downloadIndex).toBeGreaterThan(describeIndex);
    const inputUses = workflow.split("\n").filter((line) => line.includes("${{ inputs."));
    expect(inputUses.length).toBeGreaterThan(0);
    for (const line of inputUses)
      expect(line, line).toMatch(
        /^(\s+[A-Z_]+: \$\{\{ inputs\.[a-z_]+ \}\}|\s+group: promotion-readiness-\$\{\{ inputs\.candidate_version \}\})$/u,
      );
    for (const refusal of [
      "refused: Core compatibility run $COMPATIBILITY_RUN_ID is unreadable",
      'if (run.head_repository?.full_name !== "samartomar/ai-harness")',
      'if (run.path !== ".github/workflows/sibling-compatibility.yml")',
      'if (run.event !== "schedule" && run.event !== "workflow_dispatch")',
      'if (run.head_branch !== "main")',
      'if (run.conclusion !== "success")',
      "if (String(run.run_attempt) !== process.env.COMPATIBILITY_RUN_ATTEMPT)",
    ])
      expect(workflow, refusal).toContain(refusal);

    const validator = inlineModuleFollowing(
      workflow,
      "Refuse evidence from any run but Core's own main compatibility run",
    );
    const genuine = {
      id: 35733767496,
      path: ".github/workflows/sibling-compatibility.yml",
      event: "schedule",
      head_branch: "main",
      conclusion: "success",
      run_attempt: 2,
      head_repository: { full_name: "samartomar/ai-harness" },
    };
    const fixtureRoot = mkdtempSync(join(tmpdir(), "aih-catalog-promotion-run-"));
    try {
      const validate = (run: unknown, raw?: string) => {
        writeFileSync(join(fixtureRoot, "compatibility-run.json"), raw ?? JSON.stringify(run));
        return spawnSync(process.execPath, ["--input-type=module", "-"], {
          cwd: fixtureRoot,
          input: validator,
          encoding: "utf8",
          env: {
            ...process.env,
            COMPATIBILITY_RUN_ID: "35733767496",
            COMPATIBILITY_RUN_ATTEMPT: "2",
          },
        });
      };

      expect(validate(genuine).status).toBe(0);
      expect(validate({ ...genuine, event: "workflow_dispatch" }).status).toBe(0);
      for (const [label, forged, reason] of [
        ["other run", { ...genuine, id: 35733767497 }, "the compatibility run is 35733767497"],
        [
          "fork",
          { ...genuine, head_repository: { full_name: "someone/ai-harness" } },
          "ran from someone/ai-harness",
        ],
        [
          "other workflow",
          { ...genuine, path: ".github/workflows/ci.yml" },
          "is .github/workflows/ci.yml",
        ],
        ["pull request", { ...genuine, event: "pull_request" }, "triggered by pull_request"],
        [
          "pull request target",
          { ...genuine, event: "pull_request_target" },
          "triggered by pull_request_target",
        ],
        ["push", { ...genuine, event: "push" }, "triggered by push"],
        ["branch", { ...genuine, head_branch: "feature" }, "ran on feature, not main"],
        ["failure", { ...genuine, conclusion: "failure" }, "concluded failure, not success"],
        ["in progress", { ...genuine, conclusion: null }, "concluded null, not success"],
        ["attempt", { ...genuine, run_attempt: 3 }, "latest attempt is 3, not 2"],
        ["array", [genuine], "description is not an object"],
        ["null", null, "description is not an object"],
      ] as const) {
        const result = validate(forged);
        expect(result.status, label).toBe(1);
        expect(result.stderr, label).toMatch(/^refused: the compatibility run('s)? /u);
        expect(result.stderr, label).toContain(reason);
      }
      const unreadable = validate(undefined, "{not json");
      expect(unreadable.status).toBe(1);
      expect(unreadable.stderr).toContain(
        "refused: the compatibility run description is not readable JSON",
      );
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });

  it("promotes only the catalog-candidate tested against the live supported Core and Scan, over the exact bytes", () => {
    const workflow = read(".github/workflows/promotion-readiness.yml");
    const validator = inlineModuleFollowing(
      workflow,
      "Refuse unless the tested bytes are the bytes being promoted",
    );
    const fixture = compatibilityFixture();
    const { sha, integrity, core, scan, catalogCandidate, evidence, withCandidate } = fixture;
    type Live = {
      integrity?: string;
      sha256?: string;
      next?: string;
      coreLatest?: string;
      coreIntegrity?: string;
      scanLatest?: string;
      scanIntegrity?: string;
      omit?: string;
    };
    const fixtureRoot = mkdtempSync(join(tmpdir(), "aih-catalog-promotion-bytes-"));
    try {
      mkdirSync(join(fixtureRoot, "compatibility"));
      const validate = (artifact: unknown, live: Live = {}) => {
        writeFileSync(
          join(fixtureRoot, "compatibility", "core-sibling-compatibility.json"),
          JSON.stringify(artifact),
        );
        const files: Record<string, string> = {
          "live-integrity.json": JSON.stringify(live.integrity ?? integrity),
          "live-tarball-sha256.txt": `${live.sha256 ?? sha}\n`,
          "live-dist-tags.json": JSON.stringify({ latest: "0.2.0", next: live.next ?? "0.3.0" }),
          "live-baseline-core-dist-tags.json": JSON.stringify({
            latest: live.coreLatest ?? core.version,
          }),
          "live-baseline-core-integrity.json": JSON.stringify(
            live.coreIntegrity ?? core.tarballIntegrity,
          ),
          "live-baseline-scan-dist-tags.json": JSON.stringify({
            latest: live.scanLatest ?? scan.version,
            next: "0.5.0",
          }),
          "live-baseline-scan-integrity.json": JSON.stringify(
            live.scanIntegrity ?? scan.tarballIntegrity,
          ),
        };
        for (const [name, content] of Object.entries(files)) {
          rmSync(join(fixtureRoot, name), { force: true });
          if (name !== live.omit) writeFileSync(join(fixtureRoot, name), content);
        }
        return spawnSync(process.execPath, ["--input-type=module", "-"], {
          cwd: fixtureRoot,
          input: validator,
          encoding: "utf8",
          env: {
            ...process.env,
            CANDIDATE_VERSION: "0.3.0",
            COMPATIBILITY_RUN_ID: "35733767496",
            COMPATIBILITY_RUN_ATTEMPT: "2",
          },
        });
      };

      // (l) READY prints the combination, the tested baseline and the environment, and
      // surfaces every non-passed check that this package does not require.
      const ready = validate(evidence);
      expect(ready.status, ready.stderr).toBe(0);
      expect(JSON.parse(ready.stdout)).toEqual({
        status: "READY",
        candidateVersion: "0.3.0",
        combination: "catalog-candidate",
        testedBy: { runId: "35733767496", runAttempt: "2" },
        tarballSha256: sha,
        tarballIntegrity: integrity,
        baseline: [
          { package: "@aihq/core", version: "0.7.0", tarballSha256: core.tarballSha256 },
          { package: "@aihq/scan", version: "0.4.0", tarballSha256: scan.tarballSha256 },
        ],
        environment: { os: "ubuntu-latest", node: "22", npm: "11.6.2" },
        contractChecks: 12,
        requiredChecks: 7,
        otherChecksNotPassed: [
          "scan-organization-evidence-schema-lock",
          "scan-decision-schema-lock",
          "scan-custody-negative",
        ],
        authority: "none",
        limitation: expect.stringContaining("not owner authorization"),
      });
      // The recorded baseline order does not matter; each package is named once.
      expect(validate(withCandidate({ baseline: [scan, core] })).status).toBe(0);
      // An environment without a known npm version is still an environment.
      const noNpm = validate(withCandidate({ environment: { os: "ubuntu-latest", node: "22" } }));
      expect(noNpm.status, noNpm.stderr).toBe(0);
      expect(JSON.parse(noNpm.stdout).environment).toEqual({ os: "ubuntu-latest", node: "22" });

      const withChecks = (change: (checks: typeof catalogCandidate.contractChecks) => unknown) =>
        withCandidate({ contractChecks: change(catalogCandidate.contractChecks) });
      const withStatus = (id: string, status: string) =>
        withChecks((checks) =>
          checks.map((check) => (check.id === id ? { ...check, status } : check)),
        );
      const noCandidate =
        "the compatibility artifact names no single @aihq/catalog candidate tested against the supported Core";
      const noBaseline = "the candidate combination does not name the supported Core and sibling";
      const cases: ReadonlyArray<readonly [string, unknown, Live, string]> = [
        // (a) Version 1 artifacts, and anything else unknown, are refused by name.
        [
          "v1 artifact",
          fixture.v1,
          {},
          "the compatibility artifact declares an unknown format or version",
        ],
        ["version 3", { ...evidence, version: 3 }, {}, "declares an unknown format or version"],
        [
          "no candidates",
          { ...evidence, candidates: undefined },
          {},
          "declares an unknown format or version",
        ],
        [
          "other format",
          { ...evidence, format: "other" },
          {},
          "declares an unknown format or version",
        ],
        // (b) All-next evidence is never independent compatibility evidence.
        ["all-next observation only", fixture.allNextOnly, {}, noCandidate],
        [
          "all-next entry naming catalog",
          { ...evidence, candidates: [{ ...catalogCandidate, combination: "all-next" }] },
          {},
          noCandidate,
        ],
        [
          "catalog-candidate naming scan",
          withCandidate({ candidate: { ...catalogCandidate.candidate, package: "@aihq/scan" } }),
          {},
          noCandidate,
        ],
        [
          "two candidates",
          { ...evidence, candidates: [catalogCandidate, catalogCandidate] },
          {},
          noCandidate,
        ],
        // (c)(d)(e) Every required check is present once and passed.
        [
          "required check failed",
          withStatus("catalog-readers", "failed"),
          {},
          "1 required contract check(s) missing or not passed: catalog-readers",
        ],
        [
          "required check unavailable",
          withStatus("catalog-subject-digests", "unavailable"),
          {},
          "1 required contract check(s) missing or not passed: catalog-subject-digests",
        ],
        [
          "required check missing",
          withChecks((checks) => checks.filter(({ id }) => id !== "supported-clis-shape")),
          {},
          "1 required contract check(s) missing or not passed: supported-clis-shape",
        ],
        [
          "required check duplicated",
          withChecks((checks) => [...checks, { id: "catalog-readers", status: "passed" }]),
          {},
          "1 required contract check(s) missing or not passed: catalog-readers",
        ],
        [
          "no checks",
          withChecks(() => undefined),
          {},
          "7 required contract check(s) missing or not passed: catalog-readers, catalog-subject-digests, catalog-decision-schema-lock, catalog-qualification-receipt-schema-lock, supported-clis-shape, refusal-input-unknown-version, refusal-catalog-index-unknown-version",
        ],
        [
          "malformed check",
          withChecks((checks) => [...checks, { id: "scan-custody-negative-2", status: "skipped" }]),
          {},
          "the candidate combination records a malformed contract check",
        ],
        // (f)(g) The baseline is the supported Core and Scan at latest, once each.
        [
          "Core at next",
          withCandidate({ baseline: [{ ...core, distTag: "next" }, scan] }),
          {},
          noBaseline,
        ],
        ["no Scan", withCandidate({ baseline: [core] }), {}, noBaseline],
        ["Core twice", withCandidate({ baseline: [core, core] }), {}, noBaseline],
        [
          "Catalog as its own baseline",
          withCandidate({ baseline: [core, { ...scan, package: "@aihq/catalog" }] }),
          {},
          noBaseline,
        ],
        ["no baseline", withCandidate({ baseline: undefined }), {}, noBaseline],
        [
          "baseline without bytes",
          withCandidate({ baseline: [core, { ...scan, tarballSha256: "d" }] }),
          {},
          noBaseline,
        ],
        [
          "baseline without integrity",
          withCandidate({ baseline: [{ ...core, tarballIntegrity: "sha1-core" }, scan] }),
          {},
          noBaseline,
        ],
        [
          "baseline without a version",
          withCandidate({ baseline: [{ ...core, version: "latest" }, scan] }),
          {},
          noBaseline,
        ],
        // (k) The execution environment is part of the tested combination.
        [
          "environment missing",
          withCandidate({ environment: undefined }),
          {},
          "the candidate combination records no execution environment",
        ],
        [
          "environment without node",
          withCandidate({ environment: { os: "ubuntu-latest", node: "" } }),
          {},
          "the candidate combination records no execution environment",
        ],
        // (h)(i)(j) The baseline is re-observed live; stale evidence is never reused.
        [
          "live Core moved",
          evidence,
          { coreLatest: "0.7.1" },
          "the supported @aihq/core moved since the compatibility run (latest is 0.7.1, tested 0.7.0); rerun Core's sibling-compatibility",
        ],
        [
          "live Core bytes differ",
          evidence,
          { coreIntegrity: "sha512-core-republished" },
          "the supported @aihq/core@0.7.0 bytes differ from the bytes the compatibility run tested",
        ],
        [
          "live Scan moved",
          evidence,
          { scanLatest: "0.5.0" },
          "the supported @aihq/scan moved since the compatibility run (latest is 0.5.0, tested 0.4.0); rerun Core's sibling-compatibility",
        ],
        [
          "live Scan bytes differ",
          evidence,
          { scanIntegrity: "sha512-scan-republished" },
          "the supported @aihq/scan@0.4.0 bytes differ from the bytes the compatibility run tested",
        ],
        [
          "live Core not observed",
          evidence,
          { omit: "live-baseline-core-dist-tags.json" },
          "live-baseline-core-dist-tags.json is not readable JSON",
        ],
        [
          "live Scan bytes not observed",
          evidence,
          { omit: "live-baseline-scan-integrity.json" },
          "live-baseline-scan-integrity.json is not readable JSON",
        ],
        // The candidate itself: exact version at next, exact bytes, still on next.
        [
          "other version",
          withCandidate({ candidate: { ...catalogCandidate.candidate, version: "0.2.9" } }),
          {},
          "the tested candidate is 0.2.9, not 0.3.0",
        ],
        [
          "candidate from latest",
          withCandidate({ candidate: { ...catalogCandidate.candidate, distTag: "latest" } }),
          {},
          "the tested candidate was resolved from latest, not next",
        ],
        ["other bytes", evidence, { sha256: "b".repeat(64) }, "published tarball bytes differ"],
        ["other integrity", evidence, { integrity: "sha512-other" }, "registry integrity differs"],
        ["next moved", evidence, { next: "0.3.1" }, "dist-tags.next is 0.3.1"],
        ["other run", { ...evidence, runId: "1" }, {}, "different run or attempt"],
        ["other attempt", { ...evidence, runAttempt: "1" }, {}, "different run or attempt"],
      ];
      for (const [label, artifact, live, reason] of cases) {
        const result = validate(artifact, live);
        expect(result.status, label).toBe(1);
        expect(result.stderr, label).toMatch(/^refused: /u);
        expect(result.stderr, label).toContain(reason);
        expect(result.stdout, label).not.toContain("READY");
      }
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });
});

describe("Catalog content gates run on the committed data (WO-CATALOG-CI)", () => {
  const verifyJob = () => {
    const workflow = read(".github/workflows/verify.yml");
    const start = workflow.indexOf("\n  verify:\n");
    const end = workflow.indexOf("\n  cold-external-admin:\n");
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    return workflow.slice(start, end);
  };
  /** Offset of the step line that runs exactly `command`, or -1. */
  const stepIndex = (job: string, command: string) => {
    let offset = 0;
    for (const line of job.split("\n")) {
      const step = line.trim();
      if (step === `- run: ${command}` || step === `run: ${command}`) return offset;
      offset += line.length + 1;
    }
    return -1;
  };

  it("checks committed defaults in the verify workflow before any step regenerates them", () => {
    const job = verifyJob();
    const install = stepIndex(job, "npm ci");
    const compile = stepIndex(job, "npm run build:dist");
    const check = stepIndex(job, "npm run check:catalog-index");
    const verify = stepIndex(job, "npm run verify");
    expect(install).toBeGreaterThanOrEqual(0);
    expect(compile).toBeGreaterThan(install);
    expect(check).toBeGreaterThan(compile);
    expect(verify).toBeGreaterThan(check);
    // Nothing before the gate may regenerate defaults/**: no build, generator or verify.
    const beforeCheck = job.slice(0, check);
    expect(beforeCheck).not.toMatch(/npm run (?:build|verify|generate:)(?![:\w-]*dist\b)/u);
    expect(beforeCheck).not.toMatch(/tools\/generate-/u);
    expect(job).toContain("name: Check committed catalog data before any regeneration");
  });

  it("keeps the verify workflow read-only, pinned and on its existing triggers", () => {
    const workflow = read(".github/workflows/verify.yml");
    expect(workflow).toContain(
      "on:\n  pull_request:\n  push:\n    branches: [main]\n  workflow_dispatch:\n\npermissions:\n  contents: read\n\njobs:\n",
    );
    expect(workflow).not.toMatch(/(?:write|secrets\.|GITHUB_TOKEN|id-token)/u);
    const uses = [...workflow.matchAll(/^\s*(?:-\s*)?uses:\s*([^@\s]+)@(\S+)(.*)$/gmu)];
    expect(uses.length).toBeGreaterThanOrEqual(6);
    for (const [, action, revision, comment] of uses) {
      expect(action).toMatch(/^[\w.-]+\/[\w.-]+$/u);
      expect(revision).toMatch(/^[0-9a-f]{40}$/u);
      expect(comment).toMatch(/^ # v\d+\.\d+\.\d+$/u);
    }
    const checkouts = workflow.match(/uses: actions\/checkout@/gu) ?? [];
    const persisted = workflow.match(/persist-credentials: false/gu) ?? [];
    expect(persisted.length).toBe(checkouts.length);
  });

  it("orders the local verify script so the gates see committed data before build regenerates it", () => {
    const scripts = (
      JSON.parse(read("package.json")) as {
        scripts: { build: string; "build:dist": string; verify: string };
      }
    ).scripts;
    // build:dist is build without the generators, so it cannot rewrite defaults/**.
    expect(scripts["build:dist"]).toBe(
      "node tools/clean-dist.mjs && tsc -p tsconfig.build.json && node tools/ensure-cli-executable.mjs",
    );
    expect(scripts.build.endsWith(` && ${scripts["build:dist"]}`)).toBe(true);
    expect(scripts.verify.split(" && ")).toEqual([
      "npm run typecheck",
      "npm run lint",
      "npm run build:dist",
      "npm run check:catalog-index",
      "npm run build",
      "npm test",
    ]);
  });
});
