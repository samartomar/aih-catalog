/**
 * Declarations for `@aihq/catalog/workflows/nuclei`.
 *
 * Each function returns a new caller-owned Core execution policy (schema
 * `urn:aihq:core:execution-policy:1.0.0`) with one inline recipe that runs the pinned
 * Nuclei helper. Authoring performs no acquisition or execution. Invalid or ambiguous
 * options are refused by throwing an `Error`; no partial policy or diagnostic result
 * is returned.
 */

/** Selected helper platforms. Only x64 is supported on each. */
export type NucleiPlatform = "linux" | "win32";

/** Lowercase hexadecimal SHA-256 (64 characters). */
export type NucleiSha256 = string;

/** Absolute host path (`/...` or `C:\...`), with no control characters or commas. */
export type NucleiAbsolutePath = string;

/** Helper bytes supplied from a Core material root, for example `catalog`. */
export interface NucleiLocalHelperSource {
  kind: "local";
  /** Material root name: `^[A-Za-z0-9][A-Za-z0-9._-]*$`. */
  input: string;
}

/** Helper bytes read from an exact HTTPS Catalog tarball without credentials or fragment. */
export interface NucleiArchiveHelperSource {
  kind: "archive";
  url: string;
  sha256: NucleiSha256;
  /** 1 to 67108864. */
  byteLength: number;
}

/**
 * Pinned helper material, taken from `@aihq/catalog/workflows/nuclei/manifest.json`.
 * `path` must be `workflows/nuclei/bin/linux-x64` or `workflows/nuclei/bin/win32-x64.exe`
 * matching `platform`, prefixed with `package/` for an archive source.
 */
export interface NucleiHelperMaterial {
  id: "nuclei-helper";
  source: NucleiLocalHelperSource | NucleiArchiveHelperSource;
  path: string;
  sha256: NucleiSha256;
  /** 1 to 16777216. */
  byteLength: number;
}

/** Options shared by all three authoring functions. */
export interface NucleiAuthoringOptions {
  platform: NucleiPlatform;
  helper: NucleiHelperMaterial;
  /** Core run deadline in milliseconds, 10000 to 890000. Default 300000. */
  timeoutMs?: number;
}

/** A local file copied into the preparation bundle at a bundle-relative member path. */
export interface NucleiLocalBundleFile {
  source: NucleiAbsolutePath;
  path: string;
}

/** A previously validated preparation bundle to reuse instead of fetching templates. */
export interface NucleiReusedBundle {
  path: NucleiAbsolutePath;
  sha256: NucleiSha256;
  /** 1 to 67108864. */
  byteLength: number;
}

export interface NucleiPreparationBase extends NucleiAuthoringOptions {
  /** New absent preparation output directory. */
  output: NucleiAbsolutePath;
  /** 1 to 67108864. Default 67108864. */
  maxDownloadBytes?: number;
}

/** Fetch the selected official templates and copy the selected custom templates. */
export interface NucleiFreshPreparationOptions extends NucleiPreparationBase {
  reuse?: undefined;
  /**
   * Official HTTP template paths (`http/....yaml`). Default
   * `["http/technologies/tech-detect.yaml"]`. At least one official or custom
   * template must be selected.
   */
  official?: readonly string[];
  /** Declared official data dependency paths. */
  officialData?: readonly string[];
  custom?: readonly NucleiLocalBundleFile[];
  customData?: readonly NucleiLocalBundleFile[];
}

/** Reuse a previously validated bundle. Template selections do not apply. */
export interface NucleiReusePreparationOptions extends NucleiPreparationBase {
  reuse: NucleiReusedBundle;
  official?: undefined;
  officialData?: undefined;
  custom?: undefined;
  customData?: undefined;
}

export type NucleiPreparationOptions =
  | NucleiFreshPreparationOptions
  | NucleiReusePreparationOptions;

/** Docker container and network names owned by one run. */
export type NucleiResourceName = `aih-nuclei-${string}`;

/** Local Docker endpoint: `unix:///...` on Linux, the named pipe on Windows. */
export type NucleiDockerEndpoint = `unix:///${string}` | "npipe:////./pipe/docker_engine";

/** Container network mode for the one target. */
export type NucleiTargetMode = "public" | "private" | "local-host";

