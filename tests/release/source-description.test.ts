import { SOURCE_DESCRIPTION_SCHEMA_ID } from "@aihq/catalog/contracts";
import {
  checkExactSourceIdentity,
  readSourceDescription,
  SOURCE_DESCRIPTION_MAX_BYTES,
  SOURCE_DESCRIPTION_MAX_DEPTH,
} from "@aihq/catalog/source";
import { expect, it } from "vitest";

const canonical = (value: unknown): string =>
  value === null || typeof value !== "object"
    ? JSON.stringify(value)
    : Array.isArray(value)
      ? `[${value.map(canonical).join(",")}]`
      : `{${Object.keys(value)
          .sort()
          .map(
            (key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`,
          )
          .join(",")}}`;
const encode = (document: unknown): Uint8Array =>
  new TextEncoder().encode(`${canonical(document)}\n`);
const COMMIT = "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678";
const SHA = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
/** base64 of 64 zero bytes: one complete sha512 digest. */
const INTEGRITY = `sha512-${"A".repeat(86)}==`;

const description = (locator: unknown, extra: Record<string, unknown> = {}) => ({
  schema: SOURCE_DESCRIPTION_SCHEMA_ID,
  id: "org-example",
  label: "Example source",
  ...extra,
  locator,
});

const read = (document: unknown) => {
  const result = readSourceDescription(encode(document));
  if (!result.valid) throw new Error(`Expected a valid description: ${JSON.stringify(result)}`);
  return result;
};

const refuse = (bytes: Uint8Array) => {
  const result = readSourceDescription(bytes);
  if (result.valid) throw new Error(`Expected a refusal: ${JSON.stringify(result)}`);
  return result;
};

it("publishes the schema id and the byte and depth limits", () => {
  expect(SOURCE_DESCRIPTION_SCHEMA_ID).toBe("urn:aihq:catalog:source-description:1.0.0");
  expect(SOURCE_DESCRIPTION_MAX_BYTES).toBe(64 * 1024);
  expect(SOURCE_DESCRIPTION_MAX_DEPTH).toBe(8);
});

it("reads a git locator with and without a ref", () => {
  const withRef = read(
    description({ kind: "git", repository: "https://github.com/example/mcp-servers", ref: "main" }),
  );
  expect(withRef.description).toEqual({
    schema: SOURCE_DESCRIPTION_SCHEMA_ID,
    id: "org-example",
    label: "Example source",
    locator: { kind: "git", repository: "https://github.com/example/mcp-servers", ref: "main" },
  });
  const withoutRef = read(
    description({ kind: "git", repository: "https://github.com/example/mcp" }),
  );
  expect(withoutRef.description.locator).toEqual({
    kind: "git",
    repository: "https://github.com/example/mcp",
  });
  expect(Object.isFrozen(withRef)).toBe(true);
  expect(Object.isFrozen(withRef.description)).toBe(true);
  expect(Object.isFrozen(withRef.description.locator)).toBe(true);
});

it("reads an npm locator with a mutable version spec and a local locator", () => {
  const npm = read(
    description(
      { kind: "npm", package: "@scope/tool", versionSpec: "^1.2.3" },
      { publisher: "example-org" },
    ),
  );
  expect(npm.description).toEqual({
    schema: SOURCE_DESCRIPTION_SCHEMA_ID,
    id: "org-example",
    label: "Example source",
    publisher: "example-org",
    locator: { kind: "npm", package: "@scope/tool", versionSpec: "^1.2.3" },
  });
  const local = read(description({ kind: "local", label: "my-skills" }));
  expect(local.description.locator).toEqual({ kind: "local", label: "my-skills" });
});

it("saves and re-reads a description for MCP, skill and agent sources unchanged", () => {
  const sources = [
    description(
      { kind: "git", repository: "https://github.com/example/mcp-servers", ref: "main" },
      { id: "mcp", label: "MCP servers" },
    ),
    description({ kind: "npm", package: "example-skill" }, { id: "skill", label: "Skill package" }),
    description({ kind: "local", label: "agent folder" }, { id: "agent", label: "Agent folder" }),
  ];
  for (const source of sources) {
    const bytes = encode(source);
    const first = readSourceDescription(bytes);
    const second = readSourceDescription(bytes);
    expect(first.valid && second.valid).toBe(true);
    if (first.valid && second.valid) expect(second.description).toEqual(first.description);
    // Reading a description yields discovery data only, never an exact identity.
    for (const exact of ["commit", "integrity", "captureSha256", "reachable"]) {
      expect(JSON.stringify(first)).not.toContain(`"${exact}"`);
    }
  }
});

it("refuses a git repository that is not an https URL", () => {
  for (const repository of [
    "http://github.com/example/mcp",
    "ssh://git@github.com/example/mcp",
    "git@github.com:example/mcp.git",
    "git://github.com/example/mcp",
    "https://example.com:bad/repo",
    "https://example.com:99999/repo",
  ]) {
    const result = refuse(encode(description({ kind: "git", repository })));
    expect(result.diagnostics.map((d) => d.reason)).toContain("repository-not-https");
  }
});

it("refuses unknown fields, missing fields and malformed values precisely", () => {
  const unknownField = refuse(
    encode({ ...description({ kind: "local", label: "x" }), policy: "pre-ticked" }),
  );
  expect(unknownField.diagnostics.map((d) => d.reason)).toContain("unknown-field");
  expect(unknownField.diagnostics.map((d) => d.path)).toContain("/policy");

  const missing = refuse(encode({ schema: SOURCE_DESCRIPTION_SCHEMA_ID, id: "org-example" }));
  expect(missing.diagnostics.map((d) => d.reason)).toContain("missing-field");

  const badId = refuse(encode(description({ kind: "local", label: "x" }, { id: "not an id" })));
  expect(badId.diagnostics.map((d) => d.reason)).toContain("invalid-id");

  const emptyLabel = refuse(encode(description({ kind: "local", label: "" })));
  expect(emptyLabel.diagnostics.map((d) => d.reason)).toContain("invalid-label");

  const whitespaceRef = refuse(
    encode(description({ kind: "git", repository: "https://github.com/example/mcp", ref: "a b" })),
  );
  expect(whitespaceRef.diagnostics.map((d) => d.reason)).toContain("invalid-ref");

  const badPackage = refuse(encode(description({ kind: "npm", package: "Not A Package" })));
  expect(badPackage.diagnostics.map((d) => d.reason)).toContain("invalid-package");
});

it("refuses an unknown locator kind naming what is supported", () => {
  const result = refuse(encode(description({ kind: "hg", repository: "https://example.com/x" })));
  expect(result.diagnostics.map((d) => d.reason)).toContain("invalid-locator-kind");
  const diagnostic = result.diagnostics.find((d) => d.reason === "invalid-locator-kind");
  expect(diagnostic?.encountered).toBe("hg");
  expect(diagnostic?.supported).toEqual(["git", "npm", "local"]);
});

it("refuses another format version as a whole with SCHEMA_UNSUPPORTED", () => {
  const result = refuse(
    encode({
      ...description({ kind: "local", label: "x" }),
      schema: "urn:aihq:catalog:source-description:2.0.0",
    }),
  );
  expect(result.diagnostics.map((d) => d.code)).toEqual(["SCHEMA_UNSUPPORTED"]);
  const diagnostic = result.diagnostics[0];
  expect(diagnostic?.encountered).toBe("urn:aihq:catalog:source-description:2.0.0");
  expect(diagnostic?.supported).toEqual([SOURCE_DESCRIPTION_SCHEMA_ID]);
});

it("refuses bytes that are not bounded canonical JSON with one LF", () => {
  const pretty = new TextEncoder().encode(
    `${JSON.stringify(description({ kind: "local", label: "x" }), null, 2)}\n`,
  );
  expect(refuse(pretty).diagnostics.map((d) => d.code)).toEqual(["INPUT_INVALID"]);
  const noLf = new TextEncoder().encode(canonical(description({ kind: "local", label: "x" })));
  expect(refuse(noLf).diagnostics.map((d) => d.reason)).toContain("non-canonical-bytes");
  expect(refuse(new Uint8Array()).diagnostics.map((d) => d.code)).toEqual(["INPUT_INVALID"]);
});

it("accepts each exact source identity kind with its exactness", () => {
  const gitReachable = checkExactSourceIdentity({
    kind: "git",
    repository: "https://github.com/example/mcp",
    commit: COMMIT,
    reachable: true,
  });
  expect(gitReachable).toEqual({
    valid: true,
    identity: {
      kind: "git",
      repository: "https://github.com/example/mcp",
      commit: COMMIT,
      reachable: true,
    },
    diagnostics: [],
  });
  for (const reachable of [false, "unchecked"] as const) {
    const result = checkExactSourceIdentity({
      kind: "git",
      repository: "https://github.com/example/mcp",
      commit: COMMIT,
      reachable,
    });
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.identity.kind).toBe("git");
      if (result.identity.kind === "git") expect(result.identity.reachable).toBe(reachable);
    }
  }
  expect(
    checkExactSourceIdentity({
      kind: "npm",
      package: "@scope/tool",
      version: "1.2.3",
      integrity: INTEGRITY,
    }).valid,
  ).toBe(true);
  expect(checkExactSourceIdentity({ kind: "local", captureSha256: SHA }).valid).toBe(true);
});

it("refuses mutable references and malformed exact identities precisely", () => {
  const branch = checkExactSourceIdentity({
    kind: "git",
    repository: "https://github.com/example/mcp",
    commit: "main",
    reachable: true,
  });
  expect(branch.valid).toBe(false);
  if (!branch.valid) expect(branch.diagnostics.map((d) => d.reason)).toContain("invalid-commit");

  const range = checkExactSourceIdentity({
    kind: "npm",
    package: "tool",
    version: "^1.2.3",
    integrity: INTEGRITY,
  });
  expect(range.valid).toBe(false);
  if (!range.valid) expect(range.diagnostics.map((d) => d.reason)).toContain("version-not-exact");

  const latest = checkExactSourceIdentity({
    kind: "npm",
    package: "tool",
    version: "latest",
    integrity: INTEGRITY,
  });
  expect(latest.valid).toBe(false);
  if (!latest.valid) expect(latest.diagnostics.map((d) => d.reason)).toContain("version-not-exact");

  const noIntegrity = checkExactSourceIdentity({ kind: "npm", package: "tool", version: "1.2.3" });
  expect(noIntegrity.valid).toBe(false);
  if (!noIntegrity.valid)
    expect(noIntegrity.diagnostics.map((d) => d.reason)).toContain("missing-field");

  const badIntegrity = checkExactSourceIdentity({
    kind: "npm",
    package: "tool",
    version: "1.2.3",
    integrity: "md5-dGVzdA==",
  });
  expect(badIntegrity.valid).toBe(false);
  if (!badIntegrity.valid)
    expect(badIntegrity.diagnostics.map((d) => d.reason)).toContain("invalid-integrity");

  const shortIntegrity = checkExactSourceIdentity({
    kind: "npm",
    package: "tool",
    version: "1.2.3",
    integrity: "sha512-a",
  });
  expect(shortIntegrity.valid).toBe(false);
  if (!shortIntegrity.valid)
    expect(shortIntegrity.diagnostics.map((d) => d.reason)).toContain("invalid-integrity");

  const notHttps = checkExactSourceIdentity({
    kind: "git",
    repository: "git@github.com:example/mcp.git",
    commit: COMMIT,
    reachable: true,
  });
  expect(notHttps.valid).toBe(false);
  if (!notHttps.valid)
    expect(notHttps.diagnostics.map((d) => d.reason)).toContain("repository-not-https");

  const malformedHttps = checkExactSourceIdentity({
    kind: "git",
    repository: "https://example.com:99999/repo",
    commit: COMMIT,
    reachable: true,
  });
  expect(malformedHttps.valid).toBe(false);
  if (!malformedHttps.valid)
    expect(malformedHttps.diagnostics.map((d) => d.reason)).toContain("repository-not-https");

  const unknown = checkExactSourceIdentity({ kind: "archive", sha256: SHA });
  expect(unknown.valid).toBe(false);
  if (!unknown.valid) {
    expect(unknown.diagnostics.map((d) => d.reason)).toContain("invalid-kind");
    expect(unknown.diagnostics[0]?.supported).toEqual(["git", "npm", "local"]);
  }

  const extra = checkExactSourceIdentity({
    kind: "local",
    captureSha256: SHA,
    policy: "pre-ticked",
  });
  expect(extra.valid).toBe(false);
  if (!extra.valid) expect(extra.diagnostics.map((d) => d.reason)).toContain("unknown-field");

  const badSha = checkExactSourceIdentity({ kind: "local", captureSha256: "nope" });
  expect(badSha.valid).toBe(false);
  if (!badSha.valid) expect(badSha.diagnostics.map((d) => d.reason)).toContain("invalid-sha256");
});

it("never treats a description as an exact identity", () => {
  const parsed = read(
    description({ kind: "git", repository: "https://github.com/example/mcp", ref: COMMIT }),
  );
  expect(parsed.valid).toBe(true);
  const asIdentity = checkExactSourceIdentity({
    kind: "git",
    repository: "https://github.com/example/mcp",
    ref: COMMIT,
  });
  expect(asIdentity.valid).toBe(false);
  if (!asIdentity.valid)
    expect(asIdentity.diagnostics.map((d) => d.reason)).toEqual(
      expect.arrayContaining(["missing-field", "unknown-field"]),
    );
});
