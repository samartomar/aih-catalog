/**
 * Release sets 1.0: the build (`compileReleaseSets`, exported by the producer)
 * and the portable reader (`readReleaseSets`). Both apply one check: closed
 * structure, members against the release's identities, pinned cross-framework
 * references, optional hooks, acyclic bounded nesting and bottom-up digests.
 */
import { exactFields } from "./boundary.js";
import { checkedReleases, extendedReleases } from "./checked.js";
import {
  type AuthoringResult,
  type CatalogDiagnostic,
  type CatalogItem,
  type CatalogRelease,
  type Diagnostic,
  RELEASE_MAX_BYTES,
  RELEASE_MAX_DEPTH,
  RELEASE_SETS_SCHEMA_ID,
  type ReadReleaseSetsResult,
  type ReleaseSet,
  type ReleaseSetDeclaration,
  type ReleaseSetsDocument,
  SET_MAX_DEPTH,
  SET_MAX_MEMBERS,
  type SetMember,
} from "./contracts.js";
import { bytewiseCompare, CLIENT_ID, isId, isRecord, SHA256 } from "./document.js";
import { canonicalJson, deepFreeze, JsonAdmissionError, readCanonicalBytes } from "./json.js";
import { sha256Hex } from "./sha256.js";

const MAX_SETS = 4096;
const MAX_REFS = 256;
const MAX_TEXT = 4096;
const VERSION = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
const isVersion = (value: unknown): value is string =>
  typeof value === "string" && value.length <= 128 && VERSION.test(value);
/** Fields the digest leaves out besides the members, which it covers as lines. */
const UNDIGESTED = new Set([
  "id",
  "name",
  "description",
  "cost",
  "stability",
  "setSha256",
  "members",
]);
const encoder = new TextEncoder();
/** Identifies a set member by its qualified item reference. */
export const memberKey = (item: { readonly framework: string; readonly itemId: string }) =>
  `${item.framework}\u0000${item.itemId}`;

const isText = (value: unknown, max = MAX_TEXT): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= max;

interface Problem {
  readonly reason: string;
  readonly path: string;
  readonly message: string;
}

/** The identities one member contributes to its set's digest lines. */
function memberLine(
  member: SetMember,
  release: CatalogRelease,
  items: ReadonlyMap<string, CatalogItem>,
): { line?: string; problem?: Omit<Problem, "path"> } {
  const item = member.item as Record<string, unknown>;
  const own = item.framework === release.framework?.id;
  if (own) {
    const found = items.get(item.itemId as string);
    if (!found)
      return {
        problem: {
          reason: "member-unavailable",
          message: "The member is absent from the release.",
        },
      };
    if (found.contentSha256 === undefined || found.behaviourSha256 === undefined)
      return {
        problem: {
          reason: "member-identity-missing",
          message: "A set member carries both release 1.6 identities.",
        },
      };
    return {
      line: `${item.framework}\t${item.itemId}\t${found.contentSha256}\t${found.behaviourSha256}\t${member.optional}\t${member.defaultOn}\n`,
    };
  }
  return {
    line: `${item.framework}\t${item.itemId}\t${item.contentSha256}\t${item.behaviourSha256}\t${member.optional}\t${member.defaultOn}\n`,
  };
}

/** SHA-256 over sorted member lines, then the canonical JSON of the digested fields. */
function setDigest(set: Record<string, unknown>, lines: readonly string[]): string {
  const rest = Object.fromEntries(Object.entries(set).filter(([key]) => !UNDIGESTED.has(key)));
  const text = [...lines].sort(bytewiseCompare).join("") + canonicalJson(rest);
  return sha256Hex(encoder.encode(text));
}

