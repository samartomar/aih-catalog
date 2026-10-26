import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type {
  GitAcquiredCommit,
  GitRemoteRef,
  GitRemoteTransport,
  GitTreeEntry,
} from "../../src/release/contracts.js";
import {
  acquireGitSnapshot,
  GIT_SNAPSHOT_MAX_SOURCE_BYTES,
  GIT_SNAPSHOT_MAX_SOURCE_ENTRIES,
  gitCliTransport,
  resolveGitRef,
} from "../../src/release/node.js";
import { checkExactSourceIdentity } from "../../src/release/source-description.js";

const REPOSITORY = "https://github.com/example/skills";
const C0 = "0".repeat(40);
const C1 = "1".repeat(40);
const C2 = "2".repeat(40);
const FORK = "f".repeat(40);
const TREE = "3".repeat(40);

const gitOid = (type: "blob" | "commit" | "tree", bytes: Uint8Array): string =>
  createHash("sha1").update(`${type} ${bytes.byteLength}\0`, "utf8").update(bytes).digest("hex");

const commitBytes = (parents: string[] = []): Uint8Array =>
  new TextEncoder().encode(
    `tree ${TREE}\n${parents.map((parent) => `parent ${parent}\n`).join("")}author fixture <fixture@example.com> 1700000000 +0000\ncommitter fixture <fixture@example.com> 1700000000 +0000\n\nfixture\n`,
  );

const COMMIT_BYTES = commitBytes();
const COMMIT = gitOid("commit", COMMIT_BYTES);

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

interface FixtureTreeFile {
  readonly path: string;
  readonly bytes: Uint8Array;
  readonly mode?: string;
}

const acquiredCommit = (files: readonly FixtureTreeFile[]): GitAcquiredCommit => {
  const blobs = new Map<string, Uint8Array>();
  const entries: GitTreeEntry[] = [];
  for (const file of files) {
    const oid = gitOid("blob", file.bytes);
    blobs.set(oid, file.bytes);
    entries.push(
      Object.freeze({
        mode: file.mode ?? "100644",
        type: "blob" as const,
        oid,
        path: file.path,
      }),
    );
  }
  return Object.freeze({
    commitBytes: COMMIT_BYTES,
    entries: Object.freeze(entries),
    blobs: Object.freeze(blobs),
  });
};

interface FixtureTransportOptions {
  readonly refs?: readonly GitRemoteRef[];
  readonly closure?: readonly string[];
  readonly commits?: ReadonlyMap<string, GitAcquiredCommit>;
  readonly listRefsError?: Error;
  readonly closureError?: Error;
  readonly fetchError?: Error;
}

const transport = (options: FixtureTransportOptions): GitRemoteTransport => ({
  async listRefs() {
    if (options.listRefsError) throw options.listRefsError;
    return Object.freeze(options.refs ?? []);
  },
  async branchTagClosure() {
    if (options.closureError) throw options.closureError;
    return Object.freeze(options.closure ?? []);
  },
  async fetchCommit(_repository, commit) {
    if (options.fetchError) throw options.fetchError;
    const acquired = options.commits?.get(commit);
    if (!acquired) throw new Error("commit absent");
    return acquired;
  },
});

const ref = (name: string, oid: string): GitRemoteRef => Object.freeze({ name, oid });

const reasons = (result: { diagnostics: readonly { reason: string }[] }) =>
  result.diagnostics.map((d) => d.reason);

