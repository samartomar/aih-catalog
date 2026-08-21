import {
  assertStrictJsonValueV1,
  canonicalStrictJsonBytesV1,
  canonicalStrictJsonSha256V1,
  deepFreezeStrictJsonV1,
} from "../contract/strict-json-v1.js";

type JsonRecord = Record<string, unknown>;
type ProviderV1 = "github" | "npm" | "pypi" | "oci";
type ImmutableIdentityV1 = JsonRecord;

export type ProviderWatchCandidateV1 = Readonly<JsonRecord> & {
  candidateIdentitySha256: string;
  candidateSha256: string;
  identity: Readonly<JsonRecord>;
  policySha256: string;
  provider: ProviderV1;
  sourceId: string;
};

export type ProviderWatchResultV1 =
  | Readonly<{
      candidate: ProviderWatchCandidateV1;
      invalidation: Readonly<JsonRecord>;
      kind: "changed";
    }>
  | Readonly<{ candidateIdentitySha256: string; kind: "unchanged" }>;

type ProviderWatchConfigurationV1 = Readonly<{
  policySha256: string;
  provider: ProviderV1;
  source: JsonRecord;
  sourceId: string;
  watchRef: JsonRecord;
  watchConfigurationSha256: string;
}>;

const DIGEST = /^[a-f0-9]{64}$/;
const COMMIT = /^[a-f0-9]{40}$/;
const OCI_DIGEST = /^sha256:[a-f0-9]{64}$/;
const SEMVER = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;
const INTEGRITY = /^sha512-[A-Za-z0-9+/]+={0,2}$/;
const MAX_RESOLUTION_BYTES = 65_536;
const brands = new WeakMap<object, Buffer>();

function fail(label: string): never {
  throw new TypeError(`invalid provider watcher V1: ${label}`);
}

function outerRecord(value: unknown, label: string): JsonRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail(label);
  const prototype = Object.getPrototypeOf(value);
  if (
    (prototype !== Object.prototype && prototype !== null) ||
    Object.getOwnPropertySymbols(value).length !== 0
  ) {
    fail(label);
  }
  for (const key of Object.keys(value)) ownData(value, key, label);
  return value as JsonRecord;
}

function record(value: unknown, label: string): JsonRecord {
  assertStrictJsonValueV1(value, label);
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail(label);
  return structuredClone(value) as JsonRecord;
}

function ownData(value: object, key: string, label: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (descriptor === undefined || !("value" in descriptor)) fail(label);
  return descriptor.value;
}

function keys(value: JsonRecord, expected: readonly string[], label: string): void {
  const actual = Object.keys(value).sort();
  const sorted = [...expected].sort();
  if (actual.length !== sorted.length || actual.some((key, index) => key !== sorted[index]))
    fail(label);
}

function keysWithOptional(
  value: JsonRecord,
  required: readonly string[],
  optional: string,
  label: string,
): void {
  const actual = Object.keys(value).sort();
  const requiredSorted = [...required].sort();
  const allowed = [...requiredSorted, optional].sort();
  if (
    !requiredSorted.every((key) => actual.includes(key)) ||
    actual.some((key) => !allowed.includes(key)) ||
    actual.length < requiredSorted.length
  ) {
    fail(label);
  }
}

function text(value: unknown, label: string, pattern: RegExp): string {
  if (typeof value !== "string" || !pattern.test(value)) fail(label);
  return value;
}

function sha(value: unknown, label: string): string {
  return text(value, label, DIGEST);
}

function npmIntegrity(value: unknown, label: string): string {
  const integrity = text(value, label, INTEGRITY);
  const encoded = integrity.slice("sha512-".length);
  const decoded = Buffer.from(encoded, "base64");
  if (decoded.length !== 64 || decoded.toString("base64") !== encoded) fail(label);
  return integrity;
}

