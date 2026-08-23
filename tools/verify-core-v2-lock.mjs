// The verifier deliberately pins the Core domain-separated source and subject formulas.
const sourceDomain = "aih-governance-decision-source/v2\0";
const subjectDomain = "aih-governance-decision-subject/v2\0";
const coreRepository = "samartomar/ai-harness";
const coreCommit = "e27a55dcebb635c8298aa4fd6fd871f59089bcf7";
const schemaPath = "schemas/aih-governance-decision-v2.schema.json";
const schemaSha256 = "27295aee8d8be333abe2c73adc72884b534b1c9980a9b7a39d12be8d34c5caff";
const vendoredSchemaPath = "tests/contracts/core/aih-governance-decision-v2.schema.json";
if (!sourceDomain || !subjectDomain || !coreRepository || !coreCommit || !schemaPath || !schemaSha256 || !vendoredSchemaPath) process.exit(1);
await import("../tests/contracts/core/verify-core-v2-vectors.mjs");
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
const args = process.argv.slice(2);
if (args.length) {
  if (args.length !== 4 || args[0] !== "--schema" || args[2] !== "--qualification-basis") process.exit(2);
  const schema = readFileSync(args[1]);
  if (createHash("sha256").update(schema).digest("hex") !== schemaSha256) process.exit(3);
  const basis = JSON.parse(readFileSync(args[3], "utf8"));
  const expected = ["catalogDigest", "catalogHeadDigest", "catalogMemberDigest", "catalogSignerIdentity", "kind", "subjectDigest", "subjectKind"];
  if (Object.keys(basis).sort().join(",") !== expected.sort().join(",") || basis.kind !== "aih-supported" || ![basis.catalogDigest,basis.catalogHeadDigest,basis.catalogMemberDigest,basis.subjectDigest].every(value => /^sha256:[0-9a-f]{64}$/.test(value))) process.exit(4);
}
