import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const fixturePath = resolve(here, "..", "core-qualification-basis-v2.json");
const schemaPath = resolve(here, "aih-governance-decision-v2.schema.json");
const receiptSchemaPath = resolve(here, "aih-supported-qualification-receipt-v2.schema.json");
const generatorPath = resolve(here, "generate-core-v2-vectors.mjs");
const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const canonicalJson = (value) => {
  if (value === null || typeof value === "boolean" || typeof value === "number") return JSON.stringify(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
};
const source = fixture.vectors.source;
const subject = fixture.vectors.subject;
const expectedSourceCanonical = `aih-governance-decision-source/v2\0${canonicalJson(source.value)}`;
const expectedSourceDigest = `sha256:${sha256(expectedSourceCanonical)}`;
const expectedSubjectCanonical = `aih-governance-decision-subject/v2\0${canonicalJson(subject.value)}`;
const expectedSubjectDigest = `sha256:${sha256(expectedSubjectCanonical)}`;
const generated = spawnSync(process.execPath, [generatorPath], { encoding: "utf8" });
const generatedVectors = generated.status === 0 ? JSON.parse(generated.stdout) : undefined;
if (fixture.provenance.generator !== "tests/contracts/core/generate-core-v2-vectors.mjs" ||
  fixture.provenance.source !== `samartomar/ai-harness@${fixture.core.commit}` ||
  fixture.core.commit !== "aa93128ff56b3ed978ec428e29d1b1ce8036e53b" ||
  fixture.core.packageManifestSha256 !== "af64feda4e3e57808e1a262e15a5cb8f41581f77e8f9b49eb9b459317b803ecd" ||
  fixture.core.packageName !== "@aihq/core" || fixture.core.packageVersion !== "0.1.0" ||
  fixture.core.repository !== "samartomar/ai-harness" ||
  fixture.core.receiptMaxBytes !== 5970 || fixture.core.receiptSourceMaxBytes !== 4096 ||
  generatedVectors?.source?.digest !== source.digest || generatedVectors?.subject?.digest !== subject.digest ||
  source.canonical !== expectedSourceCanonical || source.digest !== expectedSourceDigest ||
  subject.canonical !== expectedSubjectCanonical || subject.digest !== expectedSubjectDigest ||
  subject.value.sourceDigest !== source.digest ||
  sha256(readFileSync(schemaPath)) !== fixture.core.schemaSha256 ||
  sha256(readFileSync(receiptSchemaPath)) !== fixture.core.receiptSchemaSha256) {
  throw new Error("exact Core V2 vector or schema lock drift");
}
process.stdout.write("Core V2 vectors and schema locks PASS\n");
