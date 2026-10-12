# Ask AIH Guide delivery evidence

This records local package behavior, separate from publication and native client
acceptance. The source is the final reviewed Extensions 0.6.0 handoff linked in
[Guide content](GUIDE-CONTENT.md). Catalog publication remains blocked.

## Exact local artifacts

| Artifact | SHA-256 |
| --- | --- |
| Core `1.0.0-dev.34`, committed source `4327df9687323b913c68e8008f9bd44246664c07` | `cf4cc41afa46333fcd422b9ffe1a1ef0f25e23cb11acc11a7d1dd9c4a5b60ff0` |
| Provisional Catalog `0.1.0` inspection build, Extensions 0.5.0 pin | `ca567c4d97268c4fd60cec073cec3efc0d396c0fdbfdaca7f63c07c10fe26e6b` |
| Final-source Catalog `0.1.0` inspection build, Extensions 0.6.0 pin | `688d6b86348810d95b2dce12a28d9a47356180aca1b11d2e1544e8bcff509e2f` |

These are unpublished local builds identified by artifact digest, not immutable
registry versions. The final-source Guide release SHA-256 is
`a9b731b648d32efbc0169c05171a1cc2dd44ce310cfe82b85e1a02ad8b596adc`.
The two Catalog artifacts were retained unchanged for the update check.

## Disposable public consumer

On Linux x64 with Node 24.15.0, `tools/verify-guide-consumer.mjs` installed the
exact local tarballs with lifecycle scripts disabled and exercised public Catalog
reader/configuration/selection and public Core Prepare/Apply. It passed:

- pinned review and no file effects before approval;
- canonical manual and reference profile installation without native registration;
- owned content update from the exact 0.5.0-pinned artifact to the exact
  0.6.0-pinned artifact, preserving unrelated files;
- owned removal preserving neighboring files and existing project choices;
- unowned whole-file conflict and edited-owned removal conflict, preserving user bytes.

The manual changed from
`92f64acddd590c6aa9b882fe3dcf358d64110e92e58146e67d375cf1b533353e`
to `77b5c9d21968cf194ca2a86cb4cd2b94cf421081780c59d7fa5289de6a364462`.
Core's completed applications passed every declared check. A separate synthetic
update fixture also passed; the actual source-update evidence above uses unchanged
committed canonical material in both packages.

The packed reader test first failed because the explicit Guide release was not
accepted by the installed Node reader, then passed after the export, release and
material closure were integrated. Focused producer checks cover preserving the
Guide while refreshing unrelated content. Deterministic generation and
whole-package integrity checks include the Guide closure.

No native Guide conversation, credentials, global installation, publication,
Nuclei assessment or real target execution was performed. Upstream native
conversation evidence and its exact-byte limitations remain as recorded in the
shipped canonical `guide-evidence.md`; this package check adds no native coverage.
