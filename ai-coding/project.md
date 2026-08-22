# aih-supported repository truth

This repository is the release-ready public Catalog V2 producer and verifier.
Its versioned API and CLI create deterministic candidates from exact
Core-compatible sources and seed-relative evidence, sign canonical heads with an
administrator Ed25519 key, verify continuity and caller-supplied replay state,
inspect unknown versions without materializing them, plan promotion exceptions,
and derive the locked Core qualification basis. See
`ai-coding/supported-catalog-v2.md` before changing that boundary.

The supported channel is optional and not-authoritative for organization
admission. Core does not consume Catalog V2 directly. Organization-qualified
subjects remain a separate Core Strict V2 path, and evidence attestors remain
distinct from catalog signers.

Candidate generation has no provider network, installation, signing,
repository-write, or publication authority. Signing executes no candidate code.
The manual protected workflow can add outer GitHub provenance only after exact
artifact and promotion-plan approval, and publication is separately authorized.
V1 has been removed. Never run an installed aih-supported against this checkout;
use packed disposable consumers or direct repository checks.
