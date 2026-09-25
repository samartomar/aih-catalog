import { createHash, generateKeyPairSync, type KeyObject, sign } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// A genuine Scanner publication over a fixture tree, and what Scan's consumer-handoff tool
// (aih-scan tools/emit-consumer-handoff.mjs) makes of it: the signed statement over a receipt and
// request with Scan's domain digests, the aih-native annex and one SARIF annex per other analyzer,
// all bound by the receipt; the publication's outer Sigstore attestation (a certificate with the
// publisher workflow's Fulcio identity, a DSSE signature, and a transparency-log entry with an
// inclusion proof); and the consumer handoff with its component artifacts.

type Json = Record<string, unknown>;

export interface FixtureComponent {
  id: string;
  content: string;
  paths: string[];
  analyzers?: string[];
}
/** One SARIF observation: a result, or a tool-execution notification (global without a path). */
export interface FixtureObservation {
  analyzer: string;
  ruleId?: string;
  path?: string;
  level?: string;
  message?: string;
  notification?: boolean;
}
export interface PublicationOptions {
  directory: string;
  source: Json;
  files: Record<string, string>;
  components: FixtureComponent[];
  treeOf: (paths: string[]) => string;
  observations: FixtureObservation[];
  mapped: string[];
  analyzers?: string[];
  requestProfile?: string;
  signedAt?: string;
  expiresAt?: string;
  nativeOverride?: Record<string, string>;
  tamperReceipt?: boolean;
  signer?: { privateKey: KeyObject; publicKey: KeyObject };
  contentClass?: string;
  /** The Catalog asset a mapped Scanner component maps to (default <source>/<content>:<id suffix>). */
  catalogAssetIds?: Record<string, string>;
}

type Reproduce = (input: {
  publication: unknown;
  predicate: unknown;
  publicationSha256: string;
  publisherCommit: string;
  mapping: unknown;
}) => { fields: Json; artifacts: Map<string, { name: string; bytes: Buffer }> };

async function reproduction(): Promise<Reproduce> {
  // @ts-expect-error The maintenance module is intentionally plain ESM JavaScript.
  const module = await import("../../tools/scanner-consumer-handoff-v1.mjs");
  return module.reproduceConsumerHandoffV1 as Reproduce;
}

export const canonical = (value: unknown): string => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const item = value as Json;
  return `{${Object.keys(item)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(item[key])}`)
    .join(",")}}`;
};
export const sha256 = (value: string | Buffer): string =>
  createHash("sha256").update(value).digest("hex");
export const writeJson = (path: string, value: unknown) => writeFileSync(path, canonical(value));
const pae = (payloadType: string, payload: Buffer) =>
  Buffer.concat([
    Buffer.from(`DSSEv1 ${Buffer.byteLength(payloadType)} ${payloadType} ${payload.length} `),
    payload,
  ]);

export const PUBLISHER_COMMIT = "e".repeat(40);
const REPOSITORY = "samartomar/aih-scan";
const REPOSITORY_URI = `https://github.com/${REPOSITORY}`;
const WORKFLOW_PATH = ".github/workflows/baseline-publication.yml";
const WORKFLOW_URI = `${REPOSITORY_URI}/${WORKFLOW_PATH}@refs/heads/main`;
const RUN_ID = 4242;
const RUN_URI = `${REPOSITORY_URI}/actions/runs/${RUN_ID}/attempts/1`;
const NATIVE_MEDIA_TYPE = "application/vnd.aih.baseline-native+json";

// DER, just enough for one Fulcio-shaped leaf certificate.
function der(tag: number, content: Buffer): Buffer {
  const length = content.length;
  const header =
    length < 0x80
      ? Buffer.from([tag, length])
      : length < 0x100
        ? Buffer.from([tag, 0x81, length])
        : Buffer.from([tag, 0x82, length >> 8, length & 0xff]);
  return Buffer.concat([header, content]);
}
const sequence = (...parts: Buffer[]) => der(0x30, Buffer.concat(parts));
const oid = (hex: string) => der(0x06, Buffer.from(hex, "hex"));
const utf8 = (value: string) => der(0x0c, Buffer.from(value, "utf8"));
const utcTime = (moment: number) => {
  const iso = new Date(moment).toISOString();
  return der(
    0x17,
    Buffer.from(
      `${iso.slice(2, 4)}${iso.slice(5, 7)}${iso.slice(8, 10)}${iso.slice(11, 13)}${iso.slice(14, 16)}${iso.slice(17, 19)}Z`,
    ),
  );
};
const ECDSA_SHA256 = sequence(oid("2a8648ce3d040302"));
const fulcio = (arc: number, value: Buffer) =>
  sequence(oid(`2b0601040183bf3001${arc.toString(16).padStart(2, "0")}`), der(0x04, value));

