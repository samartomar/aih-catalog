import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// These values deliberately pin the exact merged Core producer/consumer contract.
const sourceDomain = "aih-governance-decision-source/v2\0";
const subjectDomain = "aih-governance-decision-subject/v2\0";
const coreRepository = "samartomar/ai-harness";
const coreCommit = "e53fe219002515c092ebb68c5b91c91a2fc6110d";
const schemaPath = "schemas/aih-governance-decision-v2.schema.json";
const schemaSha256 = "27295aee8d8be333abe2c73adc72884b534b1c9980a9b7a39d12be8d34c5caff";
const receiptSchemaPath = "schemas/aih-supported-qualification-receipt-v2.schema.json";
const receiptSchemaSha256 = "40a2522dfd05b370c537dc5d9b05ddc3fe2a1d6e1b6448fa50b97d53d2d2477f";
const receiptMaxBytes = 5970;
const receiptSourceMaxBytes = 4096;
const vendoredSchemaPath = "tests/contracts/core/aih-governance-decision-v2.schema.json";
const vendoredReceiptSchemaPath =
  "tests/contracts/core/aih-supported-qualification-receipt-v2.schema.json";
const fixturePath = "tests/contracts/core-qualification-basis-v2.json";
const qualificationBasisKeys = [
  "catalogDigest",
  "catalogHeadDigest",
  "catalogMemberDigest",
  "catalogSignerIdentity",
  "kind",
  "subjectDigest",
  "subjectKind",
];
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const fixture = JSON.parse(readFileSync(resolve(fixturePath), "utf8"));

if (
  fixture.core?.commit !== coreCommit ||
  fixture.core?.repository !== coreRepository ||
  fixture.core?.schemaPath !== schemaPath ||
  fixture.core?.schemaSha256 !== schemaSha256 ||
  fixture.core?.receiptSchemaPath !== receiptSchemaPath ||
  fixture.core?.receiptSchemaSha256 !== receiptSchemaSha256 ||
  fixture.core?.receiptMaxBytes !== receiptMaxBytes ||
  fixture.core?.receiptSourceMaxBytes !== receiptSourceMaxBytes ||
  fixture.vectors?.source?.canonical?.startsWith(sourceDomain) !== true ||
  fixture.vectors?.subject?.canonical?.startsWith(subjectDomain) !== true ||
  fixture.qualificationBasisKeys?.join(",") !== qualificationBasisKeys.join(",") ||
  sha256(readFileSync(resolve(vendoredSchemaPath))) !== schemaSha256 ||
  sha256(readFileSync(resolve(vendoredReceiptSchemaPath))) !== receiptSchemaSha256
)
  process.exit(1);

await import("../tests/contracts/core/verify-core-v2-vectors.mjs");

const args = process.argv.slice(2);
if (args.length) {
  if (
    args.length !== 6 ||
    args[0] !== "--schema" ||
    args[2] !== "--qualification-basis" ||
    args[4] !== "--receipt-schema"
  )
    process.exit(2);
  if (sha256(readFileSync(args[1])) !== schemaSha256) process.exit(3);
  const basis = JSON.parse(readFileSync(args[3], "utf8"));
  if (
    Object.keys(basis).sort().join(",") !== [...qualificationBasisKeys].sort().join(",") ||
    basis.kind !== "aih-supported" ||
    ![
      basis.catalogDigest,
      basis.catalogHeadDigest,
      basis.catalogMemberDigest,
      basis.subjectDigest,
    ].every((value) => /^sha256:[0-9a-f]{64}$/.test(value))
  )
    process.exit(4);
  if (sha256(readFileSync(args[5])) !== receiptSchemaSha256) process.exit(5);
}
