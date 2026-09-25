import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { descriptorPath, INPUT } from "./generate-catalog-runtime-descriptors.mjs";

/**
 * Writes the ECC runtime descriptor Catalog distributes from the ECC packaged source record
 * the Catalog carries (runbook step 8.4, after the T3 records replace
 * src/production/data/packaged-source-data-v1.json):
 *
 *   node tools/emit-ecc-runtime-descriptor.mjs [catalog-root]
 *
 * The descriptor is the exact bytes Core sealed inside that record. The record must match its
 * own seal, the descriptor its Core seal (canonical JSON, the record's source revision), and
 * the descriptor must be evaluated under Core's ECC runtime declared evaluation contract v2.
 * The writer puts the bytes at their one path, replaces the ECC entry of the runtime
 * descriptor inputs with the Core seal and the record digest, and removes the descriptor file
 * that entry named when it lived elsewhere. `npm run generate:catalog-runtime-descriptors`
 * then runs as today. Nothing is fetched, re-signed or re-evaluated; any mismatch refuses
 * before anything is written.
 */
const RECORDS = "src/production/data/packaged-source-data-v1.json";
const DESCRIPTOR_ROOT = "defaults/runtime-descriptors";
const FORMAT = "ecc-runtime-descriptor/v1";
const REPOSITORY = "affaan-m/ECC";

/** Core 96453911 src/ecc/runtime-descriptor-evaluation.ts:5-13, copied exactly. */
export const ECC_RUNTIME_DECLARED_EVALUATION_CONTRACT_V2 = Object.freeze({
  version: "ecc-runtime-declared-evaluation/v2",
  projection: "source-data-contained-projection/v1",
  verdict: "has-findings-when-any-mapped-has-findings",
  analyzers: "exact-union",
  findings: "exact-union",
  evidenceProblems: "exact-union",
  tree: "declared-component-identity-paths",
});

const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const fail = (message) => {
  throw new Error(`ecc-runtime-descriptor: ${message}`);
};
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const canonical = (value) => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort(compare)
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
};
const object = (value, label) => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail(label);
  return value;
};
const parseCanonical = (text, label) => {
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    return fail(`${label} is not JSON`);
  }
  if (canonical(value) !== text) fail(`${label} is not canonical sorted-key JSON`);
  return object(value, label);
};

/** Core's projection contract digest: sha256 of the contract's canonical strict JSON bytes. */
export function eccRuntimeProjectionContractDigestV1() {
  return `sha256:${sha256(canonical(ECC_RUNTIME_DECLARED_EVALUATION_CONTRACT_V2))}`;
}

/** The sealed descriptor of the one ECC record among the Catalog's packaged source records. */
function sealedDescriptor(records) {
  if (!Array.isArray(records)) fail(`${RECORDS} is not a record list`);
  const ecc = records.flatMap((entry, position) => {
    const label = `${RECORDS}[${position}]`;
    const sealed = object(entry, label);
    if (typeof sealed.bytes !== "string" || !/^[0-9a-f]{64}$/.test(sealed.sha256 ?? ""))
      fail(`${label} is not a sealed record`);
    if (sha256(Buffer.from(sealed.bytes, "utf8")) !== sealed.sha256)
      fail(`${label} record bytes do not match its seal ${sealed.sha256}`);
    const record = parseCanonical(sealed.bytes, `${label} record`);
    return object(record.source, `${label} record source`).repository === REPOSITORY
      ? [{ record, recordSha256: sealed.sha256 }]
      : [];
  });
  if (ecc.length !== 1)
    fail(`the Catalog carries ${ecc.length} ECC packaged source records, not exactly one ECC packaged source record`);
  const [{ record, recordSha256 }] = ecc;
  if (record.version !== "packaged-workbench-source-data/v1")
    fail(`unsupported ECC record version ${JSON.stringify(record.version)}`);
  if (record.runtimeDescriptor === undefined)
    fail(`the ECC record ${recordSha256} carries no runtime descriptor`);
  const sealed = object(record.runtimeDescriptor, "runtime descriptor");
  if (canonical(Object.keys(sealed).sort(compare)) !== canonical(["bytesBase64", "sha256"]))
    fail("runtime descriptor: unknown or missing members");
  const bytes = Buffer.from(String(sealed.bytesBase64), "base64");
  if (bytes.length === 0 || bytes.toString("base64") !== sealed.bytesBase64)
    fail("runtime descriptor bytes are not canonical base64");
  if (!/^sha256:[0-9a-f]{64}$/.test(sealed.sha256 ?? "") || `sha256:${sha256(bytes)}` !== sealed.sha256)
    fail(`runtime descriptor bytes do not match the Core seal ${sealed.sha256}`);
  const text = bytes.toString("utf8");
  if (!Buffer.from(text, "utf8").equals(bytes)) fail("runtime descriptor is not UTF-8");
  const descriptor = parseCanonical(text, "runtime descriptor");
  if (descriptor.version !== FORMAT)
    fail(`unsupported runtime descriptor format ${JSON.stringify(descriptor.version)}`);
  const source = object(descriptor.source, "runtime descriptor source");
  const recordSource = object(record.source, "ECC record source");
  if (source.repository !== recordSource.repository || source.commit !== recordSource.commit)
    fail(
      `the runtime descriptor describes ${source.repository}@${source.commit}, its record ${recordSource.repository}@${recordSource.commit}`,
    );
  const digest = object(descriptor.evidence, "runtime descriptor evidence").projectionContractDigest;
  const expected = eccRuntimeProjectionContractDigestV1();
  if (digest !== expected)
    fail(
      `the runtime descriptor's projection contract ${digest} is not Core's ECC runtime declared evaluation contract v2 ${expected}`,
    );
  return {
    bytes,
    coreSeal: sealed.sha256,
    path: descriptorPath(source.repository, source.commit),
    projectionContractDigest: digest,
    recordSha256,
  };
}