export interface AttestationIdentity {
  sourceRepositoryDigest?: string;
  buildSignerURI?: string;
  subjects?: readonly string[];
  integratedTime?: number;
  resignWith?: boolean;
}

/**
 * The outer attestation of `publicationSha256`: a certificate for the publisher workflow, the
 * DSSE-signed SLSA statement naming the publication, and a transparency-log entry whose inclusion
 * proof reaches a three-leaf root. `identity` bends one fact for a refusal test.
 */
export function attestationBundle(
  publicationSha256: string,
  signedAt: string,
  identity: AttestationIdentity = {},
): { bytes: Buffer; integratedTime: number } {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const signed = Date.parse(signedAt);
  const integratedTime = identity.integratedTime ?? Math.floor(signed / 1000) + 60;
  const digest = identity.sourceRepositoryDigest ?? PUBLISHER_COMMIT;
  const tbs = sequence(
    der(0xa0, der(0x02, Buffer.from([2]))),
    der(0x02, Buffer.from([1])),
    ECDSA_SHA256,
    sequence(der(0x31, sequence(oid("55040a"), utf8("sigstore.dev")))),
    sequence(utcTime(signed - 60_000), utcTime(signed + 600_000)),
    sequence(),
    publicKey.export({ format: "der", type: "spki" }),
    der(
      0xa3,
      sequence(
        sequence(
          oid("551d11"),
          der(0x04, sequence(der(0x86, Buffer.from(identity.buildSignerURI ?? WORKFLOW_URI)))),
        ),
        fulcio(4, Buffer.from("immutable baseline publication")),
        fulcio(8, utf8("https://token.actions.githubusercontent.com")),
        fulcio(9, utf8(identity.buildSignerURI ?? WORKFLOW_URI)),
        fulcio(10, utf8(PUBLISHER_COMMIT)),
        fulcio(11, utf8("github-hosted")),
        fulcio(12, utf8(REPOSITORY_URI)),
        fulcio(13, utf8(digest)),
        fulcio(14, utf8("refs/heads/main")),
        fulcio(20, utf8("workflow_dispatch")),
        fulcio(21, utf8(RUN_URI)),
      ),
    ),
  );
  const certificate = sequence(
    tbs,
    ECDSA_SHA256,
    der(0x03, Buffer.concat([Buffer.from([0]), sign("sha256", tbs, privateKey)])),
  );
  const payloadType = "application/vnd.in-toto+json";
  const payload = Buffer.from(
    canonical({
      _type: "https://in-toto.io/Statement/v1",
      predicate: {
        buildDefinition: {
          buildType: "https://actions.github.io/buildtypes/workflow/v1",
          externalParameters: {
            workflow: { path: WORKFLOW_PATH, ref: "refs/heads/main", repository: REPOSITORY_URI },
          },
          internalParameters: {
            github: { event_name: "workflow_dispatch", runner_environment: "github-hosted" },
          },
          resolvedDependencies: [
            { digest: { gitCommit: digest }, uri: `git+${REPOSITORY_URI}@refs/heads/main` },
          ],
        },
        runDetails: { builder: { id: WORKFLOW_URI }, metadata: { invocationId: RUN_URI } },
      },
      predicateType: "https://slsa.dev/provenance/v1",
      subject: (identity.subjects ?? [publicationSha256]).map((value) => ({
        digest: { sha256: value },
        name: "publication.json",
      })),
    }),
  );
  const signer = identity.resignWith
    ? generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey
    : privateKey;
  const signature = sign("sha256", pae(payloadType, payload), signer).toString("base64");
  const pem = `-----BEGIN CERTIFICATE-----\n${certificate
    .toString("base64")
    .match(/.{1,64}/g)
    ?.join("\n")}\n-----END CERTIFICATE-----\n`;
  const body = Buffer.from(
    canonical({
      apiVersion: "0.0.1",
      kind: "dsse",
      spec: {
        envelopeHash: { algorithm: "sha256", value: sha256(payload) },
        payloadHash: { algorithm: "sha256", value: sha256(payload) },
        signatures: [{ signature, verifier: Buffer.from(pem).toString("base64") }],
      },
    }),
  );
  const node = (left: Buffer, right: Buffer) =>
    createHash("sha256")
      .update(Buffer.from([1]))
      .update(left)
      .update(right)
      .digest();
  const leaf = (bytes: Buffer) =>
    createHash("sha256")
      .update(Buffer.from([0]))
      .update(bytes)
      .digest();
  const first = node(leaf(Buffer.from("leaf-0")), leaf(Buffer.from("leaf-1")));
  const root = node(first, leaf(body)).toString("base64");
  const bundle = {
    dsseEnvelope: {
      payload: payload.toString("base64"),
      payloadType,
      signatures: [{ sig: signature }],
    },
    mediaType: "application/vnd.dev.sigstore.bundle.v0.3+json",
    verificationMaterial: {
      certificate: { rawBytes: certificate.toString("base64") },
      timestampVerificationData: {},
      tlogEntries: [
        {
          canonicalizedBody: body.toString("base64"),
          inclusionProof: {
            checkpoint: {
              envelope: `rekor.sigstore.dev - 1\n3\n${root}\n\n— rekor.sigstore.dev fixture\n`,
            },
            hashes: [first.toString("base64")],
            logIndex: "2",
            rootHash: root,
            treeSize: "3",
          },
          integratedTime: String(integratedTime),
          kindVersion: { kind: "dsse", version: "0.0.1" },
          logId: { keyId: Buffer.from("fixture-log").toString("base64") },
          logIndex: "12",
        },
      ],
    },
  };
  return { bytes: Buffer.from(`${JSON.stringify(bundle)}\n`), integratedTime };
}

