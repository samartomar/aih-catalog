# Packaged-evidence parity fixtures

Shared acceptance fixtures for `packaged-scanner-collection-evidence/v1` records (decision D25).
The same JSON files, byte-identical, live in `@aihq/core` at
`tests/fixtures/packaged-evidence-parity/`; change both copies together.

Each file names one case and its two expected outcomes:

- `structure`: the record's structural validation, which Catalog
  (`parsePackagedScannerCollectionEvidenceV1`) and Core
  (`PackagedScannerCollectionEvidenceStructureV1Schema`) apply identically.
- `coreAdmission`: Core's publisher admission on top of that (the reviewed publisher identity and
  commits). Admission is Core's alone; Catalog is a carrier and never admits a record, so this
  repository only checks that a record refused by admission is still structurally valid here.

Catalog test: `tests/supported/packaged-evidence-parity.test.ts`.
