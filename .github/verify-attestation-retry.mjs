import { execFile } from "node:child_process";
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, posix, relative, resolve, sep } from "node:path";
import { setTimeout } from "node:timers/promises";
import { pathToFileURL } from "node:url";

const delays = Object.freeze([2000, 5000, 10000, 20000, 30000, 30000, 30000]);
const maximumConcurrency = 8;
const maximumReceipts = 512;
const receiptPathPattern = /^receipts\/[A-Za-z0-9][A-Za-z0-9._-]*\.json$/u;
const temporaryCachePrefix = "aih-catalog-attestation-cache-";

const nativeVerify = (args, cacheHome) =>
  new Promise((complete) => {
    execFile(
      "gh",
      ["attestation", "verify", ...args],
      {
        encoding: "utf8",
        ...(cacheHome ? { env: { ...process.env, XDG_CACHE_HOME: cacheHome } } : {}),
        maxBuffer: 16 * 1024 * 1024,
        timeout: 120000,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        const status = error && Number.isSafeInteger(error.code) ? error.code : error ? null : 0;
        complete({
          ...(status === null ? { error } : {}),
          status,
          stderr: stderr ?? "",
          stdout: stdout ?? "",
        });
      },
    );
  });

/** Give each worker a fresh gh cache so concurrent trust initialization cannot share mutable state. */
export function createIsolatedNativeVerifierPool(
  laneCount,
  { execute = nativeVerify, tempRoot = tmpdir() } = {},
) {
  if (!Number.isSafeInteger(laneCount) || laneCount < 1 || laneCount > maximumConcurrency)
    throw new Error(`attestation lane count must be between 1 and ${maximumConcurrency}`);
  const resolvedTempRoot = realpathSync(tempRoot);
  const cacheRoot = mkdtempSync(join(resolvedTempRoot, temporaryCachePrefix));
  try {
    chmodSync(cacheRoot, 0o700);
    const cacheHomes = Array.from({ length: laneCount }, (_, lane) => {
      const cacheHome = join(cacheRoot, `worker-${lane}`);
      mkdirSync(cacheHome, { mode: 0o700 });
      return cacheHome;
    });
    let activeChildren = 0;
    let closed = false;
    return Object.freeze({
      close: () => {
        if (closed) return;
        if (activeChildren !== 0)
          throw new Error("cannot remove attestation caches while verifier children are active");
        const resolvedCacheRoot = resolve(cacheRoot);
        if (
          dirname(resolvedCacheRoot) !== resolvedTempRoot ||
          !basename(resolvedCacheRoot).startsWith(temporaryCachePrefix)
        )
          throw new Error("refusing to remove an unexpected attestation cache path");
        rmSync(resolvedCacheRoot, { force: true, recursive: true });
        closed = true;
      },
      run: async (args, lane) => {
        if (closed) throw new Error("attestation verifier pool is closed");
        if (!Number.isSafeInteger(lane) || lane < 0 || lane >= cacheHomes.length)
          throw new Error("attestation verifier lane is out of range");
        activeChildren++;
        try {
          return await execute(args, cacheHomes[lane]);
        } finally {
          activeChildren--;
        }
      },
    });
  } catch (error) {
    rmSync(cacheRoot, { force: true, recursive: true });
    throw error;
  }
}

const reportNative = (result) => {
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) process.stderr.write(`${result.error.message}\n`);
};

const reportSubjectNative = ({ attempts, result, subject }) => {
  process.stdout.write(`attestation subject: ${subject}\n`);
  for (const [index, attempt] of attempts.entries()) {
    if (attempts.length > 1)
      process.stdout.write(`attempt ${index + 1}/${attempts.length}: ${subject}\n`);
    reportNative(attempt);
  }
  process.stdout.write(
    `attestation result: ${result.status === 0 ? "verified" : "failed"}: ${subject}\n`,
  );
};