/** Every reference a set makes, with its JSON pointer, in declared order. */
function refsOf(
  set: Record<string, unknown>,
  at: string,
): { ref: Record<string, unknown>; at: string }[] {
  const refs: { ref: Record<string, unknown>; at: string }[] = [];
  for (const field of ["includes", "requires", "optional"] as const) {
    const list = set[field];
    if (Array.isArray(list))
      list.forEach((ref, index) => {
        refs.push({ ref: ref as Record<string, unknown>, at: `${at}/${field}/${index}` });
      });
  }
  if (Array.isArray(set.options))
    (set.options as Record<string, unknown>[]).forEach((option, o) => {
      if (!isRecord(option)) return;
      if (Array.isArray(option.always))
        option.always.forEach((ref, index) => {
          refs.push({
            ref: ref as Record<string, unknown>,
            at: `${at}/options/${o}/always/${index}`,
          });
        });
      if (Array.isArray(option.choices))
        (option.choices as Record<string, unknown>[]).forEach((choice, c) => {
          if (isRecord(choice) && Array.isArray(choice.sets))
            choice.sets.forEach((ref, index) => {
              refs.push({
                ref: ref as Record<string, unknown>,
                at: `${at}/options/${o}/choices/${c}/sets/${index}`,
              });
            });
        });
    });
  return refs;
}