function exactJson(left: unknown, right: unknown): boolean {
  return canonicalStrictJsonBytesV1(left).equals(canonicalStrictJsonBytesV1(right));
}

function boundedRecord(value: unknown, label: string): JsonRecord {
  const parsed = record(value, label);
  if (canonicalStrictJsonBytesV1(parsed).length > MAX_RESOLUTION_BYTES) fail(`${label} bound`);
  return parsed;
}

function provider(value: unknown, label: string): ProviderV1 {
  if (value === "github" || value === "npm" || value === "pypi" || value === "oci") return value;
  fail(label);
}

function sourceFor(providerName: ProviderV1, value: unknown, label: string): JsonRecord {
  const source = record(value, label);
  switch (providerName) {
    case "github":
      keys(source, ["repository"], label);
      return {
        repository: text(
          source.repository,
          label,
          /^[a-z0-9][a-z0-9._-]{0,99}\/[a-z0-9][a-z0-9._-]{0,99}$/,
        ),
      };
    case "npm":
      keys(source, ["package"], label);
      return {
        package: text(
          source.package,
          label,
          /^(?:@[a-z0-9][a-z0-9._-]{0,99}\/)?[a-z0-9][a-z0-9._-]{0,99}$/,
        ),
      };
    case "pypi":
      keys(source, ["project"], label);
      return { project: text(source.project, label, /^[a-z0-9][a-z0-9-]{0,199}$/) };
    case "oci":
      keys(source, ["registry", "repository"], label);
      return {
        registry: text(source.registry, label, /^[a-z0-9][a-z0-9.-]{0,252}$/),
        repository: text(
          source.repository,
          label,
          /^[a-z0-9][a-z0-9._-]{0,99}(?:\/[a-z0-9][a-z0-9._-]{0,99})*$/,
        ),
      };
  }
}

function watchRefFor(providerName: ProviderV1, value: unknown, label: string): JsonRecord {
  const watchRef = record(value, label);
  keys(watchRef, ["kind", "name"], label);
  const expectedKind =
    providerName === "github"
      ? "branch"
      : providerName === "npm"
        ? "dist-tag"
        : providerName === "pypi"
          ? "project"
          : "tag";
  if (watchRef.kind !== expectedKind) fail(label);
  if (providerName === "github") {
    const name = text(watchRef.name, label, /^[a-z0-9][a-z0-9._/-]{0,255}$/);
    const segments = name.split("/");
    if (
      name.includes("..") ||
      name.includes("@{") ||
      name.endsWith(".") ||
      segments.some(
        (segment) => segment.length === 0 || segment.startsWith(".") || segment.endsWith(".lock"),
      )
    ) {
      fail(label);
    }
    return { kind: expectedKind, name };
  }
  const namePattern = providerName === "pypi" ? /^latest$/ : /^[a-z0-9][a-z0-9._-]{0,255}$/;
  return { kind: expectedKind, name: text(watchRef.name, label, namePattern) };
}

function configuration(value: unknown): ProviderWatchConfigurationV1 {
  const input = record(value, "configuration");
  keys(
    input,
    ["policySha256", "protocol", "provider", "source", "sourceId", "watchRef"],
    "configuration fields",
  );
  if (input.protocol !== "ProviderWatchConfigurationV1") fail("configuration protocol");
  const providerName = provider(input.provider, "configuration provider");
  const result = {
    policySha256: sha(input.policySha256, "configuration policy"),
    provider: providerName,
    source: sourceFor(providerName, input.source, "configuration source"),
    sourceId: text(input.sourceId, "configuration source id", /^[a-z][a-z0-9-]{0,255}$/),
    watchRef: watchRefFor(providerName, input.watchRef, "configuration watch ref"),
  };
  return deepFreezeStrictJsonV1({
    ...result,
    watchConfigurationSha256: canonicalStrictJsonSha256V1({
      domain: "aih-supported.provider-watch-configuration-v1",
      value: result,
    }),
  }) as ProviderWatchConfigurationV1;
}

