import { createHash } from "node:crypto";
import {
  assertSafeRelativePosixPathV1,
  assertStrictJsonValueV1,
  canonicalStrictJsonBytesV1,
  deepFreezeStrictJsonV1,
} from "../contract/strict-json-v1.js";

type JsonRecord = Record<string, unknown>;
export type SupportedPilotResultV1 = Readonly<{
  ecc: Readonly<JsonRecord>;
  exceptions: readonly Readonly<JsonRecord>[];
  superpowers: Readonly<JsonRecord>;
}>;
const DIGEST = /^[a-f0-9]{64}$/;

const SUPERPOWERS = [
  "runtime:superpowers-plugin",
  "skill:brainstorming",
  "skill:dispatching-parallel-agents",
  "skill:executing-plans",
  "skill:finishing-a-development-branch",
  "skill:receiving-code-review",
  "skill:requesting-code-review",
  "skill:subagent-driven-development",
  "skill:systematic-debugging",
  "skill:test-driven-development",
  "skill:using-git-worktrees",
  "skill:using-superpowers",
  "skill:verification-before-completion",
  "skill:writing-plans",
  "skill:writing-skills",
] as const;

function fail(label: string): never {
  throw new TypeError(`invalid supported pilot V1: ${label}`);
}

function record(value: unknown, label: string): JsonRecord {
  assertStrictJsonValueV1(value, label);
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail(label);
  return structuredClone(value) as JsonRecord;
}

function outerRecord(value: unknown, label: string): JsonRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail(label);
  const prototype = Object.getPrototypeOf(value);
  if (
    (prototype !== Object.prototype && prototype !== null) ||
    Object.getOwnPropertySymbols(value).length !== 0
  )
    fail(label);
  for (const key of Object.keys(value)) ownData(value, key, label);
  return value as JsonRecord;
}

function ownData(value: object, key: string, label: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (descriptor === undefined || !("value" in descriptor)) fail(label);
  return descriptor.value;
}

function keys(value: JsonRecord, expected: readonly string[], label: string): void {
  const actual = Object.keys(value).sort();
  const sorted = [...expected].sort();
  if (actual.length !== sorted.length || actual.some((entry, index) => entry !== sorted[index]))
    fail(label);
}

function sha(value: unknown, label: string): string {
  if (typeof value !== "string" || !DIGEST.test(value)) fail(label);
  return value;
}

function text(value: unknown, label: string, pattern = /^[a-z][a-z0-9:._@/-]{0,255}$/): string {
  if (typeof value !== "string" || !pattern.test(value)) fail(label);
  return value;
}

function exceptionKey(row: JsonRecord): string {
  return createHash("sha256")
    .update(
      canonicalStrictJsonBytesV1({
        domain: "aih-supported.exception-dedupe-v1",
        value: {
          policyRevisionSha256: row.policyRevisionSha256,
          reasonCode: "ECC_PREVIEW_DEPENDENCY_CLOSURE_UNQUALIFIED",
          subjectSha256: row.subjectSha256,
        },
      }),
    )
    .digest("hex");
}