/** Closed structure of one set; digests are checked separately. */
function checkShape(set: unknown, at: string, problems: Problem[], declaration: boolean): void {
  const fail = (reason: string, path: string, message: string) =>
    problems.push({ reason, path, message });
  const optional = [
    "includes",
    "requires",
    "optional",
    "targets",
    "cost",
    "stability",
    "options",
    "firstRun",
  ];
  if (
    !exactFields(
      set,
      ["id", "name", "description", "members", "offer", ...(declaration ? [] : ["setSha256"])],
      optional,
    )
  ) {
    fail("set-invalid", at, "A set has exactly the published fields.");
    return;
  }
  if (!isId(set.id)) fail("set-invalid", `${at}/id`, "A set id follows the item id pattern.");
  if (!isText(set.name, 256)) fail("set-invalid", `${at}/name`, "A set has a bounded name.");
  if (!isText(set.description))
    fail("set-invalid", `${at}/description`, "A set has a bounded description.");
  if (!declaration && (typeof set.setSha256 !== "string" || !SHA256.test(set.setSha256)))
    fail("set-invalid", `${at}/setSha256`, "A set carries its lowercase SHA-256 digest.");
  if (set.offer !== "pre-ticked" && set.offer !== "listed" && set.offer !== "on-request")
    fail("set-invalid", `${at}/offer`, "offer is pre-ticked, listed or on-request.");
  if (!Array.isArray(set.members) || set.members.length > SET_MAX_MEMBERS)
    fail("set-invalid", `${at}/members`, "members is an array of at most 5,000 entries.");
  else
    set.members.forEach((member, index) => {
      const path = `${at}/members/${index}`;
      const item = isRecord(member) ? member.item : undefined;
      const pinned = ["releaseVersion", "contentSha256", "behaviourSha256"];
      if (
        !exactFields(member, ["item", "optional", "defaultOn"]) ||
        typeof member.optional !== "boolean" ||
        typeof member.defaultOn !== "boolean" ||
        !exactFields(item, ["framework", "itemId"], pinned) ||
        !isId(item.framework) ||
        !isId(item.itemId) ||
        (item.releaseVersion !== undefined && !isVersion(item.releaseVersion)) ||
        [item.contentSha256, item.behaviourSha256].some(
          (digest) => digest !== undefined && (typeof digest !== "string" || !SHA256.test(digest)),
        )
      )
        fail(
          "set-invalid",
          path,
          "A member is { item: { framework, itemId, pins? }, optional, defaultOn }.",
        );
      else if (!member.optional && !member.defaultOn)
        fail("member-required-off", path, "A member that is not optional is on by default.");
    });
  const refList = (value: unknown, path: string) => {
    if (!Array.isArray(value) || value.length > MAX_REFS) {
      fail("set-invalid", path, "Expected a bounded array of set references.");
      return;
    }
    value.forEach((ref, index) => {
      if (
        !exactFields(ref, ["framework", "setId"], ["setSha256", "releaseVersion"]) ||
        !isId(ref.framework) ||
        !isId(ref.setId) ||
        (ref.setSha256 !== undefined &&
          (typeof ref.setSha256 !== "string" || !SHA256.test(ref.setSha256))) ||
        (!declaration && ref.setSha256 === undefined) ||
        (ref.releaseVersion !== undefined && !isVersion(ref.releaseVersion))
      )
        fail(
          "set-invalid",
          `${path}/${index}`,
          "A set reference is { framework, setId, setSha256, releaseVersion? }.",
        );
    });
  };
  for (const field of ["includes", "requires", "optional"] as const)
    if (set[field] !== undefined) refList(set[field], `${at}/${field}`);
  if (
    set.targets !== undefined &&
    (!Array.isArray(set.targets) ||
      set.targets.length > 64 ||
      set.targets.some((target) => typeof target !== "string" || !CLIENT_ID.test(target)) ||
      new Set(set.targets).size !== set.targets.length)
  )
    fail("set-invalid", `${at}/targets`, "targets lists unique client ids.");
  if (
    set.cost !== undefined &&
    (!exactFields(set.cost, ["bytes", "chars"]) ||
      ![set.cost.bytes, set.cost.chars].every((n) => Number.isSafeInteger(n) && (n as number) >= 0))
  )
    fail("set-invalid", `${at}/cost`, "cost is { bytes, chars } of non-negative integers.");
  if (
    set.stability !== undefined &&
    set.stability !== "stable" &&
    set.stability !== "in-progress" &&
    set.stability !== "deprecated"
  )
    fail("set-invalid", `${at}/stability`, "stability is stable, in-progress or deprecated.");
  if (set.options !== undefined) {
    if (!Array.isArray(set.options) || set.options.length > 64)
      fail("set-invalid", `${at}/options`, "options is a bounded array.");
    else {
      const optionIds = new Set<string>();
      set.options.forEach((option, o) => {
        const path = `${at}/options/${o}`;
        if (
          !exactFields(option, ["id", "name", "choices"], ["description", "always"]) ||
          !isId(option.id) ||
          !isText(option.name, 256) ||
          (option.description !== undefined && !isText(option.description)) ||
          !Array.isArray(option.choices) ||
          option.choices.length === 0 ||
          option.choices.length > MAX_REFS
        ) {
          fail("set-invalid", path, "An option is { id, name, description?, always?, choices[] }.");
          return;
        }
        if (optionIds.has(option.id))
          fail("set-invalid", `${path}/id`, "Option ids are unique within a set.");
        optionIds.add(option.id);
        if (option.always !== undefined) refList(option.always, `${path}/always`);
        const choiceIds = new Set<string>();
        option.choices.forEach((choice, c) => {
          const choicePath = `${path}/choices/${c}`;
          if (
            !exactFields(choice, ["id", "name", "sets"], ["description"]) ||
            !isId(choice.id) ||
            !isText(choice.name, 256) ||
            (choice.description !== undefined && !isText(choice.description))
          ) {
            fail("set-invalid", choicePath, "A choice is { id, name, description?, sets[] }.");
            return;
          }
          if (choiceIds.has(choice.id))
            fail("set-invalid", `${choicePath}/id`, "Choice ids are unique within an option.");
          choiceIds.add(choice.id);
          refList(choice.sets, `${choicePath}/sets`);
        });
      });
    }
  }
  if (
    set.firstRun !== undefined &&
    (!exactFields(set.firstRun, ["framework", "itemId"]) ||
      !isId(set.firstRun.framework) ||
      !isId(set.firstRun.itemId))
  )
    fail("set-invalid", `${at}/firstRun`, "firstRun is { framework, itemId }.");
}