function maximumCandidateBytes(config: ProviderWatchConfigurationV1): number {
  const candidateEnvelope = {
    candidateIdentitySha256: "0".repeat(64),
    candidateSha256: "0".repeat(64),
    identity: {},
    observedMetadata: {},
    policySha256: config.policySha256,
    protocol: "ProviderWatchCandidateV1",
    provider: config.provider,
    source: {},
    sourceId: config.sourceId,
    watchConfigurationSha256: config.watchConfigurationSha256,
  };
  const resolutionEnvelope = {
    identity: {},
    observedMetadata: {},
    protocol: "ProviderWatchResolutionV1",
    provider: config.provider,
    source: {},
    watchRef: config.watchRef,
  };
  return (
    MAX_RESOLUTION_BYTES +
    canonicalStrictJsonBytesV1(candidateEnvelope).length -
    canonicalStrictJsonBytesV1(resolutionEnvelope).length
  );
}

function boundedCandidateRecord(
  value: unknown,
  config: ProviderWatchConfigurationV1,
  label: string,
): JsonRecord {
  const parsed = record(value, label);
  if (canonicalStrictJsonBytesV1(parsed).length > maximumCandidateBytes(config))
    fail(`${label} bound`);
  return parsed;
}

function version(value: unknown, label: string): string {
  return text(value, label, SEMVER);
}

function immutableIdentity(providerName: ProviderV1, value: unknown): ImmutableIdentityV1 {
  const identity = record(value, "resolution identity");
  switch (providerName) {
    case "github":
      keys(identity, ["commit", "treeSha256"], "github identity fields");
      return {
        commit: text(identity.commit, "github commit", COMMIT),
        treeSha256: sha(identity.treeSha256, "github tree"),
      };
    case "npm":
      keys(identity, ["integrity", "version"], "npm identity fields");
      return {
        integrity: npmIntegrity(identity.integrity, "npm integrity"),
        version: version(identity.version, "npm version"),
      };
    case "pypi":
      keys(identity, ["filename", "sha256", "version"], "pypi identity fields");
      return {
        filename: text(identity.filename, "pypi filename", /^[A-Za-z0-9][A-Za-z0-9._+-]{0,255}$/),
        sha256: sha(identity.sha256, "pypi distribution"),
        version: version(identity.version, "pypi version"),
      };
    case "oci": {
      keys(identity, ["indexDigest", "manifests"], "oci identity fields");
      if (
        !Array.isArray(identity.manifests) ||
        identity.manifests.length === 0 ||
        identity.manifests.length > 256
      )
        fail("oci manifests");
      const manifests = identity.manifests.map((entry) => {
        const manifest = record(entry, "oci manifest");
        keys(manifest, ["architecture", "digest", "os"], "oci manifest fields");
        return {
          architecture: text(
            manifest.architecture,
            "oci architecture",
            /^[a-z0-9][a-z0-9._-]{0,63}$/,
          ),
          digest: text(manifest.digest, "oci manifest digest", OCI_DIGEST),
          os: text(manifest.os, "oci os", /^[a-z0-9][a-z0-9._-]{0,63}$/),
        };
      });
      manifests.sort((left, right) => {
        const leftKey = `${left.os}/${left.architecture}`;
        const rightKey = `${right.os}/${right.architecture}`;
        return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
      });
      if (
        new Set(manifests.map((entry) => `${entry.os}/${entry.architecture}`)).size !==
        manifests.length
      )
        fail("duplicate oci platform");
      return { indexDigest: text(identity.indexDigest, "oci index digest", OCI_DIGEST), manifests };
    }
  }
}

