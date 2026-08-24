import { spawnSync } from "node:child_process";
import { createHash, generateKeyPairSync, type KeyObject, sign, verify } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { runCatalogV2Cli } from "../../src/supported/signed-catalog-v2.js";

const root = resolve(import.meta.dirname, "..", "..");
const coreCommit = "e53fe219002515c092ebb68c5b91c91a2fc6110d";
const schemaSha256 = "27295aee8d8be333abe2c73adc72884b534b1c9980a9b7a39d12be8d34c5caff";
const zeroDigest = "0".repeat(64);
const sha = (value: string | Buffer): string => createHash("sha256").update(value).digest("hex");

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type Head = Readonly<Record<string, unknown>>;
type Signed = Readonly<Record<string, unknown>>;
type Api = Readonly<{
  readonly STRICT_V2_CORE_LOCK: { readonly coreCommit: string; readonly schemaSha256: string };
  createCatalogHeadV2: (value: unknown) => Head;
  canonicalCatalogHeadV2Bytes: (value: unknown) => Buffer;
  parseCatalogHeadV2Json: (value: string) => Head;
  signCatalogHeadV2: (value: unknown) => Signed;
  verifySignedCatalogV2: (value: unknown) => Head;
  inspectSignedCatalogV2: (value: unknown) => unknown;
  planCatalogPromotionV2: (value: unknown) => unknown;
  deriveQualificationBasisV2: (value: unknown) => unknown;
  emitQualificationReceipt: (value: unknown) => Readonly<Record<string, unknown>>;
  canonicalQualificationReceiptBytes: (value: unknown) => Buffer;
  parseQualificationReceiptV2Json: (value: string) => Readonly<Record<string, unknown>>;
  QUALIFICATION_RECEIPT_V2_MAX_BYTES: number;
}>;

type Fixture = Readonly<{
  readonly catalogSignerRoot: Readonly<Record<string, unknown>>;
  readonly privateKey: KeyObject;
  readonly publicKey: KeyObject;
  readonly signer: Readonly<Record<string, unknown>>;
}>;

async function api(): Promise<Api> {
  return (await import("../../src/index.js")) as Api;
}

function canonicalJson(value: Json): string {
  if (value === null || typeof value === "boolean" || typeof value === "number")
    return JSON.stringify(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value)
    .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key] as Json)}`)
    .join(",")}}`;
}

function domainSha256(domain: string, value: Json): string {
  return sha(`${domain}\0${canonicalJson(value)}`);
}

function coreSourceDigest(source: Record<string, unknown>): string {
  return `sha256:${domainSha256("aih-governance-decision-source/v2", source as Json)}`;
}

function coreSubjectDigest(kind: string, id: string, sourceDigest: string): string {
  return `sha256:${domainSha256("aih-governance-decision-subject/v2", {
    id,
    kind,
    sourceDigest,
  })}`;
}

function dssePae(payloadType: string, payload: Buffer): Buffer {
  return Buffer.concat([
    Buffer.from(
      `DSSEv1 ${String(Buffer.byteLength(payloadType, "utf8"))} ${payloadType} ${String(payload.length)} `,
      "utf8",
    ),
    payload,
  ]);
}

function signingFixture(): Fixture {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const spki = publicKey.export({ format: "der", type: "spki" });
  const publicKeySpkiSha256 = sha(spki);
  const signer = {
    class: "administrator-ed25519",
    identity: "administrator:aih-supported/catalog-v2",
    keyId: `ed25519:${publicKeySpkiSha256}`,
    publicKeySpkiSha256,
  };
  return {
    catalogSignerRoot: { ...signer, publicKeySpkiDerBase64: spki.toString("base64") },
    privateKey,
    publicKey,
    signer,
  };
}

function claims(): Record<string, unknown> {
  return {
    environment: "catalog-signing",
    eventName: "workflow_dispatch",
    issuer: "https://token.actions.githubusercontent.com",
    jobWorkflowRef:
      "samartomar/aih-supported/.github/workflows/signed-catalog-v2.yml@refs/heads/main",
    ref: "refs/heads/main",
    repository: "samartomar/aih-supported",
    repositoryId: "987654321",
    repositoryOwnerId: "123456789",
  };
}

function changedClaimValues(): Readonly<Record<string, unknown>> {
  return {
    environment: "different-environment",
    jobWorkflowRef: "samartomar/aih-supported/.github/workflows/other.yml@refs/heads/main",
    ref: "refs/tags/v2",
    repository: "samartomar/other",
    repositoryId: "111111111",
    repositoryOwnerId: "222222222",
  };
}

function coreSubject(
  kind: string,
  id: string,
  source: Record<string, unknown>,
): Record<string, unknown> {
  const sourceDigest = coreSourceDigest(source);
  return {
    id,
    kind,
    source,
    sourceDigest,
    subjectDigest: coreSubjectDigest(kind, id, sourceDigest),
  };
}

function subject(kind = "profile", id = "default-profile"): Record<string, unknown> {
  return coreSubject(kind, id, {
    commit: "0123456789abcdef0123456789abcdef01234567",
    path: "profiles/default.json",
    repository: "samartomar/aih-supported",
    type: "github",
  });
}

function aihSubject(kind = "profile", id = "default-profile"): Record<string, unknown> {
  return coreSubject(kind, id, {
    release: "1.0.0",
    revision: `sha256:${sha("profile:default")}`,
    type: "aih",
  });
}

function coreSourceVariants(): readonly Record<string, unknown>[] {
  const digest = (value: string) => `sha256:${sha(value)}`;
  return [
    {
      commit: "0123456789abcdef0123456789abcdef01234567",
      path: "profiles/default.json",
      repository: "samartomar/aih-supported",
      type: "github",
    },
    {
      integrity: `sha512-${Buffer.alloc(64, 7).toString("base64")}`,
      package: "@aihq/supported",
      registry: "https://registry.npmjs.org/",
      type: "npm",
      version: "1.0.0",
    },
    {
      filename: "aih_supported-1.0.0-py3-none-any.whl",
      package: "aih-supported",
      registry: "https://pypi.org/simple/",
      sha256: digest("pypi-artifact"),
      type: "pypi",
      version: "1.0.0",
    },
    {
      indexDigest: digest("oci-index"),
      manifestDigest: digest("oci-manifest"),
      platform: { architecture: "amd64", os: "linux", variant: "v8" },
      registry: "ghcr.io",
      repository: "samartomar/aih-supported",
      type: "oci",
    },
    {
      contentDigest: digest("remote-content"),
      endpoint: "https://catalog.example.invalid/default.json",
      type: "remote",
    },
    {
      release: "1.0.0",
      revision: digest("aih-revision"),
      type: "aih",
    },
  ];
}

function entry(id = "recipe.default"): Record<string, unknown> {
  return {
    capabilities: {
      commands: ["catalog.verify"],
      egress: ["https://api.github.com"],
      hooks: ["hook.catalog.verify"],
      mcpTools: ["github.get_workflow_run"],
      permissions: ["contents:read"],
    },
    closure: { identity: "closure:default", sha256: sha("closure:default") },
    entryId: id,
    platforms: [{ architecture: "amd64", os: "linux" }],
    prose: { identity: "prose:default", sha256: sha("prose:default") },
    qualification: {
      findings: [{ identity: "finding:clean", sha256: sha("finding:clean") }],
      gaps: [{ identity: "gap:none", sha256: sha("gap:none") }],
      report: { identity: "report:default", sha256: sha("report:default") },
      rights: [{ identity: "right:catalog.read", sha256: sha("right:catalog.read") }],
    },
    recipe: { identity: "recipe:default", sha256: sha("recipe:default") },
    subject: subject(),
    versions: { effect: "2", schema: "2" },
  };
}

function headInput(
  signer: Readonly<Record<string, unknown>>,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    claims: claims(),
    compatibleEffectVersions: ["2"],
    compatibleSchemaVersions: ["2"],
    effectVersion: "2",
    entries: [
      entry("recipe.default"),
      { ...entry("recipe.alpha"), subject: subject("profile", "alpha-profile") },
    ],
    previousCatalogHeadSha256: zeroDigest,
    protocol: "CatalogHeadV2",
    schemaVersion: "2",
    sequence: 0,
    signer,
    validFrom: "2026-08-22T00:00:00Z",
    validUntil: "2026-08-23T00:00:00Z",
    ...overrides,
  };
}

function nextInput(
  lastGood: Head,
  signer: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  return headInput(signer, {
    previousCatalogHeadSha256: lastGood.catalogHeadSha256,
    sequence: (lastGood.sequence as number) + 1,
    validFrom: "2026-08-22T01:00:00Z",
    validUntil: "2026-08-24T00:00:00Z",
  });
}

function changedSurface(lastGood: Head, surface: string): Record<string, unknown> {
  const candidate = structuredClone(
    nextInput(lastGood, lastGood.signer as Record<string, unknown>),
  );
  const first = (candidate.entries as Record<string, unknown>[])[0] as Record<string, unknown>;
  const capabilities = first.capabilities as Record<string, string[]>;
  const qualification = first.qualification as Record<string, unknown>;
  switch (surface) {
    case "claims":
      candidate.claims = { ...(candidate.claims as object), repository: "samartomar/changed" };
      break;
    case "finding":
      qualification.findings = [{ identity: "finding:changed", sha256: sha("finding:changed") }];
      break;
    case "gap":
      qualification.gaps = [{ identity: "gap:changed", sha256: sha("gap:changed") }];
      break;
    case "report":
      qualification.report = { identity: "report:changed", sha256: sha("report:changed") };
      break;
    case "right":
      qualification.rights = [{ identity: "right:changed", sha256: sha("right:changed") }];
      break;
    case "signer":
      candidate.signer = {
        ...(candidate.signer as object),
        keyId: `ed25519:${sha("rotated-signer-spki")}`,
        publicKeySpkiSha256: sha("rotated-signer-spki"),
      };
      break;
    case "closure":
      first.closure = { identity: "closure:changed", sha256: sha("closure:changed") };
      break;
    case "command":
      capabilities.commands = ["catalog.changed"];
      break;
    case "hook":
      capabilities.hooks = ["hook.catalog.changed"];
      break;
    case "mcp-tool":
      capabilities.mcpTools = ["github.changed"];
      break;
    case "egress":
      capabilities.egress = ["https://changed.example"];
      break;
    case "permission":
      capabilities.permissions = ["issues:read"];
      break;
    case "effect":
      candidate.compatibleEffectVersions = ["2", "3"];
      first.versions = { effect: "3", schema: "2" };
      break;
    case "schema":
      candidate.compatibleSchemaVersions = ["2", "3"];
      first.versions = { effect: "2", schema: "3" };
      break;
    case "compatible-effect-versions":
      candidate.compatibleEffectVersions = ["2", "3"];
      break;
    case "compatible-schema-versions":
      candidate.compatibleSchemaVersions = ["2", "3"];
      break;
    case "platform":
      first.platforms = [{ architecture: "arm64", os: "linux" }];
      break;
    case "recipe":
      first.recipe = { identity: "recipe:changed", sha256: sha("recipe:changed") };
      break;
    case "prose":
      first.prose = { identity: "prose:changed", sha256: sha("prose:changed") };
      break;
    default:
      throw new Error(`unknown surface ${surface}`);
  }
  return candidate;
}

function opaqueUnknownEnvelope(fixture: Fixture): Record<string, unknown> {
  const opaque = JSON.parse(
    readFileSync(resolve(root, "tests/contracts/opaque-catalog-head-v2.json"), "utf8"),
  ) as Json;
  const catalogHeadSha256 = sha(canonicalJson(opaque));
  const statement = {
    _type: "https://in-toto.io/Statement/v1",
    predicate: {
      candidateSha256: sha(canonicalJson(opaque)),
      catalogHead: opaque,
      catalogHeadSha256,
      claims: claims(),
      effectVersion: "999",
      protocol: "CatalogHeadV2",
      replayIdentity: `catalog-head:${catalogHeadSha256}:${sha(canonicalJson(opaque))}`,
      schemaVersion: "999",
      signer: fixture.signer,
      validFrom: "2026-08-22T00:00:00Z",
      validUntil: "2026-08-23T00:00:00Z",
    },
    predicateType: "https://aih.dev/SupportedCatalogV2",
    subject: [{ digest: { sha256: catalogHeadSha256 }, name: "aih-supported/CatalogHeadV2" }],
  };
  const payload = Buffer.from(canonicalJson(statement as unknown as Json), "utf8");
  return {
    payload: payload.toString("base64"),
    payloadType: "application/vnd.in-toto+json",
    signatures: [
      {
        keyid: fixture.signer.keyId,
        sig: sign(
          null,
          dssePae("application/vnd.in-toto+json", payload),
          fixture.privateKey as never,
        ).toString("base64"),
      },
    ],
  };
}

function workflowJob(workflow: string, name: string): string {
  const lines = workflow.split(/\r?\n/);
  const start = lines.indexOf(`  ${name}:`);
  if (start < 0) throw new Error(`missing ${name} job`);
  const end = lines.findIndex(
    (line, index) => index > start && /^ {2}[a-z][a-z0-9_-]*:$/.test(line),
  );
  return lines.slice(start + 1, end < 0 ? undefined : end).join("\n");
}

function workflowRunBlocks(workflow: string): readonly string[] {
  const lines = workflow.split(/\r?\n/);
  const blocks: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const match = /^(\s*)run:\s*(.*)$/.exec(lines[index] ?? "");
    if (!match) continue;
    const indentation = match[1]?.length ?? 0;
    const inline = match[2] ?? "";
    const block: string[] = [];
    if (inline !== "|" && inline !== ">" && inline !== "") block.push(inline);
    for (index += 1; index < lines.length; index += 1) {
      const line = lines[index] ?? "";
      if (line.trim() === "") {
        block.push(line);
        continue;
      }
      const childIndentation = /^\s*/.exec(line)?.[0].length ?? 0;
      if (childIndentation <= indentation) {
        index -= 1;
        break;
      }
      block.push(line);
    }
    blocks.push(block.join("\n"));
  }
  return blocks;
}

function workflowEnvBindings(workflow: string): Readonly<Record<string, string>> {
  const lines = workflow.split(/\r?\n/);
  const bindings: Record<string, string> = {};
  for (let index = 0; index < lines.length; index += 1) {
    const env = /^(\s*)env:\s*$/.exec(lines[index] ?? "");
    if (!env) continue;
    const indentation = env[1]?.length ?? 0;
    for (index += 1; index < lines.length; index += 1) {
      const line = lines[index] ?? "";
      if (line.trim() === "") continue;
      const childIndentation = /^\s*/.exec(line)?.[0].length ?? 0;
      if (childIndentation <= indentation) {
        index -= 1;
        break;
      }
      const binding = /^\s*([A-Z][A-Z0-9_]*)\s*:\s*(\$\{\{[^}]+\}\})\s*(?:#.*)?$/.exec(line);
      if (binding?.[1] && binding[2]) bindings[binding[1]] = binding[2];
    }
  }
  return bindings;
}

function npmCli(): string {
  const candidates = [
    process.env.npm_execpath,
    resolve(process.execPath, "..", "node_modules", "npm", "bin", "npm-cli.js"),
    resolve(process.execPath, "..", "..", "lib", "node_modules", "npm", "bin", "npm-cli.js"),
  ];
  for (const candidate of candidates) {
    if (
      candidate &&
      isAbsolute(candidate) &&
      basename(candidate) === "npm-cli.js" &&
      existsSync(candidate)
    )
      return candidate;
  }
  throw new Error("unable to resolve a local npm-cli.js");
}

function canCreateFileAndDirectorySymlinks(): boolean {
  const probe = mkdtempSync(join(tmpdir(), "aih-supported-symlink-probe-"));
  try {
    const fileTarget = resolve(probe, "file-target");
    const directoryTarget = resolve(probe, "directory-target");
    writeFileSync(fileTarget, "probe");
    mkdirSync(directoryTarget);
    symlinkSync(fileTarget, resolve(probe, "file-link"), "file");
    symlinkSync(
      directoryTarget,
      resolve(probe, "directory-link"),
      process.platform === "win32" ? "junction" : "dir",
    );
    return existsSync(resolve(probe, "file-link")) && existsSync(resolve(probe, "directory-link"));
  } catch {
    return false;
  } finally {
    rmSync(probe, { force: true, recursive: true });
  }
}