/**
 * Checks sets against their release and computes every digest bottom-up. In
 * build mode same-release references receive their digests; in read mode every
 * carried digest must equal the recomputed one.
 */
function checkSets(
  values: readonly unknown[],
  release: CatalogRelease,
  mode: "build" | "read",
): { sets?: ReleaseSet[]; problems: Problem[] } {
  const problems: Problem[] = [];
  const fail = (reason: string, path: string, message: string) =>
    problems.push({ reason, path, message });
  const framework = release.framework?.id as string;
  if (values.length > MAX_SETS) {
    fail("set-invalid", "/sets", "A release carries at most 4,096 sets.");
    return { problems };
  }
  values.forEach((set, index) => {
    checkShape(set, `/sets/${index}`, problems, mode === "build");
  });
  if (problems.length) return { problems };
  const sets = values.map((value) => structuredClone(value) as Record<string, unknown>);
  const items = new Map(release.items.map((item) => [item.id, item]));
  const byId = new Map<string, number>();
  sets.forEach((set, index) => {
    if (byId.has(set.id as string))
      fail("set-duplicate", `/sets/${index}/id`, "Set ids are unique.");
    byId.set(set.id as string, index);
  });
  // Members and references against the release and the cross-framework rule.
  const lines = new Map<number, string[]>();
  sets.forEach((set, index) => {
    const at = `/sets/${index}`;
    const seen = new Set<string>();
    const setLines: string[] = [];
    (set.members as SetMember[]).forEach((member, m) => {
      const path = `${at}/members/${m}`;
      const item = member.item as Record<string, unknown>;
      const name = memberKey(member.item);
      if (seen.has(name)) fail("member-duplicate", path, "A set names each member once.");
      seen.add(name);
      const pins = ["releaseVersion", "contentSha256", "behaviourSha256"].filter(
        (key) => key in item,
      );
      if (item.framework === framework) {
        if (pins.length)
          fail(
            "member-pin-unexpected",
            `${path}/item`,
            "A member of this release takes its identities from it.",
          );
        if (items.get(item.itemId as string)?.kind === "hook" && !member.optional)
          fail("hook-member-required", path, "Every hook member of a set is optional.");
      } else if (pins.length !== 3)
        fail(
          "member-unpinned",
          `${path}/item`,
          "A member from another framework is pinned by releaseVersion, contentSha256 and behaviourSha256.",
        );
      const line = memberLine(member, release, items);
      if (line.problem) fail(line.problem.reason, path, line.problem.message);
      else setLines.push(line.line as string);
    });
    lines.set(index, setLines);
    for (const { ref, at: path } of refsOf(set, at)) {
      if (ref.framework === framework) {
        if (ref.releaseVersion !== undefined)
          fail("set-ref-invalid", path, "A same-release reference carries no releaseVersion.");
        if (!byId.has(ref.setId as string))
          fail("set-ref-unavailable", path, "The referenced set is absent from this release.");
      } else if (ref.releaseVersion === undefined || ref.setSha256 === undefined)
        fail(
          "set-ref-unpinned",
          path,
          "A set in another release is referenced by framework, setId, setSha256 and releaseVersion.",
        );
    }
    const firstRun = set.firstRun as { framework: string; itemId: string } | undefined;
    if (firstRun && !seen.has(memberKey(firstRun)))
      fail("first-run-not-member", `${at}/firstRun`, "firstRun names a member of the set.");
  });
  if (problems.length) return { problems };
  // Bottom-up digests over the same-release reference graph; a cycle fails.
  const digests = new Map<number, string>();
  const height = new Map<number, number>();
  const state = new Map<number, "active" | "done">();
  const visit = (index: number): boolean => {
    if (state.get(index) === "done") return true;
    if (state.get(index) === "active") {
      fail("set-cycle", `/sets/${index}`, "Sets form a cycle.");
      return false;
    }
    state.set(index, "active");
    const set = sets[index] as Record<string, unknown>;
    let depth = 0;
    for (const { ref, at } of refsOf(set, `/sets/${index}`)) {
      if (ref.framework !== framework) continue;
      const target = byId.get(ref.setId as string) as number;
      if (!visit(target)) return false;
      depth = Math.max(depth, (height.get(target) as number) + 1);
      const digest = digests.get(target) as string;
      if (mode === "build" && ref.setSha256 === undefined) ref.setSha256 = digest;
      else if (ref.setSha256 !== digest)
        fail(
          "set-digest-mismatch",
          `${at}/setSha256`,
          "The reference differs from the referenced set's digest.",
        );
    }
    if (depth > SET_MAX_DEPTH) {
      fail("set-depth-exceeded", `/sets/${index}`, "Sets nest at most 8 levels below a set.");
      return false;
    }
    height.set(index, depth);
    const digest = setDigest(set, lines.get(index) as string[]);
    if (mode === "read" && set.setSha256 !== digest)
      fail(
        "set-digest-mismatch",
        `/sets/${index}/setSha256`,
        "The set differs from its recomputed digest.",
      );
    digests.set(index, digest);
    state.set(index, "done");
    return true;
  };
  for (let index = 0; index < sets.length; index++) if (!visit(index)) break;
  if (problems.length) return { problems };
  return {
    sets: sets.map(
      (set, index) => ({ ...set, setSha256: digests.get(index) }) as unknown as ReleaseSet,
    ),
    problems,
  };
}

