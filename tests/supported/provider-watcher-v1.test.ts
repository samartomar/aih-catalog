import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { canonicalStrictJsonBytesV1 } from "../../src/contract/strict-json-v1.js";
import {
  canonicalProviderWatchCandidateV1Bytes,
  resolveProviderWatchV1,
} from "../../src/supported/provider-watcher-v1.js";

const sha = (label: string): string => createHash("sha256").update(label).digest("hex");
const npmIntegrity = `sha512-${Buffer.alloc(64, 0x61).toString("base64")}`;
const alternateNpmIntegrity = `sha512-${Buffer.alloc(64, 0x62).toString("base64")}`;
const MAX_RESOLUTION_BYTES = 65_536;

type Provider = "github" | "npm" | "pypi" | "oci";

function configuration(provider: Provider): Record<string, unknown> {
  const common = {
    policySha256: sha(`policy:${provider}`),
    protocol: "ProviderWatchConfigurationV1",
    provider,
    sourceId: `${provider}-source`,
  };
  switch (provider) {
    case "github":
      return {
        ...common,
        source: { repository: "acme/widget" },
        watchRef: { kind: "branch", name: "main" },
      };
    case "npm":
      return {
        ...common,
        source: { package: "@acme/widget" },
        watchRef: { kind: "dist-tag", name: "latest" },
      };
    case "pypi":
      return {
        ...common,
        source: { project: "acme-widget" },
        watchRef: { kind: "project", name: "latest" },
      };
    case "oci":
      return {
        ...common,
        source: { registry: "registry.example", repository: "acme/widget" },
        watchRef: { kind: "tag", name: "stable" },
      };
  }
}

function resolution(provider: Provider): Record<string, unknown> {
  const config = configuration(provider);
  const common = {
    observedMetadata: { observedAt: "2026-08-21T12:00:00Z" },
    protocol: "ProviderWatchResolutionV1",
    provider,
    source: config.source,
    watchRef: config.watchRef,
  };
  switch (provider) {
    case "github":
      return {
        ...common,
        identity: {
          commit: "0123456789abcdef0123456789abcdef01234567",
          treeSha256: sha("github-tree"),
        },
      };
    case "npm":
      return {
        ...common,
        identity: { integrity: npmIntegrity, version: "2.4.6" },
      };
    case "pypi":
      return {
        ...common,
        identity: {
          filename: "acme_widget-2.4.6-py3-none-any.whl",
          sha256: sha("pypi-distribution"),
          version: "2.4.6",
        },
      };
    case "oci":
      return {
        ...common,
        identity: {
          indexDigest: `sha256:${sha("oci-index")}`,
          manifests: [
            {
              architecture: "arm64",
              digest: `sha256:${sha("oci-arm64")}`,
              os: "linux",
            },
            {
              architecture: "amd64",
              digest: `sha256:${sha("oci-amd64")}`,
              os: "linux",
            },
          ],
        },
      };
  }
}

function resolver(result: unknown) {
  return { resolve: vi.fn(() => result) };
}

