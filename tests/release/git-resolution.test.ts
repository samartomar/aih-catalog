import {
  acquireGitSnapshot,
  GIT_SNAPSHOT_MAX_FILE_BYTES,
  GIT_SNAPSHOT_MAX_FILES,
  GIT_SNAPSHOT_MAX_SOURCE_BYTES,
  GIT_SNAPSHOT_MAX_SOURCE_ENTRIES,
  gitCliTransport,
  resolveGitRef,
} from "@aihq/catalog/node";
import { checkExactSourceIdentity } from "@aihq/catalog/source";
import { describe, expect, it } from "vitest";
import {
  COMMIT,
  COMMIT_BYTES,
  FORK_COMMIT,
  fixtureAcquiredCommit,
  fixtureRef,
  fixtureTransport,
  gitOid,
  FIXTURE_REPOSITORY as REPOSITORY,
  sha256Hex,
} from "../../tools/git-resolution-fixture.mjs";

const C0 = "0".repeat(40);
const C1 = "1".repeat(40);
const C2 = "2".repeat(40);
const ENCODER = new TextEncoder();
const encode = (text: string) => ENCODER.encode(text);

const reasons = (result: { diagnostics: readonly { reason: string }[] }) =>
  result.diagnostics.map((d) => d.reason);

describe("resolveGitRef", () => {
  const closed = fixtureTransport({
    refs: [fixtureRef("refs/heads/main", C1), fixtureRef("refs/tags/v1", C1)],
    closure: [C0, C1],
    commits: new Map([[C1, fixtureAcquiredCommit([])]]),
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
    const both = fixtureTransport({
      refs: [
        fixtureRef("refs/heads/release", C0),
        fixtureRef("refs/tags/release", tagObject),
        fixtureRef("refs/tags/release^{}", C2),
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
    const fork = fixtureTransport({
      refs: [fixtureRef("refs/heads/main", FORK_COMMIT)],
      closure: [C0, C1],
    });
    const result = await resolveGitRef(
      { repository: REPOSITORY, ref: "main" },
      { transport: fork },
    );
    expect(result.valid).toBe(false);
    expect(result.installable).toBe(false);
    expect(result.commit).toBe(FORK_COMMIT);
    expect(result.reachable).toBe(false);
    expect(result.identity).toEqual({
      kind: "git",
      repository: REPOSITORY,
      commit: FORK_COMMIT,
      reachable: false,
    });
    expect(reasons(result)).toContain("git-commit-unreachable");
    expect(checkExactSourceIdentity(result.identity).valid).toBe(true);
  });

  it("marks an uncheckable reachability unchecked and blocks installability", async () => {
    const offline = fixtureTransport({
      refs: [fixtureRef("refs/heads/main", C1)],
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
    const spy = fixtureTransport({
      refs: [fixtureRef("refs/heads/main", C1)],
      closure: [C1],
    });
    const counting = {
      listRefs: async (repository: string) => {
        calls.push("listRefs");
        return spy.listRefs(repository);
      },
      branchTagClosure: async (repository: string) => {
        calls.push("closure");
        return spy.branchTagClosure(repository);
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
    const down = fixtureTransport({ listRefsError: new Error("connection refused") });
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
  const fileA = { path: "skills/a/SKILL.md", bytes: encode("---\nname: a\n---\n") };
  const fileB = { path: "skills/b/SKILL.md", bytes: encode("---\nname: b\n---\n"), mode: "100755" };
  const acquired = fixtureAcquiredCommit([fileA, fileB]);
  const fixture = fixtureTransport({ commits: new Map([[COMMIT, acquired]]) });

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
      .map((file) => `${file.path}\t${sha256Hex(file.bytes)}\n`)
      .sort()
      .join("");
    expect(snapshot.captureSha256).toBe(sha256Hex(encode(lines)));
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
    const down = fixtureTransport({ fetchError: new Error("connection refused") });
    const result = await acquireGitSnapshot(
      { repository: REPOSITORY, commit: COMMIT },
      { transport: down },
    );
    expect(result.valid).toBe(false);
    expect(reasons(result)).toContain("git-transport-failed");
  });

  it("refuses a commit whose object does not match its id", async () => {
    const lying = fixtureTransport({
      commits: new Map([
        [
          COMMIT,
          Object.freeze({
            commitBytes: encode("bogus"),
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
    const original = encode("original\n");
    const changed = encode("changed\n");
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
      { transport: fixtureTransport({ commits: new Map([[COMMIT, tampered]]) }) },
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
      { transport: fixtureTransport({ commits: new Map([[COMMIT, incomplete]]) }) },
    );
    expect(reasons(result)).toContain("git-object-mismatch");
  });

  it("refuses trees over the entry bound with a named refusal", async () => {
    const files = [
      { path: "a.txt", bytes: encode("a") },
      { path: "b.txt", bytes: encode("b") },
    ];
    const result = await acquireGitSnapshot(
      { repository: REPOSITORY, commit: COMMIT },
      {
        transport: fixtureTransport({ commits: new Map([[COMMIT, fixtureAcquiredCommit(files)]]) }),
        maxSourceEntries: 1,
      },
    );
    expect(result.valid).toBe(false);
    expect(reasons(result)).toContain("snapshot-entry-limit");
  });

  it("refuses trees over the byte bound with a named refusal", async () => {
    const files = [
      { path: "a.txt", bytes: encode("abcd") },
      { path: "b.txt", bytes: encode("efgh") },
    ];
    const result = await acquireGitSnapshot(
      { repository: REPOSITORY, commit: COMMIT },
      {
        transport: fixtureTransport({ commits: new Map([[COMMIT, fixtureAcquiredCommit(files)]]) }),
        maxSourceBytes: 7,
      },
    );
    expect(result.valid).toBe(false);
    expect(reasons(result)).toContain("snapshot-byte-limit");
  });

  it("refuses a file past the per-file consumer envelope", async () => {
    const big = { path: "big.bin", bytes: new Uint8Array(GIT_SNAPSHOT_MAX_FILE_BYTES + 1) };
    const result = await acquireGitSnapshot(
      { repository: REPOSITORY, commit: COMMIT },
      {
        transport: fixtureTransport({ commits: new Map([[COMMIT, fixtureAcquiredCommit([big])]]) }),
      },
    );
    expect(result.valid).toBe(false);
    expect(reasons(result)).toContain("snapshot-file-limit");
  });

  it("refuses a tree past the file-count consumer envelope", async () => {
    const many = Array.from({ length: GIT_SNAPSHOT_MAX_FILES + 1 }, (_, index) => ({
      path: `f${index}.txt`,
      bytes: encode("x"),
    }));
    const result = await acquireGitSnapshot(
      { repository: REPOSITORY, commit: COMMIT },
      {
        transport: fixtureTransport({ commits: new Map([[COMMIT, fixtureAcquiredCommit(many)]]) }),
      },
    );
    expect(result.valid).toBe(false);
    expect(reasons(result)).toContain("snapshot-file-count");
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
          { transport: fixtureTransport({ commits: new Map([[COMMIT, submodule]]) }) },
        ),
      ),
    ).toContain("snapshot-submodule-refused");

    const link = fixtureAcquiredCommit([
      { path: "link", bytes: encode("../escape"), mode: "120000" },
    ]);
    expect(
      reasons(
        await acquireGitSnapshot(
          { repository: REPOSITORY, commit: COMMIT },
          { transport: fixtureTransport({ commits: new Map([[COMMIT, link]]) }) },
        ),
      ),
    ).toContain("snapshot-link-refused");

    const reserved = Object.freeze({
      commitBytes: COMMIT_BYTES,
      entries: Object.freeze([
        Object.freeze({
          mode: "100644",
          type: "blob" as const,
          oid: gitOid("blob", encode("x")),
          path: ".git/config",
        }),
      ]),
      blobs: Object.freeze(new Map([[gitOid("blob", encode("x")), encode("x")]])),
    });
    expect(
      reasons(
        await acquireGitSnapshot(
          { repository: REPOSITORY, commit: COMMIT },
          { transport: fixtureTransport({ commits: new Map([[COMMIT, reserved]]) }) },
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
          oid: gitOid("blob", encode("x")),
          path: "odd",
        }),
      ]),
      blobs: Object.freeze(new Map([[gitOid("blob", encode("x")), encode("x")]])),
    });
    const result = await acquireGitSnapshot(
      { repository: REPOSITORY, commit: COMMIT },
      { transport: fixtureTransport({ commits: new Map([[COMMIT, odd]]) }) },
    );
    expect(reasons(result)).toContain("unsupported-tree-entry");
  });
});

describe("published capture limits", () => {
  it("follows Scan's capture limits and the consumer envelope", () => {
    expect(GIT_SNAPSHOT_MAX_SOURCE_ENTRIES).toBe(100_000);
    expect(GIT_SNAPSHOT_MAX_SOURCE_BYTES).toBe(256 * 1024 * 1024);
    expect(GIT_SNAPSHOT_MAX_FILE_BYTES).toBe(16 * 1024 * 1024);
    expect(GIT_SNAPSHOT_MAX_FILES).toBe(65_536);
    const defaultTransport = gitCliTransport();
    expect(typeof defaultTransport.listRefs).toBe("function");
    expect(typeof defaultTransport.branchTagClosure).toBe("function");
    expect(typeof defaultTransport.fetchCommit).toBe("function");
  });
});
