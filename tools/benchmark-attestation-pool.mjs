import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  loadAttestationSubjects,
  verifyAttestationSubjects,
} from "../.github/verify-attestation-retry.mjs";

function usage() {
  throw new Error(
    "Usage: benchmark-attestation-pool.mjs <artifact-root> <1-8> <receipt-count|all> <output-json> -- <gh verify arguments>",
  );
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function fingerprint(root, subjects) {
  const rows = subjects.map((subject) => {
    const digest = sha256(readFileSync(resolve(root, ...subject.split("/"))));
    return `${subject}\0${digest}`;
  });
  return sha256(rows.join("\n"));
}

function representativeReceipts(receipts, requested) {
  if (requested === "all") return receipts;
  if (!/^[1-9][0-9]*$/u.test(requested)) usage();
  const count = Number(requested);
  if (!Number.isSafeInteger(count) || count > receipts.length) usage();
  if (count === 1) return [receipts[0]];
  return Array.from(
    { length: count },
    (_, index) => receipts[Math.round((index * (receipts.length - 1)) / (count - 1))],
  );
}

const args = process.argv.slice(2);
const separator = args.indexOf("--");
if (separator !== 4 || args.length === 5) usage();
const [artifactRootArgument, concurrencyArgument, receiptCount, outputArgument] = args;
if (!/^[1-8]$/u.test(concurrencyArgument)) usage();
const artifactRoot = resolve(artifactRootArgument);
const output = resolve(outputArgument);
const concurrency = Number(concurrencyArgument);
const verifyArgs = args.slice(separator + 1);
const allSubjects = loadAttestationSubjects({
  receiptSetPath: "qualification-receipt-set.json",
  root: artifactRoot,
  signedCatalogPath: "signed-catalog-v2.json",
});
const selectedSubjects = [
  ...allSubjects.slice(0, 2),
  ...representativeReceipts(allSubjects.slice(2), receiptCount),
];
const artifactSetSha256 = fingerprint(artifactRoot, allSubjects);
const selectedSubjectSetSha256 = fingerprint(artifactRoot, selectedSubjects);
const startedAt = new Date().toISOString();
const monotonicStart = performance.now();
process.chdir(artifactRoot);
const result = await verifyAttestationSubjects(selectedSubjects, verifyArgs, { concurrency });
const durationMs = Math.round(performance.now() - monotonicStart);
const artifactSetUnchanged = artifactSetSha256 === fingerprint(artifactRoot, allSubjects);
const report = {
  artifactSetSha256,
  artifactSetUnchanged,
  completedAt: new Date().toISOString(),
  concurrency,
  durationMs,
  format: "aih-catalog-attestation-pool-benchmark/v1",
  resultStatus: artifactSetUnchanged ? result.status : 2,
  selectedSubjectSetSha256,
  selectedSubjects: result.results.map(({ attempts, result: subjectResult, subject }) => ({
    attempts: attempts.length,
    status: subjectResult.status,
    subject,
  })),
  startedAt,
  totalAvailableSubjects: allSubjects.length,
  verifierArguments: verifyArgs,
};
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, { flag: "wx" });
process.stdout.write(`benchmark result: ${output}\n`);
process.stdout.write(`benchmark duration: ${durationMs} ms for ${selectedSubjects.length} subjects\n`);
process.exitCode = report.resultStatus;
