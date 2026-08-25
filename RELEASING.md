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
through npm trusted publishing, and creates the GitHub Release.

Package publication is not Catalog signing authority. It makes producer bytes
publicly obtainable with provenance; it does not execute
`signed-catalog-v2.yml`, sign or promote a catalog head, attest a Qualification
Receipt, approve organization use, establish an organization trust root, or
prove successful Core custody.

## First-package bootstrap

The `@aihq/catalog` package has not been published. npm's trusted-publisher
contract requires that the package must already exist before an owner can bind
GitHub OIDC. That makes the first registry creation an exceptional owner action.
Do not fall back to an unprovenanced local publish.

For the first version:

1. Merge and fully verify the exact release candidate.
2. Obtain full-SHA publication authorization naming `@aihq/catalog@0.1.0` and
   the exact `main` SHA.
3. If npm still refuses a pre-publication trust binding, stop and prepare a
   separately reviewed, exact-SHA, one-use GitHub bootstrap path using an
   owner-controlled short-lived credential and the protected `npm-publish`
   environment. The bootstrap must publish the exact reviewed tarball with npm
   provenance; it must not become a standing token lane.
4. Immediately after the package exists, remove the bootstrap path and credential,
   then bind the steady-state trusted publisher with npm CLI 11.15.0 or newer:

   ```sh
   npm trust github @aihq/catalog --file release.yml --repo samartomar/aih-catalog --env npm-publish --allow-publish
   npm trust list @aihq/catalog
   ```

   The observed tuple must name samartomar/aih-catalog, workflow `release.yml`, environment `npm-publish`,
   and `npm publish` permission. Then require 2FA and disallow traditional tokens
   in the package settings.

The owner must also create the GitHub `npm-publish` environment with a required
reviewer and protect immutable `v-catalog-*` tags. Environment, ruleset,
credential, tag, and trusted-publisher mutations are not source-code changes
and require their own authorization. Keep `catalog-signing` separate: it owns
approved outer provenance for exact catalog and receipt bytes, not npm package
publication.

## Normal release

1. Re-observe the issue and current npm state. A stable `0.1.0` cut is preferred
   unless an RC is justified; prerelease versions publish to `next`, while
   stable versions publish to `latest`.
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
   npm view @aihq/catalog@0.1.0
   npm install --save-exact @aihq/catalog@0.1.0
   npm audit signatures
   gh release download v-catalog-0.1.0 --repo samartomar/aih-catalog --pattern "aihq-catalog-0.1.0.tgz"
   release_sha="$(gh api repos/samartomar/aih-catalog/git/ref/tags/v-catalog-0.1.0 --jq .object.sha)"
   gh attestation verify ./aihq-catalog-0.1.0.tgz --repo samartomar/aih-catalog --signer-workflow samartomar/aih-catalog/.github/workflows/release.yml --source-ref refs/tags/v-catalog-0.1.0 --source-digest "$release_sha" --deny-self-hosted-runners
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
