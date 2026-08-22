import { createHash } from "node:crypto";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const canonicalJson = (value) => {
  if (value === null || typeof value === "boolean" || typeof value === "number") return JSON.stringify(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
    .join(",")}}`;
};
const digest = (domain, value) => {
  const canonical = `${domain}\0${canonicalJson(value)}`;
  return { canonical, digest: `sha256:${sha256(canonical)}`, value };
};

const source = digest("aih-governance-decision-source/v2", {
  release: "1.0.0",
  revision: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  type: "aih",
});
const subject = digest("aih-governance-decision-subject/v2", {
  id: "default-profile",
  kind: "profile",
  sourceDigest: source.digest,
});

process.stdout.write(`${canonicalJson({ source, subject })}\n`);