/** Removes a replaced descriptor file and the directories it leaves empty, up to the root. */
function removeReplaced(root, path) {
  rmSync(resolve(root, ...path.split("/")), { force: true });
  for (
    let directory = dirname(path);
    directory.startsWith(`${DESCRIPTOR_ROOT}/`);
    directory = dirname(directory)
  ) {
    const absolute = resolve(root, ...directory.split("/"));
    if (!existsSync(absolute) || readdirSync(absolute).length > 0) break;
    rmdirSync(absolute);
  }
}

const writeReplacing = (path, bytes) => {
  const temporary = `${path}.tmp`;
  writeFileSync(temporary, bytes, { flag: "wx" });
  try {
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
};

export function emitEccRuntimeDescriptorV1(catalogRoot) {
  const root = resolve(catalogRoot);
  const descriptor = sealedDescriptor(JSON.parse(readFileSync(resolve(root, RECORDS), "utf8")));
  const inputsPath = resolve(root, INPUT);
  const inputs = object(JSON.parse(readFileSync(inputsPath, "utf8")), "inputs");
  if (inputs.format !== "aih-catalog-runtime-descriptors-inputs" || inputs.version !== 1)
    fail("unsupported runtime descriptor inputs version");
  if (!Array.isArray(inputs.descriptors)) fail("inputs descriptors");
  const previous = inputs.descriptors.filter((item) => item?.framework === "ecc");
  if (previous.length > 1) fail("the inputs name more than one ECC runtime descriptor");
  const entry = {
    coreSeal: descriptor.coreSeal,
    format: FORMAT,
    framework: "ecc",
    origin: { kind: "core-packaged-source-data", recordSha256: descriptor.recordSha256 },
    path: descriptor.path,
  };
  const descriptors =
    previous.length === 0
      ? [...inputs.descriptors, entry]
      : inputs.descriptors.map((item) => (item?.framework === "ecc" ? entry : item));
  const replaced = previous[0]?.path;
  if (
    replaced !== undefined &&
    (typeof replaced !== "string" ||
      !replaced.startsWith(`${DESCRIPTOR_ROOT}/`) ||
      replaced.split("/").some((segment) => ["", ".", ".."].includes(segment) || segment.includes("\\")))
  )
    fail("the previous ECC runtime descriptor path is unsafe");
  const target = resolve(root, ...descriptor.path.split("/"));
  mkdirSync(dirname(target), { recursive: true });
  writeReplacing(target, descriptor.bytes);
  writeReplacing(inputsPath, `${JSON.stringify({ ...inputs, descriptors }, null, 2)}\n`);
  const removed = replaced !== undefined && replaced !== descriptor.path ? replaced : undefined;
  if (removed !== undefined) removeReplaced(root, removed);
  return {
    coreSeal: descriptor.coreSeal,
    recordSha256: descriptor.recordSha256,
    path: descriptor.path,
    projectionContractDigest: descriptor.projectionContractDigest,
    ...(removed === undefined ? {} : { removed }),
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (args.length > 1 || args[0]?.startsWith("-"))
      fail("usage: node tools/emit-ecc-runtime-descriptor.mjs [catalog-root]");
    const root = resolve(args[0] ?? resolve(dirname(fileURLToPath(import.meta.url)), ".."));
    const result = emitEccRuntimeDescriptorV1(root);
    console.log(
      `Wrote ${result.path}: coreSeal ${result.coreSeal}, recordSha256 ${result.recordSha256}, projectionContractDigest ${result.projectionContractDigest}${result.removed === undefined ? "" : `; removed ${result.removed}`}`,
    );
    console.log("next: npm run generate:catalog-runtime-descriptors");
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
