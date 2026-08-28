# Catalog V2 genesis

`signed-catalog-v2.json` is the canonical, Ed25519-signed sequence-0 Catalog V2
head for `samartomar/aih-catalog` `main`. Its inner claims bind the active
`signed-catalog-v2.yml` workflow, `catalog-signing` environment, repository
identity, and `workflow_dispatch` event. It is valid from
`2026-08-28T09:27:42Z` through `2026-09-27T09:27:42Z`.

`catalog-signer-root.json` contains the corresponding public-only SPKI root
(`sha256:a286e8c5ce5c20b4393ea8eafe7f149ac65685c2d3ce8ca49fdc295ecbfdad6a`).
Consumers must obtain and trust that root independently; its presence here does
not itself grant authority, replace the protected promotion approval, or replace
the separate outer GitHub provenance required before Core custody.

The genesis signed-catalog SHA-256 is
`6a561e5b4e38292578ce73ffba17dd17fec9ee99048205aacddcd75261efa2f2`.
The later time-bound Qualification Receipt and its outer attestation are not
committed: they must be regenerated at the separately authorized exact-SHA
workflow dispatch.
