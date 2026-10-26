// Shared deterministic fixture for samartomar/aih-catalog#122: real git object
// ids over canned refs, ancestry closures and commit trees, consumed by both
// the unit tests and the packed consumer tool so the two cannot drift apart.
// The fixture never touches the network or a git binary.
import { createHash } from "node:crypto";

export const FIXTURE_REPOSITORY = "https://github.com/example/skills";
export const FIXTURE_ENCODER = new TextEncoder();
export const FIXTURE_TREE = "3".repeat(40);

export const gitOid = (type, bytes) =>
  createHash("sha1").update(`${type} ${bytes.byteLength}\0`, "utf8").update(bytes).digest("hex");

export const sha256Hex = (bytes) => createHash("sha256").update(bytes).digest("hex");

export const commitObject = (parents = []) =>
  FIXTURE_ENCODER.encode(
    `tree ${FIXTURE_TREE}\n${parents.map((parent) => `parent ${parent}\n`).join("")}author fixture <fixture@example.com> 1700000000 +0000\ncommitter fixture <fixture@example.com> 1700000000 +0000\n\nfixture\n`,
  );

export const COMMIT_BYTES = commitObject();
export const COMMIT = gitOid("commit", COMMIT_BYTES);
export const OTHER_COMMIT = gitOid("commit", commitObject([COMMIT]));
export const FORK_COMMIT = "f".repeat(40);

export const fixtureRef = (name, oid) => Object.freeze({ name, oid });

/** One tree file: path, bytes and optional git mode ("100644" default). */

export const fixtureAcquiredCommit = (files) => {
  const blobs = new Map();
  const entries = [];
  for (const file of files) {
    const bytes = file.bytes instanceof Uint8Array ? file.bytes : FIXTURE_ENCODER.encode(file.bytes);
    const oid = gitOid("blob", bytes);
    blobs.set(oid, bytes);
    entries.push(
      Object.freeze({ mode: file.mode ?? "100644", type: "blob", oid, path: file.path }),
    );
  }
  return Object.freeze({
    commitBytes: COMMIT_BYTES,
    entries: Object.freeze(entries),
    blobs: Object.freeze(blobs),
  });
};

/**
 * One deterministic Git remote transport. Refs, ancestry closures and commit
 * trees are canned; error options simulate an unavailable stage.
 */
export const fixtureTransport = ({
  refs = [],
  closure = [],
  commits = new Map(),
  listRefsError,
  closureError,
  fetchError,
} = {}) => ({
  async listRefs() {
    if (listRefsError) throw listRefsError;
    return refs;
  },
  async branchTagClosure() {
    if (closureError) throw closureError;
    return closure;
  },
  async fetchCommit(_repository, commit) {
    if (fetchError) throw fetchError;
    const acquired = commits.get(commit);
    if (!acquired) throw new Error("commit absent from the fixture");
    return acquired;
  },
});
