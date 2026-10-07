# Greenfield Catalog integration

This candidate uses `q1/rel-license` at
`a1059df9c1543fd8326424053280b4b94e93397e` as the greenfield starting point
for one integration into `main`. It supersedes the old
[0.3.0 release proposal #42](https://github.com/samartomar/aih-catalog/pull/42).
The historical signed-head/qualification/Core-lock proposal is not the acceptance
contract for the new package.

## Review scope

| Surface | Integration behavior |
| --- | --- |
| Public package | Independent portable contracts/reader and Node acquisition/configuration adapter, canonical releases and generic executable recipes |
| Materials | Exact hashes, lengths, closure, source provenance, license custody and packed-byte checks |
| Content refresh | Explicit immutable upstream pin through the targeted Scan-free producer; preserve unaffected records, members and provenance |
| Shared context | Selectable context, native entry pointers and caller-selected instruction directory |
| Client hooks | Explicit release 1.1 and generic owned hook groups; existing release 1.0 semantics retained |
| Catalog #45 | Matt Pocock v1.3 curation and produced greenfield content at its exact accepted upstream pin |
| Catalog #53 | [Preparation lane](NATIVE-PREPARATION.md) proceeds; per-cell native acceptance remains independent and open |

Retained V1/V2 source, defaults and assessment fixtures are historical donor
material, excluded from the public package. Their old Scan-governed regeneration
does not refresh the greenfield release. Follow
[the transition](TRANSITION.md) for retained/adapted/retired checks and
[the producer guide](PRODUCER.md) for ordinary maintenance.

## Validation and publication

Use Node 24.15–24.x, `npm ci --ignore-scripts` and `npm run verify`. Verify the
exact packed public entries in disposable consumers, including recipe selection
and the bounded handoff with an explicitly supplied reviewed Core tarball.
The CI job checks hook selector continuity against the prior committed release
inside the same verification pass. It performs one compile and one active suite;
qualification receipts and signing are not gates.

The local package identity is `@aihq/catalog@0.1.0`; it is unpublished greenfield
candidate metadata. Existing registry history is unchanged. Package `private: true`,
the unconditional `prepublishOnly` refusal and retired publication workflows
remain in force. This integration allocates no new registry release, tag or signing
operation. Package publication requires its own later authorization under
[RELEASING.md](../RELEASING.md).

The replacement PR targets `main` and carries the complete candidate plus its
review evidence. Preparing or reviewing it does not merge it, complete Catalog
#53's native matrix or authorize publication.