function safeRelativePath(requested, label) {
  if (typeof requested !== "string" || requested.length === 0 || isAbsolute(requested))
    throw new Error(`${label} must be a safe relative path`);
  const parts = requested.split("/");
  if (
    parts.some(
      (part) =>
        part.length === 0 ||
        part === "." ||
        part === ".." ||
        !/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(part),
    )
  )
    throw new Error(`${label} must be a safe relative path`);
  return requested;
}

/** Return true only when a resolved subject is a strict descendant of its resolved root. */
export function isPathWithinRoot(root, subject, pathTools) {
  const withinRoot = pathTools ? pathTools.relative(root, subject) : relative(root, subject);
  const absolute = pathTools ? pathTools.isAbsolute(withinRoot) : isAbsolute(withinRoot);
  const pathSeparator = pathTools?.sep ?? sep;
  return (
    withinRoot !== "" &&
    !absolute &&
    withinRoot !== ".." &&
    !withinRoot.startsWith(`..${pathSeparator}`)
  );
}

function regularFile(root, requested) {
  const absolute = resolve(root, ...requested.split("/"));
  let stat;
  try {
    stat = lstatSync(absolute);
  } catch {
    throw new Error(`attestation subject is missing: ${requested}`);
  }
  if (!stat.isFile() || stat.isSymbolicLink())
    throw new Error(`attestation subject must be a regular file: ${requested}`);
  const realRoot = realpathSync(root);
  const realSubject = realpathSync(absolute);
  if (!isPathWithinRoot(realRoot, realSubject))
    throw new Error(`attestation subject escapes the artifact root: ${requested}`);
  return absolute;
}

/** Load and validate the complete immutable subject list before any native verification. */
export function loadAttestationSubjects({ root = process.cwd(), signedCatalogPath, receiptSetPath }) {
  const signedCatalog = safeRelativePath(signedCatalogPath, "signed catalog path");
  const receiptSet = safeRelativePath(receiptSetPath, "receipt-set path");
  regularFile(root, signedCatalog);
  const receiptSetFile = regularFile(root, receiptSet);

  let manifest;
  try {
    manifest = JSON.parse(readFileSync(receiptSetFile, "utf8"));
  } catch {
    throw new Error("receipt-set manifest must be valid JSON");
  }
  if (
    manifest === null ||
    typeof manifest !== "object" ||
    manifest.format !== "aih-supported-qualification-receipt-set" ||
    manifest.version !== 1 ||
    !Array.isArray(manifest.entries) ||
    manifest.entries.length < 1 ||
    manifest.entries.length > maximumReceipts
  )
    throw new Error("receipt-set manifest is not a bounded V1 receipt set");

  const receiptPaths = manifest.entries.map((entry) => {
    if (entry === null || typeof entry !== "object" || !receiptPathPattern.test(entry.path))
      throw new Error("receipt-set manifest contains an unsafe subject path");
    return entry.path;
  });
  if (new Set(receiptPaths).size !== receiptPaths.length)
    throw new Error("receipt-set manifest contains duplicate subject paths");

  const receiptSetDirectory = posix.dirname(receiptSet);
  const subjects = [
    signedCatalog,
    receiptSet,
    ...receiptPaths.map((path) =>
      receiptSetDirectory === "." ? path : posix.join(receiptSetDirectory, path),
    ),
  ];
  if (new Set(subjects).size !== subjects.length)
    throw new Error("attestation subject list contains duplicate paths");
  for (const subject of subjects) regularFile(root, safeRelativePath(subject, "attestation subject"));
  return Object.freeze(subjects);
}