/** The SARIF annex of one analyzer over the fixture observations. */
function sarifAnnex(analyzer: string, observations: FixtureObservation[]): Buffer {
  const own = observations.filter((item) => item.analyzer === analyzer);
  const location = (path: string) => [
    { physicalLocation: { artifactLocation: { uri: path }, region: { startLine: 1 } } },
  ];
  const notifications = own
    .filter((item) => item.notification)
    .map((item) => ({
      level: item.level ?? "warning",
      message: { text: item.message ?? "Fixture analyzer limitation." },
      ...(item.path === undefined ? {} : { locations: location(item.path) }),
    }));
  return Buffer.from(
    canonical({
      runs: [
        {
          invocations: [
            {
              executionSuccessful: true,
              ...(notifications.length === 0 ? {} : { toolExecutionNotifications: notifications }),
            },
          ],
          results: own
            .filter((item) => !item.notification)
            .map((item) => ({
              level: item.level ?? "warning",
              message: { text: item.message ?? `${item.ruleId} fixture` },
              ruleId: item.ruleId,
              ...(item.path === undefined ? {} : { locations: location(item.path) }),
            })),
          tool: { driver: { name: analyzer } },
        },
      ],
      version: "2.1.0",
    }),
  );
}

/**
 * Writes one genuine publication, its attestation bundle and Scan's consumer handoff under
 * `directory` (publication.json, attestation.jsonl, consumer-handoff.json, components/).
 */