const releaseProblem = (release: unknown): Problem | undefined => {
  if (typeof release !== "object" || release === null || !checkedReleases.has(release))
    return {
      reason: "release-unchecked",
      path: "/release",
      message: "Expected a release view returned by readRelease.",
    };
  const checked = release as CatalogRelease;
  if (checked.framework === undefined)
    return {
      reason: "framework-required",
      path: "/release/framework",
      message: "Sets belong to a release that publishes its framework identity.",
    };
  if (checked.sets !== undefined)
    return {
      reason: "sets-attached",
      path: "/release/sets",
      message: "The release already carries sets.",
    };
  return undefined;
};

/** Builds a release sets document over one checked release. Digests are computed bottom-up. */
export function compileReleaseSets(request: {
  readonly release: CatalogRelease;
  readonly sets: readonly ReleaseSetDeclaration[];
}): AuthoringResult<{
  readonly document: ReleaseSetsDocument;
  readonly bytes: Uint8Array;
  readonly sha256: string;
}> {
  const refuse = (problems: readonly Problem[]) =>
    deepFreeze({
      status: "refused" as const,
      diagnostics: problems.map(
        (problem): Diagnostic => ({
          code: "INPUT_INVALID",
          reason: problem.reason,
          path: problem.path,
          message: problem.message,
        }),
      ),
    });
  const unchecked = releaseProblem(request?.release);
  if (unchecked) return refuse([unchecked]);
  if (!Array.isArray(request.sets))
    return refuse([
      { reason: "set-invalid", path: "/sets", message: "Expected an array of sets." },
    ]);
  const release = request.release;
  const checked = checkSets(request.sets, release, "build");
  if (!checked.sets) return refuse(checked.problems);
  const document: ReleaseSetsDocument = {
    schema: RELEASE_SETS_SCHEMA_ID,
    release: {
      framework: release.framework?.id as string,
      releaseVersion: release.framework?.version as string,
    },
    sets: checked.sets,
  };
  const bytes = encoder.encode(`${canonicalJson(document)}\n`);
  if (bytes.byteLength > RELEASE_MAX_BYTES)
    return refuse([
      { reason: "byte-limit", path: "", message: "The sets exceed the 16 MiB byte ceiling." },
    ]);
  // Byte views cannot be frozen; the document and result records are.
  return Object.freeze({
    status: "ok" as const,
    value: Object.freeze({ document: deepFreeze(document), bytes, sha256: sha256Hex(bytes) }),
    diagnostics: Object.freeze([]) as unknown as [],
  });
}