describe("public signed catalog V2 acceptance contract", () => {
  it("executes the internal CLI boundary directly for coverage without exporting it publicly", async () => {
    const temp = mkdtempSync(join(tmpdir(), "aih-supported-direct-cli-"));
    const output = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    try {
      const publicApi = await api();
      const fixture = signingFixture();
      const candidate = publicApi.createCatalogHeadV2(headInput(fixture.signer));
      const candidatePath = resolve(temp, "candidate.json");
      const signedPath = resolve(temp, "signed.json");
      const privateKeyPath = resolve(temp, "private.pem");
      const rootPath = resolve(temp, "root.json");
      const claimsPath = resolve(temp, "claims.json");
      const signerPath = resolve(temp, "signer.json");
      const generatedPath = resolve(temp, "generated.json");
      writeFileSync(candidatePath, canonicalJson(candidate as Json));
      writeFileSync(privateKeyPath, fixture.privateKey.export({ format: "pem", type: "pkcs8" }));
      if (process.platform !== "win32") chmodSync(privateKeyPath, 0o600);
      writeFileSync(rootPath, canonicalJson(fixture.catalogSignerRoot as Json));
      writeFileSync(claimsPath, canonicalJson(claims() as Json));
      writeFileSync(signerPath, canonicalJson(fixture.signer as Json));
      expect(
        runCatalogV2Cli([
          "sign-candidate",
          "--candidate",
          candidatePath,
          "--private-key",
          privateKeyPath,
          "--output",
          signedPath,
        ]),
      ).toBe(0);
      expect(
        runCatalogV2Cli([
          "inspect",
          "--signed-catalog",
          signedPath,
          "--catalog-signer-root",
          rootPath,
          "--expected-claims",
          claimsPath,
          "--now",
          "2026-08-22T12:00:00Z",
          "--continuity",
          "genesis",
        ]),
      ).toBe(0);
      expect(
        runCatalogV2Cli([
          "generate-candidate",
          "--seed",
          resolve(root, "defaults/default-catalog-v2.json"),
          "--signer",
          signerPath,
          "--claims",
          claimsPath,
          "--valid-from",
          "2026-08-22T00:00:00Z",
          "--valid-until",
          "2026-08-23T00:00:00Z",
          "--sequence",
          "0",
          "--previous-catalog-head-sha256",
          zeroDigest,
          "--output",
          generatedPath,
        ]),
      ).toBe(0);
    } finally {
      output.mockRestore();
      rmSync(temp, { force: true, recursive: true });
    }
  });

  it.skipIf(!canCreateFileAndDirectorySymlinks())(
    "rejects seed and output symlinks through a freshly built packed public CLI without effects",
    () => {
      const temp = mkdtempSync(join(tmpdir(), "aih-supported-symlink-custody-"));
      try {
        const built = spawnSync(process.execPath, [npmCli(), "run", "build"], {
          cwd: root,
          encoding: "utf8",
        });
        expect(built.status).toBe(0);
        const packed = spawnSync(
          process.execPath,
          [npmCli(), "pack", "--json", "--pack-destination", temp],
          { cwd: root, encoding: "utf8" },
        );
        expect(packed.status).toBe(0);
        const packedManifest = (JSON.parse(packed.stdout) as { filename: string }[])[0];
        if (!packedManifest) throw new Error("npm pack produced no manifest");
        const consumer = resolve(temp, "consumer");
        mkdirSync(consumer);
        writeFileSync(resolve(consumer, "package.json"), '{"name":"symlink-custody-consumer"}');
        const installed = spawnSync(
          process.execPath,
          [
            npmCli(),
            "install",
            "--offline",
            "--no-audit",
            "--no-fund",
            "--ignore-scripts",
            resolve(temp, packedManifest.filename),
          ],
          { cwd: consumer, encoding: "utf8" },
        );
        expect(installed.status).toBe(0);
        const installedPackage = resolve(consumer, "node_modules/@aihq/supported");
        const cliPath = resolve(installedPackage, "dist/cli.js");
        const defaultSeedPath = resolve(installedPackage, "defaults/default-catalog-v2.json");
        expect(existsSync(cliPath)).toBe(true);
        expect(existsSync(defaultSeedPath)).toBe(true);

        const fixture = signingFixture();
        const signerPath = resolve(temp, "signer.json");
        const claimsPath = resolve(temp, "claims.json");
        const privateKeyPath = resolve(temp, "signer.pem");
        writeFileSync(signerPath, canonicalJson(fixture.signer as unknown as Json));
        writeFileSync(claimsPath, canonicalJson(claims() as Json));
        writeFileSync(privateKeyPath, fixture.privateKey.export({ format: "pem", type: "pkcs8" }));
        if (process.platform !== "win32") chmodSync(privateKeyPath, 0o600);

        const fixedCandidateArguments = [
          "--signer",
          signerPath,
          "--claims",
          claimsPath,
          "--valid-from",
          "2026-08-22T00:00:00Z",
          "--valid-until",
          "2026-08-23T00:00:00Z",
          "--sequence",
          "0",
          "--previous-catalog-head-sha256",
          zeroDigest,
        ];
        const expectExactFailure = (
          result: { status: number | null; stderr: string; stdout: string },
          error: string,
        ) => {
          expect(result.status).toBe(2);
          expect(result.stdout).toBe("");
          expect(result.stderr).toBe(`error: ${error}\n`);
        };
        const generate = (seed: string, output: string) =>
          spawnSync(
            process.execPath,
            [
              cliPath,
              "generate-candidate",
              "--seed",
              seed,
              ...fixedCandidateArguments,
              "--output",
              output,
            ],
            { cwd: temp, encoding: "utf8" },
          );

        const defaultSeed = JSON.parse(readFileSync(defaultSeedPath, "utf8")) as {
          artifacts: Record<string, string>;
          qualification: {
            findings: string[];
            gaps: string[];
            report: string;
            rights: string[];
          };
        };
        const relativeArtifacts = Object.fromEntries(
          Object.keys(defaultSeed.artifacts)
            .sort()
            .map((kind) => [kind, `artifacts/${kind}.json`]),
        );
        const writeSeed = (directory: string): string => {
          const seedPath = resolve(directory, "seed.json");
          writeFileSync(
            seedPath,
            canonicalJson({ ...defaultSeed, artifacts: relativeArtifacts } as unknown as Json),
          );
          return seedPath;
        };
        const copyArtifact = (directory: string, kind: string) => {
          const target = resolve(directory, relativeArtifacts[kind] as string);
          mkdirSync(dirname(target), { recursive: true });
          writeFileSync(
            target,
            readFileSync(resolve(dirname(defaultSeedPath), defaultSeed.artifacts[kind] as string)),
          );
        };
        const copyEvidence = (directory: string) => {
          for (const evidencePath of [
            defaultSeed.qualification.report,
            ...defaultSeed.qualification.findings,
            ...defaultSeed.qualification.gaps,
            ...defaultSeed.qualification.rights,
          ]) {
            const target = resolve(directory, evidencePath);
            mkdirSync(dirname(target), { recursive: true });
            writeFileSync(target, readFileSync(resolve(dirname(defaultSeedPath), evidencePath)));
          }
        };

        const fileLinkedSeedDirectory = resolve(temp, "file-linked-seed");
        mkdirSync(fileLinkedSeedDirectory, { recursive: true });
        for (const kind of Object.keys(relativeArtifacts)) {
          if (kind !== "profile") copyArtifact(fileLinkedSeedDirectory, kind);
        }
        const outsideProfile = resolve(temp, "outside-profile.json");
        writeFileSync(outsideProfile, "outside seed artifact must not be read");
        const fileLinkedProfile = resolve(
          fileLinkedSeedDirectory,
          relativeArtifacts.profile as string,
        );
        mkdirSync(dirname(fileLinkedProfile), { recursive: true });
        symlinkSync(outsideProfile, fileLinkedProfile, "file");
        const fileLinkedSeed = writeSeed(fileLinkedSeedDirectory);
        expectExactFailure(
          generate(fileLinkedSeed, resolve(temp, "file-linked-candidate.json")),
          "seed-artifact-not-regular",
        );

        const outsideArtifacts = resolve(temp, "outside-artifacts");
        mkdirSync(outsideArtifacts, { recursive: true });
        for (const kind of Object.keys(relativeArtifacts)) {
          writeFileSync(
            resolve(outsideArtifacts, `${kind}.json`),
            readFileSync(resolve(dirname(defaultSeedPath), defaultSeed.artifacts[kind] as string)),
          );
        }
        const directoryLinkedSeedDirectory = resolve(temp, "directory-linked-seed");
        mkdirSync(directoryLinkedSeedDirectory, { recursive: true });
        symlinkSync(
          outsideArtifacts,
          resolve(directoryLinkedSeedDirectory, "artifacts"),
          process.platform === "win32" ? "junction" : "dir",
        );
        const directoryLinkedSeed = writeSeed(directoryLinkedSeedDirectory);
        expectExactFailure(
          generate(directoryLinkedSeed, resolve(temp, "directory-linked-candidate.json")),
          "seed-artifact-not-regular",
        );

        const evidenceLinkedSeedDirectory = resolve(temp, "evidence-linked-seed");
        mkdirSync(evidenceLinkedSeedDirectory, { recursive: true });
        for (const kind of Object.keys(relativeArtifacts))
          copyArtifact(evidenceLinkedSeedDirectory, kind);
        copyEvidence(evidenceLinkedSeedDirectory);
        const linkedReport = resolve(evidenceLinkedSeedDirectory, defaultSeed.qualification.report);
        const outsideReport = resolve(temp, "outside-evidence-report.json");
        writeFileSync(outsideReport, "evidence outside the seed must not be read");
        rmSync(linkedReport);
        symlinkSync(outsideReport, linkedReport, "file");
        expectExactFailure(
          generate(
            writeSeed(evidenceLinkedSeedDirectory),
            resolve(temp, "evidence-linked-candidate.json"),
          ),
          "seed-artifact-not-regular",
        );

        const candidatePath = resolve(temp, "candidate.json");
        expect(generate(defaultSeedPath, candidatePath).status).toBe(0);
        const candidateTarget = resolve(temp, "candidate-target.json");
        const candidateOutput = resolve(temp, "candidate-output.json");
        writeFileSync(candidateTarget, "candidate-target-must-not-change");
        symlinkSync(candidateTarget, candidateOutput, "file");
        expectExactFailure(generate(defaultSeedPath, candidateOutput), "output-exists");
        expect(readFileSync(candidateTarget, "utf8")).toBe("candidate-target-must-not-change");
        const danglingCandidateTarget = resolve(temp, "dangling-candidate-target.json");
        const danglingCandidateOutput = resolve(temp, "dangling-candidate-output.json");
        symlinkSync(danglingCandidateTarget, danglingCandidateOutput, "file");
        expectExactFailure(generate(defaultSeedPath, danglingCandidateOutput), "output-exists");
        expect(existsSync(danglingCandidateTarget)).toBe(false);

        const signedTarget = resolve(temp, "signed-target.json");
        const signedOutput = resolve(temp, "signed-output.json");
        writeFileSync(signedTarget, "signed-target-must-not-change");
        symlinkSync(signedTarget, signedOutput, "file");
        const signedResult = spawnSync(
          process.execPath,
          [
            cliPath,
            "sign-candidate",
            "--candidate",
            candidatePath,
            "--private-key",
            privateKeyPath,
            "--output",
            signedOutput,
          ],
          { cwd: temp, encoding: "utf8" },
        );
        expectExactFailure(signedResult, "output-exists");
        expect(readFileSync(signedTarget, "utf8")).toBe("signed-target-must-not-change");
        const danglingSignedTarget = resolve(temp, "dangling-signed-target.json");
        const danglingSignedOutput = resolve(temp, "dangling-signed-output.json");
        symlinkSync(danglingSignedTarget, danglingSignedOutput, "file");
        expectExactFailure(
          spawnSync(
            process.execPath,
            [
              cliPath,
              "sign-candidate",
              "--candidate",
              candidatePath,
              "--private-key",
              privateKeyPath,
              "--output",
              danglingSignedOutput,
            ],
            { cwd: temp, encoding: "utf8" },
          ),
          "output-exists",
        );
        expect(existsSync(danglingSignedTarget)).toBe(false);

        const outsideOutputDirectory = resolve(temp, "outside-output-directory");
        const linkedOutputParent = resolve(temp, "linked-output-parent");
        mkdirSync(outsideOutputDirectory);
        symlinkSync(
          outsideOutputDirectory,
          linkedOutputParent,
          process.platform === "win32" ? "junction" : "dir",
        );
        const linkedCandidateOutput = resolve(linkedOutputParent, "candidate.json");
        expectExactFailure(generate(defaultSeedPath, linkedCandidateOutput), "unsafe-output-path");
        expect(existsSync(resolve(outsideOutputDirectory, "candidate.json"))).toBe(false);
        const linkedSignedOutput = resolve(linkedOutputParent, "signed-catalog.json");
        expectExactFailure(
          spawnSync(
            process.execPath,
            [
              cliPath,
              "sign-candidate",
              "--candidate",
              candidatePath,
              "--private-key",
              privateKeyPath,
              "--output",
              linkedSignedOutput,
            ],
            { cwd: temp, encoding: "utf8" },
          ),
          "unsafe-output-path",
        );
        expect(existsSync(resolve(outsideOutputDirectory, "signed-catalog.json"))).toBe(false);
      } finally {
        rmSync(temp, { force: true, recursive: true });
      }
    },
    180_000,
  );
  it("exposes the public V2 package/CLI and a Core lock only for qualification-basis derivation", async () => {
    const publicApi = await api();
    const packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as Record<
      string,
      unknown
    >;

    expect(packageJson.name).toBe("@aihq/supported");
    expect(packageJson.bin).toEqual({ "aih-supported": "dist/cli.js" });
    expect(packageJson.publishConfig).toEqual({ access: "public" });
    expect(packageJson.private).toBe(true);
    expect(publicApi.STRICT_V2_CORE_LOCK).toEqual({ coreCommit, schemaSha256 });
    for (const operation of [
      "createCatalogHeadV2",
      "canonicalCatalogHeadV2Bytes",
      "parseCatalogHeadV2Json",
      "signCatalogHeadV2",
      "verifySignedCatalogV2",
      "inspectSignedCatalogV2",
      "planCatalogPromotionV2",
      "deriveQualificationBasisV2",
      "emitQualificationReceipt",
      "canonicalQualificationReceiptBytes",
      "parseQualificationReceiptV2Json",
    ] as const)
      expect(publicApi[operation]).toBeTypeOf("function");
    expect(Object.keys(publicApi).sort()).toEqual([
      "QUALIFICATION_RECEIPT_V2_MAX_BYTES",
      "STRICT_V2_CORE_LOCK",
      "canonicalCatalogHeadV2Bytes",
      "canonicalQualificationReceiptBytes",
      "createCatalogHeadV2",
      "deriveQualificationBasisV2",
      "emitQualificationReceipt",
      "inspectSignedCatalogV2",
      "parseCatalogHeadV2Json",
      "parseQualificationReceiptV2Json",
      "planCatalogPromotionV2",
      "signCatalogHeadV2",
      "verifySignedCatalogV2",
    ]);
    expect(publicApi.QUALIFICATION_RECEIPT_V2_MAX_BYTES).toBe(5970);
    expect(Object.keys(publicApi)).not.toEqual(expect.arrayContaining(["isSupported", "isMember"]));
  });

  it("emits only a deterministic, canonical, catalog-verified V2 qualification receipt", async () => {
    const publicApi = await api();
    const fixture = signingFixture();
    const head = publicApi.createCatalogHeadV2(headInput(fixture.signer));
    const signed = publicApi.signCatalogHeadV2({ head, privateKey: fixture.privateKey });
    const request = {
      catalogSignerRoots: [fixture.catalogSignerRoot],
      entryId: "recipe.default",
      expectedClaims: claims(),
      now: "2026-08-22T12:00:00Z",
      replay: { acceptedIdentities: [] },
      signed,
    };
    const receipt = publicApi.emitQualificationReceipt(request);
    const selected = (head.entries as readonly Record<string, unknown>[]).find(
      (candidate) => candidate.entryId === "recipe.default",
    );
    expect(receipt).toEqual({
      catalogContinuity: {
        catalogHeadDigest: `sha256:${head.catalogHeadSha256}`,
        headValidFrom: head.validFrom,
        headValidUntil: head.validUntil,
        previousCatalogHeadDigest: `sha256:${head.previousCatalogHeadSha256}`,
        replayIdentity: `catalog-head:${head.catalogHeadSha256}:${sha(canonicalJson(head as Json))}`,
        sequence: head.sequence,
        signerKeyId: (head.signer as Record<string, unknown>).keyId,
      },
      entryId: "recipe.default",
      expiresAt: "2026-08-23T00:00:00Z",
      format: "aih-supported-qualification-receipt",
      issuedAt: "2026-08-22T12:00:00Z",
      notBefore: "2026-08-22T12:00:00Z",
      organizationAdmission: "not-authoritative",
      qualificationBasis: publicApi.deriveQualificationBasisV2({
        entryId: "recipe.default",
        head,
      }),
      subject: selected?.subject,
      version: 2,
    });
    const bytes = publicApi.canonicalQualificationReceiptBytes(receipt);
    expect(bytes.toString("utf8")).toBe(canonicalJson(receipt as Json));
    expect(publicApi.emitQualificationReceipt(request)).toEqual(receipt);
    expect(() =>
      publicApi.emitQualificationReceipt({ ...request, entryId: "missing.receipt" }),
    ).toThrow();
    expect(() =>
      publicApi.emitQualificationReceipt({ ...request, now: "2026-08-23T00:00:00Z" }),
    ).toThrow();
    expect(() =>
      publicApi.emitQualificationReceipt({
        ...request,
        replay: {
          acceptedIdentities: [
            `catalog-head:${head.catalogHeadSha256}:${sha(canonicalJson(head as Json))}`,
          ],
        },
      }),
    ).toThrow();
    expect(() =>
      publicApi.canonicalQualificationReceiptBytes({ ...receipt, unexpected: true }),
    ).toThrow();
    expect(() =>
      publicApi.canonicalQualificationReceiptBytes({
        ...receipt,
        qualificationBasis: { ...(receipt.qualificationBasis as object), subjectKind: "tool" },
      }),
    ).toThrow();
    expect(() =>
      publicApi.canonicalQualificationReceiptBytes({
        ...receipt,
        issuedAt: "2026-05-23T12:00:00Z",
        notBefore: "2026-08-22T12:00:00Z",
      }),
    ).toThrow();
  });

  it("accepts only closed canonical V2 receipt bytes and binds all continuity facts to the verified head", async () => {
    const publicApi = await api();
    const fixture = signingFixture();
    const genesis = publicApi.createCatalogHeadV2(headInput(fixture.signer));
    const successor = publicApi.createCatalogHeadV2(nextInput(genesis, fixture.signer));
    const signed = publicApi.signCatalogHeadV2({ head: successor, privateKey: fixture.privateKey });
    const receipt = publicApi.emitQualificationReceipt({
      catalogSignerRoots: [fixture.catalogSignerRoot],
      entryId: "recipe.default",
      expectedClaims: claims(),
      lastAccepted: genesis,
      now: "2026-08-22T12:00:00Z",
      replay: { acceptedIdentities: [] },
      signed,
    });
    const bytes = publicApi.canonicalQualificationReceiptBytes(receipt).toString("utf8");
    expect(publicApi.parseQualificationReceiptV2Json).toBeTypeOf("function");
    expect(publicApi.parseQualificationReceiptV2Json(bytes)).toEqual(receipt);
    expect((receipt.catalogContinuity as Record<string, unknown>).replayIdentity).toBe(
      `catalog-head:${successor.catalogHeadSha256}:${sha(canonicalJson(successor as Json))}`,
    );
    expect((receipt.catalogContinuity as Record<string, unknown>).catalogHeadDigest).toBe(
      (receipt.qualificationBasis as Record<string, unknown>).catalogHeadDigest,
    );
    for (const malformed of [
      `\uFEFF${bytes}`,
      `${bytes}\n`,
      bytes.replace("{", '{"version":2,'),
      bytes.replace('"version":2', '"version":1'),
    ])
      expect(() => publicApi.parseQualificationReceiptV2Json(malformed)).toThrow();
    const continuity = receipt.catalogContinuity as Record<string, unknown>;
    for (const patch of [
      { catalogHeadDigest: `sha256:${sha("wrong-head")}` },
      { previousCatalogHeadDigest: `sha256:${successor.catalogHeadSha256}` },
      { replayIdentity: `catalog-head:${sha("wrong-head")}:${sha("wrong-candidate")}` },
      { sequence: 0 },
      { previousCatalogHeadDigest: `sha256:${zeroDigest}` },
      { sequence: -0 },
      { sequence: Number.MAX_SAFE_INTEGER + 1 },
      { headValidFrom: successor.validUntil },
      { headValidUntil: successor.validFrom },
    ])
      expect(() =>
        publicApi.canonicalQualificationReceiptBytes({
          ...receipt,
          catalogContinuity: { ...continuity, ...patch },
        }),
      ).toThrow();
    expect(() =>
      publicApi.canonicalQualificationReceiptBytes({
        ...receipt,
        unexpected: true,
      }),
    ).toThrow();
    expect(() =>
      publicApi.canonicalQualificationReceiptBytes({
        ...receipt,
        catalogContinuity: { ...continuity, unexpected: true },
      }),
    ).toThrow();
    expect(() =>
      publicApi.canonicalQualificationReceiptBytes({
        ...receipt,
        expiresAt: "2026-08-25T00:00:00Z",
      }),
    ).toThrow();
    expect(() =>
      publicApi.canonicalQualificationReceiptBytes({
        ...receipt,
        issuedAt: "2026-08-22T00:30:00Z",
        notBefore: "2026-08-22T00:30:00Z",
      }),
    ).toThrow();
    const wrongKeyFixture = signingFixture();
    expect(() =>
      publicApi.emitQualificationReceipt({
        catalogSignerRoots: [wrongKeyFixture.catalogSignerRoot],
        entryId: "recipe.default",
        expectedClaims: claims(),
        lastAccepted: genesis,
        now: "2026-08-22T12:00:00Z",
        replay: { acceptedIdentities: [] },
        signed,
      }),
    ).toThrow();
    expect(() =>
      publicApi.emitQualificationReceipt({
        catalogSignerRoots: [
          { ...fixture.catalogSignerRoot, identity: "administrator:wrong-signer-identity" },
        ],
        entryId: "recipe.default",
        expectedClaims: claims(),
        lastAccepted: genesis,
        now: "2026-08-22T12:00:00Z",
        replay: { acceptedIdentities: [] },
        signed,
      }),
    ).toThrow();
    expect(() =>
      publicApi.emitQualificationReceipt({
        catalogSignerRoots: [fixture.catalogSignerRoot],
        entryId: "missing.member",
        expectedClaims: claims(),
        lastAccepted: genesis,
        now: "2026-08-22T12:00:00Z",
        replay: { acceptedIdentities: [] },
        signed,
      }),
    ).toThrow();
  });

  it("accepts the measured V2 byte cap exactly and rejects cap plus one", async () => {
    const publicApi = await api();
    const fixture = signingFixture();
    const signer = {
      ...fixture.signer,
      identity: `administrator:${"a".repeat(242)}`,
    };
    const fixedSource = {
      contentDigest: `sha256:${sha("maximum-receipt-remote-content")}`,
      endpoint: "",
      type: "remote",
    };
    const endpointBytes = 4096 - Buffer.byteLength(canonicalJson(fixedSource), "utf8");
    const source = {
      ...fixedSource,
      endpoint: `https://a/${"a".repeat(endpointBytes - "https://a/".length)}`,
    };
    expect(Buffer.byteLength(canonicalJson(source), "utf8")).toBe(4096);
    const subjectId = `a${"a".repeat(63)}`;
    const entryId = `a${"a".repeat(63)}`;
    const head = publicApi.createCatalogHeadV2(
      headInput(signer, {
        entries: [
          {
            ...entry(entryId),
            subject: coreSubject("profile", subjectId, source),
          },
        ],
      }),
    );
    const receipt = publicApi.emitQualificationReceipt({
      catalogSignerRoots: [
        { ...signer, publicKeySpkiDerBase64: fixture.catalogSignerRoot.publicKeySpkiDerBase64 },
      ],
      entryId,
      expectedClaims: claims(),
      now: "2026-08-22T12:00:00Z",
      replay: { acceptedIdentities: [] },
      signed: publicApi.signCatalogHeadV2({ head, privateKey: fixture.privateKey }),
    });
    const atCap = {
      ...receipt,
      catalogContinuity: {
        ...(receipt.catalogContinuity as Record<string, unknown>),
        previousCatalogHeadDigest: `sha256:${sha("maximum-receipt-predecessor")}`,
        sequence: Number.MAX_SAFE_INTEGER,
      },
    };
    const bytes = publicApi.canonicalQualificationReceiptBytes(atCap).toString("utf8");
    expect(Buffer.byteLength(bytes, "utf8")).toBe(publicApi.QUALIFICATION_RECEIPT_V2_MAX_BYTES);
    expect(publicApi.parseQualificationReceiptV2Json(bytes)).toEqual(atCap);
    expect(() => publicApi.parseQualificationReceiptV2Json(`${bytes}x`)).toThrow();
  });

  it("refuses a canonical source one byte above the closed V2 source-byte limit", async () => {
    const publicApi = await api();
    const fixture = signingFixture();
    const fixedSource = {
      contentDigest: `sha256:${sha("source-byte-cap")}`,
      endpoint: "",
      type: "remote",
    };
    const endpointBytes = 4097 - Buffer.byteLength(canonicalJson(fixedSource), "utf8");
    const source = {
      ...fixedSource,
      endpoint: `https://a/${"a".repeat(endpointBytes - "https://a/".length)}`,
    };
    expect(Buffer.byteLength(canonicalJson(source), "utf8")).toBe(4097);
    expect(() =>
      publicApi.createCatalogHeadV2(
        headInput(fixture.signer, {
          entries: [
            {
              ...entry("recipe.source-cap"),
              subject: coreSubject("profile", "source-cap", source),
            },
          ],
        }),
      ),
    ).toThrow();
  });

  it("emits closed V2 receipt bytes while preserving the exact Core source grammar", async () => {
    const publicApi = await api();
    const fixture = signingFixture();
    const emit = (signer: Record<string, unknown>, sourceValue: Record<string, unknown>) => {
      const sourceType = sourceValue.type as string;
      const head = publicApi.createCatalogHeadV2(
        headInput(signer, {
          entries: [
            {
              ...entry(`recipe.${sourceType}`),
              subject: coreSubject(
                "profile",
                `profile-${sourceType}`,
                structuredClone(sourceValue),
              ),
            },
          ],
        }),
      );
      return publicApi.emitQualificationReceipt({
        catalogSignerRoots: [
          { ...signer, publicKeySpkiDerBase64: fixture.catalogSignerRoot.publicKeySpkiDerBase64 },
        ],
        entryId: `recipe.${sourceType}`,
        expectedClaims: claims(),
        now: "2026-08-22T12:00:00Z",
        replay: { acceptedIdentities: [] },
        signed: publicApi.signCatalogHeadV2({ head, privateKey: fixture.privateKey }),
      });
    };
    const boundarySigner = { ...fixture.signer, identity: `administrator:${"a".repeat(242)}` };
    const variants = coreSourceVariants();
    for (const sourceValue of variants) {
      const receipt = emit(boundarySigner, sourceValue);
      const receiptSubject = receipt.subject as Record<string, unknown>;
      expect(() =>
        publicApi.canonicalQualificationReceiptBytes({
          ...receipt,
          qualificationBasis: {
            ...(receipt.qualificationBasis as Record<string, unknown>),
            catalogSignerIdentity: `administrator:${"a".repeat(243)}`,
          },
        }),
      ).toThrow();
      expect(() =>
        publicApi.canonicalQualificationReceiptBytes({
          ...receipt,
          subject: {
            ...receiptSubject,
            source: { ...(receiptSubject.source as Record<string, unknown>), extra: true },
          },
        }),
      ).toThrow();
    }
    const overlongSigner = { ...fixture.signer, identity: `administrator:${"a".repeat(243)}` };
    expect(() => emit(overlongSigner, variants[0] as Record<string, unknown>)).toThrow();
    const invalidByType: Record<string, Record<string, unknown>> = {
      github: { ...variants[0], path: "../outside.json" },
      npm: { ...variants[1], registry: "https://registry.npmjs.org" },
      pypi: { ...variants[2], registry: "https://pypi.org/simple" },
      oci: { ...variants[3], repository: "aih-supported/Upper" },
      remote: {
        ...variants[4],
        endpoint: "https://catalog.example.invalid/default.json?mutable=1",
      },
      aih: { ...variants[5], release: "01.0.0" },
    };
    for (const sourceValue of Object.values(invalidByType))
      expect(() =>
        publicApi.createCatalogHeadV2(
          headInput(fixture.signer, {
            entries: [
              {
                ...entry(`recipe.invalid-${sourceValue.type as string}`),
                subject: coreSubject(
                  "profile",
                  `invalid-${sourceValue.type as string}`,
                  sourceValue,
                ),
              },
            ],
          }),
        ),
      ).toThrow();
  });

  it("emits qualification receipts only to an exclusive regular output path and never stdout", async () => {
    const publicApi = await api();
    const fixture = signingFixture();
    const head = publicApi.createCatalogHeadV2(headInput(fixture.signer));
    const signed = publicApi.signCatalogHeadV2({ head, privateKey: fixture.privateKey });
    const temp = mkdtempSync(join(tmpdir(), "aih-supported-receipt-cli-"));
    const signedPath = resolve(temp, "signed.json");
    const rootPath = resolve(temp, "root.json");
    const claimsPath = resolve(temp, "claims.json");
    const replayPath = resolve(temp, "replay.json");
    const outputPath = resolve(temp, "receipt.json");
    try {
      writeFileSync(signedPath, canonicalJson(signed as Json));
      writeFileSync(rootPath, canonicalJson(fixture.catalogSignerRoot as Json));
      writeFileSync(claimsPath, canonicalJson(claims() as Json));
      writeFileSync(replayPath, canonicalJson({ acceptedIdentities: [] }));
      const args = [
        "emit-qualification-receipt",
        "--signed-catalog",
        signedPath,
        "--catalog-signer-root",
        rootPath,
        "--expected-claims",
        claimsPath,
        "--now",
        "2026-08-22T12:00:00Z",
        "--continuity",
        "genesis",
        "--replay-state",
        replayPath,
        "--entry-id",
        "recipe.default",
        "--output",
        outputPath,
      ];
      const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
      try {
        expect(runCatalogV2Cli(args)).toBe(0);
        expect(stdout).not.toHaveBeenCalled();
      } finally {
        stdout.mockRestore();
      }
      const bytes = readFileSync(outputPath);
      expect(bytes).toEqual(
        publicApi.canonicalQualificationReceiptBytes(
          publicApi.emitQualificationReceipt({
            catalogSignerRoots: [fixture.catalogSignerRoot],
            entryId: "recipe.default",
            expectedClaims: claims(),
            now: "2026-08-22T12:00:00Z",
            replay: { acceptedIdentities: [] },
            signed,
          }),
        ),
      );
      for (const [name, signedCatalogText] of [
        ["trailing-whitespace", `${canonicalJson(signed as Json)} `],
        ["bom", `\uFEFF${canonicalJson(signed as Json)}`],
        ["pretty", JSON.stringify(signed, null, 2)],
      ] as const) {
        const malformedSignedPath = resolve(temp, `${name}-signed.json`);
        const malformedOutputPath = resolve(temp, `${name}-receipt.json`);
        writeFileSync(malformedSignedPath, signedCatalogText);
        const malformedArgs = args.map((value) =>
          value === signedPath
            ? malformedSignedPath
            : value === outputPath
              ? malformedOutputPath
              : value,
        );
        expect(runCatalogV2Cli(malformedArgs)).toBe(2);
        expect(existsSync(malformedOutputPath)).toBe(false);
      }
      expect(runCatalogV2Cli(args)).toBe(2);
      expect(readFileSync(outputPath)).toEqual(bytes);
      expect(
        runCatalogV2Cli(args.filter((value) => value !== "--replay-state" && value !== replayPath)),
      ).toBe(2);
      const outside = resolve(temp, "outside");
      const linkedParent = resolve(temp, "linked-output");
      mkdirSync(outside);
      symlinkSync(outside, linkedParent, process.platform === "win32" ? "junction" : "dir");
      const linkedArgs = [...args];
      linkedArgs[linkedArgs.indexOf(outputPath)] = resolve(linkedParent, "receipt.json");
      expect(runCatalogV2Cli(linkedArgs)).toBe(2);
      expect(existsSync(resolve(outside, "receipt.json"))).toBe(false);
    } finally {
      rmSync(temp, { force: true, recursive: true });
    }
  });

  it("keeps the qualification receipt as a separately attested protected-workflow subject", () => {
    const workflow = readFileSync(resolve(root, ".github/workflows/signed-catalog-v2.yml"), "utf8");
    const signer = workflowJob(workflow, "sign");
    expect(workflow).toMatch(/qualification_receipt_sha256: \{ required: true, type: string \}/);
    expect(workflow).toMatch(/qualification_receipt_issued_at: \{ required: true, type: string \}/);
    expect(workflow).toMatch(/entry_id: \{ required: true, type: string \}/);
    expect(workflow).toMatch(/skew=\$\(\(observed_epoch - issued_epoch\)\)[\s\S]*skew >= -300/);
    expect(workflow).toMatch(
      /actual_qualification_receipt_sha256[\s\S]*EXPECTED_QUALIFICATION_RECEIPT_SHA256/,
    );
    expect(workflow).toMatch(/emit-qualification-receipt[\s\S]*--replay-state[\s\S]*--output/);
    expect(workflow).toMatch(/QUALIFICATION_RECEIPT_PATH: qualification-receipt-v2\.json/);
    expect(workflow).toMatch(/qualification-receipt-v2\.json/);
    expect(workflow).toMatch(/raw\.byteLength > 5970/);
    expect(workflow).toMatch(/receipt\.version !== 2/);
    expect(workflow).toMatch(/continuity\.replayIdentity !== predicate\.replayIdentity/);
    expect(
      workflow.match(/actions\/attest-build-provenance@4d101475d8b20a2381f78447822ac1eab6504dd8/g),
    ).toHaveLength(2);
    expect(workflow).toMatch(
      /subject-path: \$\{\{ env\.QUALIFICATION_RECEIPT_PATH \}\}[\s\S]*gh attestation verify "\$QUALIFICATION_RECEIPT_PATH"/,
    );
    expect(workflow).toMatch(
      /cmp "\$QUALIFICATION_RECEIPT_PATH" "\$RECOMPUTED_QUALIFICATION_RECEIPT_PATH"/,
    );
    expect(signer).toMatch(
      /QUALIFICATION_RECEIPT_ISSUED_AT:\s*\$\{\{\s*inputs\.qualification_receipt_issued_at\s*\}\}/,
    );
    expect(signer).toMatch(/receipt\.issuedAt !== process\.env\.QUALIFICATION_RECEIPT_ISSUED_AT/);
    expect(signer).toMatch(
      /Date\.parse\(receipt\.notBefore\) > now \|\| now >= Date\.parse\(receipt\.expiresAt\)/,
    );
    expect(signer).toMatch(/Object\.keys\(receipt\).*organizationAdmission/);
    const receiptDigestIndex = signer.indexOf(
      'test "$actual_qualification_receipt_sha256" = "$EXPECTED_QUALIFICATION_RECEIPT_SHA256"',
    );
    const receiptValidityGateIndex = signer.indexOf("receipt.issuedAt !==");
    const firstAttestationIndex = signer.indexOf("actions/attest-build-provenance@");
    expect(receiptDigestIndex).toBeGreaterThanOrEqual(0);
    expect(receiptValidityGateIndex).toBeGreaterThan(receiptDigestIndex);
    expect(firstAttestationIndex).toBeGreaterThan(receiptValidityGateIndex);
    expect(workflow).not.toMatch(/\b(release|publish|create-release|git tag)\b/i);
  });

  it("creates only strict V2 heads with derived Core subjects, member/catalog digests, sorted surfaces, and a zero-digest genesis", async () => {
    const publicApi = await api();
    const fixture = signingFixture();
    const mutableInput = headInput(fixture.signer);
    const head = publicApi.createCatalogHeadV2(mutableInput);
    const inputFirstEntry = (mutableInput.entries as Record<string, unknown>[])[0] as Record<
      string,
      unknown
    >;
    ((inputFirstEntry.subject as Record<string, unknown>).source as Record<string, unknown>).path =
      "changed-after-create.json";
    expect(
      (
        ((head.entries as Record<string, unknown>[])[0]?.subject as Record<string, unknown>)
          .source as Record<string, unknown>
      ).path,
    ).toBe("profiles/default.json");
    const entries = head.entries as readonly Record<string, unknown>[];

    expect(head.previousCatalogHeadSha256).toBe(zeroDigest);
    expect(head).toMatchObject({
      compatibleEffectVersions: ["2"],
      compatibleSchemaVersions: ["2"],
      effectVersion: "2",
      schemaVersion: "2",
    });
    expect(Object.keys(head.claims as object).sort()).toEqual([
      "environment",
      "eventName",
      "issuer",
      "jobWorkflowRef",
      "ref",
      "repository",
      "repositoryId",
      "repositoryOwnerId",
    ]);
    expect(head).toHaveProperty("catalogSha256");
    expect(head).toHaveProperty("catalogHeadSha256");
    expect(head.catalogSha256).not.toBe(head.catalogHeadSha256);
    expect(Object.keys(head.signer as object).sort()).toEqual([
      "class",
      "identity",
      "keyId",
      "publicKeySpkiSha256",
    ]);
    expect(entries.map((item) => item.entryId)).toEqual(["recipe.alpha", "recipe.default"]);
    expect(entries[1]).toMatchObject({
      subject: {
        id: "default-profile",
        kind: "profile",
        source: { type: "github" },
      },
    });
    const defaultEntry = entries[1] as Record<string, unknown>;
    const defaultSubject = defaultEntry.subject as Record<string, unknown>;
    expect(defaultSubject.sourceDigest).toBe(
      coreSourceDigest(defaultSubject.source as Record<string, unknown>),
    );
    expect(defaultSubject.subjectDigest).toBe(
      coreSubjectDigest(
        defaultSubject.kind as string,
        defaultSubject.id as string,
        defaultSubject.sourceDigest as string,
      ),
    );
    const subjectKinds = ["tool", "skill", "mcp", "package", "profile"] as const;
    const sourceVariants = coreSourceVariants();
    const coreSchema = JSON.parse(
      readFileSync(
        resolve(root, "tests/contracts/core/aih-governance-decision-v2.schema.json"),
        "utf8",
      ),
    ) as {
      oneOf: { properties: { subject: { properties: { source: { oneOf: unknown[] } } } } }[];
    };
    const sourceGrammar = coreSchema.oneOf[0]?.properties.subject.properties.source.oneOf;
    expect(sourceGrammar).toHaveLength(6);
    const sourceGrammarTypes = (sourceGrammar ?? [])
      .map(
        (source) =>
          (source as { properties?: { type?: { const?: unknown } } }).properties?.type?.const,
      )
      .sort();
    const coreSourceByType = new Map(
      (sourceGrammar ?? []).map((source) => {
        const definition = source as {
          properties?: {
            commit?: { pattern?: unknown };
            platform?: { properties?: { variant?: { pattern?: unknown } }; required?: unknown[] };
            release?: { pattern?: unknown };
            type?: { const?: unknown };
          };
        };
        return [String(definition.properties?.type?.const), definition] as const;
      }),
    );
    expect(sourceVariants.map((source) => source.type).sort()).toEqual([
      "aih",
      "github",
      "npm",
      "oci",
      "pypi",
      "remote",
    ]);
    expect(sourceGrammarTypes).toEqual(sourceVariants.map((source) => source.type).sort());
    expect(coreSourceByType.get("github")?.properties?.commit?.pattern).toBe(
      "^[0-9a-f]{40}(?:[0-9a-f]{24})?$",
    );
    expect(coreSourceByType.get("aih")?.properties?.release?.pattern).toContain("[1-9]");
    const coreOciPlatform = coreSourceByType.get("oci")?.properties?.platform;
    expect(coreOciPlatform?.required).toEqual(["os", "architecture"]);
    expect(coreOciPlatform?.properties?.variant?.pattern).toBe("^[a-z][a-z0-9-]{0,63}$");
    const githubSource = sourceVariants.find((source) => source.type === "github");
    if (!githubSource) throw new Error("missing github Core source vector");
    for (const kind of subjectKinds)
      for (const source of sourceVariants) {
        const sourceType = source.type as string;
        const id = `${kind}-${sourceType}`;
        const validSubject = coreSubject(kind, id, structuredClone(source));
        const validHead = publicApi.createCatalogHeadV2(
          headInput(fixture.signer, {
            entries: [{ ...entry(`recipe.${kind}-${sourceType}`), subject: validSubject }],
          }),
        );
        const createdSubject = (validHead.entries as Record<string, unknown>[])[0]
          ?.subject as Record<string, unknown>;
        expect(createdSubject.sourceDigest).toBe(
          coreSourceDigest(createdSubject.source as Record<string, unknown>),
        );
        expect(createdSubject.subjectDigest).toBe(
          coreSubjectDigest(
            createdSubject.kind as string,
            createdSubject.id as string,
            createdSubject.sourceDigest as string,
          ),
        );
      }
    const createHeadWithSubject = (value: Record<string, unknown>) =>
      publicApi.createCatalogHeadV2(
        headInput(fixture.signer, { entries: [{ ...entry(), subject: value }] }),
      );
    for (const [kind, id] of [
      ["unknown", "valid-id"],
      ["profile", "Invalid"],
      ["profile", "a".repeat(65)],
    ] as readonly (readonly [string, string])[])
      expect(() =>
        createHeadWithSubject(coreSubject(kind, id, structuredClone(githubSource))),
      ).toThrow();
    expect(() =>
      createHeadWithSubject(
        coreSubject("profile", "valid-id", { type: "unknown", value: "forbidden" }),
      ),
    ).toThrow();
    for (const source of sourceVariants) {
      for (const required of Object.keys(source)) {
        const malformed = structuredClone(source);
        delete malformed[required];
        const requiredIdentity = required.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
        expect(() =>
          createHeadWithSubject(
            coreSubject(
              "profile",
              `missing-${source.type as string}-${requiredIdentity}`,
              malformed,
            ),
          ),
        ).toThrow();
      }
      const withExtra = { ...source, extra: "forbidden" };
      expect(() =>
        createHeadWithSubject(coreSubject("profile", `extra-${source.type as string}`, withExtra)),
      ).toThrow();
      if (source.type === "oci") {
        const platform = source.platform as Record<string, unknown>;
        for (const required of ["architecture", "os"]) {
          const malformedPlatform = { ...platform };
          delete malformedPlatform[required];
          expect(() =>
            createHeadWithSubject(
              coreSubject("profile", `missing-oci-platform-${required}`, {
                ...source,
                platform: malformedPlatform,
              }),
            ),
          ).toThrow();
        }
        expect(() =>
          createHeadWithSubject(
            coreSubject("profile", "extra-oci-platform", {
              ...source,
              platform: { ...platform, extra: "forbidden" },
            }),
          ),
        ).toThrow();
      }
    }
    const entryWithoutMember = { ...defaultEntry };
    delete entryWithoutMember.memberSha256;
    expect(defaultEntry.memberSha256).toBe(
      domainSha256("aih-supported-catalog-member/v2", entryWithoutMember as Json),
    );
    expect(head.catalogSha256).toBe(domainSha256("aih-supported-catalog/v2", head.entries as Json));
    const headWithoutDigest = { ...head };
    delete headWithoutDigest.catalogHeadSha256;
    expect(head.catalogHeadSha256).toBe(
      domainSha256("aih-supported-catalog-head/v2", headWithoutDigest as Json),
    );
    expect((entries[1]?.capabilities as Record<string, string[]>).commands).toEqual([
      "catalog.verify",
    ]);
    expect(
      publicApi.parseCatalogHeadV2Json(
        publicApi.canonicalCatalogHeadV2Bytes(head).toString("utf8"),
      ),
    ).toEqual(head);
    expect(() =>
      publicApi.createCatalogHeadV2(
        headInput(fixture.signer, { validUntil: "2026-11-20T00:00:00Z" }),
      ),
    ).not.toThrow();
    for (const nonCanonical of [
      ` ${publicApi.canonicalCatalogHeadV2Bytes(head).toString("utf8")}`,
      `\ufeff${publicApi.canonicalCatalogHeadV2Bytes(head).toString("utf8")}`,
      '{"sequence":0,"sequence":0}',
    ])
      expect(() => publicApi.parseCatalogHeadV2Json(nonCanonical)).toThrow();
    for (const malformedCanonicalHead of [
      { ...head, catalogHeadSha256: sha("wrong-canonical-head") },
      { ...head, extra: true },
      { ...head, entries: [...(head.entries as Record<string, unknown>[])].reverse() },
      {
        ...head,
        entries: [
          ...(head.entries as Record<string, unknown>[]),
          (head.entries as Record<string, unknown>[])[0],
        ],
      },
    ])
      expect(() =>
        publicApi.parseCatalogHeadV2Json(canonicalJson(malformedCanonicalHead as Json)),
      ).toThrow();
    for (const malformed of [
      headInput({ ...fixture.signer, keyId: "ed25519:wrong" }),
      headInput({ ...fixture.signer, privateKey: "forbidden" }),
      headInput(fixture.signer, { entries: [{ ...entry(), evidence: [] }] }),
      headInput(fixture.signer, {
        entries: [{ ...entry(), memberSha256: sha("caller-supplied") }],
      }),
      headInput(fixture.signer, {
        entries: [
          {
            ...entry(),
            capabilities: { ...(entry().capabilities as object), commands: ["z", "a"] },
          },
        ],
      }),
      headInput(fixture.signer, {
        entries: [
          {
            ...entry(),
            capabilities: { ...(entry().capabilities as object), unknownCapability: ["forbidden"] },
          },
        ],
      }),
      headInput(fixture.signer, { previousCatalogHeadSha256: sha("not-genesis") }),
      headInput(fixture.signer, { sequence: 1 }),
      headInput(fixture.signer, { unexpectedTopLevel: true }),
      headInput(fixture.signer, { compatibleEffectVersions: [] }),
      headInput(fixture.signer, { compatibleSchemaVersions: [] }),
      headInput(fixture.signer, { compatibleEffectVersions: ["2", "2"] }),
      headInput(fixture.signer, { compatibleEffectVersions: ["3", "2"] }),
      headInput(fixture.signer, { compatibleSchemaVersions: ["3", "2"] }),
      headInput(fixture.signer, { compatibleSchemaVersions: ["2", "2"] }),
      headInput(fixture.signer, { compatibleEffectVersions: ["3"] }),
      headInput(fixture.signer, { compatibleSchemaVersions: ["3"] }),
      headInput(fixture.signer, { effectVersion: "999" }),
      headInput(fixture.signer, { schemaVersion: "999" }),
      headInput(fixture.signer, { entries: [] }),
      headInput(fixture.signer, { entries: [entry("recipe.default"), entry("recipe.default")] }),
      headInput(fixture.signer, { entries: [{ ...entry(), entryId: "UPPER" }] }),
      headInput(fixture.signer, { validFrom: "2026-08-22T00:00:00+00:00" }),
      headInput(fixture.signer, { validFrom: "2026-08-22T00:00:00.1Z" }),
      headInput(fixture.signer, { validFrom: "2026-08-23T00:00:00Z" }),
      headInput(fixture.signer, { validUntil: "2026-11-20T00:00:01Z" }),
      headInput(fixture.signer, { sequence: -1 }),
      headInput(fixture.signer, { sequence: 1.5 }),
      headInput(fixture.signer, { sequence: -0 }),
      headInput(fixture.signer, { sequence: 1e100 }),
      headInput({ ...fixture.signer, keyId: `ed25519:${sha("mismatch")}` }),
      headInput(fixture.signer, { previousCatalogHeadSha256: "A".repeat(64) }),
      headInput(fixture.signer, {
        entries: [{ ...entry(), versions: { effect: "3", schema: "2" } }],
      }),
      headInput(fixture.signer, {
        entries: [
          {
            ...entry(),
            subject: { ...subject(), sourceDigest: `sha256:${"A".repeat(64)}` },
          },
        ],
      }),
      headInput(fixture.signer, {
        entries: [{ ...entry(), subject: { ...subject(), unexpectedSubjectKey: true } }],
      }),
      headInput(fixture.signer, {
        entries: [{ ...entry(), platforms: [{ architecture: "amd64", os: "linux", extra: true }] }],
      }),
      headInput(fixture.signer, {
        entries: [{ ...entry(), versions: { effect: "2", schema: "2", extra: true } }],
      }),
      headInput(fixture.signer, {
        entries: [
          { ...entry(), qualification: { ...(entry().qualification as object), extra: [] } },
        ],
      }),
      headInput(fixture.signer, {
        entries: [{ ...entry(), closure: { ...(entry().closure as object), extra: true } }],
      }),
      headInput(fixture.signer, {
        entries: [{ ...entry(), recipe: { ...(entry().recipe as object), extra: true } }],
      }),
      headInput(fixture.signer, {
        entries: [{ ...entry(), prose: { ...(entry().prose as object), extra: true } }],
      }),
      headInput(fixture.signer, {
        entries: [{ ...entry(), closure: { identity: "closure:é", sha256: sha("closure:é") } }],
      }),
      headInput(fixture.signer, {
        entries: [
          { ...entry(), prose: { identity: "prose:e\u0301", sha256: sha("prose:e\u0301") } },
        ],
      }),
      headInput(fixture.signer, {
        entries: [
          {
            ...entry(),
            recipe: { identity: "recipe:\u0000control", sha256: sha("recipe:control") },
          },
        ],
      }),
      headInput(fixture.signer, {
        entries: [
          {
            ...entry(),
            subject: { ...subject(), subjectDigest: `sha256:${"A".repeat(64)}` },
          },
        ],
      }),
      headInput(fixture.signer, {
        entries: [
          {
            ...entry(),
            capabilities: { ...(entry().capabilities as object), egress: ["http://example.com"] },
          },
        ],
      }),
    ])
      expect(() => publicApi.createCatalogHeadV2(malformed)).toThrow();
    const without = (value: Record<string, unknown>, key: string): Record<string, unknown> => {
      const result = { ...value };
      delete result[key];
      return result;
    };
    for (const key of [
      "claims",
      "compatibleEffectVersions",
      "compatibleSchemaVersions",
      "effectVersion",
      "entries",
      "previousCatalogHeadSha256",
      "protocol",
      "schemaVersion",
      "sequence",
      "signer",
      "validFrom",
      "validUntil",
    ])
      expect(() =>
        publicApi.createCatalogHeadV2(without(headInput(fixture.signer), key)),
      ).toThrow();
    for (const key of [
      "capabilities",
      "closure",
      "entryId",
      "platforms",
      "prose",
      "qualification",
      "recipe",
      "subject",
      "versions",
    ])
      expect(() =>
        publicApi.createCatalogHeadV2(
          headInput(fixture.signer, { entries: [without(entry(), key)] }),
        ),
      ).toThrow();
    for (const key of ["commands", "egress", "hooks", "mcpTools", "permissions"])
      expect(() =>
        publicApi.createCatalogHeadV2(
          headInput(fixture.signer, {
            entries: [
              {
                ...entry(),
                capabilities: without(entry().capabilities as Record<string, unknown>, key),
              },
            ],
          }),
        ),
      ).toThrow();
    for (const key of ["findings", "gaps", "rights"])
      expect(() =>
        publicApi.createCatalogHeadV2(
          headInput(fixture.signer, {
            entries: [
              {
                ...entry(),
                qualification: without(entry().qualification as Record<string, unknown>, key),
              },
            ],
          }),
        ),
      ).toThrow();
    for (const key of ["class", "identity", "keyId", "publicKeySpkiSha256"])
      expect(() =>
        publicApi.createCatalogHeadV2(headInput(without(fixture.signer, key))),
      ).toThrow();
    for (const key of ["id", "kind", "source", "sourceDigest", "subjectDigest"])
      expect(() =>
        publicApi.createCatalogHeadV2(
          headInput(fixture.signer, {
            entries: [{ ...entry(), subject: without(subject(), key) }],
          }),
        ),
      ).toThrow();
    for (const key of ["commit", "path", "repository", "type"])
      expect(() =>
        (() => {
          const reducedSource = without(subject().source as Record<string, unknown>, key);
          const sourceDigest = coreSourceDigest(reducedSource);
          return publicApi.createCatalogHeadV2(
            headInput(fixture.signer, {
              entries: [
                {
                  ...entry(),
                  subject: {
                    ...subject(),
                    source: reducedSource,
                    sourceDigest,
                    subjectDigest: coreSubjectDigest("profile", "default-profile", sourceDigest),
                  },
                },
              ],
            }),
          );
        })(),
      ).toThrow();
    for (const key of ["release", "revision", "type"])
      expect(() =>
        (() => {
          const reducedSource = without(aihSubject().source as Record<string, unknown>, key);
          const sourceDigest = coreSourceDigest(reducedSource);
          return publicApi.createCatalogHeadV2(
            headInput(fixture.signer, {
              entries: [
                {
                  ...entry(),
                  subject: {
                    ...aihSubject(),
                    source: reducedSource,
                    sourceDigest,
                    subjectDigest: coreSubjectDigest("profile", "default-profile", sourceDigest),
                  },
                },
              ],
            }),
          );
        })(),
      ).toThrow();
    for (const key of ["architecture", "os"])
      expect(() =>
        publicApi.createCatalogHeadV2(
          headInput(fixture.signer, {
            entries: [
              { ...entry(), platforms: [without({ architecture: "amd64", os: "linux" }, key)] },
            ],
          }),
        ),
      ).toThrow();
    for (const key of ["effect", "schema"])
      expect(() =>
        publicApi.createCatalogHeadV2(
          headInput(fixture.signer, {
            entries: [
              { ...entry(), versions: without(entry().versions as Record<string, unknown>, key) },
            ],
          }),
        ),
      ).toThrow();
    for (const descriptor of ["closure", "recipe", "prose"] as const)
      for (const key of ["identity", "sha256"])
        expect(() =>
          publicApi.createCatalogHeadV2(
            headInput(fixture.signer, {
              entries: [
                {
                  ...entry(),
                  [descriptor]: without(entry()[descriptor] as Record<string, unknown>, key),
                },
              ],
            }),
          ),
        ).toThrow();
    for (const evidence of ["findings", "gaps", "rights"] as const)
      for (const key of ["identity", "sha256"])
        expect(() => {
          const qualification = entry().qualification as Record<string, Record<string, unknown>[]>;
          return publicApi.createCatalogHeadV2(
            headInput(fixture.signer, {
              entries: [
                {
                  ...entry(),
                  qualification: {
                    ...qualification,
                    [evidence]: [without(qualification[evidence]?.[0] ?? {}, key)],
                  },
                },
              ],
            }),
          );
        }).toThrow();
    for (const capability of ["commands", "egress", "hooks", "mcpTools", "permissions"] as const) {
      const base = entry();
      const capabilities = base.capabilities as Record<string, string[]>;
      const capabilityValue = capabilities[capability]?.[0];
      if (!capabilityValue) throw new Error(`missing ${capability} fixture value`);
      expect(() =>
        publicApi.createCatalogHeadV2(
          headInput(fixture.signer, {
            entries: [
              {
                ...base,
                capabilities: {
                  ...capabilities,
                  [capability]: [capabilityValue, capabilityValue],
                },
              },
            ],
          }),
        ),
      ).toThrow();
    }
    for (const qualificationSurface of ["findings", "gaps", "rights"] as const) {
      const base = entry();
      const qualification = base.qualification as Record<string, Record<string, unknown>[]>;
      const qualificationValue = qualification[qualificationSurface]?.[0];
      if (!qualificationValue) throw new Error(`missing ${qualificationSurface} fixture value`);
      expect(() =>
        publicApi.createCatalogHeadV2(
          headInput(fixture.signer, {
            entries: [
              {
                ...base,
                qualification: {
                  ...qualification,
                  [qualificationSurface]: [qualificationValue, qualificationValue],
                },
              },
            ],
          }),
        ),
      ).toThrow();
    }
    for (const capability of ["commands", "egress", "hooks", "mcpTools", "permissions"] as const) {
      const values = Array.from({ length: 64 }, (_, index) => {
        const suffix = String(index).padStart(2, "0");
        if (capability === "egress") return `https://example.invalid/${suffix}`;
        if (capability === "permissions") return `contents:${suffix}`;
        return `${capability}.${suffix}`;
      });
      const base = entry();
      const capabilities = base.capabilities as Record<string, string[]>;
      const extraValue =
        capability === "egress"
          ? "https://example.invalid/64"
          : capability === "permissions"
            ? "contents:64"
            : `${capability}.64`;
      expect(() =>
        publicApi.createCatalogHeadV2(
          headInput(fixture.signer, {
            entries: [{ ...base, capabilities: { ...capabilities, [capability]: values } }],
          }),
        ),
      ).not.toThrow();
      expect(() =>
        publicApi.createCatalogHeadV2(
          headInput(fixture.signer, {
            entries: [
              { ...base, capabilities: { ...capabilities, [capability]: [...values, extraValue] } },
            ],
          }),
        ),
      ).toThrow();
    }
    for (const qualificationSurface of ["findings", "gaps", "rights"] as const) {
      const values = Array.from({ length: 64 }, (_, index) => {
        const identity = `${qualificationSurface.slice(0, -1)}:${String(index).padStart(2, "0")}`;
        return { identity, sha256: sha(identity) };
      });
      const base = entry();
      const qualification = base.qualification as Record<string, Record<string, unknown>[]>;
      const extraIdentity = `${qualificationSurface.slice(0, -1)}:64`;
      expect(() =>
        publicApi.createCatalogHeadV2(
          headInput(fixture.signer, {
            entries: [
              { ...base, qualification: { ...qualification, [qualificationSurface]: values } },
            ],
          }),
        ),
      ).not.toThrow();
      expect(() =>
        publicApi.createCatalogHeadV2(
          headInput(fixture.signer, {
            entries: [
              {
                ...base,
                qualification: {
                  ...qualification,
                  [qualificationSurface]: [
                    ...values,
                    { identity: extraIdentity, sha256: sha(extraIdentity) },
                  ],
                },
              },
            ],
          }),
        ),
      ).toThrow();
    }
    for (const noncanonicalEgress of [
      "https://EXAMPLE.invalid/path",
      "https://example.invalid/path/",
      "https://example.invalid:443/path",
      "https://example.invalid/path?query=1",
      "https://example.invalid/path#fragment",
    ])
      expect(() =>
        publicApi.createCatalogHeadV2(
          headInput(fixture.signer, {
            entries: [
              {
                ...entry(),
                capabilities: { ...(entry().capabilities as object), egress: [noncanonicalEgress] },
              },
            ],
          }),
        ),
      ).toThrow();
    for (const malformedDigestEntry of [
      { ...entry(), closure: { identity: "closure:default", sha256: "a".repeat(63) } },
      { ...entry(), prose: { identity: "prose:default", sha256: "A".repeat(64) } },
      { ...entry(), recipe: { identity: "recipe:default", sha256: "A".repeat(64) } },
      {
        ...entry(),
        qualification: {
          ...(entry().qualification as object),
          findings: [{ identity: "finding:clean", sha256: "A".repeat(64) }],
        },
      },
      {
        ...entry(),
        qualification: {
          ...(entry().qualification as object),
          gaps: [{ identity: "gap:none", sha256: "a".repeat(63) }],
        },
      },
      {
        ...entry(),
        qualification: {
          ...(entry().qualification as object),
          rights: [{ identity: "right:catalog.read", sha256: "A".repeat(64) }],
        },
      },
    ])
      expect(() =>
        publicApi.createCatalogHeadV2(
          headInput(fixture.signer, { entries: [malformedDigestEntry] }),
        ),
      ).toThrow();
    const invalidAihSource = {
      release: "1.0.0",
      revision: `sha256:${"A".repeat(64)}`,
      type: "aih",
    };
    const invalidAihSourceDigest = coreSourceDigest(invalidAihSource);
    expect(() =>
      publicApi.createCatalogHeadV2(
        headInput(fixture.signer, {
          entries: [
            {
              ...entry(),
              subject: {
                id: "default-profile",
                kind: "profile",
                source: invalidAihSource,
                sourceDigest: invalidAihSourceDigest,
                subjectDigest: coreSubjectDigest(
                  "profile",
                  "default-profile",
                  invalidAihSourceDigest,
                ),
              },
            },
          ],
        }),
      ),
    ).toThrow();
    expect(() =>
      publicApi.createCatalogHeadV2(
        headInput({
          ...fixture.signer,
          keyId: `ed25519:${"A".repeat(64)}`,
          publicKeySpkiSha256: "A".repeat(64),
        }),
      ),
    ).toThrow();
    for (const malformedClaims of [
      {},
      { ...claims(), extra: "forbidden" },
      { ...claims(), issuer: "https://issuer.invalid" },
      { ...claims(), repositoryId: "not-a-decimal-id" },
      { ...claims(), repositoryOwnerId: "not-a-decimal-id" },
      { ...claims(), sha: "forbidden-outer-attestation-field" },
      { ...claims(), jobWorkflowSha: "forbidden-outer-attestation-field" },
      { ...claims(), runAttempt: 1 },
      { ...claims(), runId: "1" },
      ...Object.keys(claims()).map((missing) =>
        Object.fromEntries(Object.entries(claims()).filter(([key]) => key !== missing)),
      ),
      { ...claims(), repository: "SAMARTOMAR/aih-supported" },
      { ...claims(), ref: "main" },
      { ...claims(), jobWorkflowRef: "not-a-workflow-ref" },
      { ...claims(), eventName: "push" },
      { ...claims(), environment: "Catalog Signing" },
    ])
      expect(() =>
        publicApi.createCatalogHeadV2(headInput(fixture.signer, { claims: malformedClaims })),
      ).toThrow();
  });

  it("fails closed before materialization at the fixed CatalogHead and signed-envelope resource limits", async () => {
    const publicApi = await api();
    const fixture = signingFixture();
    const canonicalHeadLimit = 8 * 1024 * 1024;
    const signedCatalogLimit = 24 * 1024 * 1024;
    const boundedEntries = Array.from({ length: 4_096 }, (_, index) => ({
      ...entry(`recipe.${String(index).padStart(4, "0")}`),
      subject: subject("profile", `profile-${String(index).padStart(4, "0")}`),
    }));
    expect(() =>
      publicApi.createCatalogHeadV2(headInput(fixture.signer, { entries: boundedEntries })),
    ).not.toThrow();
    const tooManyEntries = [
      ...boundedEntries,
      { ...entry("recipe.4096"), subject: subject("profile", "profile-4096") },
    ];
    expect(() =>
      publicApi.createCatalogHeadV2(headInput(fixture.signer, { entries: tooManyEntries })),
    ).toThrow(/4096.*entr(?:y|ies)|entr(?:y|ies).*4096/i);
    const oversizedGrammarValidEntries = Array.from({ length: 4_096 }, (_, index) => {
      const suffix = `${String(index).padStart(4, "0")}.${"a".repeat(220)}`;
      return {
        ...entry(`recipe.oversized.${String(index).padStart(4, "0")}`),
        capabilities: {
          commands: [`catalog.${suffix}`],
          egress: [`https://example.invalid/${suffix}`],
          hooks: [`hook.${suffix}`],
          mcpTools: [`tool.${suffix}`],
          permissions: [`contents:${suffix}`],
        },
        qualification: {
          findings: [{ identity: `finding:${suffix}`, sha256: sha(`finding:${suffix}`) }],
          gaps: [{ identity: `gap:${suffix}`, sha256: sha(`gap:${suffix}`) }],
          report: { identity: `report:${suffix}`, sha256: sha(`report:${suffix}`) },
          rights: [{ identity: `right:${suffix}`, sha256: sha(`right:${suffix}`) }],
        },
        subject: subject("profile", `profile-oversized-${String(index).padStart(4, "0")}`),
      };
    });
    for (const entryValue of oversizedGrammarValidEntries) {
      for (const value of Object.values(entryValue.capabilities).flat()) {
        expect(value).toMatch(/^[a-z0-9:./_-]+$/);
        expect(value.length).toBeLessThanOrEqual(256);
      }
      for (const evidence of Object.values(entryValue.qualification).flat()) {
        expect(evidence.identity).toMatch(/^[a-z0-9:._-]+$/);
        expect(evidence.identity.length).toBeLessThanOrEqual(256);
        expect(evidence.sha256).toMatch(/^[a-f0-9]{64}$/);
      }
    }
    const oversizedHead = headInput(fixture.signer, { entries: oversizedGrammarValidEntries });
    expect(Buffer.byteLength(canonicalJson(oversizedHead as Json), "utf8")).toBeGreaterThan(
      canonicalHeadLimit,
    );
    expect(() => publicApi.createCatalogHeadV2(oversizedHead)).toThrow(/head-too-large/i);
    expect(() =>
      publicApi.verifySignedCatalogV2({
        catalogSignerRoots: [fixture.catalogSignerRoot],
        expectedClaims: claims(),
        lastAccepted: null,
        now: "2026-08-22T12:00:00Z",
        signed: {
          envelope: {
            payload: "A".repeat(signedCatalogLimit + 1),
            payloadType: "application/vnd.in-toto+json",
            signatures: [],
          },
        },
      }),
    ).toThrow(/24.*MiB|size.*limit/i);
  });

  it("signs the exact in-toto DSSE PAE once with a matching private Ed25519 key and verifies exact root, claims, continuity, replay, and time", async () => {
    const publicApi = await api();
    const fixture = signingFixture();
    const head = publicApi.createCatalogHeadV2(headInput(fixture.signer));
    const signed = publicApi.signCatalogHeadV2({ head, privateKey: fixture.privateKey });
    const pem = fixture.privateKey.export({ format: "pem", type: "pkcs8" });
    expect(publicApi.signCatalogHeadV2({ head, privateKey: pem })).toMatchObject({
      envelope: expect.any(Object),
    });
    expect(publicApi.signCatalogHeadV2({ head, privateKey: Buffer.from(pem) })).toMatchObject({
      envelope: expect.any(Object),
    });
    const envelope = signed.envelope as {
      payload: string;
      payloadType: string;
      signatures: readonly { keyid: string; sig: string }[];
    };
    const payload = Buffer.from(envelope.payload, "base64");
    const statement = JSON.parse(payload.toString("utf8")) as Record<string, unknown>;

    expect(envelope.signatures).toHaveLength(1);
    expect(envelope.signatures[0]?.keyid).toBe(fixture.signer.keyId);
    expect(
      verify(
        null,
        dssePae(envelope.payloadType, payload),
        fixture.publicKey as never,
        Buffer.from(envelope.signatures[0]?.sig ?? "", "base64"),
      ),
    ).toBe(true);
    expect(statement).toMatchObject({
      _type: "https://in-toto.io/Statement/v1",
      predicate: { protocol: "CatalogHeadV2" },
      predicateType: "https://aih.dev/SupportedCatalogV2",
      subject: [
        { digest: { sha256: head.catalogHeadSha256 }, name: "aih-supported/CatalogHeadV2" },
      ],
    });
    expect(Object.keys(statement.predicate as object).sort()).toEqual([
      "candidateSha256",
      "catalogHead",
      "catalogHeadSha256",
      "claims",
      "effectVersion",
      "protocol",
      "replayIdentity",
      "schemaVersion",
      "signer",
      "validFrom",
      "validUntil",
    ]);
    expect(
      canonicalJson((statement.predicate as Record<string, unknown>).catalogHead as Json),
    ).toBe(publicApi.canonicalCatalogHeadV2Bytes(head).toString("utf8"));
    expect((statement.predicate as Record<string, unknown>).catalogHeadSha256).toBe(
      head.catalogHeadSha256,
    );
    expect((statement.predicate as Record<string, unknown>).candidateSha256).toBe(
      sha(canonicalJson((statement.predicate as Record<string, unknown>).catalogHead as Json)),
    );
    const rootB = signingFixture();
    const verification = {
      catalogSignerRoots: [fixture.catalogSignerRoot, rootB.catalogSignerRoot],
      expectedClaims: claims(),
      lastAccepted: null,
      now: "2026-08-22T12:00:00Z",
      signed,
    };
    const verifiedHead = publicApi.verifySignedCatalogV2(verification);
    expect(verifiedHead).toEqual(head);
    expect(() => {
      const firstEntry = (verifiedHead.entries as Record<string, unknown>[])[0];
      if (!firstEntry) throw new Error("missing fixture entry");
      const capabilities = firstEntry.capabilities as Record<string, string[]>;
      const commands = capabilities.commands;
      if (!commands) throw new Error("missing fixture commands");
      commands.push("mutated-after-verify");
    }).toThrow();
    expect(() => {
      const firstEntry = (head.entries as Record<string, unknown>[])[0];
      if (!firstEntry) throw new Error("missing fixture entry");
      (firstEntry.subject as Record<string, unknown>).source = {
        type: "aih",
      };
    }).toThrow();
    expect(publicApi.verifySignedCatalogV2({ ...verification, now: head.validFrom })).toEqual(head);
    const actualV2ReplayIdentity = (statement.predicate as Record<string, unknown>)
      .replayIdentity as string;
    for (const operation of [publicApi.verifySignedCatalogV2, publicApi.inspectSignedCatalogV2])
      expect(() =>
        operation({
          ...verification,
          replay: { acceptedIdentities: [actualV2ReplayIdentity] },
        }),
      ).toThrow();
    for (const acceptedIdentities of [
      [123],
      [actualV2ReplayIdentity, actualV2ReplayIdentity],
      ["catalog-head:bad:identity"],
      [
        `catalog-head:${"f".repeat(64)}:${"f".repeat(64)}`,
        `catalog-head:${"0".repeat(64)}:${"0".repeat(64)}`,
      ],
    ])
      expect(() =>
        publicApi.verifySignedCatalogV2({
          ...verification,
          replay: { acceptedIdentities },
        }),
      ).toThrow();
    expect(canonicalJson(verifiedHead as Json)).toBe(
      canonicalJson((statement.predicate as Record<string, unknown>).catalogHead as Json),
    );
    const rootsAtLimit = [
      fixture.catalogSignerRoot,
      ...Array.from({ length: 63 }, () => signingFixture().catalogSignerRoot),
    ];
    expect(
      publicApi.verifySignedCatalogV2({ ...verification, catalogSignerRoots: rootsAtLimit }),
    ).toEqual(head);
    expect(
      publicApi.inspectSignedCatalogV2({ ...verification, catalogSignerRoots: rootsAtLimit }),
    ).toEqual({ kind: "materializable", head });
    const rootsOverLimit = [...rootsAtLimit, signingFixture().catalogSignerRoot];
    for (const operation of [publicApi.verifySignedCatalogV2, publicApi.inspectSignedCatalogV2])
      expect(() => operation({ ...verification, catalogSignerRoots: rootsOverLimit })).toThrow(
        /64.*root|root.*64/i,
      );
    const signatureByRootB = sign(
      null,
      dssePae(envelope.payloadType, payload),
      rootB.privateKey as never,
    );
    for (const forgedBinding of [
      {
        ...signed,
        envelope: {
          ...envelope,
          signatures: [{ keyid: rootB.signer.keyId, sig: signatureByRootB.toString("base64") }],
        },
      },
      {
        ...signed,
        envelope: {
          ...envelope,
          signatures: [{ keyid: fixture.signer.keyId, sig: signatureByRootB.toString("base64") }],
        },
      },
    ])
      for (const operation of [publicApi.verifySignedCatalogV2, publicApi.inspectSignedCatalogV2])
        expect(() => operation({ ...verification, signed: forgedBinding })).toThrow();
    const signedPredicateMirror = (patch: Record<string, unknown>) => {
      const mirrorStatement = structuredClone(statement) as Record<string, unknown>;
      Object.assign(mirrorStatement.predicate as Record<string, unknown>, patch);
      const mirrorPayload = Buffer.from(canonicalJson(mirrorStatement as Json), "utf8");
      return {
        envelope: {
          payload: mirrorPayload.toString("base64"),
          payloadType: envelope.payloadType,
          signatures: [
            {
              keyid: fixture.signer.keyId,
              sig: sign(
                null,
                dssePae(envelope.payloadType, mirrorPayload),
                fixture.privateKey as never,
              ).toString("base64"),
            },
          ],
        },
        head,
      };
    };
    const predicateMirrorMismatches: readonly [string, Record<string, unknown>][] = [
      ["claims", { claims: { ...claims(), repository: "samartomar/other" } }],
      ["signer", { signer: { ...fixture.signer, identity: "administrator:other" } }],
      ["validFrom", { validFrom: "2026-08-22T00:00:01Z" }],
      ["validUntil", { validUntil: "2026-08-23T00:00:01Z" }],
      ["effectVersion", { effectVersion: "3" }],
      ["schemaVersion", { schemaVersion: "3" }],
      ["catalogHeadSha256", { catalogHeadSha256: sha("predicate-mirror") }],
      ["replayIdentity", { replayIdentity: "catalog-head:predicate-mirror" }],
      ["candidateSha256", { candidateSha256: sha("wrong-candidate") }],
    ];
    for (const [field, patch] of predicateMirrorMismatches) {
      const mismatched = signedPredicateMirror(patch);
      for (const operation of [publicApi.verifySignedCatalogV2, publicApi.inspectSignedCatalogV2])
        expect(
          () => operation({ ...verification, signed: mismatched }),
          `valid DSSE rejects outer predicate ${field} mismatch`,
        ).toThrow();
    }
    const signedStatementMismatch = (mutate: (value: Record<string, unknown>) => void) => {
      const mismatchStatement = structuredClone(statement) as Record<string, unknown>;
      mutate(mismatchStatement);
      const mismatchPayload = Buffer.from(canonicalJson(mismatchStatement as Json), "utf8");
      return {
        envelope: {
          payload: mismatchPayload.toString("base64"),
          payloadType: envelope.payloadType,
          signatures: [
            {
              keyid: fixture.signer.keyId,
              sig: sign(
                null,
                dssePae(envelope.payloadType, mismatchPayload),
                fixture.privateKey as never,
              ).toString("base64"),
            },
          ],
        },
        head,
      };
    };
    for (const malformedEnvelope of [
      {
        ...signed,
        envelope: {
          ...(signed.envelope as Record<string, unknown>),
          signatures: [
            {
              ...((signed.envelope as { signatures: Record<string, unknown>[] }).signatures[0] ??
                {}),
              extra: "forbidden",
            },
          ],
        },
      },
    ])
      for (const operation of [publicApi.verifySignedCatalogV2, publicApi.inspectSignedCatalogV2])
        expect(() => operation({ ...verification, signed: malformedEnvelope })).toThrow();
    const subjectMismatches = [
      (value: Record<string, unknown>) => {
        (value.subject as Record<string, unknown>[])[0] = {
          name: "aih-supported/wrong-subject",
          digest: { sha256: head.catalogHeadSha256 },
        };
      },
      (value: Record<string, unknown>) => {
        ((value.subject as Record<string, unknown>[])[0]?.digest as Record<string, unknown>).extra =
          "forbidden";
      },
      (value: Record<string, unknown>) => {
        (value.subject as Record<string, unknown>[])[0] = {
          name: "aih-supported/CatalogHeadV2",
          digest: { sha256: sha("wrong-subject-digest") },
        };
      },
      (value: Record<string, unknown>) => {
        value.subject = [];
      },
      (value: Record<string, unknown>) => {
        value.subject = [
          ...(value.subject as Record<string, unknown>[]),
          { name: "aih-supported/CatalogHeadV2", digest: { sha256: head.catalogHeadSha256 } },
        ];
      },
      (value: Record<string, unknown>) => {
        value._type = "https://in-toto.io/Statement/v0";
      },
      (value: Record<string, unknown>) => {
        value.predicateType = "https://aih.dev/Other";
      },
      (value: Record<string, unknown>) => {
        (value.predicate as Record<string, unknown>).protocol = "CatalogHeadV3";
      },
    ];
    for (const mutate of subjectMismatches)
      for (const operation of [publicApi.verifySignedCatalogV2, publicApi.inspectSignedCatalogV2])
        expect(() =>
          operation({ ...verification, signed: signedStatementMismatch(mutate) }),
        ).toThrow();
    const wrongPayloadType = "application/vnd.in-toto+wrong";
    const wrongPayloadTypeSignature = sign(
      null,
      dssePae(wrongPayloadType, payload),
      fixture.privateKey as never,
    );
    for (const operation of [publicApi.verifySignedCatalogV2, publicApi.inspectSignedCatalogV2])
      expect(() =>
        operation({
          ...verification,
          signed: {
            ...signed,
            envelope: {
              ...envelope,
              payloadType: wrongPayloadType,
              signatures: [
                { keyid: fixture.signer.keyId, sig: wrongPayloadTypeSignature.toString("base64") },
              ],
            },
          },
        }),
      ).toThrow();
    expect(publicApi.inspectSignedCatalogV2(verification)).toEqual({
      kind: "materializable",
      head,
    });
    expect(publicApi.verifySignedCatalogV2({ ...verification, lastAccepted: head })).toEqual(head);
    const successor = publicApi.createCatalogHeadV2(nextInput(head, fixture.signer));
    const signedSuccessor = publicApi.signCatalogHeadV2({
      head: successor,
      privateKey: fixture.privateKey,
    });
    const rotatedSigner = {
      ...rootB.signer,
      // Rotation is a key change, not an identity change.
      identity: fixture.signer.identity,
    };
    const rotatedHead = publicApi.createCatalogHeadV2(nextInput(head, rotatedSigner));
    expect(rotatedHead.signer).toMatchObject({
      identity: fixture.signer.identity,
      keyId: rootB.signer.keyId,
    });
    expect(rotatedHead.signer).not.toMatchObject({ keyId: fixture.signer.keyId });
    const signedRotatedHead = publicApi.signCatalogHeadV2({
      head: rotatedHead,
      privateKey: rootB.privateKey,
    });
    const rotationVerification = {
      ...verification,
      catalogSignerRoots: [fixture.catalogSignerRoot, rootB.catalogSignerRoot],
      lastAccepted: head,
      signed: signedRotatedHead,
    };
    expect(publicApi.verifySignedCatalogV2(rotationVerification)).toEqual(rotatedHead);
    expect(publicApi.inspectSignedCatalogV2(rotationVerification)).toEqual({
      kind: "materializable",
      head: rotatedHead,
    });
    // A revoked prior root cannot validate its old DSSE artifact, while a caller-owned,
    // previously verified lastAccepted head still permits a properly rooted successor.
    for (const operation of [publicApi.verifySignedCatalogV2, publicApi.inspectSignedCatalogV2])
      expect(() =>
        operation({ ...verification, catalogSignerRoots: [rootB.catalogSignerRoot] }),
      ).toThrow();
    expect(
      publicApi.verifySignedCatalogV2({
        ...rotationVerification,
        catalogSignerRoots: [rootB.catalogSignerRoot],
      }),
    ).toEqual(rotatedHead);
    const staleSourceInput = nextInput(head, fixture.signer) as Record<string, unknown>;
    const changedSource = {
      ...(((head.entries as Record<string, unknown>[])[0]?.subject as Record<string, unknown>)
        .source as object),
      path: "profiles/default-changed.json",
    };
    const changedSourceDigest = coreSourceDigest(changedSource);
    const selectedSubject = (head.entries as Record<string, unknown>[])[0]?.subject as Record<
      string,
      unknown
    >;
    staleSourceInput.entries = [
      {
        ...(head.entries as Record<string, unknown>[])[0],
        subject: {
          ...((head.entries as Record<string, unknown>[])[0]?.subject as object),
          source: changedSource,
          sourceDigest: changedSourceDigest,
          subjectDigest: coreSubjectDigest(
            selectedSubject.kind as string,
            selectedSubject.id as string,
            changedSourceDigest,
          ),
        },
        capabilities: {
          ...((head.entries as Record<string, unknown>[])[0]?.capabilities as object),
          egress: ["https://changed.example.invalid"],
        },
      },
      { ...((head.entries as Record<string, unknown>[])[1] ?? {}) },
    ];
    delete (staleSourceInput.entries as Record<string, unknown>[])[0]?.memberSha256;
    delete (staleSourceInput.entries as Record<string, unknown>[])[1]?.memberSha256;
    const staleSource = publicApi.createCatalogHeadV2(staleSourceInput);
    const restampSemanticHead = (value: Record<string, unknown>): Record<string, unknown> => {
      const withoutHeadDigest = { ...value };
      delete withoutHeadDigest.catalogHeadSha256;
      return {
        ...value,
        catalogHeadSha256: domainSha256("aih-supported-catalog-head/v2", withoutHeadDigest as Json),
      };
    };
    const recomputeCatalog = (value: Record<string, unknown>): Record<string, unknown> => ({
      ...value,
      catalogSha256: domainSha256("aih-supported-catalog/v2", value.entries as Json),
    });
    const recomputeMembersAndCatalog = (
      value: Record<string, unknown>,
    ): Record<string, unknown> => {
      const entries = (value.entries as Record<string, unknown>[]).map((candidate) => {
        const withoutMember = { ...candidate };
        delete withoutMember.memberSha256;
        return {
          ...candidate,
          memberSha256: domainSha256("aih-supported-catalog-member/v2", withoutMember as Json),
        };
      });
      return recomputeCatalog({ ...value, entries });
    };
    const signRawHead = (staleHead: Record<string, unknown>) => {
      expect(() =>
        publicApi.signCatalogHeadV2({ head: staleHead, privateKey: fixture.privateKey }),
      ).toThrow();
      const staleStatement = structuredClone(statement) as Record<string, unknown>;
      const stalePredicate = staleStatement.predicate as Record<string, unknown>;
      stalePredicate.catalogHead = staleHead;
      stalePredicate.catalogHeadSha256 = staleHead.catalogHeadSha256;
      stalePredicate.candidateSha256 = sha(canonicalJson(staleHead as Json));
      stalePredicate.claims = staleHead.claims;
      stalePredicate.signer = staleHead.signer;
      stalePredicate.validFrom = staleHead.validFrom;
      stalePredicate.validUntil = staleHead.validUntil;
      stalePredicate.effectVersion = staleHead.effectVersion;
      stalePredicate.schemaVersion = staleHead.schemaVersion;
      stalePredicate.replayIdentity = `catalog-head:${staleHead.catalogHeadSha256}:${stalePredicate.candidateSha256}`;
      staleStatement.subject = [
        {
          name: "aih-supported/CatalogHeadV2",
          digest: { sha256: staleHead.catalogHeadSha256 },
        },
      ];
      const stalePayload = Buffer.from(canonicalJson(staleStatement as Json), "utf8");
      const staleSigned = {
        envelope: {
          payload: stalePayload.toString("base64"),
          payloadType: envelope.payloadType,
          signatures: [
            {
              keyid: fixture.signer.keyId,
              sig: sign(
                null,
                dssePae(envelope.payloadType, stalePayload),
                fixture.privateKey as never,
              ).toString("base64"),
            },
          ],
        },
        head: staleHead,
      };
      return staleSigned;
    };
    const staleDigestHeads: Record<string, Record<string, unknown>> = {};
    const staleMember = structuredClone(staleSource) as Record<string, unknown>;
    const staleMemberEntries = staleMember.entries as Record<string, unknown>[];
    staleMemberEntries[0] = {
      ...staleMemberEntries[0],
      memberSha256: (head.entries as Record<string, unknown>[])[0]?.memberSha256,
    };
    staleDigestHeads.memberSha256 = restampSemanticHead(recomputeCatalog(staleMember));

    const staleCatalog = structuredClone(staleSource) as Record<string, unknown>;
    staleCatalog.catalogSha256 = head.catalogSha256;
    staleDigestHeads.catalogSha256 = restampSemanticHead(staleCatalog);

    const staleSourceDigest = structuredClone(staleSource) as Record<string, unknown>;
    const staleSourceDigestEntries = staleSourceDigest.entries as Record<string, unknown>[];
    const staleSourceSubject = staleSourceDigestEntries[0]?.subject as Record<string, unknown>;
    const sourceDigestFromDifferentSource = (
      (head.entries as Record<string, unknown>[])[0]?.subject as Record<string, unknown>
    ).sourceDigest as string;
    staleSourceDigestEntries[0] = {
      ...staleSourceDigestEntries[0],
      subject: {
        ...staleSourceSubject,
        sourceDigest: sourceDigestFromDifferentSource,
        subjectDigest: coreSubjectDigest(
          staleSourceSubject.kind as string,
          staleSourceSubject.id as string,
          sourceDigestFromDifferentSource,
        ),
      },
    };
    staleDigestHeads.sourceDigest = restampSemanticHead(
      recomputeMembersAndCatalog(staleSourceDigest),
    );

    const staleSubjectDigest = structuredClone(staleSource) as Record<string, unknown>;
    const staleSubjectDigestEntries = staleSubjectDigest.entries as Record<string, unknown>[];
    staleSubjectDigestEntries[0] = {
      ...staleSubjectDigestEntries[0],
      subject: {
        ...(staleSubjectDigestEntries[0]?.subject as object),
        subjectDigest: (
          (head.entries as Record<string, unknown>[])[0]?.subject as Record<string, unknown>
        ).subjectDigest,
      },
    };
    staleDigestHeads.subjectDigest = restampSemanticHead(
      recomputeMembersAndCatalog(staleSubjectDigest),
    );
    for (const [staleField, staleHead] of Object.entries(staleDigestHeads)) {
      const staleSigned = signRawHead(staleHead);
      for (const operation of [publicApi.verifySignedCatalogV2, publicApi.inspectSignedCatalogV2])
        expect(
          () => operation({ ...verification, lastAccepted: head, signed: staleSigned }),
          `valid DSSE rejects stale ${staleField} after all outer fields are recomputed`,
        ).toThrow();
    }
    const unsortedHead = structuredClone(staleSource) as Record<string, unknown>;
    unsortedHead.entries = [...(unsortedHead.entries as Record<string, unknown>[])].reverse();
    unsortedHead.catalogSha256 = domainSha256(
      "aih-supported-catalog/v2",
      unsortedHead.entries as Json,
    );
    Object.assign(unsortedHead, restampSemanticHead(unsortedHead));
    const unsortedStatement = structuredClone(statement) as Record<string, unknown>;
    const unsortedPredicate = unsortedStatement.predicate as Record<string, unknown>;
    unsortedPredicate.catalogHead = unsortedHead;
    unsortedPredicate.catalogHeadSha256 = unsortedHead.catalogHeadSha256;
    unsortedPredicate.candidateSha256 = sha(canonicalJson(unsortedHead as Json));
    unsortedPredicate.replayIdentity = `catalog-head:${unsortedHead.catalogHeadSha256}:${unsortedPredicate.candidateSha256}`;
    unsortedStatement.subject = [
      {
        digest: { sha256: unsortedHead.catalogHeadSha256 },
        name: "aih-supported/CatalogHeadV2",
      },
    ];
    const unsortedPayload = Buffer.from(canonicalJson(unsortedStatement as Json), "utf8");
    const unsortedSigned = {
      envelope: {
        payload: unsortedPayload.toString("base64"),
        payloadType: envelope.payloadType,
        signatures: [
          {
            keyid: fixture.signer.keyId,
            sig: sign(
              null,
              dssePae(envelope.payloadType, unsortedPayload),
              fixture.privateKey as never,
            ).toString("base64"),
          },
        ],
      },
      head: unsortedHead,
    };
    for (const operation of [publicApi.verifySignedCatalogV2, publicApi.inspectSignedCatalogV2])
      expect(() =>
        operation({ ...verification, lastAccepted: head, signed: unsortedSigned }),
      ).toThrow();
    const candidateWithRecomputedBadMember = recomputeCatalog({
      ...staleSource,
      entries: [
        {
          ...((staleSource.entries as Record<string, unknown>[])[0] as Record<string, unknown>),
          memberSha256: sha("recomputed-outer-but-stale-member"),
        },
        (staleSource.entries as Record<string, unknown>[])[1] as Record<string, unknown>,
      ],
    });
    Object.assign(
      candidateWithRecomputedBadMember,
      restampSemanticHead(candidateWithRecomputedBadMember),
    );
    expect(() =>
      publicApi.planCatalogPromotionV2({
        candidateHead: candidateWithRecomputedBadMember,
        lastGood: head,
        now: "2026-08-22T12:00:00Z",
      }),
    ).toThrow();
    expect(() =>
      publicApi.deriveQualificationBasisV2({
        entryId: "recipe.default",
        head: candidateWithRecomputedBadMember,
      }),
    ).toThrow();
    const successorVerification = {
      ...verification,
      expectedClaims: claims(),
      lastAccepted: head,
      signed: signedSuccessor,
    };
    expect(publicApi.verifySignedCatalogV2(successorVerification)).toEqual(successor);
    expect(() =>
      publicApi.verifySignedCatalogV2({ ...successorVerification, lastAccepted: null }),
    ).toThrow();
    expect(
      publicApi.verifySignedCatalogV2({ ...successorVerification, lastAccepted: successor }),
    ).toEqual(successor);
    const wrongPredecessor = publicApi.createCatalogHeadV2({
      ...nextInput(head, fixture.signer),
      previousCatalogHeadSha256: sha("wrong-predecessor"),
    });
    const skippedSequence = publicApi.createCatalogHeadV2({
      ...nextInput(head, fixture.signer),
      sequence: 2,
    });
    const sameSequenceFork = publicApi.createCatalogHeadV2(
      headInput(fixture.signer, { validUntil: "2026-08-23T01:00:00Z" }),
    );
    const zeroPredecessorSuccessor = headInput(fixture.signer, {
      sequence: 1,
    });
    expect(() => publicApi.createCatalogHeadV2(zeroPredecessorSuccessor)).toThrow();
    for (const [key, value] of Object.entries(changedClaimValues())) {
      const changedHead = publicApi.createCatalogHeadV2(
        headInput(fixture.signer, { claims: { ...claims(), [key]: value } }),
      );
      expect(changedHead.catalogHeadSha256).not.toBe(head.catalogHeadSha256);
    }
    for (const malformedExpectedClaims of [
      ...Object.keys(claims()).map((missing) =>
        Object.fromEntries(Object.entries(claims()).filter(([key]) => key !== missing)),
      ),
      { ...claims(), extra: "forbidden" },
    ])
      for (const operation of [publicApi.verifySignedCatalogV2, publicApi.inspectSignedCatalogV2])
        expect(() =>
          operation({ ...verification, expectedClaims: malformedExpectedClaims }),
        ).toThrow();
    for (const [rejectedIndex, rejected] of [
      ...Object.entries(changedClaimValues()).map(([key, value]) => ({
        ...verification,
        expectedClaims: { ...claims(), [key]: value },
      })),
      ...Object.keys(claims()).map((missing) => ({
        ...verification,
        expectedClaims: Object.fromEntries(
          Object.entries(claims()).filter(([key]) => key !== missing),
        ),
      })),
      { ...verification, expectedClaims: { ...claims(), extra: "forbidden" } },
      { ...verification, expectedClaims: { ...claims(), issuer: "https://issuer.invalid" } },
      { ...verification, expectedClaims: { ...claims(), eventName: "push" } },
      { ...verification, now: "2026-08-24T00:00:00Z" },
      { ...verification, now: "2026-08-21T23:59:59Z" },
      { ...verification, now: "2026-08-22T12:00:00.1Z" },
      { ...verification, now: "2026-08-22T12:00:00+00:00" },
      { ...verification, now: "2026-08-23T00:00:00Z" },
      { ...verification, now: undefined },
      {
        ...verification,
        catalogSignerRoots: [{ ...fixture.catalogSignerRoot, identity: "administrator:wrong" }],
      },
      {
        ...verification,
        catalogSignerRoots: [{ ...fixture.catalogSignerRoot, class: "administrator-other" }],
      },
      {
        ...verification,
        catalogSignerRoots: [{ ...fixture.catalogSignerRoot, keyId: "ed25519:wrong" }],
      },
      {
        ...verification,
        catalogSignerRoots: [fixture.catalogSignerRoot, fixture.catalogSignerRoot],
      },
      {
        ...verification,
        catalogSignerRoots: [
          fixture.catalogSignerRoot,
          { ...signingFixture().catalogSignerRoot, class: "administrator-other" },
        ],
      },
      {
        ...verification,
        catalogSignerRoots: [
          {
            ...fixture.catalogSignerRoot,
            publicKeySpkiDerBase64: generateKeyPairSync("rsa", { modulusLength: 2048 })
              .publicKey.export({ format: "der", type: "spki" })
              .toString("base64"),
          },
        ],
      },
      {
        ...verification,
        catalogSignerRoots: [
          {
            ...fixture.catalogSignerRoot,
            publicKeySpkiDerBase64: signingFixture().catalogSignerRoot
              .publicKeySpkiDerBase64 as string,
          },
        ],
      },
      {
        ...verification,
        signed: {
          ...signed,
          envelope: { ...envelope, signatures: [...envelope.signatures, envelope.signatures[0]] },
        },
      },
      {
        ...verification,
        signed: { ...signed, envelope: { ...envelope, signatures: [] } },
      },
      {
        ...verification,
        signed: {
          ...signed,
          envelope: {
            ...envelope,
            signatures: [
              {
                ...envelope.signatures[0],
                sig: `${envelope.signatures[0]?.sig ?? ""}=`,
              },
            ],
          },
        },
      },
      {
        ...verification,
        signed: {
          ...signed,
          envelope: { ...envelope, payload: Buffer.from("tampered").toString("base64") },
        },
      },
      {
        ...verification,
        signed: {
          ...signed,
          envelope: {
            ...envelope,
            payload: Buffer.from(JSON.stringify({ ...statement, subject: [] })).toString("base64"),
          },
        },
      },
      {
        ...verification,
        signed: { ...signed, head: { ...head, catalogHeadSha256: sha("wrong-head") } },
      },
      {
        ...verification,
        signed: { ...signed, head: { ...head, validUntil: "2026-08-23T01:00:00Z" } },
      },
      {
        ...verification,
        signed: {
          ...signed,
          head: {
            ...head,
            entries: [
              {
                ...(head.entries as Record<string, unknown>[])[0],
                capabilities: {
                  ...((head.entries as Record<string, unknown>[])[0]?.capabilities as object),
                  commands: ["catalog.changed"],
                },
              },
              (head.entries as Record<string, unknown>[])[1],
            ],
          },
        },
      },
      {
        ...verification,
        signed: { ...signed, envelope: { ...envelope, payload: `${envelope.payload} ` } },
      },
      {
        ...verification,
        signed: {
          envelope: {
            payload: publicApi.canonicalCatalogHeadV2Bytes(head).toString("base64"),
            payloadType: "application/vnd.in-toto+json",
            signatures: [
              {
                keyid: fixture.signer.keyId,
                sig: sign(
                  null,
                  publicApi.canonicalCatalogHeadV2Bytes(head),
                  fixture.privateKey as never,
                ).toString("base64"),
              },
            ],
          },
          head,
        },
      },
      {
        ...successorVerification,
        signed: publicApi.signCatalogHeadV2({
          head: wrongPredecessor,
          privateKey: fixture.privateKey,
        }),
      },
      {
        ...successorVerification,
        signed: publicApi.signCatalogHeadV2({
          head: skippedSequence,
          privateKey: fixture.privateKey,
        }),
      },
      {
        ...verification,
        lastAccepted: head,
        signed: publicApi.signCatalogHeadV2({
          head: sameSequenceFork,
          privateKey: fixture.privateKey,
        }),
      },
      { ...verification, lastAccepted: successor },
      { ...verification, provider: "forbidden" },
      { ...verification, fetch: () => undefined },
      { ...verification, skipContinuity: true },
    ].entries())
      expect(
        () => publicApi.verifySignedCatalogV2(rejected),
        `rejected input ${rejectedIndex}`,
      ).toThrow();
    for (const operation of [publicApi.verifySignedCatalogV2, publicApi.inspectSignedCatalogV2])
      expect(() => operation({ ...verification, now: undefined })).toThrow();
    const restampLastAccepted = (value: Record<string, unknown>) => {
      const withoutHeadDigest = { ...value };
      delete withoutHeadDigest.catalogHeadSha256;
      return {
        ...value,
        catalogHeadSha256: domainSha256("aih-supported-catalog-head/v2", withoutHeadDigest as Json),
      };
    };
    const tamperedLastAcceptedCatalog = restampLastAccepted({
      ...head,
      catalogSha256: sha("tampered-last-accepted-catalog"),
    });
    const staleLastAcceptedEntries = structuredClone(head.entries) as Record<string, unknown>[];
    staleLastAcceptedEntries[0] = {
      ...staleLastAcceptedEntries[0],
      memberSha256: sha("tampered-last-accepted-member"),
    };
    const tamperedLastAcceptedMember = restampLastAccepted({
      ...head,
      entries: staleLastAcceptedEntries,
      catalogSha256: domainSha256("aih-supported-catalog/v2", staleLastAcceptedEntries as Json),
    });
    for (const tamperedLastAccepted of [tamperedLastAcceptedCatalog, tamperedLastAcceptedMember]) {
      const successorOfTamperedLastAccepted = publicApi.createCatalogHeadV2(
        headInput(fixture.signer, {
          previousCatalogHeadSha256: tamperedLastAccepted.catalogHeadSha256,
          sequence: 1,
          validFrom: "2026-08-22T01:00:00Z",
          validUntil: "2026-08-23T00:00:00Z",
        }),
      );
      const signedSuccessorOfTamperedLastAccepted = publicApi.signCatalogHeadV2({
        head: successorOfTamperedLastAccepted,
        privateKey: fixture.privateKey,
      });
      for (const operation of [publicApi.verifySignedCatalogV2, publicApi.inspectSignedCatalogV2])
        expect(() =>
          operation({
            ...verification,
            lastAccepted: tamperedLastAccepted,
            signed: signedSuccessorOfTamperedLastAccepted,
          }),
        ).toThrow();
    }
    for (const signingInput of [
      { head, privateKey: signingFixture().privateKey },
      { head, privateKey: generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey },
      { head: headInput(fixture.signer), privateKey: fixture.privateKey },
      {
        head: { ...head, catalogHeadSha256: sha("self-declared-wrong-digest") },
        privateKey: fixture.privateKey,
      },
      {
        head: {
          ...head,
          entries: [...(head.entries as Record<string, unknown>[]), entry("recipe.default")],
        },
        privateKey: fixture.privateKey,
      },
      { head: { ...head, effectVersion: "999" }, privateKey: fixture.privateKey },
      { head, privateKey: fixture.privateKey, provider: "forbidden" },
      { head, privateKey: fixture.privateKey, source: "forbidden" },
      { head, privateKey: fixture.privateKey, authority: "forbidden" },
      { head, privateKey: "not a PEM" },
      { head, privateKey: `${pem}\n${pem}` },
    ])
      expect(() => publicApi.signCatalogHeadV2(signingInput)).toThrow();
  });

  it("returns an authenticated opaque unknown-version record but never materializes or verifies it as V2", async () => {
    const publicApi = await api();
    const fixture = signingFixture();
    const envelope = opaqueUnknownEnvelope(fixture);
    const request = {
      catalogSignerRoots: [fixture.catalogSignerRoot],
      expectedClaims: claims(),
      lastAccepted: null,
      now: "2026-08-22T12:00:00Z",
      replay: { acceptedIdentities: [] },
      signed: { envelope },
    };
    const opaqueStatement = JSON.parse(
      Buffer.from(envelope.payload as string, "base64").toString("utf8"),
    ) as { predicate: Record<string, unknown> };
    expect(Object.keys(opaqueStatement.predicate).sort()).toEqual([
      "candidateSha256",
      "catalogHead",
      "catalogHeadSha256",
      "claims",
      "effectVersion",
      "protocol",
      "replayIdentity",
      "schemaVersion",
      "signer",
      "validFrom",
      "validUntil",
    ]);
    expect(opaqueStatement.predicate.candidateSha256).toBe(
      sha(canonicalJson(opaqueStatement.predicate.catalogHead as Json)),
    );

    const opaqueInspection = publicApi.inspectSignedCatalogV2(request) as Record<string, unknown>;
    expect(opaqueInspection).toMatchObject({
      kind: "unsupported-version",
      record: { effectVersion: "999", schemaVersion: "999" },
    });
    expect(Object.keys(opaqueInspection).sort()).toEqual(["kind", "record"]);
    expect(Object.keys(opaqueInspection.record as object).sort()).toEqual([
      "candidateSha256",
      "catalogHeadSha256",
      "claims",
      "effectVersion",
      "protocol",
      "replayIdentity",
      "schemaVersion",
      "signer",
      "validFrom",
      "validUntil",
    ]);
    expect(opaqueInspection).not.toHaveProperty("head");
    expect(opaqueInspection).not.toHaveProperty("basis");
    const replayIdentitiesAtLimit = Array.from(
      { length: 4_096 },
      (_, index) =>
        `catalog-head:${sha(`replay-head:${index}`)}:${sha(`replay-candidate:${index}`)}`,
    ).sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
    expect(
      publicApi.inspectSignedCatalogV2({
        ...request,
        replay: { acceptedIdentities: replayIdentitiesAtLimit },
      }),
    ).toEqual(opaqueInspection);
    const replayIdentitiesOverLimit = [
      ...replayIdentitiesAtLimit,
      `catalog-head:${sha("replay-head:over")}:${sha("replay-candidate:over")}`,
    ];
    for (const operation of [publicApi.verifySignedCatalogV2, publicApi.inspectSignedCatalogV2])
      expect(() =>
        operation({
          ...request,
          replay: { acceptedIdentities: replayIdentitiesOverLimit },
        }),
      ).toThrow(/4096.*replay|replay.*4096/i);
    expect(() => publicApi.verifySignedCatalogV2(request)).toThrow();
    for (const rejected of [
      { ...request, expectedClaims: { ...claims(), repository: "samartomar/other" } },
      { ...request, now: "2026-08-21T23:59:59Z" },
      { ...request, now: "2026-08-24T00:00:00Z" },
      {
        ...request,
        replay: {
          acceptedIdentities: [
            `catalog-head:${opaqueStatement.predicate.catalogHeadSha256 as string}:${opaqueStatement.predicate.candidateSha256 as string}`,
          ],
        },
      },
      {
        ...request,
        catalogSignerRoots: [{ ...fixture.catalogSignerRoot, publicKeySpkiSha256: sha("wrong") }],
      },
      {
        ...request,
        signed: { envelope: { ...envelope, payload: Buffer.from("tampered").toString("base64") } },
      },
      { ...request, provider: "forbidden" },
      { ...request, fetch: () => undefined },
      { ...request, skipContinuity: true },
    ])
      expect(() => publicApi.inspectSignedCatalogV2(rejected)).toThrow();
  });

  it("derives promotion differences from closed head surfaces and preserves last-good for every material exception", async () => {
    const publicApi = await api();
    const fixture = signingFixture();
    const lastGood = publicApi.createCatalogHeadV2(headInput(fixture.signer));
    const cleanSuccessor = publicApi.createCatalogHeadV2(nextInput(lastGood, fixture.signer));

    expect(
      publicApi.planCatalogPromotionV2({
        candidateHead: cleanSuccessor,
        lastGood,
        now: "2026-08-22T12:00:00Z",
      }),
    ).toEqual({ head: cleanSuccessor, kind: "promoted" });
    expect(
      publicApi.planCatalogPromotionV2({
        candidateHead: lastGood,
        lastGood,
        now: "2026-08-22T12:00:00Z",
      }),
    ).toEqual({ head: lastGood, kind: "unchanged" });
    expect(() =>
      publicApi.planCatalogPromotionV2({ candidateHead: cleanSuccessor, lastGood }),
    ).toThrow();
    const restampLastGood = (value: Record<string, unknown>) => {
      const withoutHeadDigest = { ...value };
      delete withoutHeadDigest.catalogHeadSha256;
      return {
        ...value,
        catalogHeadSha256: domainSha256("aih-supported-catalog-head/v2", withoutHeadDigest as Json),
      };
    };
    const tamperedLastGoodCatalog = restampLastGood({
      ...lastGood,
      catalogSha256: sha("tampered-last-good-catalog"),
    });
    const staleLastGoodEntries = structuredClone(lastGood.entries) as Record<string, unknown>[];
    staleLastGoodEntries[0] = {
      ...staleLastGoodEntries[0],
      memberSha256: sha("tampered-last-good-member"),
    };
    const tamperedLastGoodMember = restampLastGood({
      ...lastGood,
      entries: staleLastGoodEntries,
      catalogSha256: domainSha256("aih-supported-catalog/v2", staleLastGoodEntries as Json),
    });
    for (const tamperedLastGood of [tamperedLastGoodCatalog, tamperedLastGoodMember]) {
      const successorOfTamperedLastGood = publicApi.createCatalogHeadV2(
        headInput(fixture.signer, {
          previousCatalogHeadSha256: tamperedLastGood.catalogHeadSha256,
          sequence: 1,
          validFrom: "2026-08-22T01:00:00Z",
          validUntil: "2026-08-23T00:00:00Z",
        }),
      );
      expect(() =>
        publicApi.planCatalogPromotionV2({
          candidateHead: successorOfTamperedLastGood,
          lastGood: tamperedLastGood,
          now: "2026-08-22T12:00:00Z",
        }),
      ).toThrow();
    }
    for (const now of ["2026-08-21T23:59:59Z", "2026-08-25T00:00:00Z"])
      expect(() =>
        publicApi.planCatalogPromotionV2({ candidateHead: cleanSuccessor, lastGood, now }),
      ).toThrow();
    expect(() =>
      publicApi.planCatalogPromotionV2({
        candidateHead: {
          ...nextInput(lastGood, fixture.signer),
          entries: [
            {
              ...(nextInput(lastGood, fixture.signer).entries as Record<string, unknown>[])[0],
              capabilities: {
                ...((nextInput(lastGood, fixture.signer).entries as Record<string, unknown>[])[0]
                  ?.capabilities as object),
                unknownCapability: ["forbidden"],
              },
            },
          ],
        },
        lastGood,
        now: "2026-08-22T12:00:00Z",
      }),
    ).toThrow();
    for (const invalidContinuity of [
      publicApi.createCatalogHeadV2({
        ...nextInput(lastGood, fixture.signer),
        sequence: (lastGood.sequence as number) + 2,
      }),
      publicApi.createCatalogHeadV2({
        ...nextInput(lastGood, fixture.signer),
        previousCatalogHeadSha256: sha("wrong-parent"),
      }),
    ])
      expect(() =>
        publicApi.planCatalogPromotionV2({
          candidateHead: invalidContinuity,
          lastGood,
          now: "2026-08-22T12:00:00Z",
        }),
      ).toThrow();
    for (const surface of [
      "claims",
      "finding",
      "gap",
      "report",
      "right",
      "signer",
      "closure",
      "command",
      "hook",
      "mcp-tool",
      "egress",
      "permission",
      "effect",
      "schema",
      "compatible-effect-versions",
      "compatible-schema-versions",
      "platform",
      "recipe",
      "prose",
    ]) {
      const candidateInput = changedSurface(lastGood, surface);
      if (surface === "signer") {
        expect((candidateInput.signer as Record<string, unknown>).identity).toBe(
          fixture.signer.identity,
        );
        expect((candidateInput.signer as Record<string, unknown>).keyId).not.toBe(
          fixture.signer.keyId,
        );
        expect((candidateInput.signer as Record<string, unknown>).publicKeySpkiSha256).not.toBe(
          fixture.signer.publicKeySpkiSha256,
        );
      }
      const result = publicApi.planCatalogPromotionV2({
        candidateHead: publicApi.createCatalogHeadV2(candidateInput),
        lastGood,
        now: "2026-08-22T12:00:00Z",
      }) as Record<string, unknown>;
      expect(result.kind).toBe("last-good");
      expect(result.head).toStrictEqual(lastGood);
      const expectedIdentity =
        surface === "signer"
          ? fixture.signer.identity
          : surface === "compatible-effect-versions" || surface === "compatible-schema-versions"
            ? "catalog"
            : expect.any(String);
      expect(result.facts).toEqual([
        {
          candidateSurfaceSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
          identity: expectedIdentity,
          lastGoodSurfaceSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
          surface,
        },
      ]);
    }
    expect(() =>
      publicApi.planCatalogPromotionV2({
        candidateHead: { ...cleanSuccessor, catalogHeadSha256: sha("wrong-candidate-head") },
        lastGood,
        now: "2026-08-22T12:00:00Z",
      }),
    ).toThrow();
    const entryAdded = publicApi.createCatalogHeadV2({
      ...nextInput(lastGood, fixture.signer),
      entries: [
        ...(nextInput(lastGood, fixture.signer).entries as Record<string, unknown>[]),
        entry("recipe.beta"),
      ],
    });
    const entryRemoved = publicApi.createCatalogHeadV2({
      ...nextInput(lastGood, fixture.signer),
      entries: (nextInput(lastGood, fixture.signer).entries as Record<string, unknown>[]).filter(
        (candidate) => candidate.entryId !== "recipe.alpha",
      ),
    });
    const subjectChanged = publicApi.createCatalogHeadV2({
      ...nextInput(lastGood, fixture.signer),
      entries: (nextInput(lastGood, fixture.signer).entries as Record<string, unknown>[]).map(
        (candidate) =>
          candidate.entryId === "recipe.default"
            ? { ...candidate, subject: subject("profile", "changed-default-profile") }
            : candidate,
      ),
    });
    for (const [candidateHead, surface, identity] of [
      [entryAdded, "entry-added", "recipe.beta"],
      [entryRemoved, "entry-removed", "recipe.alpha"],
      [subjectChanged, "subject", "recipe.default"],
    ]) {
      const result = publicApi.planCatalogPromotionV2({
        candidateHead,
        lastGood,
        now: "2026-08-22T12:00:00Z",
      }) as Record<string, unknown>;
      expect(result).toMatchObject({ head: lastGood, kind: "last-good" });
      expect(result.facts).toEqual(
        expect.arrayContaining([expect.objectContaining({ identity, surface })]),
      );
    }
    for (const forbidden of [
      {
        candidateHead: cleanSuccessor,
        lastGood,
        now: "2026-08-22T12:00:00Z",
        qualification: { complete: true },
      },
      {
        candidateHead: cleanSuccessor,
        lastGood,
        now: "2026-08-22T12:00:00Z",
        sign: () => undefined,
      },
      {
        candidateHead: cleanSuccessor,
        lastGood,
        now: "2026-08-22T12:00:00Z",
        writeCatalog: () => undefined,
      },
    ])
      expect(() => publicApi.planCatalogPromotionV2(forbidden)).toThrow();
  });

  it("requires a portable exact-Core lock verifier for qualification-basis shape, without asserting Core consumes V2", async () => {
    const publicApi = await api();
    const fixture = signingFixture();
    const head = publicApi.createCatalogHeadV2(headInput(fixture.signer));
    const fixtureJson = JSON.parse(
      readFileSync(resolve(root, "tests/contracts/core-qualification-basis-v2.json"), "utf8"),
    ) as Record<string, unknown>;
    const expectedKeys = fixtureJson.qualificationBasisKeys as string[];
    const derived = publicApi.deriveQualificationBasisV2({
      entryId: "recipe.default",
      head,
    }) as Record<string, unknown>;

    expect(fixtureJson.core).toEqual({
      commit: coreCommit,
      repository: "samartomar/ai-harness",
      schemaPath: "schemas/aih-governance-decision-v2.schema.json",
      schemaSha256,
    });
    const vectors = fixtureJson.vectors as Record<string, Record<string, unknown>>;
    const sourceVector = vectors.source;
    const subjectVector = vectors.subject;
    if (!sourceVector || !subjectVector) throw new Error("missing exact Core digest vectors");
    expect(sourceVector.digest).toBe(
      "sha256:cf031ec31f84fd8d592dd1797711217e3d806f517d3b52a994d5576d78267bc7",
    );
    expect(subjectVector.digest).toBe(
      "sha256:65de8c36c7fa97a742edb7c72bad0df3e261a5c90e59ee26e83896852c7da81a",
    );
    expect(sourceVector.canonical).toBe(
      `aih-governance-decision-source/v2\0${canonicalJson(sourceVector.value as Json)}`,
    );
    expect(sourceVector.digest).toBe(
      coreSourceDigest(sourceVector.value as Record<string, unknown>),
    );
    expect(subjectVector.canonical).toBe(
      `aih-governance-decision-subject/v2\0${canonicalJson(subjectVector.value as Json)}`,
    );
    expect(subjectVector.digest).toBe(
      coreSubjectDigest(
        (subjectVector.value as Record<string, unknown>).kind as string,
        (subjectVector.value as Record<string, unknown>).id as string,
        (subjectVector.value as Record<string, unknown>).sourceDigest as string,
      ),
    );
    expect(expectedKeys).toEqual([
      "catalogDigest",
      "catalogHeadDigest",
      "catalogMemberDigest",
      "catalogSignerIdentity",
      "kind",
      "subjectDigest",
      "subjectKind",
    ]);
    const defaultEntry = (head.entries as Record<string, unknown>[]).find(
      (candidate) => candidate.entryId === "recipe.default",
    ) as Record<string, unknown>;
    expect(derived).toMatchObject({
      catalogDigest: `sha256:${head.catalogSha256}`,
      catalogHeadDigest: `sha256:${head.catalogHeadSha256}`,
      catalogMemberDigest: `sha256:${defaultEntry.memberSha256}`,
      catalogSignerIdentity: fixture.signer.identity,
      kind: "aih-supported",
      subjectDigest: (defaultEntry.subject as Record<string, unknown>).subjectDigest,
      subjectKind: "profile",
    });
    for (const key of [
      "catalogDigest",
      "catalogHeadDigest",
      "catalogMemberDigest",
      "subjectDigest",
    ])
      expect(derived[key]).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(derived.catalogSignerIdentity).toMatch(/^administrator:aih-supported\/catalog-v2$/);
    expect(derived.subjectKind).toMatch(/^(tool|skill|mcp|package|profile)$/);
    expect(Object.keys(derived).sort()).toEqual([...expectedKeys].sort());
    expect(() =>
      publicApi.deriveQualificationBasisV2({ entryId: "recipe.unknown", head }),
    ).toThrow();
    for (const invalidHead of [
      headInput(fixture.signer),
      { ...head, catalogHeadSha256: sha("tampered-head") },
      {
        ...head,
        entries: [
          {
            ...(head.entries as Record<string, unknown>[])[0],
            memberSha256: sha("tampered-member"),
          },
          (head.entries as Record<string, unknown>[])[1],
        ],
      },
    ])
      expect(() =>
        publicApi.deriveQualificationBasisV2({ entryId: "recipe.default", head: invalidHead }),
      ).toThrow();
    const incompatibleEntryHead = publicApi.createCatalogHeadV2(
      headInput(fixture.signer, {
        compatibleEffectVersions: ["2", "3"],
        entries: [
          { ...entry("recipe.alpha"), subject: subject("profile", "alpha-profile") },
          { ...entry("recipe.default"), versions: { effect: "3", schema: "2" } },
        ],
      }),
    );
    expect(
      publicApi.parseCatalogHeadV2Json(
        publicApi.canonicalCatalogHeadV2Bytes(incompatibleEntryHead).toString("utf8"),
      ),
    ).toEqual(incompatibleEntryHead);
    expect(() =>
      publicApi.deriveQualificationBasisV2({
        entryId: "recipe.default",
        head: incompatibleEntryHead,
      }),
    ).toThrow();
    const packageJson = readFileSync(resolve(root, "package.json"), "utf8");
    const packageScripts = JSON.parse(packageJson).scripts as Record<string, string>;
    const verificationWorkflow = readFileSync(
      resolve(root, ".github/workflows/verify.yml"),
      "utf8",
    );
    const verifierPath = resolve(root, "tools/verify-core-v2-lock.mjs");
    const schemaPath = resolve(root, "tests/contracts/core/aih-governance-decision-v2.schema.json");
    expect(packageJson).toContain('"verify:core-v2-lock"');
    expect(packageScripts.verify).toBe(
      "npm run typecheck && npm run lint && npm run build && npm test",
    );
    expect(packageScripts["verify:core-v2-lock"]).toMatch(/^node tools\/verify-core-v2-lock\.mjs$/);
    expect(readFileSync(verifierPath, "utf8")).toContain("aih-governance-decision-source/v2\\0");
    expect(readFileSync(verifierPath, "utf8")).toContain("aih-governance-decision-subject/v2\\0");
    expect(verificationWorkflow).toContain("npm run verify:core-v2-lock");
    expect(existsSync(verifierPath)).toBe(true);
    const verifier = readFileSync(verifierPath, "utf8");
    expect(verifier).toContain(coreCommit);
    expect(verifier).toContain("samartomar/ai-harness");
    expect(verifier).toContain(schemaSha256);
    expect(verifier).toContain("aih-governance-decision-v2.schema.json");
    expect(verifier).toContain("tests/contracts/core/aih-governance-decision-v2.schema.json");
    expect(existsSync(schemaPath)).toBe(true);
    expect(sha(readFileSync(schemaPath))).toBe(schemaSha256);
    const vectorVerifier = spawnSync(
      process.execPath,
      ["tests/contracts/core/verify-core-v2-vectors.mjs"],
      { cwd: root, encoding: "utf8" },
    );
    expect(vectorVerifier.status).toBe(0);
    expect(vectorVerifier.stdout).toBe("Core V2 vectors and schema lock PASS\n");
    expect(
      spawnSync(process.execPath, [verifierPath], { cwd: root, encoding: "utf8" }).status,
    ).toBe(0);
    const validationTemp = mkdtempSync(join(tmpdir(), "aih-supported-core-lock-"));
    try {
      const basisPath = resolve(validationTemp, "qualification-basis.json");
      const driftedSchemaPath = resolve(validationTemp, "drifted-schema.json");
      writeFileSync(basisPath, canonicalJson(derived as unknown as Json));
      writeFileSync(driftedSchemaPath, `${readFileSync(schemaPath, "utf8")}\n`);
      expect(
        spawnSync(
          process.execPath,
          [verifierPath, "--schema", schemaPath, "--qualification-basis", basisPath],
          { cwd: root, encoding: "utf8" },
        ).status,
      ).toBe(0);
      expect(
        spawnSync(
          process.execPath,
          [verifierPath, "--schema", driftedSchemaPath, "--qualification-basis", basisPath],
          { cwd: root, encoding: "utf8" },
        ).status,
      ).not.toBe(0);
      for (const malformedBasis of [
        Object.fromEntries(Object.entries(derived).filter(([key]) => key !== "catalogDigest")),
        { ...derived, catalogDigest: String(derived.catalogDigest).replace("sha256:", "sha1:") },
        { ...derived, extra: "forbidden" },
      ]) {
        writeFileSync(basisPath, canonicalJson(malformedBasis as Json));
        expect(
          spawnSync(
            process.execPath,
            [verifierPath, "--schema", schemaPath, "--qualification-basis", basisPath],
            { cwd: root, encoding: "utf8" },
          ).status,
        ).not.toBe(0);
      }
    } finally {
      rmSync(validationTemp, { force: true, recursive: true });
    }
  });

  it("derives one deterministic default profile/recipe evidence chain and supports a packed disposable cold external-admin journey", async () => {
    const packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as Record<
      string,
      unknown
    >;
    const defaultCatalogText = readFileSync(
      resolve(root, "tests/contracts/default-catalog-v2.json"),
      "utf8",
    );
    const defaultCatalog = JSON.parse(defaultCatalogText) as Record<string, unknown>;
    const coldAdminText = readFileSync(
      resolve(root, "tests/contracts/cold-external-admin-v2.json"),
      "utf8",
    );
    const coldAdmin = JSON.parse(coldAdminText) as Record<string, unknown>;
    const defaultRecipeArtifact = defaultCatalog.recipe as Record<string, unknown>;
    expect(defaultCatalog).toMatchObject({
      entryId: "recipe.default",
      installedSeed: "defaults/default-catalog-v2.json",
      profile: { id: "default-profile", kind: "profile" },
      recipe: defaultRecipeArtifact,
    });
    expect(defaultRecipeArtifact).toEqual({ id: "default-recipe", kind: "recipe" });
    expect(defaultRecipeArtifact.kind).not.toBe("profile");
    expect(defaultCatalogText.trim()).toBe(canonicalJson(defaultCatalog as unknown as Json));
    expect(coldAdmin).toMatchObject({
      organizationAdmission: "not-authoritative",
      verificationMode: "cold-external-admin",
    });
    expect(coldAdminText.trim()).toBe(canonicalJson(coldAdmin as unknown as Json));
    expect(packageJson.version).toBe("1.0.0");
    expect(packageJson.bin).toEqual({ "aih-supported": "dist/cli.js" });
    expect(packageJson.files).toEqual(["dist", "defaults", "README.md"]);
    expect(packageJson.dependencies).toEqual({});
    expect(packageJson.private).toBe(true);
    expect(packageJson.repository).toEqual({
      type: "git",
      url: "git+https://github.com/samartomar/aih-supported.git",
    });
    expect(packageJson.homepage).toBe("https://github.com/samartomar/aih-supported#readme");
    expect(packageJson.bugs).toEqual({ url: "https://github.com/samartomar/aih-supported/issues" });
    expect(packageJson.keywords).toEqual([
      "ai-harness",
      "aih",
      "catalog",
      "dsse",
      "ed25519",
      "evidence",
    ]);
    expect(packageJson.publishConfig).toEqual({ access: "public" });
    const packageScripts = packageJson.scripts as Record<string, string>;
    expect(packageScripts["generate:default-candidate"]).toMatch(
      /^node dist\/cli\.js generate-candidate(?:\s|$)/,
    );
    expect(packageScripts.build).toBe(
      "node tools/clean-dist.mjs && tsc -p tsconfig.build.json && node tools/ensure-cli-executable.mjs",
    );
    expect(packageScripts["sign:candidate"]).toMatch(/^node dist\/cli\.js sign-candidate(?:\s|$)/);
    expect(packageScripts["verify:cold-external-admin"]).toBe(
      "node tools/verify-cold-external-admin.mjs",
    );
    const coldVerificationTool = resolve(root, "tools/verify-cold-external-admin.mjs");
    const ciWorkflow = readFileSync(resolve(root, ".github/workflows/verify.yml"), "utf8");
    expect(existsSync(coldVerificationTool)).toBe(true);
    const coldVerificationSource = readFileSync(coldVerificationTool, "utf8");
    expect(coldVerificationSource).toMatch(/npmCli, "pack"/);
    expect(coldVerificationSource).not.toMatch(/npmCli,\s*"install",\s*"--offline"/);
    expect(coldVerificationSource).toMatch(/generateKeyPairSync\("ed25519"\)/);
    expect(coldVerificationSource).toMatch(/"generate-candidate"/);
    expect(coldVerificationSource).toMatch(/"sign-candidate"/);
    expect(coldVerificationSource).toMatch(/"inspect"/);
    expect(coldVerificationSource).toMatch(/"--qualification-basis"/);
    expect(coldVerificationSource).toContain("e53fe219002515c092ebb68c5b91c91a2fc6110d");
    expect(coldVerificationSource).toMatch(/AIH_SUPPORTED_CORE_SOURCE/);
    expect(coldVerificationSource).toMatch(/@aihq\/harness/);
    expect(coldVerificationSource).toMatch(/"policy",\s*"supported",\s*"inspect"/);
    expect(coldVerificationSource).toMatch(/pre-publication-public-receipt-contract/);
    expect(coldVerificationSource).toMatch(/qualification-receipt-v1|version: 1/);
    expect(coldVerificationSource).not.toMatch(/fake gh/);
    expect(coldVerificationSource).toMatch(/receipt\.version !== 2/);
    expect(coldVerificationSource).toMatch(/catalogContinuity/);
    expect(coldVerificationSource).toMatch(/production acceptance was not accepted/);
    expect(coldVerificationSource).toContain(
      "error [AIH_TRUST]: supported custody verification failed",
    );
    expect(coldVerificationSource).toMatch(
      /Number\.isInteger\(unsupportedProductionAcceptance\.status\)/,
    );
    expect(ciWorkflow).toMatch(/cold-external-admin:[\s\S]*npm run verify:cold-external-admin/);
    expect(ciWorkflow).toMatch(/repository: samartomar\/ai-harness/);
    expect(ciWorkflow).toMatch(/AIH_SUPPORTED_CORE_SOURCE/);
    expect(coldVerificationSource).toMatch(
      /process\.platform === "win32" \? process\.execPath : bin/,
    );
    const cliSource = readFileSync(resolve(root, "src/cli.ts"), "utf8");
    expect(cliSource).toMatch(/^#!\/usr\/bin\/env node\n/);
    const executableTool = resolve(root, "tools/ensure-cli-executable.mjs");
    expect(readFileSync(executableTool, "utf8")).toMatch(/chmodSync\(cli, 0o755\)/);
    expect(packageJson.main).toBe("./dist/index.js");
    expect(packageJson.types).toBe("./dist/index.d.ts");
    expect(packageJson.exports).toEqual({
      ".": { import: "./dist/index.js", types: "./dist/index.d.ts" },
    });
    expect(coldVerificationSource).toMatch(/import \* as api from '@aihq\/supported'/);
    expect(packageScripts["verify:default-evidence-chain"]).toBe(
      "vitest run tests/supported/default-evidence-chain.test.ts",
    );
    const defaultEvidenceChainTest = resolve(
      root,
      "tests/supported/default-evidence-chain.test.ts",
    );
    expect(existsSync(defaultEvidenceChainTest)).toBe(true);
    const defaultEvidenceChainSource = readFileSync(defaultEvidenceChainTest, "utf8");
    expect(defaultEvidenceChainSource).toMatch(/artifactDigests/);
    expect(defaultEvidenceChainSource).toMatch(/tests\/contracts\/cold-external-admin-v2\.json/);
    expect(defaultEvidenceChainSource).toMatch(/qualificationBasis/);
    expect(defaultEvidenceChainSource).toMatch(/import\("\.\.\/\.\.\/src\/index\.js"\)/);
    expect(defaultEvidenceChainSource).toMatch(/createCatalogHeadV2/);
    expect(defaultEvidenceChainSource).toMatch(/deriveQualificationBasisV2/);
    for (const script of Object.values(packageScripts)) expect(script).not.toMatch(/^true(?:\s|$)/);
    const temp = mkdtempSync(join(tmpdir(), "aih-supported-cold-"));
    try {
      const staleOutput = resolve(root, "dist/stale.js");
      mkdirSync(resolve(root, "dist"), { recursive: true });
      writeFileSync(staleOutput, "stale");
      expect((packageJson.scripts as Record<string, string>).build).toMatch(
        /(?:node tools\/clean-dist\.mjs|node -e .*dist.*rmSync).*tsc -p tsconfig\.build\.json/,
      );
      const buildStarted = Date.now();
      const build = spawnSync(process.execPath, [npmCli(), "run", "build"], {
        cwd: root,
        encoding: "utf8",
      });
      expect(build.status).toBe(0);
      expect(existsSync(staleOutput)).toBe(false);
      for (const output of ["dist/cli.js", "dist/index.js"] as const) {
        const outputPath = resolve(root, output);
        expect(existsSync(outputPath)).toBe(true);
        expect(statSync(outputPath).mtimeMs).toBeGreaterThanOrEqual(buildStarted - 1_000);
      }
      if (process.platform !== "win32")
        expect(statSync(resolve(root, "dist/cli.js")).mode & 0o111).not.toBe(0);
      const packed = spawnSync(
        process.execPath,
        [npmCli(), "pack", "--json", "--pack-destination", temp],
        {
          cwd: root,
          encoding: "utf8",
        },
      );
      expect(packed.status).toBe(0);
      const packedManifest = (
        JSON.parse(packed.stdout) as {
          filename: string;
          files: { path: string }[];
        }[]
      )[0];
      const tarball = resolve(temp, packedManifest?.filename ?? "");
      const tarFiles = packedManifest?.files.map((file) => file.path) ?? [];
      expect(tarFiles).not.toHaveLength(0);
      for (const file of tarFiles)
        expect(file).toMatch(
          /^(dist\/|defaults\/|package\.json$|README(?:\.md)?$|LICENSE(?:\.md)?$)/,
        );
      expect(tarFiles.join("\n")).not.toMatch(/\.pem$|^tests\/|^ai-coding\/|^tools\/|hooks\//m);
      expect(tarFiles.filter((path) => path.startsWith("dist/")).sort()).toEqual([
        "dist/cli.d.ts",
        "dist/cli.js",
        "dist/index.d.ts",
        "dist/index.js",
        "dist/supported/signed-catalog-v2.d.ts",
        "dist/supported/signed-catalog-v2.js",
      ]);
      expect(tarFiles).toContain("package.json");
      expect(tarFiles.join("\n")).not.toMatch(
        /(?:^|\/)v1(?:\/|\.|$)|records-v1|provider-watcher-v1/i,
      );
      const consumer = resolve(temp, "consumer");
      mkdirSync(consumer);
      writeFileSync(`${consumer}/package.json`, '{"name":"cold-admin-consumer","private":true}');
      const installed = spawnSync(
        process.execPath,
        [npmCli(), "install", "--offline", "--no-audit", "--no-fund", "--ignore-scripts", tarball],
        {
          cwd: consumer,
          encoding: "utf8",
        },
      );
      expect(installed.status).toBe(0);
      const installedManifest = JSON.parse(
        readFileSync(resolve(consumer, "node_modules/@aihq/supported/package.json"), "utf8"),
      ) as Record<string, unknown>;
      expect(installedManifest).toMatchObject({
        homepage: "https://github.com/samartomar/aih-supported#readme",
        publishConfig: { access: "public" },
        repository: { type: "git", url: "git+https://github.com/samartomar/aih-supported.git" },
      });
      expect(installedManifest.private).toBe(true);

      const fixture = signingFixture();
      const wrongFixture = signingFixture();
      const claimsPath = resolve(temp, "claims.json");
      const changedClaimsPath = resolve(temp, "changed-claims.json");
      const rootPath = resolve(temp, "catalog-signer-root.json");
      const signerPath = resolve(temp, "catalog-signer.json");
      const changedSignerPath = resolve(temp, "changed-catalog-signer.json");
      const privateKeyPath = resolve(temp, "catalog-signer-private.pem");
      const wrongPrivateKeyPath = resolve(temp, "wrong-catalog-signer-private.pem");
      const insecurePrivateKeyPath = resolve(temp, "insecure-catalog-signer-private.pem");
      const insecurePrivateKeyOutputPath = resolve(temp, "insecure-private-key-signed.json");
      const candidatePath = resolve(temp, "candidate.json");
      const repeatedCandidatePath = resolve(temp, "candidate-repeated.json");
      const changedClaimsCandidatePath = resolve(temp, "changed-claims-candidate.json");
      const changedSignerCandidatePath = resolve(temp, "changed-signer-candidate.json");
      const signedCatalogPath = resolve(temp, "signed-catalog.json");
      const existingCandidatePath = resolve(temp, "existing-candidate.json");
      const existingSignedCatalogPath = resolve(temp, "existing-signed-catalog.json");
      const oversizedSignerPath = resolve(temp, "oversized-signer.json");
      const oversizedClaimsPath = resolve(temp, "oversized-claims.json");
      const oversizedInspectClaimsPath = resolve(temp, "oversized-inspect-claims.json");
      const oversizedRootPath = resolve(temp, "oversized-root.json");
      const oversizedPrivateKeyPath = resolve(temp, "oversized-private-key.pem");
      const oversizedSignedCatalogPath = resolve(temp, "oversized-signed-catalog.json");
      const oversizedSeedPath = resolve(temp, "oversized-seed.json");
      const oversizedCandidatePath = resolve(temp, "oversized-candidate.json");
      const oversizedLastAcceptedPath = resolve(temp, "oversized-last-accepted.json");
      const oversizedReplayStatePath = resolve(temp, "oversized-replay-state.json");
      const mustNotReadPrivateKeyPath = resolve(temp, "must-not-read-private-key.pem");
      const successorCandidatePath = resolve(temp, "successor-candidate.json");
      const successorSignedCatalogPath = resolve(temp, "successor-signed-catalog.json");
      const rotatedSuccessorCandidatePath = resolve(temp, "rotated-successor-candidate.json");
      const rotatedSuccessorSignedCatalogPath = resolve(
        temp,
        "rotated-successor-signed-catalog.json",
      );
      const trustedRotationRootsPath = resolve(temp, "trusted-rotation-roots.json");
      const revokedPreviousRootPath = resolve(temp, "revoked-previous-root.json");
      const replayStatePath = resolve(temp, "replay-state.json");
      const candidateInputs = [
        "--valid-from",
        "2026-08-22T00:00:00Z",
        "--valid-until",
        "2026-08-23T00:00:00Z",
        "--sequence",
        "0",
        "--previous-catalog-head-sha256",
        zeroDigest,
      ];
      writeFileSync(claimsPath, canonicalJson(claims() as unknown as Json));
      writeFileSync(
        changedClaimsPath,
        canonicalJson({ ...claims(), repository: "samartomar/other" } as unknown as Json),
      );
      writeFileSync(rootPath, canonicalJson(fixture.catalogSignerRoot as unknown as Json));
      writeFileSync(
        trustedRotationRootsPath,
        canonicalJson({
          catalogSignerRoots: [fixture.catalogSignerRoot, wrongFixture.catalogSignerRoot],
        } as unknown as Json),
      );
      writeFileSync(
        revokedPreviousRootPath,
        canonicalJson({ catalogSignerRoots: [wrongFixture.catalogSignerRoot] } as unknown as Json),
      );
      expect(
        JSON.parse(readFileSync(trustedRotationRootsPath, "utf8")) as Record<string, unknown>,
      ).toEqual({
        catalogSignerRoots: [fixture.catalogSignerRoot, wrongFixture.catalogSignerRoot],
      });
      writeFileSync(signerPath, canonicalJson(fixture.signer as unknown as Json));
      writeFileSync(changedSignerPath, canonicalJson(wrongFixture.signer as unknown as Json));
      expect(Object.keys(JSON.parse(readFileSync(signerPath, "utf8")) as object).sort()).toEqual([
        "class",
        "identity",
        "keyId",
        "publicKeySpkiSha256",
      ]);
      writeFileSync(privateKeyPath, fixture.privateKey.export({ format: "pem", type: "pkcs8" }));
      writeFileSync(
        wrongPrivateKeyPath,
        wrongFixture.privateKey.export({ format: "pem", type: "pkcs8" }),
      );
      const privatePem = readFileSync(privateKeyPath, "utf8");
      const claimsText = readFileSync(claimsPath, "utf8");
      const expectSanitizedCliFailure = (
        result: { status: number | null; stderr: string; stdout: string },
        prohibitedValues: readonly string[],
      ) => {
        expect(result.status).toBe(2);
        expect(result.stdout).toBe("");
        expect(result.stderr).toMatch(/^error: [a-z0-9][a-z0-9-]{2,80}\r?\n?$/i);
        expect(Buffer.byteLength(result.stderr, "utf8")).toBeLessThanOrEqual(128);
        for (const value of prohibitedValues) expect(result.stderr).not.toContain(value);
      };
      const cliPath = resolve(consumer, "node_modules/@aihq/supported/dist/cli.js");
      const installedPackage = resolve(consumer, "node_modules/@aihq/supported");
      const installedSeed = resolve(installedPackage, defaultCatalog.installedSeed as string);
      expect(existsSync(installedSeed)).toBe(true);
      const installedSeedDirectory = dirname(installedSeed);
      const installedSeedText = readFileSync(installedSeed, "utf8");
      const installedSeedCatalog = JSON.parse(installedSeedText) as {
        artifacts: Record<string, string>;
        capabilities: Record<string, string[]>;
        entryId: string;
        platforms: Record<string, string>[];
        qualification: Record<string, unknown>;
        subject: Record<string, unknown>;
      };
      expect(installedSeedCatalog.capabilities).toEqual(defaultCatalog.capabilities);
      expect(installedSeedCatalog.capabilities.commands).toEqual(["catalog.verify"]);
      expect(installedSeedCatalog.capabilities.egress).toEqual(["https://api.github.com"]);
      expect(installedSeedCatalog.capabilities.permissions).toEqual(["contents:read"]);
      expect(installedSeedCatalog.platforms).toEqual(defaultCatalog.platforms);
      expect(installedSeedCatalog.qualification).toEqual(defaultCatalog.qualification);
      const artifactDigests = Object.fromEntries(
        Object.entries(installedSeedCatalog.artifacts).map(([kind, path]) => [
          kind,
          sha(readFileSync(resolve(installedSeedDirectory, path))),
        ]),
      );
      expect(Object.keys(installedSeedCatalog.artifacts).sort()).toEqual([
        "closure",
        "profile",
        "prose",
        "recipe",
      ]);
      for (const unsafeArtifactPath of [
        "../outside.json",
        "/absolute.json",
        "//server/share/artifact.json",
        "\\\\server\\share\\artifact.json",
        "C:\\drive\\artifact.json",
        "defaults\\backslash.json",
        "",
        ".",
        "defaults/../profile.json",
        "defaults",
      ]) {
        const unsafeSeedDirectory = resolve(temp, `unsafe-seed-${sha(unsafeArtifactPath)}`);
        mkdirSync(unsafeSeedDirectory, { recursive: true });
        const confinedArtifacts = Object.fromEntries(
          Object.keys(installedSeedCatalog.artifacts).map((kind) => [
            kind,
            `artifacts/${kind}.json`,
          ]),
        );
        const unsafeSeedPath = resolve(unsafeSeedDirectory, "seed.json");
        writeFileSync(
          unsafeSeedPath,
          canonicalJson({
            ...installedSeedCatalog,
            artifacts: { ...confinedArtifacts, profile: unsafeArtifactPath },
          } as unknown as Json),
        );
        const rejectedUnsafeSeed = spawnSync(
          process.execPath,
          [
            cliPath,
            "generate-candidate",
            "--seed",
            unsafeSeedPath,
            "--signer",
            signerPath,
            "--claims",
            claimsPath,
            ...candidateInputs,
            "--output",
            resolve(temp, `unsafe-seed-output-${sha(unsafeArtifactPath)}.json`),
          ],
          { cwd: consumer, encoding: "utf8" },
        );
        expectSanitizedCliFailure(
          rejectedUnsafeSeed,
          unsafeArtifactPath === "" ? [] : [unsafeArtifactPath],
        );
        expect(rejectedUnsafeSeed.stderr).toMatch(/^error: unsafe-seed-artifact\r?\n$/);
      }
      const externalSeedDirectory = resolve(temp, "external-organization-seed");
      const externalArtifactsDirectory = resolve(externalSeedDirectory, "artifacts");
      mkdirSync(externalArtifactsDirectory, { recursive: true });
      const externalArtifacts = Object.fromEntries(
        Object.entries(installedSeedCatalog.artifacts).map(([kind, installedPath]) => {
          const relativePath = `artifacts/${kind}.json`;
          writeFileSync(
            resolve(externalSeedDirectory, relativePath),
            readFileSync(resolve(installedSeedDirectory, installedPath)),
          );
          return [kind, relativePath];
        }),
      );
      const externalQualification = installedSeedCatalog.qualification as {
        findings: string[];
        gaps: string[];
        report: string;
        rights: string[];
      };
      for (const evidencePath of [
        externalQualification.report,
        ...externalQualification.findings,
        ...externalQualification.gaps,
        ...externalQualification.rights,
      ]) {
        const target = resolve(externalSeedDirectory, evidencePath);
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, readFileSync(resolve(installedSeedDirectory, evidencePath)));
      }
      const externalSeedPath = resolve(externalSeedDirectory, "seed.json");
      writeFileSync(
        externalSeedPath,
        canonicalJson({ ...installedSeedCatalog, artifacts: externalArtifacts } as unknown as Json),
      );
      const externalSeedCandidatePath = resolve(temp, "external-seed-candidate.json");
      const generatedExternalSeed = spawnSync(
        process.execPath,
        [
          cliPath,
          "generate-candidate",
          "--seed",
          externalSeedPath,
          "--signer",
          signerPath,
          "--claims",
          claimsPath,
          ...candidateInputs,
          "--output",
          externalSeedCandidatePath,
        ],
        { cwd: consumer, encoding: "utf8" },
      );
      expect(generatedExternalSeed.status).toBe(0);
      expect(existsSync(externalSeedCandidatePath)).toBe(true);
      const externalSeedObject = JSON.parse(readFileSync(externalSeedPath, "utf8")) as Record<
        string,
        unknown
      >;
      const rejectedEvidenceSeed = (
        suffix: string,
        seedValue: Record<string, unknown>,
        expectedCode: RegExp,
      ) => {
        const path = resolve(externalSeedDirectory, `evidence-${suffix}.json`);
        writeFileSync(path, canonicalJson(seedValue as Json));
        const result = spawnSync(
          process.execPath,
          [
            cliPath,
            "generate-candidate",
            "--seed",
            path,
            "--signer",
            signerPath,
            "--claims",
            claimsPath,
            ...candidateInputs,
            "--output",
            resolve(temp, `evidence-${suffix}-output.json`),
          ],
          { cwd: consumer, encoding: "utf8" },
        );
        expectSanitizedCliFailure(result, [privatePem, claimsText]);
        expect(result.stderr).toMatch(expectedCode);
      };
      rejectedEvidenceSeed(
        "caller-hash",
        {
          ...externalSeedObject,
          qualification: {
            ...externalQualification,
            rights: [{ identity: "right:caller", sha256: sha("caller") }],
          },
        },
        /^error: evidence-unreadable\r?\n$/,
      );
      rejectedEvidenceSeed(
        "missing",
        {
          ...externalSeedObject,
          qualification: { ...externalQualification, report: "evidence/missing.json" },
        },
        /^error: evidence-unreadable\r?\n$/,
      );
      const reportPath = resolve(externalSeedDirectory, externalQualification.report);
      const originalReport = readFileSync(reportPath, "utf8");
      const changedEvidence = (changes: Record<string, unknown>) => {
        writeFileSync(
          reportPath,
          canonicalJson({ ...JSON.parse(originalReport), ...changes } as Json),
        );
        rejectedEvidenceSeed(
          `report-${Object.keys(changes)[0] ?? "changed"}`,
          externalSeedObject,
          /^error: evidence(?:-subject)?\r?\n$/,
        );
        writeFileSync(reportPath, originalReport);
      };
      changedEvidence({ kind: "right" });
      changedEvidence({ subjectDigest: `sha256:${sha("wrong-evidence-subject")}` });
      changedEvidence({ attestor: "!invalid-attestor" });
      changedEvidence({ id: "a".repeat(65) });
      writeFileSync(
        reportPath,
        canonicalJson({ ...JSON.parse(originalReport), id: "a".repeat(64) } as Json),
      );
      expect(
        spawnSync(
          process.execPath,
          [
            cliPath,
            "generate-candidate",
            "--seed",
            externalSeedPath,
            "--signer",
            signerPath,
            "--claims",
            claimsPath,
            ...candidateInputs,
            "--output",
            resolve(temp, "evidence-id-boundary-candidate.json"),
          ],
          { cwd: consumer, encoding: "utf8" },
        ).status,
      ).toBe(0);
      writeFileSync(reportPath, originalReport);
      const oversizeEvidencePath = resolve(externalSeedDirectory, "evidence", "oversize.json");
      writeFileSync(oversizeEvidencePath, Buffer.alloc(1024 * 1024 + 1, 0x20));
      rejectedEvidenceSeed(
        "oversize",
        {
          ...externalSeedObject,
          qualification: { ...externalQualification, report: "evidence/oversize.json" },
        },
        /^error: evidence-too-large\r?\n$/,
      );
      const unreadableEvidencePath = resolve(externalSeedDirectory, "evidence", "unreadable.json");
      mkdirSync(unreadableEvidencePath, { recursive: true });
      rejectedEvidenceSeed(
        "unreadable",
        {
          ...externalSeedObject,
          qualification: { ...externalQualification, report: "evidence/unreadable.json" },
        },
        /^error: seed-artifact-not-regular\r?\n$/,
      );
      const oversizedArtifactPath = resolve(externalSeedDirectory, "artifacts", "profile.json");
      writeFileSync(oversizedArtifactPath, Buffer.alloc(1024 * 1024 + 1, 0x20));
      rejectedEvidenceSeed(
        "oversize-artifact",
        externalSeedObject,
        /^error: artifact-too-large\r?\n$/,
      );
      for (const digest of Object.values(artifactDigests)) expect(digest).toMatch(/^[a-f0-9]{64}$/);
      expect((installedSeedCatalog as Record<string, unknown>).entryId).toBe("recipe.default");
      expect((installedSeedCatalog as Record<string, unknown>).subject).toMatchObject({
        id: "default-profile",
        kind: "profile",
      });
      const installedProfileArtifact = JSON.parse(
        readFileSync(
          resolve(installedSeedDirectory, installedSeedCatalog.artifacts.profile as string),
          "utf8",
        ),
      ) as Record<string, unknown>;
      const installedRecipeArtifact = JSON.parse(
        readFileSync(
          resolve(installedSeedDirectory, installedSeedCatalog.artifacts.recipe as string),
          "utf8",
        ),
      ) as Record<string, unknown>;
      expect(installedProfileArtifact.id).toBe(
        (defaultCatalog.profile as Record<string, unknown>).id,
      );
      expect(installedRecipeArtifact.id).toBe(defaultRecipeArtifact.id);
      if (process.platform !== "win32") {
        chmodSync(privateKeyPath, 0o600);
        chmodSync(wrongPrivateKeyPath, 0o600);
        expect(statSync(privateKeyPath).mode & 0o777).toBe(0o600);
      }
      const unsignedInspection = spawnSync(
        process.execPath,
        [
          cliPath,
          "inspect",
          "--signed-catalog",
          installedSeed,
          "--catalog-signer-root",
          rootPath,
          "--expected-claims",
          claimsPath,
          "--now",
          "2026-08-22T12:00:00Z",
          "--continuity",
          "genesis",
          "--qualification-basis",
          "--entry-id",
          "recipe.default",
        ],
        { cwd: consumer, encoding: "utf8" },
      );
      expectSanitizedCliFailure(unsignedInspection, [privatePem, claimsText, installedSeedText]);
      expect(unsignedInspection.stderr).toMatch(/^error: unsigned-catalog\r?\n$/);
      for (const rejectedAuthority of [
        ["--private-key", privateKeyPath],
        ["--sign-callback", "https://signer.invalid/callback"],
        ["--write-catalog", "https://catalog.invalid/write"],
      ]) {
        const rejectsCandidateSigningAuthority = spawnSync(
          process.execPath,
          [
            cliPath,
            "generate-candidate",
            "--seed",
            installedSeed,
            "--signer",
            signerPath,
            "--claims",
            claimsPath,
            ...candidateInputs,
            ...rejectedAuthority,
            "--output",
            candidatePath,
          ],
          { cwd: consumer, encoding: "utf8" },
        );
        if (rejectedAuthority[0] === "--private-key")
          expectSanitizedCliFailure(rejectsCandidateSigningAuthority, [
            privatePem,
            claimsText,
            installedSeedText,
          ]);
        else expect(rejectsCandidateSigningAuthority.status).not.toBe(0);
      }
      const rejectsCandidateProvider = spawnSync(
        process.execPath,
        [
          cliPath,
          "generate-candidate",
          "--seed",
          installedSeed,
          "--signer",
          signerPath,
          "--claims",
          claimsPath,
          ...candidateInputs,
          "--provider-callback",
          "https://provider.invalid/candidate",
          "--output",
          candidatePath,
        ],
        { cwd: consumer, encoding: "utf8" },
      );
      expect(rejectsCandidateProvider.status).not.toBe(0);
      const existingCandidateMarker = "candidate-output-must-remain-byte-identical";
      writeFileSync(existingCandidatePath, existingCandidateMarker);
      const rejectsExistingCandidateOutput = spawnSync(
        process.execPath,
        [
          cliPath,
          "generate-candidate",
          "--seed",
          installedSeed,
          "--signer",
          signerPath,
          "--claims",
          claimsPath,
          ...candidateInputs,
          "--output",
          existingCandidatePath,
        ],
        { cwd: consumer, encoding: "utf8" },
      );
      expectSanitizedCliFailure(rejectsExistingCandidateOutput, [
        privatePem,
        claimsText,
        installedSeedText,
      ]);
      expect(readFileSync(existingCandidatePath, "utf8")).toBe(existingCandidateMarker);
      const generated = spawnSync(
        process.execPath,
        [
          cliPath,
          "generate-candidate",
          "--seed",
          installedSeed,
          "--signer",
          signerPath,
          "--claims",
          claimsPath,
          ...candidateInputs,
          "--output",
          candidatePath,
        ],
        { cwd: consumer, encoding: "utf8" },
      );
      expect(generated.status).toBe(0);
      const candidateText = readFileSync(candidatePath, "utf8");
      const candidate = JSON.parse(candidateText) as Record<string, unknown>;
      expect(candidateText).toBe(canonicalJson(candidate as unknown as Json));
      const publicApi = await api();
      expect(publicApi.createCatalogHeadV2(candidate)).toEqual(candidate);
      expect(candidate).not.toHaveProperty("signature");
      expect(candidate).not.toHaveProperty("catalogSignerRoot");
      expect(candidate).not.toHaveProperty("privateKey");
      expect(candidate.signer).toEqual(fixture.signer);
      expect(candidate.claims).toEqual(claims());
      expect(Object.keys(candidate.claims as object).sort()).toEqual([
        "environment",
        "eventName",
        "issuer",
        "jobWorkflowRef",
        "ref",
        "repository",
        "repositoryId",
        "repositoryOwnerId",
      ]);
      expect(candidate.validFrom).toBe("2026-08-22T00:00:00Z");
      expect(candidate.validUntil).toBe("2026-08-23T00:00:00Z");
      expect(candidate.sequence).toBe(0);
      expect(candidate.previousCatalogHeadSha256).toBe(zeroDigest);
      expect(
        spawnSync(
          process.execPath,
          [
            cliPath,
            "generate-candidate",
            "--seed",
            installedSeed,
            "--signer",
            signerPath,
            "--claims",
            claimsPath,
            ...candidateInputs,
            "--output",
            repeatedCandidatePath,
            "--unknown-generate-flag",
            "forbidden",
          ],
          { cwd: consumer, encoding: "utf8" },
        ).status,
      ).not.toBe(0);
      const defaultCandidateEntry = (candidate.entries as Record<string, unknown>[]).find(
        (candidateEntry) => candidateEntry.entryId === installedSeedCatalog.entryId,
      ) as Record<string, unknown>;
      expect(defaultCandidateEntry).toBeDefined();
      expect(defaultCandidateEntry.subject).toMatchObject({
        id: (installedSeedCatalog.subject as Record<string, unknown>).id,
        kind: "profile",
        source: {
          type: "aih",
          release: "1.0.0",
          revision: `sha256:${artifactDigests.profile}`,
        },
      });
      const defaultCandidateSubject = defaultCandidateEntry.subject as Record<string, unknown>;
      expect(defaultCandidateSubject.sourceDigest).toBe(
        coreSourceDigest(defaultCandidateSubject.source as Record<string, unknown>),
      );
      expect(defaultCandidateSubject.subjectDigest).toBe(
        coreSubjectDigest(
          defaultCandidateSubject.kind as string,
          defaultCandidateSubject.id as string,
          defaultCandidateSubject.sourceDigest as string,
        ),
      );
      expect(defaultCandidateEntry.recipe).toEqual({
        identity: `artifact:${installedSeedCatalog.artifacts.recipe}`,
        sha256: artifactDigests.recipe,
      });
      expect(defaultCandidateEntry.closure).toEqual({
        identity: `artifact:${installedSeedCatalog.artifacts.closure}`,
        sha256: artifactDigests.closure,
      });
      expect(defaultCandidateEntry.prose).toEqual({
        identity: `artifact:${installedSeedCatalog.artifacts.prose}`,
        sha256: artifactDigests.prose,
      });
      const expectedDefaultSource = {
        release: "1.0.0",
        revision: `sha256:${artifactDigests.profile}`,
        type: "aih",
      };
      const expectedDefaultSourceDigest = coreSourceDigest(expectedDefaultSource);
      const installedQualification = installedSeedCatalog.qualification as {
        findings: string[];
        gaps: string[];
        report: string;
        rights: string[];
      };
      const installedEvidence = (kind: string, path: string) => ({
        identity: `evidence:${kind}:${path}`,
        sha256: sha(readFileSync(resolve(installedSeedDirectory, path))),
      });
      const expectedQualification = {
        findings: installedQualification.findings.map((path) => installedEvidence("finding", path)),
        gaps: installedQualification.gaps.map((path) => installedEvidence("gap", path)),
        report: installedEvidence("report", installedQualification.report),
        rights: installedQualification.rights.map((path) => installedEvidence("right", path)),
      };
      const expectedApiHead = publicApi.createCatalogHeadV2({
        claims: claims(),
        compatibleEffectVersions: ["2"],
        compatibleSchemaVersions: ["2"],
        effectVersion: "2",
        entries: [
          {
            capabilities: installedSeedCatalog.capabilities,
            closure: {
              identity: `artifact:${installedSeedCatalog.artifacts.closure}`,
              sha256: artifactDigests.closure,
            },
            entryId: installedSeedCatalog.entryId,
            platforms: installedSeedCatalog.platforms,
            prose: {
              identity: `artifact:${installedSeedCatalog.artifacts.prose}`,
              sha256: artifactDigests.prose,
            },
            qualification: expectedQualification,
            recipe: {
              identity: `artifact:${installedSeedCatalog.artifacts.recipe}`,
              sha256: artifactDigests.recipe,
            },
            subject: {
              id: (installedSeedCatalog.subject as Record<string, unknown>).id,
              kind: (installedSeedCatalog.subject as Record<string, unknown>).kind,
              source: expectedDefaultSource,
              sourceDigest: expectedDefaultSourceDigest,
              subjectDigest: coreSubjectDigest(
                (installedSeedCatalog.subject as Record<string, unknown>).kind as string,
                (installedSeedCatalog.subject as Record<string, unknown>).id as string,
                expectedDefaultSourceDigest,
              ),
            },
            versions: { effect: "2", schema: "2" },
          },
        ],
        previousCatalogHeadSha256: zeroDigest,
        protocol: "CatalogHeadV2",
        schemaVersion: "2",
        sequence: 0,
        signer: fixture.signer,
        validFrom: "2026-08-22T00:00:00Z",
        validUntil: "2026-08-23T00:00:00Z",
      });
      expect(expectedApiHead).toEqual(candidate);
      expect(expectedApiHead.catalogHeadSha256).toBe(candidate.catalogHeadSha256);
      const repeatedCandidate = spawnSync(
        process.execPath,
        [
          cliPath,
          "generate-candidate",
          "--seed",
          installedSeed,
          "--signer",
          signerPath,
          "--claims",
          claimsPath,
          ...candidateInputs,
          "--output",
          repeatedCandidatePath,
        ],
        { cwd: consumer, encoding: "utf8" },
      );
      expect(repeatedCandidate.status).toBe(0);
      expect(readFileSync(repeatedCandidatePath, "utf8")).toBe(candidateText);
      const inspectionNow = "2026-08-22T12:00:00Z";
      expect(inspectionNow < (candidate.validUntil as string)).toBe(true);
      const changedClaimsCandidate = spawnSync(
        process.execPath,
        [
          cliPath,
          "generate-candidate",
          "--seed",
          installedSeed,
          "--signer",
          signerPath,
          "--claims",
          changedClaimsPath,
          ...candidateInputs,
          "--output",
          changedClaimsCandidatePath,
        ],
        { cwd: consumer, encoding: "utf8" },
      );
      expect(changedClaimsCandidate.status).toBe(0);
      const changedSignerCandidate = spawnSync(
        process.execPath,
        [
          cliPath,
          "generate-candidate",
          "--seed",
          installedSeed,
          "--signer",
          changedSignerPath,
          "--claims",
          claimsPath,
          ...candidateInputs,
          "--output",
          changedSignerCandidatePath,
        ],
        { cwd: consumer, encoding: "utf8" },
      );
      expect(changedSignerCandidate.status).toBe(0);
      expect(
        (JSON.parse(readFileSync(changedClaimsCandidatePath, "utf8")) as Record<string, unknown>)
          .catalogHeadSha256,
      ).not.toBe(candidate.catalogHeadSha256);
      expect(
        (JSON.parse(readFileSync(changedSignerCandidatePath, "utf8")) as Record<string, unknown>)
          .catalogHeadSha256,
      ).not.toBe(candidate.catalogHeadSha256);
      const mutatedCandidatePath = resolve(temp, "mutated-candidate.json");
      const candidateDigest = String(candidate.catalogHeadSha256);
      const mutatedCandidate = {
        ...candidate,
        catalogHeadSha256: `${candidateDigest.startsWith("0") ? "1" : "0"}${candidateDigest.slice(1)}`,
      };
      const mutatedCandidateText = canonicalJson(mutatedCandidate as Json);
      expect(mutatedCandidateText).not.toBe(candidateText);
      expect(mutatedCandidateText).toBe(canonicalJson(JSON.parse(mutatedCandidateText) as Json));
      writeFileSync(mutatedCandidatePath, mutatedCandidateText);
      expect(
        spawnSync(
          process.execPath,
          [
            cliPath,
            "sign-candidate",
            "--candidate",
            mutatedCandidatePath,
            "--private-key",
            privateKeyPath,
            "--output",
            signedCatalogPath,
          ],
          { cwd: consumer, encoding: "utf8" },
        ).status,
      ).not.toBe(0);
      for (const rejectedCandidateInput of [
        ["--seed", installedSeed],
        ["--artifact", installedSeed],
        ["--artifacts", installedSeed],
        ["--provider-callback", "https://provider.invalid/sign"],
        ["--signer", signerPath],
        ["--claims", claimsPath],
      ]) {
        const rejectsSigningCandidateInput = spawnSync(
          process.execPath,
          [
            cliPath,
            "sign-candidate",
            "--candidate",
            candidatePath,
            "--private-key",
            privateKeyPath,
            ...rejectedCandidateInput,
            "--output",
            signedCatalogPath,
          ],
          { cwd: consumer, encoding: "utf8" },
        );
        if (rejectedCandidateInput[0] === "--claims")
          expectSanitizedCliFailure(rejectsSigningCandidateInput, [
            privatePem,
            claimsText,
            candidateText,
          ]);
        else expect(rejectsSigningCandidateInput.status).not.toBe(0);
      }
      if (process.platform !== "win32") {
        writeFileSync(
          insecurePrivateKeyPath,
          fixture.privateKey.export({ format: "pem", type: "pkcs8" }),
        );
        chmodSync(insecurePrivateKeyPath, 0o644);
        const rejectsInsecurePrivateKey = spawnSync(
          process.execPath,
          [
            cliPath,
            "sign-candidate",
            "--candidate",
            candidatePath,
            "--private-key",
            insecurePrivateKeyPath,
            "--output",
            insecurePrivateKeyOutputPath,
          ],
          { cwd: consumer, encoding: "utf8" },
        );
        expectSanitizedCliFailure(rejectsInsecurePrivateKey, [privatePem, candidateText]);
        expect(rejectsInsecurePrivateKey.stderr).toMatch(/^error: private-key-permissions\r?\n$/);
        expect(existsSync(insecurePrivateKeyOutputPath)).toBe(false);
      }
      const rejectsWrongPrivateKey = spawnSync(
        process.execPath,
        [
          cliPath,
          "sign-candidate",
          "--candidate",
          candidatePath,
          "--private-key",
          wrongPrivateKeyPath,
          "--output",
          signedCatalogPath,
        ],
        { cwd: consumer, encoding: "utf8" },
      );
      expectSanitizedCliFailure(rejectsWrongPrivateKey, [
        privatePem,
        readFileSync(wrongPrivateKeyPath, "utf8"),
        candidateText,
      ]);
      expect(
        spawnSync(
          process.execPath,
          [
            cliPath,
            "sign-candidate",
            "--candidate",
            candidatePath,
            "--private-key",
            privateKeyPath,
            "--output",
            signedCatalogPath,
            "--unknown-sign-flag",
            "forbidden",
          ],
          { cwd: consumer, encoding: "utf8" },
        ).status,
      ).not.toBe(0);
      const existingSignedCatalogMarker = "signed-catalog-output-must-remain-byte-identical";
      writeFileSync(existingSignedCatalogPath, existingSignedCatalogMarker);
      const rejectsExistingSignedCatalogOutput = spawnSync(
        process.execPath,
        [
          cliPath,
          "sign-candidate",
          "--candidate",
          candidatePath,
          "--private-key",
          privateKeyPath,
          "--output",
          existingSignedCatalogPath,
        ],
        { cwd: consumer, encoding: "utf8" },
      );
      expectSanitizedCliFailure(rejectsExistingSignedCatalogOutput, [
        privatePem,
        claimsText,
        candidateText,
      ]);
      expect(readFileSync(existingSignedCatalogPath, "utf8")).toBe(existingSignedCatalogMarker);
      const signed = spawnSync(
        process.execPath,
        [
          cliPath,
          "sign-candidate",
          "--candidate",
          candidatePath,
          "--private-key",
          privateKeyPath,
          "--output",
          signedCatalogPath,
        ],
        { cwd: consumer, encoding: "utf8" },
      );
      expect(signed.status).toBe(0);
      const signedCatalog = readFileSync(signedCatalogPath, "utf8");
      const signedArtifact = JSON.parse(signedCatalog) as {
        envelope: { payload: string; payloadType: string };
        head: Record<string, unknown>;
      };
      expect(signedCatalog).toBe(canonicalJson(signedArtifact as unknown as Json));
      expect(canonicalJson(signedArtifact.head as Json)).toBe(candidateText);
      const statement = JSON.parse(
        Buffer.from(signedArtifact.envelope.payload, "base64").toString("utf8"),
      ) as {
        predicate: {
          candidateSha256: string;
          catalogHead: Record<string, unknown>;
          replayIdentity: string;
        };
        subject: readonly { digest: { sha256: string }; name: string }[];
      };
      expect(signedArtifact.envelope.payloadType).toBe("application/vnd.in-toto+json");
      expect(statement.predicate.candidateSha256).toBe(sha(candidateText));
      expect(canonicalJson(statement.predicate.catalogHead as Json)).toBe(candidateText);
      expect(statement.subject).toEqual([
        {
          digest: { sha256: candidate.catalogHeadSha256 },
          name: "aih-supported/CatalogHeadV2",
        },
      ]);
      for (const digest of Object.values(artifactDigests)) expect(signedCatalog).toContain(digest);
      const successorCandidate = spawnSync(
        process.execPath,
        [
          cliPath,
          "generate-candidate",
          "--seed",
          installedSeed,
          "--signer",
          signerPath,
          "--claims",
          claimsPath,
          "--valid-from",
          "2026-08-22T01:00:00Z",
          "--valid-until",
          "2026-08-23T00:00:00Z",
          "--sequence",
          "1",
          "--previous-catalog-head-sha256",
          candidate.catalogHeadSha256 as string,
          "--output",
          successorCandidatePath,
        ],
        { cwd: consumer, encoding: "utf8" },
      );
      expect(successorCandidate.status).toBe(0);
      const signedSuccessorCandidate = spawnSync(
        process.execPath,
        [
          cliPath,
          "sign-candidate",
          "--candidate",
          successorCandidatePath,
          "--private-key",
          privateKeyPath,
          "--output",
          successorSignedCatalogPath,
        ],
        { cwd: consumer, encoding: "utf8" },
      );
      expect(signedSuccessorCandidate.status).toBe(0);
      const generatedRotatedSuccessor = spawnSync(
        process.execPath,
        [
          cliPath,
          "generate-candidate",
          "--seed",
          installedSeed,
          "--signer",
          changedSignerPath,
          "--claims",
          claimsPath,
          "--valid-from",
          "2026-08-22T01:00:00Z",
          "--valid-until",
          "2026-08-23T00:00:00Z",
          "--sequence",
          "1",
          "--previous-catalog-head-sha256",
          candidate.catalogHeadSha256 as string,
          "--output",
          rotatedSuccessorCandidatePath,
        ],
        { cwd: consumer, encoding: "utf8" },
      );
      expect(generatedRotatedSuccessor.status).toBe(0);
      const rotatedSuccessorCandidate = JSON.parse(
        readFileSync(rotatedSuccessorCandidatePath, "utf8"),
      ) as Record<string, unknown>;
      expect(rotatedSuccessorCandidate.signer).toMatchObject({
        identity: fixture.signer.identity,
        keyId: wrongFixture.signer.keyId,
      });
      expect(rotatedSuccessorCandidate.signer).not.toMatchObject({ keyId: fixture.signer.keyId });
      const signedRotatedSuccessor = spawnSync(
        process.execPath,
        [
          cliPath,
          "sign-candidate",
          "--candidate",
          rotatedSuccessorCandidatePath,
          "--private-key",
          wrongPrivateKeyPath,
          "--output",
          rotatedSuccessorSignedCatalogPath,
        ],
        { cwd: consumer, encoding: "utf8" },
      );
      expect(signedRotatedSuccessor.status).toBe(0);
      writeFileSync(replayStatePath, canonicalJson({ acceptedIdentities: [] } as unknown as Json));
      const oneMiB = 1024 * 1024;
      const oversizedSignerSentinel = "OVERSIZED_SIGNER_SENTINEL";
      const oversizedClaimsSentinel = "OVERSIZED_CLAIMS_SENTINEL";
      const oversizedInspectClaimsSentinel = "OVERSIZED_INSPECT_CLAIMS_SENTINEL";
      const oversizedRootSentinel = "OVERSIZED_ROOT_SENTINEL";
      const oversizedPrivateKeySentinel = "OVERSIZED_PRIVATE_KEY_SENTINEL";
      const oversizedLastAcceptedSentinel = "OVERSIZED_LAST_ACCEPTED_SENTINEL";
      const oversizedReplayStateSentinel = "OVERSIZED_REPLAY_STATE_SENTINEL";
      writeFileSync(oversizedSignerPath, `${oversizedSignerSentinel}${"x".repeat(oneMiB)}`);
      writeFileSync(oversizedClaimsPath, `${oversizedClaimsSentinel}${"x".repeat(oneMiB)}`);
      writeFileSync(
        oversizedInspectClaimsPath,
        `${oversizedInspectClaimsSentinel}${"x".repeat(oneMiB)}`,
      );
      writeFileSync(oversizedRootPath, `${oversizedRootSentinel}${"x".repeat(oneMiB)}`);
      writeFileSync(
        oversizedPrivateKeyPath,
        `${oversizedPrivateKeySentinel}${"x".repeat(64 * 1024)}`,
      );
      if (process.platform !== "win32") chmodSync(oversizedPrivateKeyPath, 0o600);
      const rejectsOversizedSigner = spawnSync(
        process.execPath,
        [
          cliPath,
          "generate-candidate",
          "--seed",
          installedSeed,
          "--signer",
          oversizedSignerPath,
          "--claims",
          claimsPath,
          ...candidateInputs,
          "--output",
          resolve(temp, "oversized-signer-candidate.json"),
        ],
        { cwd: consumer, encoding: "utf8" },
      );
      expectSanitizedCliFailure(rejectsOversizedSigner, [
        oversizedSignerSentinel,
        installedSeedText,
      ]);
      expect(rejectsOversizedSigner.stderr).toMatch(/^error: signer-too-large\r?\n$/);
      const rejectsOversizedClaims = spawnSync(
        process.execPath,
        [
          cliPath,
          "generate-candidate",
          "--seed",
          installedSeed,
          "--signer",
          signerPath,
          "--claims",
          oversizedClaimsPath,
          ...candidateInputs,
          "--output",
          resolve(temp, "oversized-claims-candidate.json"),
        ],
        { cwd: consumer, encoding: "utf8" },
      );
      expectSanitizedCliFailure(rejectsOversizedClaims, [
        oversizedClaimsSentinel,
        installedSeedText,
      ]);
      expect(rejectsOversizedClaims.stderr).toMatch(/^error: claims-too-large\r?\n$/);
      const rejectsOversizedPrivateKey = spawnSync(
        process.execPath,
        [
          cliPath,
          "sign-candidate",
          "--candidate",
          candidatePath,
          "--private-key",
          oversizedPrivateKeyPath,
          "--output",
          resolve(temp, "oversized-private-key-signed.json"),
        ],
        { cwd: consumer, encoding: "utf8" },
      );
      expectSanitizedCliFailure(rejectsOversizedPrivateKey, [
        oversizedPrivateKeySentinel,
        candidateText,
      ]);
      expect(rejectsOversizedPrivateKey.stderr).toMatch(/^error: private-key-too-large\r?\n$/);
      const oversizedSeedSentinel = "OVERSIZED_SEED_SENTINEL";
      const oversizedCandidateSentinel = "OVERSIZED_CANDIDATE_SENTINEL";
      writeFileSync(oversizedSeedPath, `${oversizedSeedSentinel}${"x".repeat(8 * oneMiB)}`);
      writeFileSync(
        oversizedCandidatePath,
        `${oversizedCandidateSentinel}${"x".repeat(8 * oneMiB)}`,
      );
      writeFileSync(
        oversizedLastAcceptedPath,
        `${oversizedLastAcceptedSentinel}${"x".repeat(8 * oneMiB)}`,
      );
      writeFileSync(
        oversizedReplayStatePath,
        `${oversizedReplayStateSentinel}${"x".repeat(oneMiB)}`,
      );
      const rejectsOversizedSeedBeforeSignerParse = spawnSync(
        process.execPath,
        [
          cliPath,
          "generate-candidate",
          "--seed",
          oversizedSeedPath,
          "--signer",
          resolve(temp, "must-not-read-signer.json"),
          "--claims",
          claimsPath,
          ...candidateInputs,
          "--output",
          resolve(temp, "oversized-seed-candidate.json"),
        ],
        { cwd: consumer, encoding: "utf8" },
      );
      expectSanitizedCliFailure(rejectsOversizedSeedBeforeSignerParse, [
        oversizedSeedSentinel,
        claimsText,
      ]);
      expect(rejectsOversizedSeedBeforeSignerParse.stderr).toMatch(/^error: seed-too-large\r?\n$/);
      expect(existsSync(resolve(temp, "oversized-seed-candidate.json"))).toBe(false);
      const rejectsOversizedCandidateBeforeKeyParse = spawnSync(
        process.execPath,
        [
          cliPath,
          "sign-candidate",
          "--candidate",
          oversizedCandidatePath,
          "--private-key",
          mustNotReadPrivateKeyPath,
          "--output",
          resolve(temp, "oversized-candidate-signed.json"),
        ],
        { cwd: consumer, encoding: "utf8" },
      );
      expectSanitizedCliFailure(rejectsOversizedCandidateBeforeKeyParse, [
        oversizedCandidateSentinel,
      ]);
      expect(rejectsOversizedCandidateBeforeKeyParse.stderr).toMatch(
        /^error: candidate-too-large\r?\n$/,
      );
      expect(existsSync(resolve(temp, "oversized-candidate-signed.json"))).toBe(false);
      const inspected = spawnSync(
        process.execPath,
        [
          cliPath,
          "inspect",
          "--signed-catalog",
          signedCatalogPath,
          "--catalog-signer-root",
          rootPath,
          "--expected-claims",
          claimsPath,
          "--now",
          inspectionNow,
          "--continuity",
          "genesis",
          "--qualification-basis",
          "--entry-id",
          "recipe.default",
        ],
        { cwd: consumer, encoding: "utf8" },
      );
      expect(inspected.status).toBe(0);
      expect(inspected.stdout).toContain('"kind":"aih-supported"');
      expect(inspected.stdout).toContain('"organizationAdmission":"not-authoritative"');
      const opaqueSignedCatalogPath = resolve(temp, "opaque-signed-catalog.json");
      writeFileSync(
        opaqueSignedCatalogPath,
        canonicalJson({ envelope: opaqueUnknownEnvelope(fixture) } as unknown as Json),
      );
      const opaqueInspection = spawnSync(
        process.execPath,
        [
          cliPath,
          "inspect",
          "--signed-catalog",
          opaqueSignedCatalogPath,
          "--catalog-signer-root",
          rootPath,
          "--expected-claims",
          claimsPath,
          "--now",
          inspectionNow,
          "--continuity",
          "genesis",
        ],
        { cwd: consumer, encoding: "utf8" },
      );
      expect(opaqueInspection.status).toBe(0);
      const opaqueOutput = JSON.parse(opaqueInspection.stdout) as Record<string, unknown>;
      expect(opaqueOutput).toMatchObject({ kind: "unsupported-version" });
      expect(opaqueOutput).not.toHaveProperty("head");
      expect(opaqueOutput).not.toHaveProperty("qualificationBasis");
      const opaqueBasis = spawnSync(
        process.execPath,
        [
          cliPath,
          "inspect",
          "--signed-catalog",
          opaqueSignedCatalogPath,
          "--catalog-signer-root",
          rootPath,
          "--expected-claims",
          claimsPath,
          "--now",
          inspectionNow,
          "--continuity",
          "genesis",
          "--qualification-basis",
          "--entry-id",
          "recipe.default",
        ],
        { cwd: consumer, encoding: "utf8" },
      );
      expectSanitizedCliFailure(opaqueBasis, [claimsText]);
      const replayStateBeforeSuccessorInspection = readFileSync(replayStatePath, "utf8");
      const lastAcceptedBeforeSuccessorInspection = readFileSync(candidatePath, "utf8");
      const inspectedSuccessor = spawnSync(
        process.execPath,
        [
          cliPath,
          "inspect",
          "--signed-catalog",
          successorSignedCatalogPath,
          "--catalog-signer-root",
          rootPath,
          "--expected-claims",
          claimsPath,
          "--now",
          "2026-08-22T12:00:00Z",
          "--last-accepted-head",
          candidatePath,
          "--replay-state",
          replayStatePath,
          "--qualification-basis",
          "--entry-id",
          "recipe.default",
        ],
        { cwd: consumer, encoding: "utf8" },
      );
      expect(inspectedSuccessor.status).toBe(0);
      expect(readFileSync(replayStatePath, "utf8")).toBe(replayStateBeforeSuccessorInspection);
      expect(readFileSync(candidatePath, "utf8")).toBe(lastAcceptedBeforeSuccessorInspection);
      const inspectedRotatedSuccessor = spawnSync(
        process.execPath,
        [
          cliPath,
          "inspect",
          "--signed-catalog",
          rotatedSuccessorSignedCatalogPath,
          "--catalog-signer-root",
          trustedRotationRootsPath,
          "--expected-claims",
          claimsPath,
          "--now",
          inspectionNow,
          "--last-accepted-head",
          candidatePath,
          "--replay-state",
          replayStatePath,
        ],
        { cwd: consumer, encoding: "utf8" },
      );
      expect(inspectedRotatedSuccessor.status).toBe(0);
      expect(readFileSync(replayStatePath, "utf8")).toBe(replayStateBeforeSuccessorInspection);
      expect(readFileSync(candidatePath, "utf8")).toBe(lastAcceptedBeforeSuccessorInspection);
      const revokedOldArtifact = spawnSync(
        process.execPath,
        [
          cliPath,
          "inspect",
          "--signed-catalog",
          signedCatalogPath,
          "--catalog-signer-root",
          revokedPreviousRootPath,
          "--expected-claims",
          claimsPath,
          "--now",
          inspectionNow,
          "--continuity",
          "genesis",
        ],
        { cwd: consumer, encoding: "utf8" },
      );
      expectSanitizedCliFailure(revokedOldArtifact, [signedCatalog, claimsText]);
      const inspectedRevokedRotationSuccessor = spawnSync(
        process.execPath,
        [
          cliPath,
          "inspect",
          "--signed-catalog",
          rotatedSuccessorSignedCatalogPath,
          "--catalog-signer-root",
          revokedPreviousRootPath,
          "--expected-claims",
          claimsPath,
          "--now",
          inspectionNow,
          "--last-accepted-head",
          candidatePath,
          "--replay-state",
          replayStatePath,
        ],
        { cwd: consumer, encoding: "utf8" },
      );
      expect(inspectedRevokedRotationSuccessor.status).toBe(0);
      const tamperedLastAcceptedPath = resolve(temp, "tampered-last-accepted.json");
      const tamperedLastAccepted = JSON.parse(candidateText) as Record<string, unknown>;
      const tamperedLastAcceptedEntries = tamperedLastAccepted.entries as Record<string, unknown>[];
      tamperedLastAcceptedEntries[0] = {
        ...tamperedLastAcceptedEntries[0],
        memberSha256: sha("tampered-last-accepted-member"),
      };
      tamperedLastAccepted.catalogSha256 = domainSha256(
        "aih-supported-catalog/v2",
        tamperedLastAcceptedEntries as Json,
      );
      const tamperedLastAcceptedWithoutHeadDigest = { ...tamperedLastAccepted };
      delete tamperedLastAcceptedWithoutHeadDigest.catalogHeadSha256;
      tamperedLastAccepted.catalogHeadSha256 = domainSha256(
        "aih-supported-catalog-head/v2",
        tamperedLastAcceptedWithoutHeadDigest as Json,
      );
      writeFileSync(tamperedLastAcceptedPath, canonicalJson(tamperedLastAccepted as Json));
      const tamperedSuccessorCandidatePath = resolve(temp, "tampered-successor-candidate.json");
      const tamperedSuccessorSignedCatalogPath = resolve(
        temp,
        "tampered-successor-signed-catalog.json",
      );
      expect(
        spawnSync(
          process.execPath,
          [
            cliPath,
            "generate-candidate",
            "--seed",
            installedSeed,
            "--signer",
            signerPath,
            "--claims",
            claimsPath,
            "--valid-from",
            "2026-08-22T01:00:00Z",
            "--valid-until",
            "2026-08-23T00:00:00Z",
            "--sequence",
            "1",
            "--previous-catalog-head-sha256",
            tamperedLastAccepted.catalogHeadSha256 as string,
            "--output",
            tamperedSuccessorCandidatePath,
          ],
          { cwd: consumer, encoding: "utf8" },
        ).status,
      ).toBe(0);
      expect(
        spawnSync(
          process.execPath,
          [
            cliPath,
            "sign-candidate",
            "--candidate",
            tamperedSuccessorCandidatePath,
            "--private-key",
            privateKeyPath,
            "--output",
            tamperedSuccessorSignedCatalogPath,
          ],
          { cwd: consumer, encoding: "utf8" },
        ).status,
      ).toBe(0);
      const rejectsTamperedLastAccepted = spawnSync(
        process.execPath,
        [
          cliPath,
          "inspect",
          "--signed-catalog",
          tamperedSuccessorSignedCatalogPath,
          "--catalog-signer-root",
          rootPath,
          "--expected-claims",
          claimsPath,
          "--now",
          "2026-08-22T12:00:00Z",
          "--last-accepted-head",
          tamperedLastAcceptedPath,
          "--replay-state",
          replayStatePath,
        ],
        { cwd: consumer, encoding: "utf8" },
      );
      expectSanitizedCliFailure(rejectsTamperedLastAccepted, [candidateText, claimsText]);
      const rejectsSuccessorAsGenesis = spawnSync(
        process.execPath,
        [
          cliPath,
          "inspect",
          "--signed-catalog",
          successorSignedCatalogPath,
          "--catalog-signer-root",
          rootPath,
          "--expected-claims",
          claimsPath,
          "--now",
          "2026-08-22T12:00:00Z",
          "--continuity",
          "genesis",
        ],
        { cwd: consumer, encoding: "utf8" },
      );
      expectSanitizedCliFailure(rejectsSuccessorAsGenesis, [claimsText]);
      const rejectsMixedContinuityInputs = spawnSync(
        process.execPath,
        [
          cliPath,
          "inspect",
          "--signed-catalog",
          successorSignedCatalogPath,
          "--catalog-signer-root",
          rootPath,
          "--expected-claims",
          claimsPath,
          "--now",
          "2026-08-22T12:00:00Z",
          "--continuity",
          "genesis",
          "--last-accepted-head",
          candidatePath,
        ],
        { cwd: consumer, encoding: "utf8" },
      );
      expectSanitizedCliFailure(rejectsMixedContinuityInputs, [claimsText]);
      writeFileSync(
        replayStatePath,
        canonicalJson({
          acceptedIdentities: [statement.predicate.replayIdentity],
        } as unknown as Json),
      );
      const rejectsV2Replay = spawnSync(
        process.execPath,
        [
          cliPath,
          "inspect",
          "--signed-catalog",
          signedCatalogPath,
          "--catalog-signer-root",
          rootPath,
          "--expected-claims",
          claimsPath,
          "--now",
          inspectionNow,
          "--continuity",
          "genesis",
          "--replay-state",
          replayStatePath,
        ],
        { cwd: consumer, encoding: "utf8" },
      );
      expectSanitizedCliFailure(rejectsV2Replay, [signedCatalog, claimsText]);
      const rejectsQualificationBasisWithoutEntryId = spawnSync(
        process.execPath,
        [
          cliPath,
          "inspect",
          "--signed-catalog",
          signedCatalogPath,
          "--catalog-signer-root",
          rootPath,
          "--expected-claims",
          claimsPath,
          "--now",
          inspectionNow,
          "--continuity",
          "genesis",
          "--qualification-basis",
        ],
        { cwd: consumer, encoding: "utf8" },
      );
      expectSanitizedCliFailure(rejectsQualificationBasisWithoutEntryId, [
        signedCatalog,
        claimsText,
      ]);
      for (const missingRequiredFlag of ["--catalog-signer-root", "--expected-claims"] as const) {
        const inspectArgs = [
          cliPath,
          "inspect",
          "--signed-catalog",
          signedCatalogPath,
          "--catalog-signer-root",
          rootPath,
          "--expected-claims",
          claimsPath,
          "--now",
          inspectionNow,
          "--continuity",
          "genesis",
        ];
        const missingIndex = inspectArgs.indexOf(missingRequiredFlag);
        inspectArgs.splice(missingIndex, 2);
        expectSanitizedCliFailure(
          spawnSync(process.execPath, inspectArgs, { cwd: consumer, encoding: "utf8" }),
          [signedCatalog, claimsText],
        );
      }
      const rejectsOversizedRoot = spawnSync(
        process.execPath,
        [
          cliPath,
          "inspect",
          "--signed-catalog",
          signedCatalogPath,
          "--catalog-signer-root",
          oversizedRootPath,
          "--expected-claims",
          claimsPath,
          "--now",
          inspectionNow,
          "--continuity",
          "genesis",
        ],
        { cwd: consumer, encoding: "utf8" },
      );
      expectSanitizedCliFailure(rejectsOversizedRoot, [oversizedRootSentinel, signedCatalog]);
      expect(rejectsOversizedRoot.stderr).toMatch(/^error: catalog-signer-root-too-large\r?\n$/);
      const rejectsOversizedInspectClaims = spawnSync(
        process.execPath,
        [
          cliPath,
          "inspect",
          "--signed-catalog",
          signedCatalogPath,
          "--catalog-signer-root",
          resolve(temp, "must-not-read-root.json"),
          "--expected-claims",
          oversizedInspectClaimsPath,
          "--now",
          inspectionNow,
          "--continuity",
          "genesis",
        ],
        { cwd: consumer, encoding: "utf8" },
      );
      expectSanitizedCliFailure(rejectsOversizedInspectClaims, [oversizedInspectClaimsSentinel]);
      expect(rejectsOversizedInspectClaims.stderr).toMatch(/^error: claims-too-large\r?\n$/);
      const rejectsOversizedLastAccepted = spawnSync(
        process.execPath,
        [
          cliPath,
          "inspect",
          "--signed-catalog",
          signedCatalogPath,
          "--catalog-signer-root",
          rootPath,
          "--expected-claims",
          claimsPath,
          "--now",
          inspectionNow,
          "--last-accepted-head",
          oversizedLastAcceptedPath,
          "--replay-state",
          resolve(temp, "must-not-read-replay-state.json"),
        ],
        { cwd: consumer, encoding: "utf8" },
      );
      expectSanitizedCliFailure(rejectsOversizedLastAccepted, [oversizedLastAcceptedSentinel]);
      expect(rejectsOversizedLastAccepted.stderr).toMatch(
        /^error: last-accepted-head-too-large\r?\n$/,
      );
      const rejectsOversizedReplayState = spawnSync(
        process.execPath,
        [
          cliPath,
          "inspect",
          "--signed-catalog",
          signedCatalogPath,
          "--catalog-signer-root",
          rootPath,
          "--expected-claims",
          claimsPath,
          "--now",
          inspectionNow,
          "--continuity",
          "genesis",
          "--replay-state",
          oversizedReplayStatePath,
        ],
        { cwd: consumer, encoding: "utf8" },
      );
      expectSanitizedCliFailure(rejectsOversizedReplayState, [oversizedReplayStateSentinel]);
      expect(rejectsOversizedReplayState.stderr).toMatch(/^error: replay-state-too-large\r?\n$/);
      writeFileSync(oversizedSignedCatalogPath, "A".repeat(24 * oneMiB + 1));
      const rejectsOversizedSignedCatalog = spawnSync(
        process.execPath,
        [
          cliPath,
          "inspect",
          "--signed-catalog",
          oversizedSignedCatalogPath,
          "--catalog-signer-root",
          rootPath,
          "--expected-claims",
          claimsPath,
          "--now",
          inspectionNow,
          "--continuity",
          "genesis",
        ],
        { cwd: consumer, encoding: "utf8" },
      );
      expectSanitizedCliFailure(rejectsOversizedSignedCatalog, [signedCatalog, claimsText]);
      expect(rejectsOversizedSignedCatalog.stderr).toMatch(
        /^error: signed-catalog-too-large\r?\n$/,
      );
      const inspectedOutput = JSON.parse(inspected.stdout) as Record<string, unknown>;
      expect(inspectedOutput).toMatchObject({
        organizationAdmission: coldAdmin.organizationAdmission,
        verificationMode: coldAdmin.verificationMode,
      });
      expect(inspectedOutput.qualificationBasis).toEqual({
        catalogDigest: `sha256:${candidate.catalogSha256}`,
        catalogHeadDigest: `sha256:${candidate.catalogHeadSha256}`,
        catalogMemberDigest: `sha256:${defaultCandidateEntry.memberSha256}`,
        catalogSignerIdentity: fixture.signer.identity,
        kind: "aih-supported",
        subjectDigest: (defaultCandidateEntry.subject as Record<string, unknown>).subjectDigest,
        subjectKind: "profile",
      });
      expect(
        spawnSync(
          process.execPath,
          [
            cliPath,
            "inspect",
            "--signed-catalog",
            signedCatalogPath,
            "--catalog-signer-root",
            rootPath,
            "--expected-claims",
            claimsPath,
            "--now",
            inspectionNow,
            "--continuity",
            "genesis",
            "--unknown-inspect-flag",
            "forbidden",
          ],
          { cwd: consumer, encoding: "utf8" },
        ).status,
      ).not.toBe(0);
      for (const omittedFlag of ["--now", "--continuity"]) {
        const args = [
          cliPath,
          "inspect",
          "--signed-catalog",
          signedCatalogPath,
          "--catalog-signer-root",
          rootPath,
          "--expected-claims",
          claimsPath,
          "--now",
          inspectionNow,
          "--continuity",
          "genesis",
        ];
        const offset = args.indexOf(omittedFlag);
        args.splice(offset, 2);
        expect(
          spawnSync(process.execPath, args, { cwd: consumer, encoding: "utf8" }).status,
        ).not.toBe(0);
      }
      const tamperedSignedCatalogPath = resolve(temp, "tampered-signed-catalog.json");
      const wrongRootPath = resolve(temp, "wrong-catalog-signer-root.json");
      writeFileSync(tamperedSignedCatalogPath, `${signedCatalog} `);
      writeFileSync(
        wrongRootPath,
        canonicalJson(wrongFixture.catalogSignerRoot as unknown as Json),
      );
      for (const [flag, value] of [
        ["--expected-claims", changedClaimsPath],
        ["--catalog-signer-root", wrongRootPath],
        ["--now", "2026-08-24T00:00:00Z"],
        ["--signed-catalog", tamperedSignedCatalogPath],
      ] as const) {
        const rejectedInspection = spawnSync(
          process.execPath,
          [
            cliPath,
            "inspect",
            "--signed-catalog",
            flag === "--signed-catalog" ? value : signedCatalogPath,
            "--catalog-signer-root",
            flag === "--catalog-signer-root" ? value : rootPath,
            "--expected-claims",
            flag === "--expected-claims" ? value : claimsPath,
            "--now",
            flag === "--now" ? value : inspectionNow,
            "--continuity",
            "genesis",
            "--qualification-basis",
          ],
          { cwd: consumer, encoding: "utf8" },
        );
        if (flag === "--expected-claims" || flag === "--signed-catalog")
          expectSanitizedCliFailure(rejectedInspection, [
            claimsText,
            readFileSync(changedClaimsPath, "utf8"),
            signedCatalog,
          ]);
        else expect(rejectedInspection.status).not.toBe(0);
      }
    } finally {
      rmSync(temp, { force: true, recursive: true });
    }
  }, 180_000);

  it("requires a manual exact-SHA OIDC/keyless workflow split into no-authority candidate, protected signer, and independent verifier jobs", () => {
    const packageJson = readFileSync(resolve(root, "package.json"), "utf8");
    const verificationWorkflow = readFileSync(
      resolve(root, ".github/workflows/verify.yml"),
      "utf8",
    );
    const workflowPath = resolve(root, ".github/workflows/signed-catalog-v2.yml");

    expect(packageJson).toContain(
      '"verify:default-evidence-chain": "vitest run tests/supported/default-evidence-chain.test.ts"',
    );
    expect(packageJson).toContain(
      '"verify:workflow-action-pins": "node tools/verify-pinned-actions.mjs"',
    );
    expect(verificationWorkflow).toContain("npm run verify:default-evidence-chain");
    expect(verificationWorkflow).toMatch(/push:\s*\n\s*branches:\s*\[main\]/);
    expect(verificationWorkflow).toContain("npm run verify:workflow-action-pins");
    expect(existsSync(workflowPath)).toBe(true);
    const workflow = readFileSync(workflowPath, "utf8");
    const actionRefs = [...workflow.matchAll(/^\s*(?:-\s*)?uses:\s*(\S+)/gm)];
    expect(actionRefs.length).toBeGreaterThan(0);
    for (const use of actionRefs) expect(use[1]).toMatch(/^[^@\s]+@[0-9a-f]{40}$/);
    expect(workflow).toContain("actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02");
    expect(workflow).toContain(
      "actions/attest-build-provenance@4d101475d8b20a2381f78447822ac1eab6504dd8",
    );
    expect(workflow).toMatch(/^on:\s*\n\s*workflow_dispatch:/m);
    expect(workflow).toMatch(/commit_sha:[\s\S]*required:\s*true/);
    expect(workflow).toMatch(/signed_catalog_sha256:[\s\S]*required:\s*true/);
    expect(workflow).toMatch(/promotion_plan_sha256:[\s\S]*required:\s*true/);
    expect(workflow).toMatch(/continuity_mode:[\s\S]*required:\s*true/);
    expect(workflow).toContain("last_accepted_head_path");
    expect(workflow).toContain("last_accepted_head_sha256");
    const candidate = workflowJob(workflow, "candidate");
    const signer = workflowJob(workflow, "sign");
    const verifier = workflowJob(workflow, "verify");
    const runBlocks = workflowRunBlocks(workflow);
    expect(runBlocks.length).toBeGreaterThan(0);
    for (const run of runBlocks) expect(run).not.toMatch(/\$\{\{[^}]+\}\}/);
    const candidateEnv = workflowEnvBindings(candidate);
    const signerEnv = workflowEnvBindings(signer);
    const verifierEnv = workflowEnvBindings(verifier);
    expect(candidate).toMatch(/permissions:\s*\n\s*contents:\s*read/);
    expect(candidate).toMatch(/persist-credentials:\s*false/);
    expect(candidate).toMatch(/\[0-9a-f\]\{40\}/);
    expect(candidate).not.toMatch(
      /id-token:\s*write|contents:\s*write|\b(sign|cosign|sigstore)\b/i,
    );
    expect(candidateEnv).toMatchObject({
      EXPECTED_COMMIT_SHA: "$" + "{{ inputs.commit_sha }}",
      ACTUAL_DISPATCH_SHA: "$" + "{{ github.sha }}",
      EXPECTED_REF: "$" + "{{ github.ref }}",
    });
    expect(candidateEnv).not.toHaveProperty("EXPECTED_PROMOTION_PLAN_SHA256");
    expect(candidate).toMatch(
      /actions\/checkout[\s\S]*ref:\s*\$\{\{\s*env\.EXPECTED_COMMIT_SHA\s*\}\}/,
    );
    expect(candidate).toMatch(/actual_commit\s*=\s*["']?\$\(git rev-parse HEAD\)/i);
    expect(candidate).toMatch(/test\s+"\$EXPECTED_COMMIT_SHA"\s+=\s+"\$ACTUAL_DISPATCH_SHA"/);
    expect(candidate).toMatch(/\[\[\s+"\$EXPECTED_COMMIT_SHA"\s+=~\s+\^\[0-9a-f\]\{40\}\$\s+\]\]/i);
    expect(candidate).toMatch(
      /\[\[\s+"\$EXPECTED_REF"\s+=~\s+\^refs\/heads\/[a-z0-9._/-]+\$\s+\]\]/i,
    );
    expect(candidate).toMatch(
      /(?:if|test)\s+[^\n]*actual_commit[^\n]*(?:!=|==|=)[^\n]*EXPECTED_COMMIT_SHA/i,
    );
    expect(candidate).not.toMatch(/git merge-base --is-ancestor/i);
    expect(candidate).toMatch(/sha256sum|shasum/);
    expect(candidate).toMatch(/realpath\s+-e\s+"?\$GITHUB_WORKSPACE/i);
    expect(candidate).toMatch(/git ls-files --error-unmatch/i);
    expect(candidate).toMatch(/CONTINUITY_MODE.*(?:genesis|successor)/s);
    expect(candidate).toMatch(/planCatalogPromotionV2/);
    expect(candidate).toMatch(/actions\/upload-artifact@[0-9a-f]{40}/);
    expect(candidate).toMatch(/regenerated_candidate|regenerated-candidate/i);
    expect(candidate).toMatch(/embedded_catalog_head|embedded-catalog-head/i);
    expect(candidate).toMatch(/promotion-plan|promotion_plan/i);
    expect(candidate).toMatch(/candidateCatalogHeadSha256/);
    expect(candidate).toMatch(/lastGoodCatalogHeadSha256/);
    expect(candidate).toMatch(/facts:plan\.facts/);
    expect(candidate).toMatch(
      /(?:cmp|diff|test|if)[^\n]*(?:regenerated_candidate|regenerated-candidate)[^\n]*(?:embedded_catalog_head|embedded-catalog-head)/i,
    );
    const candidateComparisonIndex = candidate.search(
      /(?:cmp|diff|test|if)[^\n]*(?:regenerated_candidate|regenerated-candidate)[^\n]*(?:embedded_catalog_head|embedded-catalog-head)/i,
    );
    const candidateUploadIndex = candidate.search(/actions\/upload-artifact@[0-9a-f]{40}/);
    const candidateInspectIndex = candidate.search(
      /(?:node\s+dist\/cli\.js|aih-supported)\s+inspect/i,
    );
    expect(candidate).toMatch(/(?:node\s+dist\/cli\.js|aih-supported)\s+inspect/i);
    for (const flag of ["--signed-catalog", "--catalog-signer-root", "--expected-claims", "--now"])
      expect(candidate).toContain(flag);
    expect(candidate).toMatch(/--continuity\s+genesis|--last-accepted-head/i);
    expect(candidateComparisonIndex).toBeGreaterThanOrEqual(0);
    expect(candidateInspectIndex).toBeGreaterThanOrEqual(0);
    expect(candidateComparisonIndex).toBeGreaterThan(candidateInspectIndex);
    expect(candidateUploadIndex).toBeGreaterThan(candidateComparisonIndex);
    const candidateCommitAssignmentIndex = candidate.search(
      /actual_commit\s*=\s*["']?\$\(git rev-parse HEAD\)/i,
    );
    const candidateCommitCompareIndex = candidate.search(
      /(?:if|test)\s+[^\n]*actual_commit[^\n]*(?:!=|==|=)[^\n]*EXPECTED_COMMIT_SHA/i,
    );
    const candidateCommitFormatIndex = candidate.search(
      /\[\[\s+"\$EXPECTED_COMMIT_SHA"\s+=~\s+\^\[0-9a-f\]\{40\}\$\s+\]\]/i,
    );
    const candidateRefFormatIndex = candidate.search(
      /\[\[\s+"\$EXPECTED_REF"\s+=~\s+\^refs\/heads\/[a-z0-9._/-]+\$\s+\]\]/i,
    );
    const candidateGenerationIndex = candidate.search(
      /(?:node\s+dist\/cli\.js|aih-supported)\s+generate-candidate/i,
    );
    expect(candidateCommitAssignmentIndex).toBeGreaterThanOrEqual(0);
    expect(candidateCommitFormatIndex).toBeGreaterThanOrEqual(0);
    expect(candidateRefFormatIndex).toBeGreaterThan(candidateCommitFormatIndex);
    expect(candidateCommitCompareIndex).toBeGreaterThan(candidateCommitAssignmentIndex);
    expect(candidateCommitCompareIndex).toBeGreaterThan(candidateCommitFormatIndex);
    expect(candidateGenerationIndex).toBeGreaterThan(candidateRefFormatIndex);
    for (const githubContext of [
      "github.repository",
      "github.repository_id",
      "github.repository_owner_id",
      "github.ref",
      "github.workflow_ref",
      "github.event_name",
    ])
      expect(candidate).toContain(githubContext);
    expect(candidate).toMatch(/inner.*claims|claims.*github/i);
    expect(candidate).not.toMatch(
      /inner.*(?:run_id|run_attempt|github\.sha)|claims.*(?:run_id|run_attempt)/i,
    );
    expect(signer).toMatch(/environment:\s*catalog-signing/);
    expect(signer).toMatch(/needs:\s*(?:candidate|\[\s*candidate\s*\])/);
    expect(signerEnv).toMatchObject({
      EXPECTED_SIGNED_CATALOG_SHA256: "$" + "{{ inputs.signed_catalog_sha256 }}",
      EXPECTED_PROMOTION_PLAN_SHA256: "$" + "{{ inputs.promotion_plan_sha256 }}",
      EXPECTED_COMMIT_SHA: "$" + "{{ inputs.commit_sha }}",
      ACTUAL_DISPATCH_SHA: "$" + "{{ github.sha }}",
    });
    expect(signer).toMatch(/actions\/download-artifact@[0-9a-f]{40}/);
    expect(signer).toMatch(/\[0-9a-f\]\{64\}/);
    expect(signer).toMatch(/id-token:\s*write/);
    expect(signer).toMatch(/sha256sum|shasum/);
    expect(signer).toMatch(/signed_catalog_sha256/);
    expect(signer).toMatch(/promotion_plan_sha256/);
    expect(signer).toMatch(/actual_promotion_plan_sha256/);
    expect(signer).toMatch(/test\s+"\$EXPECTED_COMMIT_SHA"\s+=\s+"\$ACTUAL_DISPATCH_SHA"/);
    expect(signer).toMatch(
      /test\s+"\$actual_promotion_plan_sha256"\s+=\s+"\$EXPECTED_PROMOTION_PLAN_SHA256"/,
    );
    expect(signer).toMatch(/actual_catalog_sha256\s*=\s*["']?\$\((?:sha256sum|shasum)/i);
    expect(signer).toMatch(
      /\[\[\s+"\$EXPECTED_SIGNED_CATALOG_SHA256"\s+=~\s+\^\[0-9a-f\]\{64\}\$\s+\]\]/i,
    );
    expect(signer).toMatch(
      /(?:if|test)\s+[^\n]*actual_catalog_sha256[^\n]*(?:!=|==|=)[^\n]*EXPECTED_SIGNED_CATALOG_SHA256/i,
    );
    expect(signer).toMatch(/(sigstore|cosign|keyless)/i);
    expect(signer).toMatch(
      /(provenance|attestation).*(signed-catalog|artifact)|(signed-catalog|artifact).*(provenance|attestation)/i,
    );
    expect(signer).not.toMatch(
      /actions\/checkout|npm\s|candidate\.ts|contents:\s*write|catalogSignerRoot|ed25519.*generate|private.*key|\b(curl|wget|gh\s+api)\b/i,
    );
    expect(signer).toMatch(/administrator.*ed25519.*DSSE|DSSE.*administrator.*ed25519/i);
    expect(signer).toMatch(/keyless.*(provenance|publication)|(provenance|publication).*keyless/i);
    expect(signer).toMatch(/GitHub.*attestation|attestation.*GitHub/i);
    expect(signer).toMatch(/transparency/i);
    expect(signer).toMatch(/attestations:\s*write/);
    expect(signer).toMatch(/(?:actions\/attest-build-provenance|sigstore\/cosign)@[0-9a-f]{40}/);
    expect(signer).toMatch(
      /attest-build-provenance@[0-9a-f]{40}[\s\S]*subject-path:\s*\$\{\{\s*env\.SIGNED_CATALOG_PATH\s*\}\}/i,
    );
    expect(signer).not.toMatch(/subject-digest:/i);
    const signerDigestAssignmentIndex = signer.search(
      /actual_catalog_sha256\s*=\s*["']?\$\((?:sha256sum|shasum)/i,
    );
    const signerDigestCompareIndex = signer.search(
      /(?:if|test)\s+[^\n]*actual_catalog_sha256[^\n]*(?:!=|==|=)[^\n]*EXPECTED_SIGNED_CATALOG_SHA256/i,
    );
    const signerDigestFormatIndex = signer.search(
      /\[\[\s+"\$EXPECTED_SIGNED_CATALOG_SHA256"\s+=~\s+\^\[0-9a-f\]\{64\}\$\s+\]\]/i,
    );
    const outerAttestationIndex = signer.search(
      /(?:actions\/attest-build-provenance|sigstore\/cosign)@[0-9a-f]{40}/i,
    );
    const signerDispatchCompareIndex = signer.search(
      /test\s+"\$EXPECTED_COMMIT_SHA"\s+=\s+"\$ACTUAL_DISPATCH_SHA"/,
    );
    expect(signerDigestAssignmentIndex).toBeGreaterThanOrEqual(0);
    expect(signerDigestFormatIndex).toBeGreaterThanOrEqual(0);
    expect(signerDigestAssignmentIndex).toBeGreaterThan(signerDigestFormatIndex);
    expect(signerDigestCompareIndex).toBeGreaterThan(signerDigestAssignmentIndex);
    expect(outerAttestationIndex).toBeGreaterThan(signerDigestCompareIndex);
    const signerPromotionPlanCompareIndex = signer.search(
      /test\s+"\$actual_promotion_plan_sha256"\s+=\s+"\$EXPECTED_PROMOTION_PLAN_SHA256"/,
    );
    expect(signerPromotionPlanCompareIndex).toBeGreaterThan(signerDigestAssignmentIndex);
    expect(signerDispatchCompareIndex).toBeGreaterThanOrEqual(0);
    expect(outerAttestationIndex).toBeGreaterThan(signerDispatchCompareIndex);
    expect(outerAttestationIndex).toBeGreaterThan(signerPromotionPlanCompareIndex);
    expect(verifier).toMatch(/actions\/download-artifact/);
    expect(verifier).toMatch(/npm\s+(ci|run)/);
    expect(verifier).toMatch(/needs:\s*(?:sign|\[\s*sign\s*\])/);
    expect(verifier).not.toMatch(/needs:\s*(?:candidate|\[[^\]]*candidate)/i);
    expect(verifier).toMatch(/permissions:\s*\n\s*contents:\s*read/);
    expect(verifier).not.toMatch(/(?:id-token|attestations|contents):\s*write/i);
    expect(verifierEnv).toMatchObject({
      EXPECTED_COMMIT_SHA: "$" + "{{ inputs.commit_sha }}",
      EXPECTED_REF: "$" + "{{ github.ref }}",
      EXPECTED_REPOSITORY: "$" + "{{ github.repository }}",
      EXPECTED_SIGNED_CATALOG_SHA256: "$" + "{{ inputs.signed_catalog_sha256 }}",
      EXPECTED_PROMOTION_PLAN_SHA256: "$" + "{{ inputs.promotion_plan_sha256 }}",
    });
    expect(verifier).toMatch(
      /actions\/checkout[\s\S]*ref:\s*\$\{\{\s*env\.EXPECTED_COMMIT_SHA\s*\}\}/,
    );
    expect(verifier).toMatch(/actual_commit\s*=\s*["']?\$\(git rev-parse HEAD\)/i);
    expect(verifier).toMatch(/\[\[\s+"\$EXPECTED_COMMIT_SHA"\s+=~\s+\^\[0-9a-f\]\{40\}\$\s+\]\]/i);
    expect(verifier).toMatch(
      /\[\[\s+"\$EXPECTED_SIGNED_CATALOG_SHA256"\s+=~\s+\^\[0-9a-f\]\{64\}\$\s+\]\]/i,
    );
    expect(verifier).toMatch(
      /\[\[\s+"\$EXPECTED_REF"\s+=~\s+\^refs\/heads\/[a-z0-9._/-]+\$\s+\]\]/i,
    );
    expect(verifier).toMatch(
      /(?:if|test)\s+[^\n]*actual_commit[^\n]*(?:!=|==|=)[^\n]*EXPECTED_COMMIT_SHA/i,
    );
    expect(verifier).not.toMatch(/git merge-base --is-ancestor/i);
    expect(verifier).toMatch(/(?:node\s+dist\/cli\.js|aih-supported)\s+inspect/i);
    expect(verifier).toMatch(/realpath\s+-e\s+"?\$GITHUB_WORKSPACE/i);
    expect(verifier).toMatch(/git ls-files --error-unmatch/i);
    expect(verifier).toMatch(/planCatalogPromotionV2/);
    expect(verifier).toMatch(/promotion-plan|promotion_plan/i);
    for (const flag of ["--signed-catalog", "--catalog-signer-root", "--expected-claims", "--now"])
      expect(verifier).toContain(flag);
    expect(verifier).toMatch(
      /(?:sha256sum|shasum).*EXPECTED_SIGNED_CATALOG_SHA256|EXPECTED_SIGNED_CATALOG_SHA256.*(?:sha256sum|shasum)/i,
    );
    const outerAttestationStep = workflow.match(
      /- name: verify outer attestation\s+env:\s+GH_TOKEN:\s+\$\{\{ github\.token \}\}\s+run:\s+\|\s+gh attestation verify "\$SIGNED_CATALOG_PATH" --repo "\$EXPECTED_REPOSITORY" --source-digest "\$EXPECTED_COMMIT_SHA"\s*$/m,
    );
    expect(outerAttestationStep).not.toBeNull();
    const verifierDigestAssignmentIndex = verifier.search(
      /actual_catalog_sha256\s*=\s*["']?\$\((?:sha256sum|shasum)/i,
    );
    const verifierDigestCompareIndex = verifier.search(
      /(?:if|test)\s+[^\n]*actual_catalog_sha256[^\n]*(?:!=|==|=)[^\n]*EXPECTED_SIGNED_CATALOG_SHA256/i,
    );
    const verifierCommitFormatIndex = verifier.search(
      /\[\[\s+"\$EXPECTED_COMMIT_SHA"\s+=~\s+\^\[0-9a-f\]\{40\}\$\s+\]\]/i,
    );
    const verifierDigestFormatIndex = verifier.search(
      /\[\[\s+"\$EXPECTED_SIGNED_CATALOG_SHA256"\s+=~\s+\^\[0-9a-f\]\{64\}\$\s+\]\]/i,
    );
    const verifierRefFormatIndex = verifier.search(
      /\[\[\s+"\$EXPECTED_REF"\s+=~\s+\^refs\/heads\/[a-z0-9._/-]+\$\s+\]\]/i,
    );
    const verifierInspectIndex = verifier.search(
      /(?:node\s+dist\/cli\.js|aih-supported)\s+inspect/i,
    );
    const verifierCommitCompareIndex = verifier.search(
      /(?:if|test)\s+[^\n]*actual_commit[^\n]*(?:!=|==|=)[^\n]*EXPECTED_COMMIT_SHA/i,
    );
    expect(verifierDigestAssignmentIndex).toBeGreaterThanOrEqual(0);
    expect(verifierCommitFormatIndex).toBeGreaterThanOrEqual(0);
    expect(verifierDigestFormatIndex).toBeGreaterThan(verifierCommitFormatIndex);
    expect(verifierRefFormatIndex).toBeGreaterThan(verifierDigestFormatIndex);
    expect(verifierCommitCompareIndex).toBeGreaterThan(verifierCommitFormatIndex);
    expect(verifierDigestAssignmentIndex).toBeGreaterThan(verifierDigestFormatIndex);
    expect(verifierDigestCompareIndex).toBeGreaterThan(verifierDigestAssignmentIndex);
    expect(verifierInspectIndex).toBeGreaterThan(verifierDigestCompareIndex);
    const outerAttestationStepIndex = workflow.indexOf("- name: verify outer attestation");
    expect(outerAttestationStepIndex).toBeGreaterThan(
      workflow.indexOf("- name: verify signed catalog"),
    );
    expect(workflow).not.toMatch(/\b(release|publish|create-release|git tag)\b/i);
  });
});
