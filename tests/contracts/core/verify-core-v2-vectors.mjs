import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const fixturePath = resolve(here, "..", "core-qualification-basis-v2.json");
const schemaPath = resolve(here, "aih-governance-decision-v2.schema.json");
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
if (source.canonical !== expectedSourceCanonical || source.digest !== expectedSourceDigest ||
  subject.canonical !== expectedSubjectCanonical || subject.digest !== expectedSubjectDigest ||
  subject.value.sourceDigest !== source.digest ||
  sha256(readFileSync(schemaPath)) !== fixture.core.schemaSha256) {
  throw new Error("exact Core V2 vector or schema lock drift");
}
process.stdout.write("Core V2 vectors and schema lock PASS\n");