export function evaluateStaticPilotV1(value: unknown): SupportedPilotResultV1 {
  const input = record(value, "pilot");
  keys(
    input,
    [
      "ecc",
      "evidenceRunId",
      "exceptionRows",
      "policyRevisionSha256",
      "profileSha256",
      "protocol",
      "recipeSha256",
      "sources",
      "superpowers",
    ],
    "pilot fields",
  );
  if (input.protocol !== "SupportedStaticPilotV1" || input.evidenceRunId !== "31922381993")
    fail("pilot protocol/evidence");
  const policyRevisionSha256 = sha(input.policyRevisionSha256, "policy");
  const profileSha256 = sha(input.profileSha256, "profile");
  const recipeSha256 = sha(input.recipeSha256, "recipe");
  if (!Array.isArray(input.sources) || input.sources.length !== 2) fail("sources");
  const sources = input.sources.map((source) => record(source, "source"));
  const ecc = sources.find(
    (source) => source.canonicalHost === "github" && source.canonicalRepository === "affaan-m/ecc",
  );
  const superpowers = sources.find(
    (source) =>
      source.canonicalHost === "github" && source.canonicalRepository === "obra/superpowers",
  );
  if (
    ecc === undefined ||
    superpowers === undefined ||
    sources.some((source) => source.canonicalHost !== "github")
  )
    fail("source identity");
  keys(
    ecc,
    [
      "activeCommit",
      "blockedCandidateCommit",
      "canonicalHost",
      "canonicalRepository",
      "ledgerDisplayRepository",
    ],
    "ecc source fields",
  );
  if (
    ecc.ledgerDisplayRepository !== "affaan-m/ECC" ||
    ecc.activeCommit !== "623f2c020f052319657674e4e6c29ab5d0ad566b" ||
    ecc.blockedCandidateCommit !== "dcbf95bf63dc67701564198df9c3451940a2ca83"
  )
    fail("ecc source");
  keys(
    superpowers,
    ["activeCommit", "canonicalHost", "canonicalRepository"],
    "superpowers source fields",
  );
  if (superpowers.activeCommit !== "3dcbd5c4b48e02263fbf4a3c01e3fe4f81d584d9")
    fail("superpowers source");
  const eccResult = record(input.ecc, "ecc result");
  keys(
    eccResult,
    [
      "assembly",
      "blocked",
      "components",
      "newBlockedComponentIds",
      "passed",
      "previewGeneratorClosure",
    ],
    "ecc result fields",
  );
  if (
    eccResult.assembly !== "blocked" ||
    eccResult.components !== 137 ||
    eccResult.passed !== 109 ||
    eccResult.blocked !== 28 ||
    !Array.isArray(eccResult.newBlockedComponentIds) ||
    eccResult.newBlockedComponentIds.length !== 0 ||
    !Array.isArray(eccResult.previewGeneratorClosure) ||
    eccResult.previewGeneratorClosure.length !== 1 ||
    eccResult.previewGeneratorClosure[0] !== "js-yaml@4.3.1"
  )
    fail("ecc result");
  const superResult = record(input.superpowers, "superpowers result");
  keys(superResult, ["passedComponentIds", "total"], "superpowers result fields");
  if (
    !Array.isArray(superResult.passedComponentIds) ||
    superResult.total !== 15 ||
    JSON.stringify([...superResult.passedComponentIds].sort()) !==
      JSON.stringify([...SUPERPOWERS].sort())
  )
    fail("superpowers result");
  if (
    !Array.isArray(input.exceptionRows) ||
    input.exceptionRows.length === 0 ||
    input.exceptionRows.length > 4_096
  )
    fail("exception rows");
  const exceptions = new Map<string, JsonRecord>();
  for (const rowValue of input.exceptionRows) {
    const row = record(rowValue, "exception row");
    keys(
      row,
      ["closureMember", "policyRevisionSha256", "profileSha256", "recipeSha256", "subjectSha256"],
      "exception row fields",
    );
    text(row.closureMember, "exception closure");
    sha(row.subjectSha256, "exception subject");
    sha(row.policyRevisionSha256, "exception policy");
    sha(row.profileSha256, "exception profile");
    sha(row.recipeSha256, "exception recipe");
    if (
      row.closureMember !== "js-yaml@4.3.1" ||
      row.policyRevisionSha256 !== policyRevisionSha256 ||
      row.profileSha256 !== profileSha256 ||
      row.recipeSha256 !== recipeSha256
    )
      fail("exception evidence binding");
    const dedupeKeySha256 = exceptionKey(row);
    if (!exceptions.has(dedupeKeySha256)) {
      exceptions.set(dedupeKeySha256, {
        activeCommit: ecc.activeCommit,
        activePinChanged: false,
        blockedCandidateCommit: ecc.blockedCandidateCommit,
        canonicalHost: "github",
        canonicalRepository: "affaan-m/ecc",
        closureMember: row.closureMember,
        dedupeKeySha256,
        evidenceRunId: input.evidenceRunId,
        executedDuringPreview: false,
        lockChanged: false,
        newMaliciousContentFinding: false,
        policyRevisionSha256: row.policyRevisionSha256,
        profileSha256: row.profileSha256,
        promoted: false,
        projectionChanged: false,
        reasonCode: "ECC_PREVIEW_DEPENDENCY_CLOSURE_UNQUALIFIED",
        recipeSha256: row.recipeSha256,
        state: "acceptance-required",
        subjectSha256: row.subjectSha256,
      });
    }
  }
  return deepFreezeStrictJsonV1({
    ecc: {
      assembly: "blocked",
      blocked: 28,
      components: 137,
      newBlockedComponentIds: [],
      passed: 109,
    },
    exceptions: [...exceptions.values()].sort((left, right) =>
      (left.dedupeKeySha256 as string) < (right.dedupeKeySha256 as string)
        ? -1
        : (left.dedupeKeySha256 as string) > (right.dedupeKeySha256 as string)
          ? 1
          : 0,
    ),
    superpowers: { passed: 15, passedComponentIds: [...SUPERPOWERS], total: 15 },
  }) as SupportedPilotResultV1;
}

export function validateOfflineSourceRequestV1(value: unknown): Readonly<JsonRecord> {
  const input = record(value, "offline request");
  keys(
    input,
    [
      "closureMembers",
      "closureSha256",
      "commitSha256",
      "host",
      "protocol",
      "repository",
      "treeSha256",
    ],
    "offline request fields",
  );
  if (
    input.protocol !== "OfflineSourceRequestV1" ||
    input.host !== "github" ||
    input.repository !== "affaan-m/ecc"
  )
    fail("offline request identity");
  sha(input.commitSha256, "commit");
  sha(input.treeSha256, "tree");
  sha(input.closureSha256, "closure");
  if (
    !Array.isArray(input.closureMembers) ||
    input.closureMembers.length === 0 ||
    input.closureMembers.length > 4_096
  )
    fail("closure members");
  const members = input.closureMembers.map((member) => {
    const row = record(member, "closure member");
    keys(row, ["path", "sha256"], "closure member fields");
    return {
      path: assertSafeRelativePosixPathV1(text(row.path, "path", /^.{1,4096}$/), "path"),
      sha256: sha(row.sha256, "member"),
    };
  });
  if (new Set(members.map((member) => member.path)).size !== members.length)
    fail("duplicate closure member");
  return deepFreezeStrictJsonV1({
    ...input,
    closureMembers: members.sort((left, right) =>
      left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
    ),
  });
}

export function createReadOnlyEvaluationV1(value: unknown): Readonly<JsonRecord> {
  const input = outerRecord(value, "read-only evaluation");
  keys(input, ["provider", "request"], "read-only evaluation fields");
  validateOfflineSourceRequestV1(ownData(input, "request", "read-only evaluation"));
  ownData(input, "provider", "read-only evaluation");
  return deepFreezeStrictJsonV1({ capabilities: { mutation: false, network: false } });
}