describe("provider watcher v1", () => {
  it("resolves each configured provider only through its bounded injected seam", async () => {
    for (const provider of ["github", "npm", "pypi", "oci"] as const) {
      const seam = resolver(resolution(provider));
      const result = await resolveProviderWatchV1({
        configuration: configuration(provider),
        resolver: seam,
      });

      expect(seam.resolve).toHaveBeenCalledOnce();
      expect(seam.resolve).toHaveBeenCalledWith({
        configuration: expect.objectContaining({ provider, sourceId: `${provider}-source` }),
      });
      expect(result.kind).toBe("changed");
      if (result.kind !== "changed") throw new Error("expected a changed watch result");
      expect(result.candidate).toMatchObject({
        protocol: "ProviderWatchCandidateV1",
        provider,
        sourceId: `${provider}-source`,
      });
      expect(result.candidate).not.toHaveProperty("watchRef");
      expect(result.invalidation).toEqual({
        currentCandidateIdentitySha256: result.candidate.candidateIdentitySha256,
        policySha256: sha(`policy:${provider}`),
        previousCandidateIdentitySha256: null,
        protocol: "ProviderWatchInvalidationV1",
        sourceId: `${provider}-source`,
      });
      expect(Object.isFrozen(result)).toBe(true);
      expect(Object.isFrozen(result.candidate)).toBe(true);
    }
  });

  it("returns a deterministic no-op for the exact prior identity and schedules no candidate", async () => {
    const first = await resolveProviderWatchV1({
      configuration: configuration("oci"),
      resolver: resolver(resolution("oci")),
    });
    if (first.kind !== "changed") throw new Error("expected initial candidate");
    const seam = resolver({
      ...resolution("oci"),
      observedMetadata: { observedAt: "2026-08-21T12:01:00Z" },
    });
    const next = await resolveProviderWatchV1({
      configuration: configuration("oci"),
      lastObservedCandidate: first.candidate,
      resolver: seam,
    });
    const again = await resolveProviderWatchV1({
      configuration: configuration("oci"),
      lastObservedCandidate: first.candidate,
      resolver: resolver(resolution("oci")),
    });

    expect(seam.resolve).toHaveBeenCalledOnce();
    expect(next).toEqual({
      candidateIdentitySha256: first.candidate.candidateIdentitySha256,
      kind: "unchanged",
    });
    expect(again).toEqual(next);
    expect(next).not.toHaveProperty("candidate");
    expect(next).not.toHaveProperty("invalidation");
  });

  it("round-trips an exact-bound resolution candidate without weakening the prior bound", async () => {
    const exactBoundResolution = resolution("github");
    exactBoundResolution.observedMetadata = { padding: "" };
    const paddingLength =
      MAX_RESOLUTION_BYTES - canonicalStrictJsonBytesV1(exactBoundResolution).length;
    exactBoundResolution.observedMetadata = { padding: "x".repeat(paddingLength) };
    expect(canonicalStrictJsonBytesV1(exactBoundResolution)).toHaveLength(MAX_RESOLUTION_BYTES);

    const first = await resolveProviderWatchV1({
      configuration: configuration("github"),
      resolver: resolver(exactBoundResolution),
    });
    if (first.kind !== "changed") throw new Error("expected initial candidate");
    expect(canonicalProviderWatchCandidateV1Bytes(first.candidate).length).toBeGreaterThan(
      MAX_RESOLUTION_BYTES,
    );
    const storedCandidate = JSON.parse(JSON.stringify(first.candidate));
    const seam = resolver(exactBoundResolution);
    await expect(
      resolveProviderWatchV1({
        configuration: configuration("github"),
        lastObservedCandidate: storedCandidate,
        resolver: seam,
      }),
    ).resolves.toEqual({
      candidateIdentitySha256: first.candidate.candidateIdentitySha256,
      kind: "unchanged",
    });
    expect(seam.resolve).toHaveBeenCalledOnce();

    const hostileSeam = resolver(exactBoundResolution);
    await expect(
      resolveProviderWatchV1({
        configuration: configuration("github"),
        lastObservedCandidate: {
          ...storedCandidate,
          observedMetadata: { padding: "x".repeat(MAX_RESOLUTION_BYTES) },
        },
        resolver: hostileSeam,
      }),
    ).rejects.toThrow();
    expect(hostileSeam.resolve).not.toHaveBeenCalled();
  });

  it("emits one canonical candidate and precise invalidation inputs for an immutable change", async () => {
    const baseline = await resolveProviderWatchV1({
      configuration: configuration("github"),
      resolver: resolver(resolution("github")),
    });
    if (baseline.kind !== "changed") throw new Error("expected initial candidate");
    const changedResolution = resolution("github");
    changedResolution.identity = {
      commit: "fedcba9876543210fedcba9876543210fedcba98",
      treeSha256: sha("changed-tree"),
    };
    const changed = await resolveProviderWatchV1({
      configuration: configuration("github"),
      lastObservedCandidate: baseline.candidate,
      resolver: resolver(changedResolution),
    });
    if (changed.kind !== "changed") throw new Error("expected changed candidate");

    expect(changed.candidate.candidateIdentitySha256).not.toBe(
      baseline.candidate.candidateIdentitySha256,
    );
    expect(changed.invalidation).toEqual({
      currentCandidateIdentitySha256: changed.candidate.candidateIdentitySha256,
      policySha256: sha("policy:github"),
      previousCandidateIdentitySha256: baseline.candidate.candidateIdentitySha256,
      protocol: "ProviderWatchInvalidationV1",
      sourceId: "github-source",
    });
    expect(
      JSON.parse(canonicalProviderWatchCandidateV1Bytes(changed.candidate).toString("utf8")),
    ).toEqual(changed.candidate);
  });

  it("fails closed before calling a seam for malformed configurations and hostile wrappers", async () => {
    const seam = resolver(resolution("github"));
    let getterCalls = 0;
    const accessor = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(accessor, "configuration", {
      enumerable: true,
      get: () => {
        getterCalls += 1;
        return configuration("github");
      },
    });
    Object.defineProperty(accessor, "resolver", {
      enumerable: true,
      get: () => {
        getterCalls += 1;
        return seam;
      },
    });
    for (const invalid of [
      accessor,
      { configuration: { ...configuration("github"), provider: "gitHub" }, resolver: seam },
      {
        configuration: { ...configuration("github"), watchRef: { kind: "branch", name: "main" } },
        resolver: { resolve: "not-a-function" },
      },
      { configuration: { ...configuration("github"), extra: true }, resolver: seam },
    ])
      await expect(resolveProviderWatchV1(invalid)).rejects.toThrow();
    expect(getterCalls).toBe(0);
    expect(seam.resolve).not.toHaveBeenCalled();
  });

  it("rejects ambiguous Git branch names before calling its resolver", async () => {
    for (const name of [
      "a/../b",
      "a//b",
      "a/",
      "a/./b",
      "a/.b",
      "feature/.hidden/x",
      "a/b.",
      "a/.lock/b",
      "a/b.lock",
      "main@{1}",
    ]) {
      const seam = resolver(resolution("github"));
      await expect(
        resolveProviderWatchV1({
          configuration: {
            ...configuration("github"),
            watchRef: { kind: "branch", name },
          },
          resolver: seam,
        }),
      ).rejects.toThrow();
      expect(seam.resolve).not.toHaveBeenCalled();
    }
  });

  it("fails closed for deleted, redirecting, mutable-only, inconsistent, and oversized resolutions", async () => {
    const valid = resolution("npm");
    for (const rejected of [
      { ...valid, identity: { tag: "latest" } },
      { ...valid, deleted: true },
      { ...valid, redirectTo: "registry.evil/npm/@acme/widget" },
      { ...valid, source: { package: "@acme/other" } },
      { ...valid, watchRef: { kind: "dist-tag", name: "next" } },
      { ...valid, observedMetadata: { note: "x".repeat(65_537) } },
      { ...valid, identity: { integrity: "sha512-not-a-real-integrity", version: "2.4.6" } },
      { ...valid, identity: { integrity: "sha512-YWJjZA==", version: "2.4.6" } },
      { ...valid, identity: { integrity: npmIntegrity.slice(0, -2), version: "2.4.6" } },
    ]) {
      const seam = resolver(rejected);
      await expect(
        resolveProviderWatchV1({ configuration: configuration("npm"), resolver: seam }),
      ).rejects.toThrow();
      expect(seam.resolve).toHaveBeenCalledOnce();
    }
  });

  it("rejects version downgrades and tampered prior candidates without producing work", async () => {
    const initial = await resolveProviderWatchV1({
      configuration: configuration("pypi"),
      resolver: resolver(resolution("pypi")),
    });
    if (initial.kind !== "changed") throw new Error("expected initial candidate");
    const downgrade = resolution("pypi");
    downgrade.identity = {
      filename: "acme_widget-2.4.5-py3-none-any.whl",
      sha256: sha("old-pypi-distribution"),
      version: "2.4.5",
    };
    const downgradeSeam = resolver(downgrade);
    await expect(
      resolveProviderWatchV1({
        configuration: configuration("pypi"),
        lastObservedCandidate: initial.candidate,
        resolver: downgradeSeam,
      }),
    ).rejects.toThrow();
    expect(downgradeSeam.resolve).toHaveBeenCalledOnce();
    const reissued = resolution("pypi");
    reissued.identity = {
      filename: "acme_widget-2.4.6-py3-none-any.whl",
      sha256: sha("reissued-pypi-distribution"),
      version: "2.4.6",
    };
    await expect(
      resolveProviderWatchV1({
        configuration: configuration("pypi"),
        lastObservedCandidate: initial.candidate,
        resolver: resolver(reissued),
      }),
    ).rejects.toThrow();
    const tamperedSeam = resolver(resolution("pypi"));
    await expect(
      resolveProviderWatchV1({
        configuration: configuration("pypi"),
        lastObservedCandidate: { ...initial.candidate, candidateSha256: sha("tampered") },
        resolver: tamperedSeam,
      }),
    ).rejects.toThrow();
    expect(tamperedSeam.resolve).not.toHaveBeenCalled();
  });

  it("compares arbitrarily large version components exactly for downgrades and reissues", async () => {
    const initialResolution = resolution("npm");
    initialResolution.identity = {
      integrity: npmIntegrity,
      version: "9007199254740993.0.0",
    };
    const initial = await resolveProviderWatchV1({
      configuration: configuration("npm"),
      resolver: resolver(initialResolution),
    });
    if (initial.kind !== "changed") throw new Error("expected initial candidate");
    for (const identity of [
      { integrity: alternateNpmIntegrity, version: "9007199254740992.0.0" },
      { integrity: alternateNpmIntegrity, version: "9007199254740993.0.0" },
    ]) {
      const next = resolution("npm");
      next.identity = identity;
      await expect(
        resolveProviderWatchV1({
          configuration: configuration("npm"),
          lastObservedCandidate: initial.candidate,
          resolver: resolver(next),
        }),
      ).rejects.toThrow();
    }
  });
});
