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

## Trusted Publishing boundary

The first successful package release is `@aihq/catalog@0.1.3` from immutable tag
`v-catalog-0.1.3`. The normal registry endpoint, registry signature, npm
provenance attestation, GitHub build attestation, Release checksum, disposable
installation, and packed CLI help path were independently verified. The
first-package credential path is historical and must never be restored.

The steady-state npm Trusted Publisher is configured with repository
`samartomar/aih-catalog`, workflow `release.yml`, environment `npm-publish`, and
only the `npm publish` action. Verify the exact tuple with npm CLI 11.15.0 or
newer:

```sh
npm trust github @aihq/catalog --file release.yml --repo samartomar/aih-catalog --env npm-publish --allow-publish
npm trust list @aihq/catalog
```

The GitHub bootstrap secret is absent. The owner must revoke the npm token used
for first publication and configure package publishing access to require 2FA and
disallow traditional tokens. Future Catalog tags remain blocked by owner
approval policy until those npm controls are confirmed. Independently, the
workflow rejects nonempty token credential variables and requires npm CLI 11.5.1
or newer so `npm publish` authenticates only through GitHub OIDC. The protected
job also omits setup-node's `registry-url` input so it cannot create an empty
token placeholder that suppresses OIDC; the publish command itself pins npmjs.

Environment, ruleset, credential, tag, and trusted-publisher mutations are not
source-code changes and require their own authorization. Keep `catalog-signing`
separate: it owns approved outer provenance for exact catalog and receipt bytes,
not npm package publication.

## Normal release

1. Re-observe the issue and current npm state. The immutable `v-catalog-0.1.0`,
   `v-catalog-0.1.1`, and `v-catalog-0.1.2` attempts failed during read-only
   verification before publication and remain audit evidence. Version `0.1.3`
   is the first published package. Every later version uses Trusted Publishing;
   prerelease versions publish to `next`, while stable versions publish to
   `latest`.
2. Ensure `package.json` and `package-lock.json` name the exact version and the
   public README and Catalog V2 contract document the shipped behavior.
3. Run the repository verification commands in the Catalog V2 contract,
   followed by `npm pack --ignore-scripts --dry-run --json` and
   `git diff --check`.
4. Merge the release candidate and wait for every required `main` check.
5. Obtain full-SHA publication authorization with the exact statement:

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

If npm publication succeeds before a later workflow step fails, treat the npm
version as immutable and repair the missing GitHub Release evidence from a new
reviewed version. The tokenless workflow must not be weakened for recovery.