describe("resolveGitRef", () => {
  const closed = transport({
    refs: [ref("refs/heads/main", C1), ref("refs/tags/v1", C1)],
    closure: [C0, C1],
    commits: new Map([[C1, acquiredCommit([])]]),
  });

  it("resolves a branch to an exact commit with reachable true", async () => {
    const result = await resolveGitRef(
      { repository: REPOSITORY, ref: "main" },
      { transport: closed },
    );
    expect(reasons(result)).toEqual([]);
    expect(result.valid).toBe(true);
    expect(result.commit).toBe(C1);
    expect(result.reachable).toBe(true);
    expect(result.installable).toBe(true);
    expect(result.identity).toEqual({
      kind: "git",
      repository: REPOSITORY,
      commit: C1,
      reachable: true,
    });
    expect(checkExactSourceIdentity(result.identity).valid).toBe(true);
    expect(Object.isFrozen(result.identity)).toBe(true);
  });

  it("resolves a lightweight tag directly", async () => {
    const result = await resolveGitRef(
      { repository: REPOSITORY, ref: "v1" },
      { transport: closed },
    );
    expect(result.valid).toBe(true);
    expect(result.commit).toBe(C1);
    expect(result.reachable).toBe(true);
  });

  it("peels an annotated tag to its commit and prefers a tag over a branch", async () => {
    const tagObject = "9".repeat(40);
    const both = transport({
      refs: [
        ref("refs/heads/release", C0),
        ref("refs/tags/release", tagObject),
        ref("refs/tags/release^{}", C2),
      ],
      closure: [C0, C2],
    });
    const result = await resolveGitRef(
      { repository: REPOSITORY, ref: "release" },
      { transport: both },
    );
    expect(result.valid).toBe(true);
    expect(result.commit).toBe(C2);
    expect(result.reachable).toBe(true);
  });

  it("refuses a fork-only commit with reachable false", async () => {
    const fork = transport({
      refs: [ref("refs/heads/main", FORK)],
      closure: [C0, C1],
    });
    const result = await resolveGitRef(
      { repository: REPOSITORY, ref: "main" },
      { transport: fork },
    );
    expect(result.valid).toBe(false);
    expect(result.installable).toBe(false);
    expect(result.commit).toBe(FORK);
    expect(result.reachable).toBe(false);
    expect(result.identity).toEqual({
      kind: "git",
      repository: REPOSITORY,
      commit: FORK,
      reachable: false,
    });
    expect(reasons(result)).toContain("git-commit-unreachable");
    expect(checkExactSourceIdentity(result.identity).valid).toBe(true);
  });

  it("marks an uncheckable reachability unchecked and blocks installability", async () => {
    const offline = transport({
      refs: [ref("refs/heads/main", C1)],
      closureError: new Error("offline"),
    });
    const result = await resolveGitRef(
      { repository: REPOSITORY, ref: "main" },
      { transport: offline },
    );
    expect(result.valid).toBe(true);
    expect(result.commit).toBe(C1);
    expect(result.reachable).toBe("unchecked");
    expect(result.installable).toBe(false);
    expect(result.identity).toEqual({
      kind: "git",
      repository: REPOSITORY,
      commit: C1,
      reachable: "unchecked",
    });
    expect(checkExactSourceIdentity(result.identity).valid).toBe(true);
    expect(reasons(result)).toContain("git-reachability-unchecked");
    expect(result.diagnostics[0]?.message).toContain(
      "cannot be made installable until it is checked",
    );
  });

  it("refuses precisely for invalid requests before any transport call", async () => {
    const calls: string[] = [];
    const spy = transport({
      refs: [ref("refs/heads/main", C1)],
      closure: [C1],
    });
    const counting = {
      listRefs: async () => {
        calls.push("listRefs");
        return spy.listRefs(REPOSITORY);
      },
      branchTagClosure: async () => {
        calls.push("closure");
        return spy.branchTagClosure(REPOSITORY);
      },
      fetchCommit: spy.fetchCommit,
    };
    for (const request of [
      { repository: "http://github.com/example/skills", ref: "main" },
      { repository: "git@github.com:example/skills.git", ref: "main" },
      { repository: REPOSITORY, ref: "refs/heads/main" },
      { repository: REPOSITORY, ref: "a b" },
      { repository: REPOSITORY, ref: "feature/../escape" },
      { repository: REPOSITORY, ref: "x".repeat(257) },
      { repository: REPOSITORY, ref: "branch.lock" },
    ]) {
      const result = await resolveGitRef(request as { repository: string; ref: string }, {
        transport: counting,
      });
      expect(result.valid).toBe(false);
    }
    expect(calls).toEqual([]);
  });

  it("refuses out-of-range bounds before any transport call", async () => {
    const result = await resolveGitRef(
      { repository: REPOSITORY, ref: "main" },
      { transport: closed, maxSourceEntries: 0 },
    );
    expect(result.valid).toBe(false);
    expect(reasons(result)).toContain("invalid-request");
    const tooBig = await resolveGitRef(
      { repository: REPOSITORY, ref: "main" },
      { transport: closed, maxSourceBytes: GIT_SNAPSHOT_MAX_SOURCE_BYTES + 1 },
    );
    expect(reasons(tooBig)).toContain("invalid-request");
  });

  it("refuses a missing ref with ref-not-found", async () => {
    const result = await resolveGitRef(
      { repository: REPOSITORY, ref: "nope" },
      { transport: closed },
    );
    expect(result.valid).toBe(false);
    expect(reasons(result)).toContain("ref-not-found");
  });

  it("maps a ref-advertisement transport failure to a refusal", async () => {
    const down = transport({ listRefsError: new Error("connection refused") });
    const result = await resolveGitRef(
      { repository: REPOSITORY, ref: "main" },
      { transport: down },
    );
    expect(result.valid).toBe(false);
    expect(reasons(result)).toContain("git-transport-failed");
  });

  it("honours a pre-aborted signal without transport calls", async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await resolveGitRef(
      { repository: REPOSITORY, ref: "main" },
      { transport: closed, signal: controller.signal },
    );
    expect(result.valid).toBe(false);
    expect(reasons(result)).toContain("cancelled");
  });
});

