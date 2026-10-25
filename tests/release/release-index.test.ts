import { describe, expect, it } from "vitest";
import { readReleaseIndex } from "../../src/release/reader.js";
import { canonical, encode, type Json, sha256 } from "./fixtures.js";

const NOW = "2026-06-01T00:00:00Z";
const RELEASE_SCHEMA = "urn:aihq:catalog:release:1.5.0";
const INDEX_SCHEMA = "urn:aihq:catalog:release-index:1.0.0";

const digest = (seed: string) => sha256(encode(seed));

type EntryOptions = {
  frameworkId?: string;
  name?: string;
  version?: string;
  status?: string;
  reason?: string;
  sha?: string;
  sourceId?: string;
  kind?: string;
  evidence?: Json[];
  local?: boolean;
};

function entry(options: EntryOptions = {}): { [key: string]: Json } {
  const sha = options.sha ?? digest(`release:${options.frameworkId ?? "alpha"}`);
  const sourceId = options.sourceId ?? "catalog-public";
  return {
    frameworkId: options.frameworkId ?? "alpha",
    name: options.name ?? "Framework Alpha",
    version: options.version ?? "1.0.0",
    location: options.local
      ? { kind: "local", input: "org-mirror" }
      : {
          kind: "archive",
          url: `https://example.test/releases/${options.frameworkId ?? "alpha"}-${options.version ?? "1.0.0"}.json`,
          sha256: sha,
          byteLength: 100,
        },
    sha256: sha,
    schema: RELEASE_SCHEMA,
    status: options.status ?? "current",
    ...(options.reason === undefined ? {} : { reason: options.reason }),
    evidence: options.evidence ?? [],
    source: { id: sourceId, kind: options.kind ?? "public" },
  };
}

type DocumentOptions = {
  sourceId?: string;
  version?: number;
  issuedAt?: string;
  expires?: string;
  entries?: Json[];
};

function indexDocument(options: DocumentOptions = {}): { [key: string]: Json } {
  return {
    schema: INDEX_SCHEMA,
    sourceId: options.sourceId ?? "catalog-public",
    version: options.version ?? 1,
    issuedAt: options.issuedAt ?? "2026-01-01T00:00:00Z",
    expires: options.expires ?? "2027-01-01T00:00:00Z",
    entries: options.entries ?? [entry()],
  };
}

type SourceOptions = {
  sourceId: string;
  doc?: { [key: string]: Json };
  trust?: unknown;
  authorized?: string[];
  offline?: boolean;
  state?: Json;
  rawBytes?: Uint8Array;
};

const initialState = (sourceId: string) => ({
  sourceId,
  lastVersion: 0,
  lastVerifiedAt: null,
  lastIndexSha256: null,
});

function read(sources: SourceOptions[], evaluatedAt: string = NOW) {
  return readReleaseIndex({
    evaluatedAt,
    sources: sources.map((source) => ({
      sourceId: source.sourceId,
      trust: (source.trust ?? "none") as never,
      authorizedFrameworks: source.authorized ?? ["alpha", "beta", "gamma", "delta"],
      ...(source.rawBytes !== undefined
        ? { indexBytes: source.rawBytes }
        : source.doc !== undefined
          ? { indexBytes: encode(`${canonical(source.doc)}\n`) }
          : {}),
      ...(source.offline ? { offline: true } : {}),
    })),
    state: sources.map((source) => (source.state ?? initialState(source.sourceId)) as never),
  });
}

const bytesOf = (doc: Json) => encode(`${canonical(doc)}\n`);
const reasons = (result: { sources: readonly { diagnostics: readonly { code: string }[] }[] }) =>
  result.sources.flatMap((source) => source.diagnostics.map((d) => d.code));

