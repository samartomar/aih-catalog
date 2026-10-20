# Release content and baseline evidence

Release format `urn:aihq:catalog:release:1.5.0` requires a dedicated `baseline`.
Earlier formats remain readable with that field absent. The reader never invents
a historical assessment. Unknown release, inventory, projection or baseline
contracts are unsupported. Package version and contract version are independent.

This changes **release preparation**. Ordinary content preparation, offline
integrity checks, selection and Core execution can still operate without Scan.
An authentic readable assessment can qualify even if every requested provider
failed or no item has demonstrated detector coverage. Findings, zero findings,
capture matching and a release binding do not establish safety or authorization.
Policy evidence stays optional; organizational decisions belong to their owners.

## Construct the candidate in order

```text
checked content -> inventory C -> Scan S1 -> signed artifact -> release R -> tarball T
```

1. Prepare and verify content using the existing producer/checks. Freeze its exact
   declarations with `createContentInventory(contentBytes,{expectedSha256})` from
   `@aihq/catalog/reader`. Save the returned `bytes` unchanged at the chosen safe
   package-relative inventory path. Its digest includes the single trailing LF.
2. Explicitly acquire an existing or newly produced assessment artifact. The report
   must capture that exact inventory path, SHA-256 and length in the same
   **package-relative** coordinate namespace as the release's recipe/material
   paths. Record its exact `selection.paths` and `selection.excludedPaths`, sorted
   and unique. A descriptor in C does not mean its material was captured or scanned.
3. Build the typed `ScanBaseline` binding and call `prepareReleaseBaseline` from
   `@aihq/catalog/node`, using the public Scan reader/coverage operations and Core
   authentication under explicitly configured, previously accepted producer trust.
   Supply `acquireBaselineArtifact` for bounded package/HTTPS acquisition. No
   provider engine is imported by Catalog. The caller chooses its evidence runtime.
4. Only a valid result yields final release bytes. Ship C at the bound inventory
   path and, for a package location, the exact artifact at the bound artifact path.
   Save `releaseBytes` as the selected release document. Run ordinary package
   integrity checks, then pack T. Retain the result's authentication receipt and
   `itemCoverage` as release-preparation evidence.

The content projection `urn:aihq:catalog:release-content:1.0.0` contains the entire
raw release document with schema 1.5, excluding only `baseline`: package identity,
sources, items, recipes, material descriptors, dependencies and all metadata.
Array order and omitted/default declarations remain exact; computed reader fields
and normalized dependency defaults are not substituted. Unknown fields are
refused by release admission, never silently omitted. C has no own digest,
signature, baseline/report/artifact reference, final release digest or tarball
integrity. Original material bytes are identified by their declarations.

An older supported content document is upgraded to this projection when frozen;
its prior format identifier is replaced by the defined 1.5 content format.
No other semantic field changes. Freeze does not certify any old binding.
Changing any inventoried field produces C2, so S1 cannot qualify. Changing only
the dedicated binding preserves C, while changing R and the eventual T.
This is an assessment of declared content, not of the final tarball or reader code.

## Public package usage

```js
import { createContentInventory, readContentInventory } from "@aihq/catalog/reader";
import { acquireBaselineArtifact, prepareReleaseBaseline } from "@aihq/catalog/node";
import { readArtifact, readContentCoverage } from "@aihq/scan/read";
import { authenticateEvidence } from "@aihq/core";

const result = await prepareReleaseBaseline({
  contentBytes, expectedSha256: contentSha256, baseline, trust: configuredProducerTrust,
}, {
  readArtifact, readContentCoverage, authenticateEvidence,
  acquireArtifact: artifact => acquireBaselineArtifact(artifact, { packageRoot }),
});
if (!result.valid) throw new Error(JSON.stringify(result.diagnostics));
// Save result.releaseBytes only after reviewing the exact binding and explicit gaps.
```

`baseline` is a `ScanBaseline` from `@aihq/catalog/contracts`:

```js
{
  schema: "urn:aihq:catalog:scan-baseline:1.0.0",
  inventory: { path: "release/content-inventory.json", sha256: contentId, byteLength: inventoryLength },
  scanId: exactScanId,
  artifact: { sha256: artifactSha256, byteLength: artifactLength,
    location: { kind: "package", path: "release/baseline.json" } },
  scope: { namespace: "package-relative", paths: requestedPaths, excludedPaths: excludedPaths }
}
```