function resolution(
  value: unknown,
  config: ProviderWatchConfigurationV1,
): Readonly<{
  identity: ImmutableIdentityV1;
  observedMetadata: JsonRecord;
}> {
  const input = boundedRecord(value, "resolution");
  keys(
    input,
    ["identity", "observedMetadata", "protocol", "provider", "source", "watchRef"],
    "resolution fields",
  );
  if (input.protocol !== "ProviderWatchResolutionV1" || input.provider !== config.provider)
    fail("resolution provider");
  if (!exactJson(sourceFor(config.provider, input.source, "resolution source"), config.source))
    fail("resolution source");
  if (
    !exactJson(
      watchRefFor(config.provider, input.watchRef, "resolution watch ref"),
      config.watchRef,
    )
  )
    fail("resolution watch ref");
  return deepFreezeStrictJsonV1({
    identity: immutableIdentity(config.provider, input.identity),
    observedMetadata: boundedRecord(input.observedMetadata, "observed metadata"),
  });
}

function candidate(
  config: ProviderWatchConfigurationV1,
  resolved: Readonly<{ identity: ImmutableIdentityV1; observedMetadata: JsonRecord }>,
): ProviderWatchCandidateV1 {
  const identityValue = {
    identity: resolved.identity,
    provider: config.provider,
    source: config.source,
    sourceId: config.sourceId,
    watchConfigurationSha256: config.watchConfigurationSha256,
  };
  const candidateIdentitySha256 = canonicalStrictJsonSha256V1({
    domain: "aih-supported.provider-watch-candidate-v1.identity",
    value: identityValue,
  });
  const value = {
    candidateIdentitySha256,
    identity: resolved.identity,
    observedMetadata: resolved.observedMetadata,
    policySha256: config.policySha256,
    protocol: "ProviderWatchCandidateV1" as const,
    provider: config.provider,
    source: config.source,
    sourceId: config.sourceId,
    watchConfigurationSha256: config.watchConfigurationSha256,
  };
  const result = deepFreezeStrictJsonV1({
    ...value,
    candidateSha256: canonicalStrictJsonSha256V1({
      domain: "aih-supported.provider-watch-candidate-v1",
      value,
    }),
  }) as ProviderWatchCandidateV1;
  brands.set(result, canonicalStrictJsonBytesV1(result));
  return result;
}

function priorCandidate(
  value: unknown,
  config: ProviderWatchConfigurationV1,
): ProviderWatchCandidateV1 {
  const input = boundedCandidateRecord(value, config, "prior candidate");
  keys(
    input,
    [
      "candidateIdentitySha256",
      "candidateSha256",
      "identity",
      "observedMetadata",
      "policySha256",
      "protocol",
      "provider",
      "source",
      "sourceId",
      "watchConfigurationSha256",
    ],
    "prior candidate fields",
  );
  if (input.protocol !== "ProviderWatchCandidateV1" || input.provider !== config.provider)
    fail("prior candidate provider");
  if (
    input.sourceId !== config.sourceId ||
    input.policySha256 !== config.policySha256 ||
    input.watchConfigurationSha256 !== config.watchConfigurationSha256 ||
    !exactJson(sourceFor(config.provider, input.source, "prior candidate source"), config.source)
  ) {
    fail("prior candidate configuration");
  }
  const rebuilt = candidate(config, {
    identity: immutableIdentity(config.provider, input.identity),
    observedMetadata: boundedRecord(input.observedMetadata, "prior metadata"),
  });
  if (
    input.candidateIdentitySha256 !== rebuilt.candidateIdentitySha256 ||
    input.candidateSha256 !== rebuilt.candidateSha256
  ) {
    fail("prior candidate digest");
  }
  return rebuilt;
}

function compareVersions(next: string, previous: string): number {
  const nextParts = next.split(".");
  const previousParts = previous.split(".");
  for (let index = 0; index < 3; index += 1) {
    const nextPart = nextParts[index];
    const previousPart = previousParts[index];
    if (nextPart === undefined || previousPart === undefined) fail("version identity");
    if (nextPart.length !== previousPart.length)
      return nextPart.length < previousPart.length ? -1 : 1;
    if (nextPart !== previousPart) return nextPart < previousPart ? -1 : 1;
  }
  return 0;
}