/** One reviewed, unauthenticated assessment of one target with a fixed template bundle. */
export interface NucleiAssessmentOptions extends NucleiAuthoringOptions {
  /** New absent run directory for retained reports. */
  runDirectory: NucleiAbsolutePath;
  bundle: NucleiAbsolutePath;
  bundleSha256: NucleiSha256;
  /** 1 to 67108864. */
  bundleBytes: number;
  /** One HTTP(S) URL without credentials or fragment. */
  target: string;
  /** Must include the target's hostname (IPv6 without brackets). */
  allowHosts: readonly string[];
  targetMode: NucleiTargetMode;
  hostGateway: boolean;
  /** Numeric `UID:GID`. */
  containerUser: string;
  daemon: NucleiDockerEndpoint;
  dockerCli: NucleiAbsolutePath;
  image: `projectdiscovery/nuclei@sha256:${string}`;
  container: NucleiResourceName;
  network: NucleiResourceName;
  /** 1 to 4. Default 1. */
  cpus?: number;
  /** 128 to 4096. Default 512. */
  memoryMiB?: number;
  /** 16 to 256. Default 128. */
  pids?: number;
  /** Requests per second, 1 to 20. Default 5. */
  rateLimit?: number;
  /** Nuclei deadline in seconds, bounded below the run deadline less cleanup. */
  toolTimeoutSeconds?: number;
  /** 2 to 60. Default 20. */
  cleanupTimeoutSeconds?: number;
  /** 1024 to 67108864. Default 16777216. */
  maxReportBytes?: number;
}

/** Explicit stop and removal of resources owned by one known run. */
export interface NucleiReconciliationOptions extends NucleiAuthoringOptions {
  runDirectory: NucleiAbsolutePath;
  daemon: string;
  dockerCli: NucleiAbsolutePath;
  container: NucleiResourceName;
  network: NucleiResourceName;
  /** 2 to min(60, run deadline seconds - 6). Default min(20, run deadline seconds - 6). */
  cleanupTimeoutSeconds?: number;
}

/** Helper subcommand a policy runs. */
export type NucleiCommand = "prepare" | "run" | "reconcile";

/** Core literal argument slot. */
export interface NucleiLiteralArgument {
  literal: string;
}

/** Core process invocation of the pinned helper material. */
export interface NucleiHelperInvocation {
  executable: { material: "nuclei-helper" };
  args: NucleiLiteralArgument[];
  cwd: { root: "project"; segments: [] };
  env: Record<string, never>;
  timeoutMs: number;
  maxOutputBytes: number;
  acceptedExitCodes: [0];
}

export interface NucleiRecipeOperation<C extends NucleiCommand> extends NucleiHelperInvocation {
  id: C;
  purpose: string;
  kind: "process.run";
  scope: "project";
  requires: [];
  checks: C extends "run" ? ["validate"] : [];
  effects: string[];
}

/** Assessment-only check that independently validates retained artifacts and cleanup. */
export interface NucleiValidationCheck extends NucleiHelperInvocation {
  id: "validate";
  purpose: string;
  kind: "process.exit";
}

/** Core recipe 1.0.0 carried inline by the policy. */
export interface NucleiRecipe<C extends NucleiCommand> {
  schema: "urn:aihq:core:recipe:1.0.0";
  id: `nuclei-${C}`;
  description: string;
  inputs: Record<string, never>;
  materials: [NucleiHelperMaterial];
  targets: ["project"];
  prerequisites: [{ kind: "platform"; os: NucleiPlatform; architectures: ["x64"] }];
  operations: [NucleiRecipeOperation<C>];
  checks: C extends "run" ? [NucleiValidationCheck] : [];
}

export interface NucleiPolicySelection<C extends NucleiCommand> {
  id: `nuclei-${C}`;
  managementId: `nuclei-${C}`;
  scope: "project";
  requires: [];
  configuration: Record<string, never>;
  /** Set by the caller for Enterprise admission. */
  organizationSelectionId?: string;
  recipe: { inline: NucleiRecipe<C> };
}

/**
 * Core execution policy 1.0.0 with exactly one selection. Authored with
 * `mode: "vibe"`; an Enterprise caller sets `mode` and `organizationSelectionId`.
 */
export interface NucleiExecutionPolicy<C extends NucleiCommand> {
  schema: "urn:aihq:core:execution-policy:1.0.0";
  mode: "vibe" | "enterprise";
  selections: [NucleiPolicySelection<C>];
}

/** Author a template preparation policy. It never assesses a target. @throws Error on invalid options. */
export declare function authorPreparationPolicy(
  options: NucleiPreparationOptions,
): NucleiExecutionPolicy<"prepare">;

/** Author one assessment policy with an artifact validation check. @throws Error on invalid options. */
export declare function authorAssessmentPolicy(
  options: NucleiAssessmentOptions,
): NucleiExecutionPolicy<"run">;

/** Author a reconciliation policy for one known run. @throws Error on invalid options. */
export declare function authorReconciliationPolicy(
  options: NucleiReconciliationOptions,
): NucleiExecutionPolicy<"reconcile">;