Alternatively use `{kind:"https",url:"https://..."}` for an immutable public
artifact. No credentials, fragments, non-443 ports or private machine paths are
allowed. HTTPS redirects are refused, downloads have a 15-second deadline and an
exact-byte-length ceiling, and every acquired artifact is checked against the
bound length and digest. Callers can cancel acquisition. The default host helper
never installs packages or changes trust. Host callbacks are trusted implementations
of the named public APIs, not serialized claims of verification.
Artifacts are bounded to 64 MiB; shipped package artifacts additionally respect
the existing 16 MiB archive-member limit. Requested scope has at most 10,000 paths
in each list. Inventory and release documents retain their 16 MiB/depth-32 limits.

The gate requires a supported readable report, matching Scan ID, matching inventory
capture, equal requested scope, and successful Core authentication identifying the
producer. It rejects missing/unavailable bytes, integrity/identity/content/scope
mismatches, unsupported/unreadable reports and failed authentication. Qualifying
reuse repeats the same checks, with no freshness, all-provider-success, zero-finding
or mandatory per-item scan rule. `itemCoverage` distinguishes capture mismatch
from matched descriptors having zero qualifying observation IDs. It does not infer
remote dependency capture from a declaration or turn missing coverage into a pass.

Portable `readRelease` validates the binding and recomputes C against the entire
release projection. `release.baseline` exposes the exact inventory descriptor,
artifact descriptor/location, Scan ID and requested scope. It authenticates nothing.
`createContentInventory` applied to final R exports the same exact C bytes;
`readContentInventory` admits separately supplied C against its expected digest.
The installed/archive reader additionally checks shipped inventory and artifact
bytes, but does not fetch HTTPS evidence or authenticate a producer implicitly.

Consumers can independently acquire S2 from configured evidence sources, use the
public inventory descriptor and `baseline.scope` as exact comparison inputs to
Scan, and authenticate S2 under their own producer configuration. No Catalog
rebuild is needed. Catalog performs no latest-summary selection. Preserve S1 in
saved policies, reviews and prepared actions until an explicit edit selects other
evidence. Content without evidence remains a valid runtime choice.

## Maintainer commands and proof

The existing `prepare:candidate` prepares **content**, and `check:release` remains
an offline integrity check. Neither establishes new release candidacy. The
release-preparation entry is `prepare:release`; its `prepare` mode always calls the
mandatory baseline gate, including for older input formats. There is no skip flag.
Its separate `freeze` mode emits only C, never a release candidate:

```sh
npm run build:dist
node tools/prepare-release.mjs freeze --content content.json --content-sha256 <sha256> --out content-inventory.json
node tools/prepare-release.mjs prepare --content content.json --content-sha256 <sha256> \
  --baseline binding.json --trust configured-trust.json --runtime <isolated-installed-runtime> \
  --package-root <staged-package> --out <new-final-release.json>
```

Add `--receipt <new-qualification.json>` to retain the exact input/output
descriptors, complete baseline binding, selected trust-file digest, authentication
result, item coverage and measured qualification duration. Release and receipt
outputs must be distinct new files. A failed write can leave the other output;
preserve and inspect it rather than overwriting. This local receipt is custody,
not a signature or an additional release-admission contract. It does not contain
private trust configuration. Keep the original assessment bytes and their
independent producer trust alongside the receipt.

Control JSON is canonical UTF-8 with one LF. Existing outputs are never overwritten.
The runtime root explicitly contains the selected installed public Catalog, Scan
and Core packages. A bounded Node child resolves their ordinary ESM public entries
from that root; the tool discovers no sibling source. The staged package and final
release are reviewed before packing. `prepublishOnly` still refuses publication
unconditionally during migration; neither this tool nor fixtures remove that guard.
No real published baseline, production signing or npm availability is claimed.

`prepare` also reads the staged package through `readInstalledRelease`, checking
its package identity and recipe/material bytes against the pinned content input
before checking evidence. `--release ./release.json` is the default; use another
declared release export explicitly when preparing that document. Output R goes to
a new file for review and staging, and is packed only after ordinary integrity
checks of the completed staged package.

```sh
node tools/verify-baseline-consumer.mjs <exact-scan.tgz> <exact-core.tgz> <new-output-dir> [scan-runtime-lock.json]
```

This installs exact artifacts with lifecycle scripts off and locked dependencies
offline. It constructs a two-item ordinary fixture, captures only the inventory
and one recipe in a synthetic report, signs with an ephemeral fixture key, calls
actual Scan/Core public APIs, writes R, packs T, and reads T in a second consumer.
It retains C/S1/R, public fixture trust, later S2, rejection outcomes and artifact
digests. It exercises partial/all-failed acceptance, unchanged reuse, C2 refusal,
read/trust/acquisition/identity/scope refusals, explicit member gaps and R's
unchanged S1 baseline after reading S2. Saved policy, review, prepared-action and
browser preservation require downstream consumer journey proof; this fixture does
not establish them. It runs no scanner, native client, paid service or publication.
The output is a test fixture, not production content or real provider execution.
