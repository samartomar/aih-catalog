import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Stages one current collection member's original source files into
 * `defaults/sources/github.com/<owner>/<repo>/<revision>/`, at their original
 * relative paths, for `readCatalogSourceClosureV1` to ship.
 *
 * The member is resolved through the published collection view. Its profile
 * must hash to the digest the index declares; the profile alone names the files,
 * their digests and the public repository revision. Each file is retrieved from
 * that exact revision and written only when it hashes to its declared digest.
 * Nothing is reconstructed, renamed or taken from another revision or HEAD.
 *
 * This is a maintenance step with network access. Reading the package never
 * fetches anything.
 *
 *   node tools/stage-source-closure.mjs <collection-id> <subject-id>
 */
const INDEX = "defaults/catalog-index-v1.json";
const COLLECTIONS = "defaults/catalog-collections-v1.json";
const SOURCES = "defaults/sources";
const GIT_COMMIT = /^[0-9a-f]{40}$/;
const GITHUB_NAME = /^[A-Za-z0-9_.-]{1,100}$/;
const PATH_SEGMENT = /^[A-Za-z0-9_.@+-]+$/;
const PREFIXED_SHA256 = /^sha256:[0-9a-f]{64}$/;

const fail = (message) => {
  throw new Error(`stage-source-closure: ${message}`);
};
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const name = (value, label) => {
  if (typeof value !== "string" || !GITHUB_NAME.test(value) || value === "." || value === "..") {
    fail(`${label} is not a repository name`);
  }
  return value;
};
const sourcePath = (value) => {
  if (typeof value !== "string" || value.length === 0) fail("declared path is empty");
  for (const segment of value.split("/")) {
    if (segment === "." || segment === ".." || !PATH_SEGMENT.test(segment)) {
      fail(`declared path is unsafe: ${value}`);
    }
  }
  return value;
};

export async function stageSourceClosure(root, collectionId, subjectId, fetchBytes) {
  const index = JSON.parse(readFileSync(resolve(root, INDEX), "utf8"));
  const collectionsBytes = readFileSync(resolve(root, COLLECTIONS));
  const collections = JSON.parse(collectionsBytes.toString("utf8"));
  if (collections.index?.sha256 !== sha256(readFileSync(resolve(root, INDEX)))) {
    fail("collection view does not describe the committed index");
  }
  const collection = collections.collections.find((candidate) => candidate.id === collectionId);
  if (collection === undefined) fail(`unknown collection ${collectionId}`);
  const entries = collection.members
    .map((member) => index.entries.find((entry) => entry.entryId === member.entryId))
    .filter((entry) => entry?.subject.id === subjectId);
  if (entries.length !== 1) fail(`${collectionId} has ${entries.length} current ${subjectId} members`);
  const [entry] = entries;

  const descriptor = entry.artifacts.profile;
  const profileBytes = readFileSync(resolve(root, ...descriptor.path.split("/")));
  if (sha256(profileBytes) !== descriptor.sha256) fail("profile does not match its index digest");
  const profile = JSON.parse(profileBytes.toString("utf8"));
  if (profile.material?.kind !== "source-files") fail("material is not a source-file closure");
  const owner = name(profile.scanner?.catalog?.owner, "owner");
  const repository = name(profile.scanner?.catalog?.repository, "repository");
  const revision = profile.scanner?.catalog?.pinnedCommit;
  if (typeof revision !== "string" || !GIT_COMMIT.test(revision)) fail("revision is not a commit");

  const base = `${SOURCES}/github.com/${owner}/${repository}/${revision}`;
  const staged = [];
  for (const file of profile.material.files) {
    const path = sourcePath(file.path);
    if (typeof file.digest !== "string" || !PREFIXED_SHA256.test(file.digest)) {
      fail(`declared digest is malformed for ${path}`);
    }
    const expected = file.digest.slice("sha256:".length);
    const url = `https://raw.githubusercontent.com/${owner}/${repository}/${revision}/${path}`;
    const bytes = await fetchBytes(url);
    const actual = sha256(bytes);
    if (actual !== expected) fail(`${path} from ${revision} is sha256:${actual}, declared ${file.digest}`);
    staged.push({ path, bytes, sha256: actual, url });
  }

  // Only a complete, verified closure is written.
  for (const file of staged) {
    const target = resolve(root, ...base.split("/"), ...file.path.split("/"));
    mkdirSync(dirname(target), { recursive: true });
    let existing;
    try {
      existing = readFileSync(target);
    } catch {
      existing = undefined;
    }
    if (existing !== undefined) {
      if (sha256(existing) !== file.sha256) fail(`${target} holds different bytes`);
      continue;
    }
    const temporary = `${target}.tmp`;
    writeFileSync(temporary, file.bytes, { flag: "wx" });
    try {
      renameSync(temporary, target);
    } finally {
      rmSync(temporary, { force: true });
    }
  }
  return { entryId: entry.entryId, base, files: staged.map(({ path, sha256, url }) => ({ path, sha256, url })) };
}

async function fetchPublic(url) {
  const response = await fetch(url, { redirect: "error" });
  if (!response.ok) fail(`${url} returned HTTP ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [collectionId, subjectId, ...rest] = process.argv.slice(2);
    if (!collectionId || !subjectId || rest.length > 0) {
      fail("usage: node tools/stage-source-closure.mjs <collection-id> <subject-id>");
    }
    const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
    const result = await stageSourceClosure(root, collectionId, subjectId, fetchPublic);
    console.log(`Staged ${result.entryId} into ${result.base}`);
    for (const file of result.files) console.log(`  sha256:${file.sha256}  ${file.path}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