const invalid = (problem: Problem): CatalogDiagnostic =>
  Object.freeze({
    code: "INPUT_INVALID" as const,
    reason: problem.reason,
    message: problem.message,
    blocking: true,
    path: problem.path,
  });

/**
 * Reads a release sets document against its checked release and returns a
 * checked view of that release carrying the sets. Every digest is recomputed.
 */
export function readReleaseSets(
  bytes: Uint8Array,
  options: { readonly expectedSha256: string; readonly release: CatalogRelease },
): ReadReleaseSetsResult {
  const refused = (...diagnostics: CatalogDiagnostic[]): ReadReleaseSetsResult =>
    Object.freeze({ valid: false, diagnostics: Object.freeze(diagnostics) });
  const expected = (options as { expectedSha256?: unknown } | undefined)?.expectedSha256;
  if (typeof expected !== "string" || !SHA256.test(expected))
    return refused(
      invalid({
        reason: "expected-sha256-required",
        path: "",
        message: "Sets are read only against the caller's expected lowercase SHA-256.",
      }),
    );
  if (!(bytes instanceof Uint8Array))
    return refused(
      invalid({ reason: "malformed-bytes", path: "", message: "Sets bytes must be a Uint8Array." }),
    );
  if (bytes.byteLength > RELEASE_MAX_BYTES)
    return refused(
      invalid({
        reason: "byte-limit",
        path: "",
        message: "The sets exceed the 16 MiB byte ceiling.",
      }),
    );
  if (sha256Hex(bytes) !== expected)
    return refused(
      invalid({
        reason: "sets-integrity-mismatch",
        path: "",
        message: "The sets bytes do not match the expected SHA-256.",
      }),
    );
  const unchecked = releaseProblem(options.release);
  if (unchecked) return refused(invalid(unchecked));
  const release = options.release;
  let value: unknown;
  try {
    value = readCanonicalBytes(bytes, { maxBytes: RELEASE_MAX_BYTES, maxDepth: RELEASE_MAX_DEPTH });
  } catch (error) {
    if (!(error instanceof JsonAdmissionError)) throw error;
    return refused(
      invalid({
        reason: error.reason,
        path: "",
        message: "The sets are not bounded canonical JSON with one LF.",
      }),
    );
  }
  if (isRecord(value) && value.schema !== RELEASE_SETS_SCHEMA_ID)
    return refused(
      Object.freeze({
        code: "SCHEMA_UNSUPPORTED" as const,
        reason: "schema-unsupported",
        message: "This reader supports release sets 1.0.0 only.",
        blocking: true,
        path: "/schema",
        encountered:
          typeof value.schema === "string" ? value.schema.slice(0, 256) : String(value.schema),
        supported: Object.freeze([RELEASE_SETS_SCHEMA_ID]),
      }),
    );
  if (
    !exactFields(value, ["schema", "release", "sets"]) ||
    !exactFields(value.release, ["framework", "releaseVersion"]) ||
    !Array.isArray(value.sets)
  )
    return refused(
      invalid({ reason: "sets-invalid", path: "", message: "Expected { schema, release, sets }." }),
    );
  if (
    value.release.framework !== release.framework?.id ||
    value.release.releaseVersion !== release.framework?.version
  )
    return refused(
      invalid({
        reason: "sets-release-mismatch",
        path: "/release",
        message: "The sets belong to another framework release.",
      }),
    );
  const checked = checkSets(value.sets, release, "read");
  if (!checked.sets) return refused(...checked.problems.map(invalid));
  const sets = deepFreeze(checked.sets);
  const attached = deepFreeze({ ...release, sets }) as CatalogRelease;
  checkedReleases.add(attached);
  extendedReleases.set(attached, release);
  return Object.freeze({
    valid: true,
    release: attached,
    sets,
    diagnostics: Object.freeze([]) as readonly [],
  });
}