function rejectDowngrade(
  providerName: ProviderV1,
  next: ImmutableIdentityV1,
  previous: ImmutableIdentityV1,
): void {
  if (providerName !== "npm" && providerName !== "pypi") return;
  const nextVersion = next.version;
  const previousVersion = previous.version;
  if (typeof nextVersion !== "string" || typeof previousVersion !== "string")
    fail("version identity");
  if (compareVersions(nextVersion, previousVersion) < 0) fail("version downgrade");
}

function rejectIdentityInconsistency(
  providerName: ProviderV1,
  next: ImmutableIdentityV1,
  previous: ImmutableIdentityV1,
): void {
  const keysByProvider: Record<ProviderV1, readonly string[]> = {
    github: ["commit"],
    npm: ["version"],
    oci: ["indexDigest"],
    pypi: ["version"],
  };
  const stableKeys = keysByProvider[providerName];
  if (stableKeys.every((key) => next[key] === previous[key]) && !exactJson(next, previous))
    fail("provider identity inconsistency");
}

function resolver(value: unknown): {
  resolve: (request: Readonly<{ configuration: ProviderWatchConfigurationV1 }>) => unknown;
} {
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail("resolver");
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) fail("resolver");
  if (
    Object.getOwnPropertySymbols(value).length !== 0 ||
    Object.keys(value).length !== 1 ||
    !Object.hasOwn(value, "resolve")
  )
    fail("resolver");
  const resolve = ownData(value, "resolve", "resolver");
  if (typeof resolve !== "function") fail("resolver");
  return {
    resolve: resolve as (
      request: Readonly<{ configuration: ProviderWatchConfigurationV1 }>,
    ) => unknown,
  };
}

export function canonicalProviderWatchCandidateV1Bytes(value: unknown): Buffer {
  if (typeof value !== "object" || value === null) fail("candidate");
  const expected = brands.get(value);
  if (expected === undefined || !expected.equals(canonicalStrictJsonBytesV1(value)))
    fail("candidate brand");
  return Buffer.from(expected);
}

export async function resolveProviderWatchV1(value: unknown): Promise<ProviderWatchResultV1> {
  const input = outerRecord(value, "watch invocation");
  keysWithOptional(
    input,
    ["configuration", "resolver"],
    "lastObservedCandidate",
    "watch invocation fields",
  );
  const config = configuration(ownData(input, "configuration", "watch invocation"));
  const seam = resolver(ownData(input, "resolver", "watch invocation"));
  const previous = Object.hasOwn(input, "lastObservedCandidate")
    ? priorCandidate(ownData(input, "lastObservedCandidate", "watch invocation"), config)
    : undefined;
  let rawResolution: unknown;
  try {
    rawResolution = await seam.resolve({ configuration: config });
  } catch {
    fail("resolver failure");
  }
  const resolved = resolution(rawResolution, config);
  if (previous !== undefined) {
    rejectDowngrade(config.provider, resolved.identity, previous.identity);
    rejectIdentityInconsistency(config.provider, resolved.identity, previous.identity);
  }
  const next = candidate(config, resolved);
  if (previous?.candidateIdentitySha256 === next.candidateIdentitySha256) {
    return deepFreezeStrictJsonV1({
      candidateIdentitySha256: next.candidateIdentitySha256,
      kind: "unchanged" as const,
    });
  }
  return deepFreezeStrictJsonV1({
    candidate: next,
    invalidation: {
      currentCandidateIdentitySha256: next.candidateIdentitySha256,
      policySha256: config.policySha256,
      previousCandidateIdentitySha256: previous?.candidateIdentitySha256 ?? null,
      protocol: "ProviderWatchInvalidationV1",
      sourceId: config.sourceId,
    },
    kind: "changed" as const,
  });
}
