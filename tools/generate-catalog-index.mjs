import { createHash } from "node:crypto";
import { lstatSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const MANIFEST = "defaults/default-catalog-seed-manifest-v2.json";
const OUTPUT = "defaults/catalog-index-v1.json";
const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const fail = (message) => { throw new Error(`catalog-index: ${message}`); };
const text = (value, label) => {
  if (typeof value !== "string" || value.length === 0) fail(label);
  return value;
};
const object = (value, label) => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail(label);
  return value;
};
const list = (value, label, max = 64) => {
  if (!Array.isArray(value) || value.length > max) fail(label);
  return value;
};
const canonical = (value) => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value).sort(compare)
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
};
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const digest = (domain, value) => `sha256:${sha256(`${domain}\0${canonical(value)}`)}`;

/** Build a data-only index from a Catalog package directory; never execute candidate code. */
export function generateCatalogIndex(packageRoot) {
  const root = resolve(packageRoot);
  const read = (base, input) => {
    const path = text(input, "unsafe path");
    if (!/^[A-Za-z0-9._/-]+$/.test(path) ||
        path.split("/").some((segment) => !segment || segment === "." || segment === "..")) {
      fail(`unsafe path: ${path}`);
    }
    const target = resolve(base, path);
    const packagePath = relative(root, target).replaceAll("\\", "/");
    if (packagePath.startsWith("../")) fail("unsafe path");
    let cursor = root;
    for (const segment of packagePath.split("/")) {
      cursor = resolve(cursor, segment);
      if (lstatSync(cursor).isSymbolicLink()) fail(`linked path: ${packagePath}`);
    }
    const stat = lstatSync(target);
    if (!stat.isFile() || stat.size > 1024 * 1024) fail(`invalid file: ${packagePath}`);
    const bytes = readFileSync(target);
    if (bytes.length > 1024 * 1024) fail(`file too large: ${packagePath}`);
    return { path: packagePath, sha256: sha256(bytes), bytes };
  };
  const json = (file) => object(JSON.parse(file.bytes.toString("utf8")), file.path);
  const descriptor = ({ path, sha256: hash }) => ({ path, sha256: hash });
  const packageJson = json(read(root, "package.json"));
  if (packageJson.name !== "@aihq/catalog") fail("expected @aihq/catalog package");
  text(packageJson.version, "package version");
  const manifest = json(read(root, MANIFEST));
  if (manifest.format !== "aih-supported-candidate-seed-manifest" || manifest.version !== 1) {
    fail("unsupported manifest version");
  }
  const identities = new Set();
  const entries = list(manifest.seeds, "manifest seeds", 4096).map((seedPath) => {
    const file = read(resolve(root, "defaults"), seedPath);
    const seed = json(file);
    const entryId = text(seed.entryId, "entryId");
    if (identities.has(entryId)) fail(`duplicate entryId: ${entryId}`);
    identities.add(entryId);
    const base = dirname(resolve(root, file.path));
    const declaredSubject = object(seed.subject, "subject");
    text(declaredSubject.id, "subject id");
    if (!["tool", "skill", "agent", "mcp", "package", "profile"].includes(declaredSubject.kind)) {
      fail("subject kind");
    }
    const source = object(declaredSubject.source, "subject source");
    text(source.type, "source type");
    const sourceDigest = digest("aih-governance-decision-source/v2", source);
    const subjectDigest = digest("aih-governance-decision-subject/v2", {
      id: declaredSubject.id, kind: declaredSubject.kind, sourceDigest,
    });
    const subject = { ...declaredSubject, sourceDigest, subjectDigest };
    const artifacts = Object.fromEntries(["closure", "profile", "prose", "recipe"].map((name) => [
      name, descriptor(read(base, object(seed.artifacts, "artifacts")[name])),
    ]));
    if (source.type === "aih" && source.revision !== `sha256:${artifacts.profile.sha256}`) {
      fail("aih source revision");
    }
    const qualification = object(seed.qualification, "qualification");
    const evidence = (path, kind) => {
      const evidenceFile = read(base, path);
      const value = json(evidenceFile);
      if (value.format !== "aih-supported-evidence/v2") fail("evidence format");
      if (value.kind !== kind) fail("evidence kind");
      if (value.subjectDigest !== subjectDigest) fail("evidence subject");
      for (const name of ["id", "attestor", "summary"]) text(value[name], `evidence ${name}`);
      return { ...descriptor(evidenceFile), evidence: value };
    };
    const evidenceList = (name, kind) => list(qualification[name], name)
      .map((path) => evidence(path, kind)).sort((a, b) => compare(a.path, b.path));
    return {
      entryId,
      seed: descriptor(file),
      subject,
      capabilities: object(seed.capabilities, "capabilities"),
      platforms: list(seed.platforms, "platforms"),
      artifacts,
      qualification: {
        report: evidence(qualification.report, "report"),
        findings: evidenceList("findings", "finding"),
        gaps: evidenceList("gaps", "gap"),
        rights: evidenceList("rights", "right"),
      },
    };
  }).sort((a, b) => compare(a.entryId, b.entryId));
  return {
    format: "aih-catalog-index",
    version: 1,
    package: { name: packageJson.name, version: packageJson.version },
    organizationAdmission: "not-authoritative",
    entries,
  };
}

/** Stable UTF-8 JSON representation; file hashes above address the original bytes. */
export function serializeCatalogIndex(index) {
  return `${canonical(index)}\n`;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    const check = args[0] === "--check";
    if (check) args.shift();
    if (args.length > 1 || args[0]?.startsWith("-")) {
      fail("usage: node tools/generate-catalog-index.mjs [--check] [catalog-root]");
    }
    const root = resolve(args[0] ?? resolve(dirname(fileURLToPath(import.meta.url)), ".."));
    const index = generateCatalogIndex(root);
    const bytes = serializeCatalogIndex(index);
    const output = resolve(root, OUTPUT);
    if (check) {
      if (readFileSync(output, "utf8") !== bytes) fail("index is stale; run npm run generate:catalog-index");
    } else {
      // All inputs have been checked before replacing the generated output.
      const temporary = `${output}.tmp`;
      writeFileSync(temporary, bytes, { flag: "wx" });
      try {
        renameSync(temporary, output);
      } finally {
        rmSync(temporary, { force: true });
      }
    }
    console.log(`${check ? "Checked" : "Generated"} ${index.entries.length} catalog entries: ${OUTPUT}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
