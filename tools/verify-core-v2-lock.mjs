// The verifier deliberately pins the Core domain-separated source and subject formulas.
const sourceDomain = "aih-governance-decision-source/v2\0";
const subjectDomain = "aih-governance-decision-subject/v2\0";
const coreRepository = "samartomar/ai-harness";
const coreCommit = "e27a55dcebb635c8298aa4fd6fd871f59089bcf7";
const schemaPath = "schemas/aih-governance-decision-v2.schema.json";
const schemaSha256 = "27295aee8d8be333abe2c73adc72884b534b1c9980a9b7a39d12be8d34c5caff";
const vendoredSchemaPath = "tests/contracts/core/aih-governance-decision-v2.schema.json";
// Keep the receipt lock independent from the established Core V2 decision lock:
// the Core merge SHA is the only value expected to change after Core promotion.
const qualificationReceiptCoreCommit = "03c07b37c64d7d00473e5171ce8c6a7e5159a034";
const qualificationReceiptSchemaPath = "schemas/aih-supported-qualification-receipt-v1.schema.json";
const qualificationReceiptSchemaSha256 = "b3291e568177829cad4e369c78075c58b0835ccbda90f15def4c840168a4eda8";
const vendoredQualificationReceiptSchemaPath =
  "tests/contracts/core/aih-supported-qualification-receipt-v1.schema.json";
if (!sourceDomain || !subjectDomain || !coreRepository || !coreCommit || !schemaPath || !schemaSha256 || !vendoredSchemaPath || !qualificationReceiptCoreCommit || !qualificationReceiptSchemaPath || !qualificationReceiptSchemaSha256 || !vendoredQualificationReceiptSchemaPath) process.exit(1);
await import("../tests/contracts/core/verify-core-v2-vectors.mjs");
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
if (createHash("sha256").update(readFileSync(vendoredQualificationReceiptSchemaPath)).digest("hex") !== qualificationReceiptSchemaSha256) process.exit(5);
const args = process.argv.slice(2);
if (args.length) {
  if (args.length !== 4 || args[0] !== "--schema" || args[2] !== "--qualification-basis") process.exit(2);
  const schema = readFileSync(args[1]);
  if (createHash("sha256").update(schema).digest("hex") !== schemaSha256) process.exit(3);
  const basis = JSON.parse(readFileSync(args[3], "utf8"));
  const expected = ["catalogDigest", "catalogHeadDigest", "catalogMemberDigest", "catalogSignerIdentity", "kind", "subjectDigest", "subjectKind"];
  if (Object.keys(basis).sort().join(",") !== expected.sort().join(",") || basis.kind !== "aih-supported" || ![basis.catalogDigest,basis.catalogHeadDigest,basis.catalogMemberDigest,basis.subjectDigest].every(value => /^sha256:[0-9a-f]{64}$/.test(value))) process.exit(4);
}
