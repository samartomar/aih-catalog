# Releasing AIH Catalog

`@aihq/catalog` is the Apache-2.0 Catalog package. A `v-catalog-X.Y.Z` tag on
the exact current `main` commit starts `.github/workflows/release.yml`. The
workflow's read-only job re-runs repository and exact Core contract verification,
including a disposable packed integration proof, then packs, hashes, and
smoke-installs the release artifact once. A protected publication job downloads
that candidate by immutable artifact ID, checks its artifact-service and direct
tarball digests, re-observes the tag and `main`, and validates the embedded
package identity. The protected job runs no candidate package code. It produces
a tarball-scoped SPDX SBOM and GitHub build attestation, signs the trusted
checksum with keyless cosign, publishes the same digest-revalidated tarball
with npm provenance, and creates the GitHub Release.

Package publication is not Catalog signing authority. It makes producer bytes
publicly obtainable with provenance; it does not execute
`signed-catalog-v2.yml`, sign or promote a catalog head, attest a Qualification
Receipt, approve organization use, establish an organization trust root, or
prove successful Core custody.

## First-package bootstrap

This bootstrap applies only while the registry returns one exact structured
`E404` for `@aihq/catalog`. npm's trusted-publisher contract requires that the
package must already exist before an owner can bind GitHub OIDC. That makes the
first registry creation an exceptional owner action. Once the package exists,
never rerun this section: bind the trusted publisher and remove the bootstrap
credential and source path. Do not fall back to an unprovenanced local publish.

For the first version:

1. Merge and fully verify the exact release candidate.
2. Obtain full-SHA publication authorization naming `@aihq/catalog@0.1.3` and
   the exact `main` SHA.
3. Create the `npm-publish` GitHub environment with a required reviewer and
   protect immutable `v-catalog-*` tags. Create a short-lived granular npm access
   token with **Bypass 2FA** enabled and read/write access limited to the `@aihq`
   scope, then store it only as the environment secret `NPM_BOOTSTRAP_TOKEN`.
   Never place it in a repository/organization variable, working-tree `.npmrc`,
   read-only job, log, or issue.
4. The temporary workflow accepts only `v-catalog-0.1.3`. Before the secret is
   available and again after `npm whoami` authenticates it, the workflow requires
   one structured npm error whose exact code is `E404`. Mixed output, success, or
   any other failure refuses publication. The packed manifest must contain exactly
   `publishConfig: { "access": "public" }`; the publish command explicitly selects
   `https://registry.npmjs.org/` and rehashes the tarball before the effect.
5. Begin cleanup as soon as npm confirms package existence, regardless of whether
   the later GitHub Release succeeds. Bind the steady-state trusted publisher
   with npm CLI 11.15.0 or newer:

   ```sh
   npm trust github @aihq/catalog --file release.yml --repo samartomar/aih-catalog --env npm-publish --allow-publish
   npm trust list @aihq/catalog
   ```

   The observed tuple must name samartomar/aih-catalog, workflow `release.yml`,
   environment `npm-publish`, and `npm publish` permission. Then delete the GitHub
   `NPM_BOOTSTRAP_TOKEN` secret, revoke the npm token, and merge the cleanup that
   restores trusted-publisher-only publication before any later Catalog tag.
   Finally require 2FA and disallow traditional tokens in the package settings.

Environment, ruleset, credential, tag, and trusted-publisher mutations are not
source-code changes and require their own authorization. Keep `catalog-signing`
separate: it owns approved outer provenance for exact catalog and receipt bytes,
not npm package publication.

## Normal release

1. Re-observe the issue and current npm state. The immutable `v-catalog-0.1.0`,
   `v-catalog-0.1.1`, and `v-catalog-0.1.2` attempts failed during read-only
   verification before publication and are retained as audit evidence. The
   `0.1.1` attempt exposed a test fixture that assumed the intentionally shallow
   exact-Core checkout had parent history. The `0.1.2` attempt fixed that
   fixture, then its packed smoke install exposed the missing documented
   `aih-supported --help` path. The fix-forward first publication is `0.1.3`; prerelease
   versions publish to `next`, while stable versions publish to `latest`.
2. Ensure `package.json` and `package-lock.json` name the exact version and the
   public README and Catalog V2 contract document the shipped behavior.
3. Run the repository verification commands in the Catalog V2 contract,
   followed by `npm pack --ignore-scripts --dry-run --json` and
   `git diff --check`.
4. Merge the release candidate and wait for every required `main` check.
5. Obtain the exact authorization statement:

   ```text
   Authorize publishing @aihq/catalog@X.Y.Z from <full-main-SHA> as v-catalog-X.Y.Z.
   ```

6. Tag only that unchanged current-main commit, then push the tag normally:

   ```sh
   git tag v-catalog-X.Y.Z <full-main-SHA>
   git push origin v-catalog-X.Y.Z
   ```

7. Approve the protected `npm-publish` environment and drive the release run to
   terminal. Verify the published result from a disposable consumer:

   ```sh
   npm view @aihq/catalog@0.1.3
   npm install --save-exact @aihq/catalog@0.1.3
   npm audit signatures
   gh release download v-catalog-0.1.3 --repo samartomar/aih-catalog --pattern "aihq-catalog-0.1.3.tgz"
   release_sha="$(gh api repos/samartomar/aih-catalog/git/ref/tags/v-catalog-0.1.3 --jq .object.sha)"
   gh attestation verify ./aihq-catalog-0.1.3.tgz --repo samartomar/aih-catalog --signer-workflow samartomar/aih-catalog/.github/workflows/release.yml --source-ref refs/tags/v-catalog-0.1.3 --source-digest "$release_sha" --deny-self-hosted-runners
   ./node_modules/.bin/aih-supported --help
   ```

Compare `release_sha` to the separately authorized full SHA. Also download the
GitHub Release's `SHA256SUMS.txt`, cosign bundle, provenance bundle, and SBOM;
verify the checksum, keyless signature, and SBOM subject before claiming the
package release complete.

## Failure and immutability

Once a tag or npm version exists, never delete, move, or reuse the tag or
version. Preserve the failed run as audit evidence, correct the defect on a new
reviewed commit/version, and fix forward. A green package-release workflow is
not evidence of a signed catalog head, receipt provenance, organization
authority, evidence acceptance, or a successful Core effect.

If npm publication succeeded before a later workflow step failed, npm package
existence is the cleanup trigger: complete step 5 immediately before repairing
the missing GitHub Release evidence. Do not leave the bootstrap credential or
source path active while repairing that evidence.