describe("readReleaseIndex", () => {
  it("reads one unsigned source, checks release digests and advances state", () => {
    const doc = indexDocument({
      entries: [
        entry({ frameworkId: "alpha" }),
        entry({ frameworkId: "beta", status: "retired", reason: "Superseded by gamma." }),
        entry({ frameworkId: "gamma", status: "revoked", reason: "Withdrawn upstream." }),
      ],
    });
    const bytes = bytesOf(doc);
    const result = read([{ sourceId: "catalog-public", doc }]);
    expect(result.valid).toBe(true);
    expect(result.entries.map((e) => e.frameworkId)).toEqual(["alpha", "beta", "gamma"]);
    // Retired and revoked entries stay listed: status never deletes.
    expect(result.entries.map((e) => e.status)).toEqual(["current", "retired", "revoked"]);
    expect(result.entries[0]?.sources).toEqual([{ id: "catalog-public", kind: "public" }]);
    const source = result.sources[0];
    expect(source?.diagnostics.map((d) => d.code)).toEqual(["unsigned"]);
    expect(source?.diagnostics[0]?.blocking).toBe(false);
    expect(source?.state).toEqual({
      sourceId: "catalog-public",
      lastVersion: 1,
      lastVerifiedAt: null,
      lastIndexSha256: sha256(bytes),
    });
  });

  it("merges public and local sources and records every agreeing source", () => {
    const publicDoc = indexDocument({
      entries: [entry({ frameworkId: "alpha" }), entry({ frameworkId: "beta" })],
    });
    const localDoc = indexDocument({
      sourceId: "org-local",
      version: 4,
      entries: [entry({ frameworkId: "gamma", sourceId: "org-local", kind: "local", local: true })],
    });
    const result = read([
      { sourceId: "catalog-public", doc: publicDoc },
      {
        sourceId: "org-local",
        doc: localDoc,
        authorized: ["gamma"],
      },
    ]);
    expect(result.valid).toBe(true);
    expect(result.entries.map((e) => e.frameworkId)).toEqual(["alpha", "beta", "gamma"]);
    expect(result.entries[2]?.sources).toEqual([{ id: "org-local", kind: "local" }]);
    expect(result.sources.map((s) => s.state.lastVersion)).toEqual([1, 4]);
  });

  it("checks the release digest an archive location declares", () => {
    const broken = entry({ frameworkId: "alpha" });
    (broken as { location: { sha256: string } }).location.sha256 = digest("other-bytes");
    const result = read([
      { sourceId: "catalog-public", doc: indexDocument({ entries: [broken] }) },
    ]);
    expect(result.valid).toBe(false);
    expect(reasons(result)).toContain("INPUT_INVALID");
    expect(result.sources[0]?.diagnostics.map((d) => d.reason)).toContain(
      "location-digest-mismatch",
    );
    expect(result.entries).toEqual([]);
  });

  it("refuses a rollback and keeps the recorded state", () => {
    const doc = indexDocument({ version: 2 });
    const state = {
      sourceId: "catalog-public",
      lastVersion: 3,
      lastVerifiedAt: null,
      lastIndexSha256: digest("accepted-v3"),
    };
    const result = read([{ sourceId: "catalog-public", doc, state }]);
    expect(result.valid).toBe(true);
    expect(reasons(result)).toEqual(["rollback-refused"]);
    expect(result.entries).toEqual([]);
    expect(result.sources[0]?.state).toEqual(state);
  });

  it("refuses an equal version with different bytes and accepts an identical re-read", () => {
    const first = indexDocument({ version: 3 });
    const bytes = bytesOf(first);
    const recorded = {
      sourceId: "catalog-public",
      lastVersion: 3,
      lastVerifiedAt: null,
      lastIndexSha256: sha256(bytes),
    };
    const reissued = indexDocument({
      version: 3,
      entries: [entry({ frameworkId: "alpha", sha: digest("different-release") })],
    });
    const changed = read([{ sourceId: "catalog-public", doc: reissued, state: recorded }]);
    expect(reasons(changed)).toEqual(["rollback-refused"]);
    expect(changed.entries).toEqual([]);
    const same = read([{ sourceId: "catalog-public", doc: first, state: recorded }]);
    expect(same.valid).toBe(true);
    expect(same.entries.map((e) => e.frameworkId)).toEqual(["alpha"]);
  });

  it("ignores frameworks outside the source authorization", () => {
    const doc = indexDocument({
      entries: [entry({ frameworkId: "alpha" }), entry({ frameworkId: "beta" })],
    });
    const result = read([{ sourceId: "catalog-public", doc, authorized: ["alpha"] }]);
    expect(result.valid).toBe(true);
    expect(result.entries.map((e) => e.frameworkId)).toEqual(["alpha"]);
    const diagnostic = result.sources[0]?.diagnostics.find(
      (d) => d.code === "unauthorized-framework",
    );
    expect(diagnostic?.frameworkId).toBe("beta");
    expect(diagnostic?.blocking).toBe(false);
  });

  it("withholds an expired index", () => {
    const doc = indexDocument({ expires: "2026-02-01T00:00:00Z" });
    const result = read([{ sourceId: "catalog-public", doc }], "2026-06-01T00:00:00Z");
    expect(result.valid).toBe(true);
    expect(reasons(result)).toEqual(["expired"]);
    expect(result.entries).toEqual([]);
    expect(result.sources[0]?.state.lastVersion).toBe(0);
  });

  it("reuses an unexpired recorded copy offline without calling it verified", () => {
    const doc = indexDocument({ expires: "2027-01-01T00:00:00Z" });
    const bytes = bytesOf(doc);
    const recorded = {
      sourceId: "catalog-public",
      lastVersion: 1,
      lastVerifiedAt: null,
      lastIndexSha256: sha256(bytes),
    };
    const result = read([
      { sourceId: "catalog-public", rawBytes: bytes, offline: true, state: recorded },
    ]);
    expect(result.valid).toBe(true);
    expect(result.entries.map((e) => e.frameworkId)).toEqual(["alpha"]);
    const offline = result.sources[0]?.diagnostics.find((d) => d.code === "offline");
    expect(offline?.reason).toBe("offline-cache");
    expect(offline?.message).toContain("last checked copy");
    expect(offline?.message).toContain("unsigned");
    expect(offline?.message).not.toContain("verified");
    expect(result.sources[0]?.state).toEqual(recorded);
  });

  it("withholds an offline copy that is not the recorded one or is expired", () => {
    const doc = indexDocument({ expires: "2027-01-01T00:00:00Z" });
    const bytes = bytesOf(doc);
    const other = indexDocument({
      version: 2,
      entries: [entry({ frameworkId: "beta" })],
    });
    const notRecorded = read([
      {
        sourceId: "catalog-public",
        rawBytes: bytesOf(other),
        offline: true,
        state: {
          sourceId: "catalog-public",
          lastVersion: 1,
          lastVerifiedAt: null,
          lastIndexSha256: sha256(bytes),
        },
      },
    ]);
    expect(reasons(notRecorded)).toEqual(["offline"]);
    expect(notRecorded.entries).toEqual([]);
    const expired = read(
      [
        {
          sourceId: "catalog-public",
          rawBytes: bytes,
          offline: true,
          state: {
            sourceId: "catalog-public",
            lastVersion: 1,
            lastVerifiedAt: null,
            lastIndexSha256: sha256(bytes),
          },
        },
      ],
      "2028-06-01T00:00:00Z",
    );
    expect(reasons(expired)).toEqual(["expired"]);
    expect(expired.entries).toEqual([]);
  });

  it("reports a selected TUF source offline and never as unsigned or verified", () => {
    const doc = indexDocument();
    const result = read([
      {
        sourceId: "catalog-public",
        doc,
        trust: { tufRoot: encode("root-bytes") },
        authorized: ["alpha"],
      },
    ]);
    expect(result.valid).toBe(true);
    expect(result.entries).toEqual([]);
    const diagnostic = result.sources[0]?.diagnostics[0];
    expect(diagnostic?.code).toBe("offline");
    expect(diagnostic?.reason).toBe("tuf-unavailable");
    expect(diagnostic?.message).toContain("TUF");
    expect(diagnostic?.message.toLowerCase()).toContain("unavailable");
    expect(reasons(result)).not.toContain("unsigned");
  });

  it("reports a two-source digest conflict and uses neither entry", () => {
    const first = indexDocument({
      entries: [entry({ frameworkId: "alpha", sha: digest("release-a") })],
    });
    const second = indexDocument({
      sourceId: "org-mirror",
      version: 9,
      entries: [
        entry({
          frameworkId: "alpha",
          sha: digest("release-b"),
          sourceId: "org-mirror",
          kind: "organization",
        }),
        entry({ frameworkId: "beta", sourceId: "org-mirror", kind: "organization" }),
      ],
    });
    const result = read([
      { sourceId: "catalog-public", doc: first, authorized: ["alpha", "beta"] },
      { sourceId: "org-mirror", doc: second, authorized: ["alpha", "beta"] },
    ]);
    expect(result.valid).toBe(true);
    expect(result.entries.map((e) => e.frameworkId)).toEqual(["beta"]);
    for (const source of result.sources) {
      const conflict = source.diagnostics.find((d) => d.code === "conflict");
      expect(conflict?.frameworkId).toBe("alpha");
      expect(conflict?.version).toBe("1.0.0");
      expect(conflict?.blocking).toBe(false);
    }
  });

  it("merges agreeing sources into one entry and lets withdrawal be visible", () => {
    const current = indexDocument({
      entries: [entry({ frameworkId: "alpha", sha: digest("same-release") })],
    });
    const withdrawn = indexDocument({
      sourceId: "org-mirror",
      version: 2,
      entries: [
        entry({
          frameworkId: "alpha",
          sha: digest("same-release"),
          status: "revoked",
          reason: "Upstream withdrawal.",
          sourceId: "org-mirror",
          kind: "organization",
        }),
      ],
    });
    const result = read([
      { sourceId: "catalog-public", doc: current, authorized: ["alpha"] },
      { sourceId: "org-mirror", doc: withdrawn, authorized: ["alpha"] },
    ]);
    expect(result.valid).toBe(true);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]?.status).toBe("revoked");
    expect(result.entries[0]?.reason).toBe("Upstream withdrawal.");
    expect(result.entries[0]?.sources).toEqual([
      { id: "catalog-public", kind: "public" },
      { id: "org-mirror", kind: "organization" },
    ]);
  });

  it("refuses ambiguous request and document shapes closed", () => {
    const doc = indexDocument();
    const missingState = readReleaseIndex({
      evaluatedAt: NOW,
      sources: [
        {
          sourceId: "catalog-public",
          trust: "none",
          authorizedFrameworks: ["alpha"],
          indexBytes: bytesOf(doc),
        },
      ],
      state: [],
    });
    expect(missingState.valid).toBe(false);
    expect(missingState.diagnostics.map((d) => d.reason)).toContain("state-mismatch");

    const duplicateSources = readReleaseIndex({
      evaluatedAt: NOW,
      sources: [
        { sourceId: "catalog-public", trust: "none", authorizedFrameworks: ["alpha"] },
        { sourceId: "catalog-public", trust: "none", authorizedFrameworks: ["alpha"] },
      ],
      state: [initialState("catalog-public"), initialState("catalog-public")],
    });
    expect(duplicateSources.valid).toBe(false);

    const badTime = readReleaseIndex({
      evaluatedAt: "not-a-time",
      sources: [],
      state: [],
    });
    expect(badTime.valid).toBe(false);
    expect(badTime.diagnostics.map((d) => d.reason)).toContain("invalid-time");

    const unknownField = { ...doc, extra: true };
    const result = read([{ sourceId: "catalog-public", doc: unknownField }]);
    expect(result.valid).toBe(false);
    expect(result.sources[0]?.diagnostics.map((d) => d.reason)).toContain("unknown-field");

    const future = read([
      {
        sourceId: "catalog-public",
        doc: { ...doc, schema: "urn:aihq:catalog:release-index:2.0.0" },
      },
    ]);
    expect(future.valid).toBe(false);
    expect(future.sources[0]?.diagnostics[0]?.code).toBe("SCHEMA_UNSUPPORTED");
  });

  it("refuses structural document faults with stable reasons", () => {
    const doc = indexDocument({
      entries: [entry({ frameworkId: "beta" }), entry({ frameworkId: "alpha" })],
    });
    const unsorted = read([{ sourceId: "catalog-public", doc }]);
    expect(unsorted.valid).toBe(false);
    expect(unsorted.sources[0]?.diagnostics.map((d) => d.reason)).toContain("unordered-entries");

    const foreignSource = indexDocument({
      entries: [entry({ frameworkId: "alpha", sourceId: "someone-else" })],
    });
    const mismatched = read([{ sourceId: "catalog-public", doc: foreignSource }]);
    expect(mismatched.valid).toBe(false);
    expect(mismatched.sources[0]?.diagnostics.map((d) => d.reason)).toContain("source-id-mismatch");

    const zeroVersion = read([{ sourceId: "catalog-public", doc: indexDocument({ version: 0 }) }]);
    expect(zeroVersion.valid).toBe(false);
    expect(zeroVersion.sources[0]?.diagnostics.map((d) => d.reason)).toContain("invalid-version");

    const inverted = read([
      {
        sourceId: "catalog-public",
        doc: indexDocument({ issuedAt: "2027-01-01T00:00:00Z", expires: "2026-01-01T00:00:00Z" }),
      },
    ]);
    expect(inverted.valid).toBe(false);
    expect(inverted.sources[0]?.diagnostics.map((d) => d.reason)).toContain("invalid-times");

    const duplicate = indexDocument({
      entries: [entry({ frameworkId: "alpha" }), entry({ frameworkId: "alpha" })],
    });
    const repeated = read([{ sourceId: "catalog-public", doc: duplicate }]);
    expect(repeated.valid).toBe(false);
    expect(repeated.sources[0]?.diagnostics.map((d) => d.reason)).toContain("duplicate-entry");
  });

  it("keeps no framework-specific branches", () => {
    // The reader treats every framework id as data: two unknown ids merge the same way.
    const one = indexDocument({
      entries: [entry({ frameworkId: "anything-at-all" })],
    });
    const two = indexDocument({
      sourceId: "org-mirror",
      version: 2,
      entries: [
        entry({ frameworkId: "anything-at-all", sourceId: "org-mirror", kind: "organization" }),
      ],
    });
    const result = read([
      { sourceId: "catalog-public", doc: one, authorized: ["anything-at-all"] },
      { sourceId: "org-mirror", doc: two, authorized: ["anything-at-all"] },
    ]);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]?.sources).toHaveLength(2);
  });
});