/** Retry transport failures only. Every successful result still comes from gh. */
export async function verifyWithTransientRetries(
  args,
  { run = nativeVerify, wait = setTimeout, report = reportNative } = {},
) {
  const unchangedArgs = Object.freeze([...args]);
  for (let attempt = 0; ; attempt++) {
    let result;
    try {
      result = await run(unchangedArgs);
    } catch (error) {
      result = {
        error: error instanceof Error ? error : new Error(String(error)),
        status: null,
        stderr: "",
        stdout: "",
      };
    }
    report(result);
    if (result.status === 0) return result;
    if (
      result.error ||
      result.status === null ||
      attempt >= delays.length ||
      !/^Error: HTTP (?:429|502|503|504):/mu.test(result.stderr ?? "")
    )
      return result;
    await wait(delays[attempt]);
  }
}

/** Verify a prevalidated subject list with a fixed-size worker pool and ordered fan-in. */
export async function verifyAttestationSubjects(
  subjects,
  verifyArgs,
  {
    concurrency,
    run = nativeVerify,
    wait = setTimeout,
    reportSubject = reportSubjectNative,
  } = {},
) {
  if (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > maximumConcurrency)
    throw new Error(`attestation concurrency must be between 1 and ${maximumConcurrency}`);
  if (
    !Array.isArray(subjects) ||
    subjects.length < 1 ||
    subjects.some((subject) => typeof subject !== "string") ||
    new Set(subjects).size !== subjects.length
  )
    throw new Error("attestation subjects must be a non-empty unique list");
  if (!Array.isArray(verifyArgs) || verifyArgs.some((argument) => typeof argument !== "string"))
    throw new Error("attestation verifier arguments must be strings");

  const unchangedVerifyArgs = Object.freeze([...verifyArgs]);
  const results = new Array(subjects.length);
  const workerCount = Math.min(concurrency, Math.max(1, subjects.length - 1));
  const nativePool = run === nativeVerify ? createIsolatedNativeVerifierPool(workerCount) : null;
  const execute = nativePool?.run ?? run;
  const verifySubject = async (index, lane) => {
    const subject = subjects[index];
    const attempts = [];
    const result = await verifyWithTransientRetries([subject, ...unchangedVerifyArgs], {
      report: (attempt) => attempts.push(attempt),
      run: (args) => execute(args, lane),
      wait,
    });
    results[index] = Object.freeze({ attempts: Object.freeze(attempts), result, subject });
  };

  try {
    await verifySubject(0, 0);
    let nextIndex = 1;
    const worker = async (lane) => {
      while (nextIndex < subjects.length) {
        const index = nextIndex++;
        await verifySubject(index, lane);
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(concurrency, subjects.length - 1) }, (_, lane) => worker(lane)),
    );
    for (const row of results) reportSubject(row);
    const failure = results.find(({ result }) => result.status !== 0);
    return Object.freeze({
      results: Object.freeze(results),
      status: failure ? failure.result.status || 1 : 0,
    });
  } finally {
    nativePool?.close();
  }
}

/** Validate every expected subject, then verify it through the bounded worker pool. */
export async function verifyAttestationBatch(
  { concurrency, receiptSetPath, root = process.cwd(), signedCatalogPath, verifyArgs },
  dependencies = {},
) {
  if (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > maximumConcurrency)
    throw new Error(`attestation concurrency must be between 1 and ${maximumConcurrency}`);
  const subjects = loadAttestationSubjects({ receiptSetPath, root, signedCatalogPath });
  return verifyAttestationSubjects(subjects, verifyArgs, { concurrency, ...dependencies });
}

async function runCli(args) {
  if (args[0] !== "--batch") {
    const result = await verifyWithTransientRetries(args);
    return result.status === 0 ? 0 : result.status || 1;
  }
  const separator = args.indexOf("--");
  if (separator !== 4 || args.length === 5)
    throw new Error(
      "Usage: verify-attestation-retry.mjs --batch <1-8> <signed-catalog> <receipt-set> -- <gh verify arguments>",
    );
  const concurrency = Number(args[1]);
  const result = await verifyAttestationBatch({
    concurrency,
    receiptSetPath: args[3],
    signedCatalogPath: args[2],
    verifyArgs: args.slice(separator + 1),
  });
  return result.status;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    process.exitCode = await runCli(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  }
}
