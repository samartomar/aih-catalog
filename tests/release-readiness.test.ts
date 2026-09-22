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
    // The artifact leg this package reads, and the only passing check status.
    expect(workflow).toContain('"package":"@aihq/catalog"');
    expect(workflow).toContain('"status":"passed"');
    expect(workflow).toContain('leg.package === "@aihq/catalog"');
    expect(workflow).toContain('check?.status !== "passed"');
    expect(workflow).toContain(
      "the published tarball bytes differ from the bytes the compatibility run tested",
    );
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

  it("promotes only the @aihq/catalog leg whose every check passed, over the exact bytes", () => {
    const workflow = read(".github/workflows/promotion-readiness.yml");
    const validator = inlineModuleFollowing(
      workflow,
      "Refuse unless the tested bytes are the bytes being promoted",
    );
    const sha = "a".repeat(64);
    const integrity = "sha512-tested";
    const leg = {
      package: "@aihq/catalog",
      version: "0.3.0",
      tarballSha256: sha,
      tarballIntegrity: integrity,
      contractChecks: [{ status: "passed" }, { status: "passed" }],
    };
    const evidence = {
      format: "core-sibling-compatibility",
      version: 1,
      runId: 35733767496,
      runAttempt: 2,
      legs: [{ ...leg, package: "@aihq/scan", version: "0.5.0" }, leg],
    };
    const fixtureRoot = mkdtempSync(join(tmpdir(), "aih-catalog-promotion-bytes-"));
    try {
      mkdirSync(join(fixtureRoot, "compatibility"));
      const validate = (
        artifact: unknown,
        live: { integrity?: string; sha256?: string; next?: string } = {},
      ) => {
        writeFileSync(
          join(fixtureRoot, "compatibility", "core-sibling-compatibility.json"),
          JSON.stringify(artifact),
        );
        writeFileSync(
          join(fixtureRoot, "live-integrity.json"),
          JSON.stringify(live.integrity ?? integrity),
        );
        writeFileSync(join(fixtureRoot, "live-tarball-sha256.txt"), `${live.sha256 ?? sha}\n`);
        writeFileSync(
          join(fixtureRoot, "live-dist-tags.json"),
          JSON.stringify({ latest: "0.2.0", next: live.next ?? "0.3.0" }),
        );
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

      const ready = validate(evidence);
      expect(ready.status, ready.stderr).toBe(0);
      expect(JSON.parse(ready.stdout)).toMatchObject({
        status: "READY",
        candidateVersion: "0.3.0",
        tarballSha256: sha,
        authority: "none",
      });
      const withLeg = (changed: Record<string, unknown>) => ({
        ...evidence,
        legs: [evidence.legs[0], { ...leg, ...changed }],
      });
      const cases: ReadonlyArray<
        readonly [string, unknown, { integrity?: string; sha256?: string; next?: string }, string]
      > = [
        [
          "no catalog leg",
          { ...evidence, legs: [evidence.legs[0]] },
          {},
          "no single @aihq/catalog",
        ],
        ["two catalog legs", { ...evidence, legs: [leg, leg] }, {}, "no single @aihq/catalog"],
        ["other version", withLeg({ version: "0.2.9" }), {}, "the tested leg is 0.2.9"],
        [
          "a failed check",
          withLeg({ contractChecks: [{ status: "passed" }, { status: "failed" }] }),
          {},
          "1 contract check(s)",
        ],
        ["no checks", withLeg({ contractChecks: [] }), {}, "records no contract checks"],
        ["other bytes", evidence, { sha256: "b".repeat(64) }, "published tarball bytes differ"],
        ["other integrity", evidence, { integrity: "sha512-other" }, "registry integrity differs"],
        ["next moved", evidence, { next: "0.3.1" }, "dist-tags.next is 0.3.1"],
        ["other run", { ...evidence, runId: 1 }, {}, "different run or attempt"],
        ["unknown format", { ...evidence, version: 2 }, {}, "unknown format or version"],
      ];
      for (const [label, artifact, live, reason] of cases) {
        const result = validate(artifact, live);
        expect(result.status, label).toBe(1);
        expect(result.stderr, label).toContain(reason);
      }
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });
});
