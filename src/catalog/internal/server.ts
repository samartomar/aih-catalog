/**
 * The shape of a Registry `server.json` that Catalog records and lowers: package registries it
 * can launch, their runners and runner flags, package-name grammars and exact versions. The
 * producer checks it when it reads the file, the reader again for recorded content, and the
 * planner launches only what it allows.
 */
import { isRecord } from "./check.js";
import { EXACT_VERSION } from "./source-link.js";

/**
 * The registries Catalog launches: the runner each uses, the runner flags it may carry, the
 * package-name grammar and the pinned spec. Nothing else is launched.
 */
export const RUNNERS: Readonly<
  Record<
    "npm" | "pypi",
    {
      readonly command: string;
      readonly flags: readonly string[];
      readonly name: RegExp;
      readonly spec: (identifier: string, version: string) => string;
    }
  >
> = {
  // npm package names: an optional lowercase scope, then a lowercase name (no leading `.`/`_`).
  npm: {
    command: "npx",
    flags: ["-y", "--yes"],
    name: /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/,
    spec: (identifier, version) => `${identifier}@${version}`,
  },
  // PEP 508 project names: letters and digits, with `.`, `_` or `-` only inside.
  pypi: {
    command: "uvx",
    flags: [],
    name: /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/,
    spec: (identifier, version) => `${identifier}==${version}`,
  },
};

export type Registry = keyof typeof RUNNERS;

/** True for a registry Catalog launches; inherited object keys never count. */
export const isRegistry = (type: unknown): type is Registry =>
  typeof type === "string" && Object.hasOwn(RUNNERS, type);

const isArgument = (entry: unknown): boolean =>
  isRecord(entry) &&
  ((entry.type === "positional" && typeof entry.value === "string") ||
    (entry.type === "named" &&
      typeof entry.name === "string" &&
      entry.name.length > 0 &&
      (entry.value === undefined || typeof entry.value === "string")));

const isNamedList = (value: unknown): boolean =>
  value === undefined ||
  (Array.isArray(value) &&
    value.every((entry) => isRecord(entry) && typeof entry.name === "string"));

/** Why one package entry cannot be recorded, or undefined. */
export function packageProblem(pkg: unknown): string | undefined {
  if (!isRecord(pkg)) return "a package is an object";
  if (typeof pkg.registryType !== "string" || typeof pkg.identifier !== "string")
    return "a package needs registryType and identifier";
  if (typeof pkg.version !== "string" || !EXACT_VERSION.test(pkg.version))
    return "a package needs an exact version, not a range, latest or none";
  if (/@(?:latest|[\^~><=*])|@$/.test(pkg.identifier) || pkg.identifier.includes("@latest"))
    return "the identifier carries a mutable version";
  if (isRegistry(pkg.registryType) && !RUNNERS[pkg.registryType].name.test(pkg.identifier))
    return `the identifier is not a valid ${pkg.registryType} package name`;
  if (pkg.runtimeHint !== undefined && typeof pkg.runtimeHint !== "string")
    return "runtimeHint is text";
  if (pkg.transport !== undefined && !isRecord(pkg.transport)) return "transport is an object";
  for (const key of ["runtimeArguments", "packageArguments"] as const) {
    const list = pkg[key];
    if (list !== undefined && (!Array.isArray(list) || !list.every(isArgument)))
      return `${key} are positional with a value, or named`;
  }
  if (!isNamedList(pkg.environmentVariables)) return "environmentVariables are named entries";
  return undefined;
}

/** Why a recorded server cannot be lowered or kept, or undefined: its shape and pins. */
export function serverProblem(server: unknown): { path: string; message: string } | undefined {
  if (!isRecord(server)) return { path: "", message: "the server is an object" };
  if (server.version !== undefined && typeof server.version !== "string")
    return { path: "/version", message: "version is text" };
  if (server.packages !== undefined) {
    if (!Array.isArray(server.packages))
      return { path: "/packages", message: "packages are a list" };
    for (const [index, pkg] of server.packages.entries()) {
      const message = packageProblem(pkg);
      if (message) return { path: `/packages/${index}`, message };
    }
  }
  if (server.remotes !== undefined) {
    if (!Array.isArray(server.remotes)) return { path: "/remotes", message: "remotes are a list" };
    for (const [index, remote] of server.remotes.entries())
      if (
        !isRecord(remote) ||
        (remote.type !== "streamable-http" && remote.type !== "sse") ||
        typeof remote.url !== "string" ||
        remote.url.length === 0 ||
        !isNamedList(remote.headers)
      )
        return {
          path: `/remotes/${index}`,
          message: "a remote is streamable-http or sse with its url and named headers",
        };
  }
  if (server.packages === undefined && server.remotes === undefined)
    return { path: "", message: "a server needs packages or remotes" };
  return undefined;
}