describe("acquireGitSnapshot", () => {
  const fileA = {
    path: "skills/a/SKILL.md",
    bytes: new TextEncoder().encode("---\nname: a\n---\n"),
  };
  const fileB = {
    path: "skills/b/SKILL.md",
    bytes: new TextEncoder().encode("---\nname: b\n---\n"),
    mode: "100755",
  };
  const acquired = acquiredCommit([fileA, fileB]);
  const fixture = transport({ commits: new Map([[COMMIT, acquired]]) });

  it("acquires the exact commit into a bounded snapshot", async () => {
    const result = await acquireGitSnapshot(
      { repository: REPOSITORY, commit: COMMIT },
      { transport: fixture },
    );
    if (!result.valid) throw new Error(JSON.stringify(result.diagnostics));
    const snapshot = result.snapshot;
    expect(snapshot.repository).toBe(REPOSITORY);
    expect(snapshot.revision).toBe(COMMIT);
    expect(Object.keys(snapshot.files).sort()).toEqual([fileA.path, fileB.path].sort());
    expect(snapshot.files[fileA.path]).toEqual(fileA.bytes);
    expect(snapshot.modes[fileA.path]).toBe(0o644);
    expect(snapshot.modes[fileB.path]).toBe(0o755);
    expect(snapshot.entryCount).toBe(2);
    expect(snapshot.byteLength).toBe(fileA.bytes.byteLength + fileB.bytes.byteLength);
    const lines = [fileA, fileB]
      .map((file) => `${file.path}\t${sha256(file.bytes)}\n`)
      .sort()
      .join("");
    expect(snapshot.captureSha256).toBe(sha256(new TextEncoder().encode(lines)));
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.files)).toBe(true);
  });

  it("refuses invalid requests precisely", async () => {
    const notHttps = await acquireGitSnapshot(
      { repository: "ssh://git@example.com/x", commit: COMMIT },
      { transport: fixture },
    );
    expect(reasons(notHttps)).toContain("repository-not-https");
    const mutable = await acquireGitSnapshot(
      { repository: REPOSITORY, commit: "main" },
      { transport: fixture },
    );
    expect(reasons(mutable)).toContain("commit-invalid");
    const uppercase = await acquireGitSnapshot(
      { repository: REPOSITORY, commit: "A".repeat(40) },
      { transport: fixture },
    );
    expect(reasons(uppercase)).toContain("commit-invalid");
  });

  it("maps an acquisition transport failure to a refusal", async () => {
    const down = transport({ fetchError: new Error("connection refused") });
    const result = await acquireGitSnapshot(
      { repository: REPOSITORY, commit: COMMIT },
      { transport: down },
    );
    expect(result.valid).toBe(false);
    expect(reasons(result)).toContain("git-transport-failed");
  });

  it("refuses a commit whose object does not match its id", async () => {
    const lying = transport({
      commits: new Map([
        [
          COMMIT,
          Object.freeze({
            commitBytes: new TextEncoder().encode("bogus"),
            entries: Object.freeze([]),
            blobs: Object.freeze(new Map()),
          }),
        ],
      ]),
    });
    const result = await acquireGitSnapshot(
      { repository: REPOSITORY, commit: COMMIT },
      { transport: lying },
    );
    expect(reasons(result)).toContain("git-object-mismatch");
  });

  it("refuses a blob that does not match its pinned object id", async () => {
    const original = new TextEncoder().encode("original\n");
    const changed = new TextEncoder().encode("changed\n");
    const tampered = Object.freeze({
      commitBytes: COMMIT_BYTES,
      entries: Object.freeze([
        Object.freeze({
          mode: "100644",
          type: "blob" as const,
          oid: gitOid("blob", original),
          path: "skills/a/SKILL.md",
        }),
      ]),
      blobs: Object.freeze(new Map([[gitOid("blob", original), changed]])),
    });
    const result = await acquireGitSnapshot(
      { repository: REPOSITORY, commit: COMMIT },
      { transport: transport({ commits: new Map([[COMMIT, tampered]]) }) },
    );
    expect(reasons(result)).toContain("git-object-mismatch");
  });

  it("refuses a missing blob as an object mismatch", async () => {
    const incomplete = Object.freeze({
      commitBytes: COMMIT_BYTES,
      entries: acquired.entries,
      blobs: Object.freeze(new Map()),
    });
    const result = await acquireGitSnapshot(
      { repository: REPOSITORY, commit: COMMIT },
      { transport: transport({ commits: new Map([[COMMIT, incomplete]]) }) },
    );
    expect(reasons(result)).toContain("git-object-mismatch");
  });

  it("refuses trees over the entry bound with a named refusal", async () => {
    const files = [
      { path: "a.txt", bytes: new TextEncoder().encode("a") },
      { path: "b.txt", bytes: new TextEncoder().encode("b") },
    ];
    const result = await acquireGitSnapshot(
      { repository: REPOSITORY, commit: COMMIT },
      {
        transport: transport({ commits: new Map([[COMMIT, acquiredCommit(files)]]) }),
        maxSourceEntries: 1,
      },
    );
    expect(result.valid).toBe(false);
    expect(reasons(result)).toContain("snapshot-entry-limit");
  });

  it("refuses trees over the byte bound with a named refusal", async () => {
    const files = [
      { path: "a.txt", bytes: new TextEncoder().encode("abcd") },
      { path: "b.txt", bytes: new TextEncoder().encode("efgh") },
    ];
    const result = await acquireGitSnapshot(
      { repository: REPOSITORY, commit: COMMIT },
      {
        transport: transport({ commits: new Map([[COMMIT, acquiredCommit(files)]]) }),
        maxSourceBytes: 7,
      },
    );
    expect(result.valid).toBe(false);
    expect(reasons(result)).toContain("snapshot-byte-limit");
  });

  it("refuses submodules, git links and reserved paths by name", async () => {
    const submodule = Object.freeze({
      commitBytes: COMMIT_BYTES,
      entries: Object.freeze([
        Object.freeze({ mode: "160000", type: "commit" as const, oid: C0, path: "vendor/dep" }),
      ]),
      blobs: Object.freeze(new Map()),
    });
    expect(
      reasons(
        await acquireGitSnapshot(
          { repository: REPOSITORY, commit: COMMIT },
          { transport: transport({ commits: new Map([[COMMIT, submodule]]) }) },
        ),
      ),
    ).toContain("snapshot-submodule-refused");

    const link = acquiredCommit([
      { path: "link", bytes: new TextEncoder().encode("../escape"), mode: "120000" },
    ]);
    expect(
      reasons(
        await acquireGitSnapshot(
          { repository: REPOSITORY, commit: COMMIT },
          { transport: transport({ commits: new Map([[COMMIT, link]]) }) },
        ),
      ),
    ).toContain("snapshot-link-refused");

    const reserved = Object.freeze({
      commitBytes: COMMIT_BYTES,
      entries: Object.freeze([
        Object.freeze({
          mode: "100644",
          type: "blob" as const,
          oid: gitOid("blob", new TextEncoder().encode("x")),
          path: ".git/config",
        }),
      ]),
      blobs: Object.freeze(
        new Map([[gitOid("blob", new TextEncoder().encode("x")), new TextEncoder().encode("x")]]),
      ),
    });
    expect(
      reasons(
        await acquireGitSnapshot(
          { repository: REPOSITORY, commit: COMMIT },
          { transport: transport({ commits: new Map([[COMMIT, reserved]]) }) },
        ),
      ),
    ).toContain("snapshot-reserved-path");
  });

  it("refuses unsupported tree entries by name", async () => {
    const odd = Object.freeze({
      commitBytes: COMMIT_BYTES,
      entries: Object.freeze([
        Object.freeze({
          mode: "100664",
          type: "blob" as const,
          oid: gitOid("blob", new TextEncoder().encode("x")),
          path: "odd",
        }),
      ]),
      blobs: Object.freeze(
        new Map([[gitOid("blob", new TextEncoder().encode("x")), new TextEncoder().encode("x")]]),
      ),
    });
    const result = await acquireGitSnapshot(
      { repository: REPOSITORY, commit: COMMIT },
      { transport: transport({ commits: new Map([[COMMIT, odd]]) }) },
    );
    expect(reasons(result)).toContain("unsupported-tree-entry");
  });
});

describe("published capture limits", () => {
  it("follows Scan's capture limits and exports a contained default transport", () => {
    expect(GIT_SNAPSHOT_MAX_SOURCE_ENTRIES).toBe(100_000);
    expect(GIT_SNAPSHOT_MAX_SOURCE_BYTES).toBe(256 * 1024 * 1024);
    const defaultTransport = gitCliTransport();
    expect(typeof defaultTransport.listRefs).toBe("function");
    expect(typeof defaultTransport.branchTagClosure).toBe("function");
    expect(typeof defaultTransport.fetchCommit).toBe("function");
  });
});
