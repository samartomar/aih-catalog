# aih-supported repository truth

This repository is the release-ready public Catalog V2 producer and verifier.
Its versioned API and CLI create deterministic candidates from exact
Core-compatible sources and seed-relative evidence, sign canonical heads with an
administrator Ed25519 key, verify continuity and caller-supplied replay state,
inspect unknown versions without materializing them, plan promotion exceptions,
and emit the closed Core-owned Strict Qualification Receipt V2 for one fully
verified member. The receipt preserves the verified entry, head, predecessor,
sequence, replay identity, signer key, and validity facts needed by Core's
separate durable custody. See
`ai-coding/supported-catalog-v2.md` before changing that boundary.

The supported channel is optional and not-authoritative for organization
admission. Core does not consume Catalog V2 directly; it independently verifies
the receipt's outer attestation and exact subject/basis fields. Organization-
qualified subjects remain a separate Core Strict V2 decision path carried by a
V3 authority receipt, and evidence attestors remain distinct from catalog
signers.

Candidate generation has no provider network, installation, signing,
repository-write, or publication authority. Signing executes no candidate code.
The manual protected workflow can add separate outer GitHub provenance for the
exact catalog and exact V2 receipt only after their hashes and the promotion plan
are approved, and publication is separately authorized.
Catalog V1 and Qualification Receipt V1 have been removed. Never run an
installed aih-supported against this checkout; use packed disposable consumers
or direct repository checks.
