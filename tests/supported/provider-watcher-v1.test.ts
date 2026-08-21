import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  canonicalProviderWatchCandidateV1Bytes,
  resolveProviderWatchV1,
} from "../../src/supported/provider-watcher-v1.js";

const sha = (label: string): string => createHash("sha256").update(label).digest("hex");

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
        identity: { integrity: "sha512-YWJjZA==", version: "2.4.6" },
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
      previousCandidateIdentitySha256: baseline.candidate.candidateIdentitySha256,
      protocol: "ProviderWatchInvalidationV1",
      sourceId: "github-source",
    });
    expect(canonicalProviderWatchCandidateV1Bytes(changed.candidate).toString("utf8")).toBe(
      JSON.stringify(changed.candidate),
    );
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
    ]) await expect(resolveProviderWatchV1(invalid)).rejects.toThrow();
    expect(getterCalls).toBe(0);
    expect(seam.resolve).not.toHaveBeenCalled();
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
    await expect(
      resolveProviderWatchV1({
        configuration: configuration("pypi"),
        lastObservedCandidate: initial.candidate,
        resolver: resolver(downgrade),
      }),
    ).rejects.toThrow();
    await expect(
      resolveProviderWatchV1({
        configuration: configuration("pypi"),
        lastObservedCandidate: { ...initial.candidate, candidateSha256: sha("tampered") },
        resolver: resolver(resolution("pypi")),
      }),
    ).rejects.toThrow();
  });
});