export async function writeScannerPublication(options: PublicationOptions) {
  const reproduce = await reproduction();
  const analyzers = options.analyzers ?? ["aih-native", "cisco"];
  const signedAt = options.signedAt ?? "2026-01-01T00:00:00.000Z";
  const expiresAt = options.expiresAt ?? "2026-01-01T00:45:00.000Z";
  const { directory, source } = options;
  mkdirSync(join(directory, "components"), { recursive: true });
  const native = Buffer.from(
    canonical({
      files: Object.keys(options.files)
        .sort()
        .map((path) => ({
          bytes: Buffer.byteLength(options.files[path] as string),
          path,
          sha256: options.nativeOverride?.[path] ?? sha256(options.files[path] as string),
        })),
      protocol: "BaselineNativeObservationV1",
      sourceTreeSha256: source.treeSha256,
    }),
  );
  const annexBytes = new Map<string, Buffer>(
    analyzers.map((analyzer) => [
      analyzer,
      analyzer === "aih-native" ? native : sarifAnnex(analyzer, options.observations),
    ]),
  );
  const observations = analyzers.map((analyzer) => {
    const bytes = annexBytes.get(analyzer) as Buffer;
    return {
      analyzer,
      analyzerVersion: "fixture",
      annex: {
        byteLength: bytes.length,
        mediaType: analyzer === "aih-native" ? NATIVE_MEDIA_TYPE : "application/sarif+json",
        path: `annex/${analyzer}.json`,
        sha256: sha256(bytes),
      },
    };
  });
  const components = options.components.map((component) => ({
    analyzers: component.analyzers ?? analyzers,
    content: component.content,
    id: component.id,
    paths: component.paths,
    treeSha256: options.treeOf(component.paths),
  }));
  const requestAuthoring = {
    components,
    profile: options.requestProfile ?? "fixture",
    protocol: "BaselineVetRequestV1",
    source,
  };
  const requestSha256 = sha256(
    canonical({ domain: "aih.baseline-vet-request-v1", request: requestAuthoring }),
  );
  const receiptAuthoring: Json = {
    components: components.map((component) => ({
      content: component.content,
      id: component.id,
      observations: component.analyzers.map((analyzer) => ({
        analyzer,
        annexSha256: sha256(annexBytes.get(analyzer) as Buffer),
      })),
      paths: component.paths,
      treeSha256: component.treeSha256,
    })),
    observations,
    profile: "aih-baseline-v1",
    protocol: "BaselineVetReceiptV1",
    requestSha256,
    source,
  };
  const receiptSha256 = sha256(
    canonical({ domain: "aih.baseline-vet-receipt-v1", receipt: receiptAuthoring }),
  );
  if (options.tamperReceipt) receiptAuthoring.profile = "tampered";
  const { privateKey, publicKey } = options.signer ?? generateKeyPairSync("ed25519");
  const publicKeyBytes = publicKey.export({ format: "der", type: "spki" });
  const keyId = `ed25519:${sha256(publicKeyBytes)}`;
  const signer = {
    class: "test-ephemeral",
    identity: "github-actions:aih-scan-baseline-publication",
    keyId,
  };
  const payloadType = "application/vnd.in-toto+json";
  const predicate = {
    claims: { expiresAt, origin: "signer-asserted", provenance: "none", signedAt },
    protocol: "BaselineVetAttestationV1",
    receiptSha256,
    requestSha256,
    signer,
  };
  const payload = Buffer.from(
    canonical({
      _type: "https://in-toto.io/Statement/v1",
      predicate,
      predicateType: "https://aih.dev/BaselineVetAttestationV1",
      subject: [{ digest: { sha256: receiptSha256 }, name: "baseline-vet-receipt" }],
    }),
  );
  const publication = {
    annexes: analyzers.map((analyzer) => ({
      bytesBase64: (annexBytes.get(analyzer) as Buffer).toString("base64"),
      path: `annex/${analyzer}.json`,
    })),
    envelope: {
      payload: payload.toString("base64"),
      payloadType,
      signatures: [
        { keyid: keyId, sig: sign(null, pae(payloadType, payload), privateKey).toString("base64") },
      ],
    },
    protocol: "BaselineVetPublicationV1",
    receipt: { ...receiptAuthoring, receiptSha256 },
    request: { ...requestAuthoring, requestSha256 },
    verification: {
      expected: { now: signedAt, signer },
      root: { ...signer, publicKeySpkiBase64: publicKeyBytes.toString("base64") },
    },
  };
  const publicationPath = join(directory, "publication.json");
  writeJson(publicationPath, publication);
  const publicationSha256 = sha256(readFileSync(publicationPath));
  const attestation = attestationBundle(publicationSha256, signedAt);
  const attestationPath = join(directory, "attestation.jsonl");
  writeFileSync(attestationPath, attestation.bytes);
  const mapping = {
    contentClass: options.contentClass ?? "exact compiler/source-file closure for assessment only",
    components: components
      .filter((component) => options.mapped.includes(component.id))
      .map((component) => ({
        scannerComponentId: component.id,
        catalogAssetId:
          options.catalogAssetIds?.[component.id] ??
          `${source.id}/${component.content}:${component.id.split(":")[1]}`,
      })),
    exclusions: components
      .filter((component) => !options.mapped.includes(component.id))
      .map((component) => ({ reason: "fixture", scannerComponentId: component.id })),
  };
  // The genuine publication must also pass the receipt check when it is tampered, so the
  // projection reads the untampered receipt; the tampered bytes are what the Catalog verifies.
  const genuine = options.tamperReceipt
    ? {
        ...publication,
        receipt: { ...receiptAuthoring, profile: "aih-baseline-v1", receiptSha256 },
      }
    : publication;
  const { fields, artifacts } = reproduce({
    publication: genuine,
    predicate,
    publicationSha256,
    publisherCommit: PUBLISHER_COMMIT,
    mapping,
  });
  for (const { name, bytes } of artifacts.values())
    writeFileSync(join(directory, "components", name), bytes);
  const tag = `baseline-v1-${PUBLISHER_COMMIT}-${requestSha256}`;
  const handoff: Json = {
    ...fields,
    api: { node: ">=20", package: "@aihq/scan", version: "0.5.0" },
    attestation: {
      buildSignerDigest: PUBLISHER_COMMIT,
      buildSignerURI: WORKFLOW_URI,
      issuer: "https://token.actions.githubusercontent.com",
      predicateType: "https://slsa.dev/provenance/v1",
      runInvocationURI: RUN_URI,
      runnerEnvironment: "github-hosted",
      sourceRepositoryDigest: PUBLISHER_COMMIT,
      sourceRepositoryRef: "refs/heads/main",
      sourceRepositoryURI: REPOSITORY_URI,
      subject: { digest: { sha256: publicationSha256 }, name: "publication.json" },
      subjectCount: 1,
      verifiedTimestampCount: 1,
      verifiedTimestamps: [
        {
          timestamp: new Date(attestation.integratedTime * 1000).toISOString(),
          type: "Tlog",
          uri: "https://rekor.sigstore.dev",
        },
      ],
    },
    discoverySha256: "f".repeat(64),
    envelope: {
      ...(fields.envelope as Json),
      annexesComplete: true,
      cliInspectionMatchesReleasedInspection: true,
      envelopeValid: true,
      sameRunArtifactAndReleaseBytesMatch: true,
    },
    inspectionSha256: "1".repeat(64),
    localInspection: {
      inspectionSha256: "1".repeat(64),
      matchesReleasedInspection: true,
      tool: "@aihq/scan@0.5.0 baseline-inspect",
    },
    release: {
      assets: [],
      isDraft: false,
      tag,
      targetCommitish: PUBLISHER_COMMIT,
      url: `${REPOSITORY_URI}/releases/tag/${tag}`,
    },
    workflow: {
      attempt: 1,
      conclusion: "success",
      event: "workflow_dispatch",
      headBranch: "main",
      headSha: PUBLISHER_COMMIT,
      runId: RUN_ID,
      status: "completed",
      url: `${REPOSITORY_URI}/actions/runs/${RUN_ID}`,
      workflowName: "immutable baseline publication",
      workflowPath: WORKFLOW_PATH,
    },
  };
  const handoffPath = join(directory, "consumer-handoff.json");
  writeJson(handoffPath, handoff);
  const artifactPaths = new Map(
    [...artifacts].map(([id, { name }]) => [id, join(directory, "components", name)]),
  );
  return {
    publication,
    publicationPath,
    publicationSha256,
    attestationPath,
    handoff,
    handoffPath,
    artifactPaths,
    requestSha256,
    signedAt,
  };
}

