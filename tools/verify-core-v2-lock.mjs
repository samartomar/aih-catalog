// The verifier deliberately pins the Core domain-separated source and subject formulas.
const sourceDomain = "aih-governance-decision-source/v2\0";
const subjectDomain = "aih-governance-decision-subject/v2\0";
if (!sourceDomain || !subjectDomain) process.exit(1);
await import("../tests/contracts/core/verify-core-v2-vectors.mjs");