export type WrittenPublication = Awaited<ReturnType<typeof writeScannerPublication>>;

/**
 * Edits one component artifact and re-binds everything the handoff derives from it: the
 * component summary, the artifact pointer's length and digest, and the aggregate mapped-finding
 * summary. This is the unsigned re-derivation a forged handoff would carry.
 */
export function rewriteArtifact(
  written: WrittenPublication,
  scannerComponentId: string,
  mutate: (artifact: Json) => void,
) {
  const path = written.artifactPaths.get(scannerComponentId) as string;
  const artifact = JSON.parse(readFileSync(path, "utf8")) as Json;
  mutate(artifact);
  writeJson(path, artifact);
  const bytes = readFileSync(path);
  const handoff = JSON.parse(readFileSync(written.handoffPath, "utf8")) as Json;
  const summaries = handoff.components as Json[];
  const summary = summaries.find((item) => item.scannerComponentId === scannerComponentId) as Json;
  summary.findings = artifact.findingSummary;
  summary.locationBoundCoverage = artifact.locationBoundCoverageSummary;
  summary.globalCoverage = artifact.globalCoverageSummary;
  summary.observationArtifact = {
    ...(summary.observationArtifact as Json),
    byteLength: bytes.length,
    sha256: sha256(bytes),
  };
  const mapped = summaries.flatMap((item) => {
    const own = JSON.parse(
      readFileSync(written.artifactPaths.get(item.scannerComponentId as string) as string, "utf8"),
    ) as Json;
    return own.findings as Json[];
  });
  const tally = (keyOf: (row: Json) => unknown) => {
    const counts: Record<string, number> = {};
    for (const row of mapped) counts[String(keyOf(row))] = (counts[String(keyOf(row))] ?? 0) + 1;
    return counts;
  };
  (handoff.findings as Json).mappedToDeclaredClosures = {
    byAnalyzer: tally((row) => row.analyzer),
    byLevel: tally((row) => row.level),
    byRule: tally((row) => row.ruleId),
    count: mapped.length,
  };
  writeJson(written.handoffPath, handoff);
}

/** Edits the handoff JSON in place. */
export function rewriteHandoff(written: WrittenPublication, mutate: (handoff: Json) => void) {
  const handoff = JSON.parse(readFileSync(written.handoffPath, "utf8")) as Json;
  mutate(handoff);
  writeJson(written.handoffPath, handoff);
}
